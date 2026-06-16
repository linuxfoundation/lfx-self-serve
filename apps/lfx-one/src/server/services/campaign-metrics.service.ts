// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GADS_STATUS_ENUM, parseCampaignName, VALID_CAMPAIGN_STATUSES } from '@lfx-one/shared/constants';
import type {
  AudienceBucket,
  AudienceDemographics,
  CampaignActionItem,
  CampaignMetrics,
  CampaignMonitorResponse,
  KeywordMetrics,
  KeywordMetricsResponse,
  LinkedInMonitorResponse,
  PacingLabel,
  RedditMonitorResponse,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { gaqlSearch } from './campaign-proxy.service';
import { getLinkedInAnalytics } from './linkedin-ads.service';
import { getRedditAnalytics } from './reddit-ads.service';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// CampaignMetricsService — monitoring, keywords, audience demographics
// ---------------------------------------------------------------------------

export class CampaignMetricsService {
  // === Monitoring data ===

  public async getMonitorData(req: Request, days: number): Promise<CampaignMonitorResponse> {
    logger.debug(req, 'campaign_monitor', 'Fetching campaign metrics from Google Ads', { days });

    const { gaqlRange, effectiveDays } = resolveDateRange(days);

    const query = `
      SELECT campaign.name, campaign.status, campaign.id,
             campaign_budget.amount_micros,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions
      FROM campaign
      WHERE segments.date DURING ${gaqlRange}
        AND campaign.advertising_channel_type IN ('SEARCH', 'DEMAND_GEN')
        AND campaign.status IN ('ENABLED', 'PAUSED')
        AND metrics.impressions > 0
      ORDER BY metrics.cost_micros DESC`;

    const rows = await gaqlSearch(query);
    const rangeStart = queryRangeStart(effectiveDays);
    const rangeEnd = todayIso();
    const campaigns = rows.map((row) => parseCampaignMetrics(row, effectiveDays, rangeStart, rangeEnd)).filter((c) => !c.name.toLowerCase().startsWith('zz'));
    const actionItems = generateActionItems(campaigns);

    return {
      pulledAt: new Date().toISOString(),
      dateRange: { mode: `last_${effectiveDays}_days` },
      campaigns,
      accountTotals: aggregateTotals(campaigns),
      actionItems,
    };
  }

  // === Keyword metrics ===

  public async getKeywords(req: Request, days: number): Promise<KeywordMetricsResponse> {
    logger.debug(req, 'campaign_keywords', 'Fetching keyword metrics from Google Ads', { days });

    const { gaqlRange, effectiveDays } = resolveDateRange(days);

    const query = `
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             ad_group_criterion.quality_info.quality_score, ad_group_criterion.status,
             ad_group_criterion.criterion_id,
             ad_group.name, ad_group.id, campaign.name, campaign.id,
             metrics.impressions, metrics.clicks, metrics.ctr,
             metrics.cost_micros, metrics.conversions
      FROM keyword_view
      WHERE segments.date DURING ${gaqlRange}
      ORDER BY metrics.impressions DESC
      LIMIT 50`;

    const rows = await gaqlSearch(query);
    const keywords = rows.map(parseKeywordRow);
    const totals = {
      impressions: keywords.reduce((s, k) => s + k.impressions, 0),
      clicks: keywords.reduce((s, k) => s + k.clicks, 0),
      spend: keywords.reduce((s, k) => s + k.spend, 0),
      conversions: keywords.reduce((s, k) => s + k.conversions, 0),
      avgCtr: 0,
    };
    totals.avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;

    return { pulledAt: new Date().toISOString(), days: effectiveDays, totalKeywords: keywords.length, totals, keywords };
  }

  // === Audience demographics ===

  public async getAudience(req: Request, days: number): Promise<AudienceDemographics> {
    logger.debug(req, 'campaign_audience', 'Fetching audience demographics from Google Ads', { days });

    const { gaqlRange, effectiveDays } = resolveDateRange(days);

    const ageQuery = `SELECT ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM age_range_view WHERE segments.date DURING ${gaqlRange}`;

    const genderQuery = `SELECT ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM gender_view WHERE segments.date DURING ${gaqlRange}`;

    const deviceQuery = `SELECT segments.device, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM campaign WHERE segments.date DURING ${gaqlRange}`;

    const [ageRows, genderRows, deviceRows] = await Promise.all([gaqlSearch(ageQuery), gaqlSearch(genderQuery), gaqlSearch(deviceQuery)]);

    const age = aggregateDemoBuckets(ageRows, (r) => (extractNested(r, 'ad_group_criterion.age_range.type') as string) || 'Unknown');
    const gender = aggregateDemoBuckets(genderRows, (r) => (extractNested(r, 'ad_group_criterion.gender.type') as string) || 'Unknown');
    const device = aggregateDemoBuckets(deviceRows, (r) => (extractNested(r, 'segments.device') as string) || 'Unknown');

    return { pulledAt: new Date().toISOString(), days: effectiveDays, age, gender, device };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveDateRange(days: number): { gaqlRange: string; effectiveDays: number } {
  if (days <= 7) return { gaqlRange: 'LAST_7_DAYS', effectiveDays: 7 };
  if (days <= 14) return { gaqlRange: 'LAST_14_DAYS', effectiveDays: 14 };
  return { gaqlRange: 'LAST_30_DAYS', effectiveDays: 30 };
}

function extractNested(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeCampaignStatus(raw: unknown): CampaignMetrics['status'] {
  if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
    return GADS_STATUS_ENUM[Number(raw)] ?? 'unknown';
  }
  const status = String(raw ?? 'unknown').toLowerCase() as CampaignMetrics['status'];
  return VALID_CAMPAIGN_STATUSES.has(status) ? status : 'unknown';
}

function buildGoogleAdsUrl(campaignId: string): string {
  return campaignId ? `https://ads.google.com/aw/campaigns?campaignId=${campaignId}` : '';
}

function computeTotalBudget(budgetDay: number, days: number): number {
  return budgetDay * days;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function queryRangeStart(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

function parseCampaignMetrics(row: unknown, days: number, rangeStart: string, rangeEnd: string): CampaignMetrics {
  const r = row as Record<string, unknown>;
  const name = (extractNested(r, 'campaign.name') as string) || '';
  const parsed = parseCampaignName(name);
  const campaignId = String(extractNested(r, 'campaign.id') || '');
  const budgetMicros = Number(extractNested(r, 'campaign_budget.amount_micros') || 0);
  const costMicros = Number(extractNested(r, 'metrics.cost_micros') || 0);
  const impressions = Number(extractNested(r, 'metrics.impressions') || 0);
  const clicks = Number(extractNested(r, 'metrics.clicks') || 0);
  const conversions = Number(extractNested(r, 'metrics.conversions') || 0);
  const budgetDay = budgetMicros / 1_000_000;
  const spend = costMicros / 1_000_000;
  const expectedSpend = budgetDay * days;
  const pacingPct = expectedSpend > 0 ? Math.round((spend / expectedSpend) * 100) : 0;

  let pacingLabel: PacingLabel = 'normal';
  if (pacingPct < 50) pacingLabel = 'underspending';
  else if (pacingPct > 100) pacingLabel = 'overspending';
  else if (pacingPct > 90) pacingLabel = 'constrained';

  return {
    name,
    shortName: parsed.baseName || name,
    eventName: parsed.baseName,
    adFormat: parsed.adFormat,
    targeting: parsed.targeting,
    status: normalizeCampaignStatus(extractNested(r, 'campaign.status')),
    startDate: rangeStart,
    endDate: rangeEnd,
    budgetDay,
    totalBudget: computeTotalBudget(budgetDay, days),
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    avgCpc: clicks > 0 ? spend / clicks : 0,
    conversions,
    pacingPct,
    pacingLabel,
    campaignId,
    googleAdsUrl: buildGoogleAdsUrl(campaignId),
  };
}

function aggregateTotals(campaigns: CampaignMetrics[]) {
  return {
    budgetDay: campaigns.reduce((s, c) => s + c.budgetDay, 0),
    spend: campaigns.reduce((s, c) => s + c.spend, 0),
    impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
    clicks: campaigns.reduce((s, c) => s + c.clicks, 0),
    conversions: campaigns.reduce((s, c) => s + c.conversions, 0),
  };
}

function generateActionItems(campaigns: CampaignMetrics[]): CampaignActionItem[] {
  const items: CampaignActionItem[] = [];

  for (const c of campaigns) {
    const isSearch = c.adFormat.toLowerCase().includes('search');
    const baseMetrics = {
      spend: c.spend,
      budget: c.budgetDay,
      pacingPct: c.pacingPct,
      impressions: c.impressions,
      clicks: c.clicks,
      conversions: c.conversions,
    };

    if (c.status === 'limited') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'HIGH',
        issue: `Campaign limited by Google — only ${c.impressions.toLocaleString()} impressions on $${c.budgetDay.toFixed(2)}/day budget`,
        action: 'Switch bid strategy to Maximize Clicks, or expand keyword match types to increase eligible auctions',
        metrics: baseMetrics,
      });
    }
    if (c.budgetDay <= 1 && c.status === 'enabled') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'HIGH',
        issue: `Budget is $${c.budgetDay.toFixed(2)}/day — this is a placeholder and won't generate meaningful traffic`,
        action: 'Set a real daily budget (typically $10–50/day for events) before expecting results',
        metrics: baseMetrics,
      });
    }
    if (c.status === 'paused') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Campaign is paused — spent $${c.spend.toFixed(2)} before pause`,
        action: 'Check if this was intentionally paused or if the event is still upcoming and needs reactivation',
        metrics: baseMetrics,
      });
    }
    if (c.pacingLabel === 'underspending' && c.status === 'enabled') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Only spending ${c.pacingPct}% of $${c.budgetDay.toFixed(2)}/day budget — $${c.spend.toFixed(2)} spent vs $${(c.budgetDay * 30).toFixed(2)} expected`,
        action: 'Broaden targeting (locations, audiences), add broad match keywords, or increase bids to win more auctions',
        metrics: baseMetrics,
      });
    }
    if (c.pacingLabel === 'constrained' && c.status === 'enabled') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Spending ${c.pacingPct}% of budget — demand exceeds $${c.budgetDay.toFixed(2)}/day cap, ads stop showing mid-day`,
        action: 'Increase daily budget to capture missed impressions, or narrow targeting to focus spend on highest-value audiences',
        metrics: baseMetrics,
      });
    }
    if (isSearch && c.ctr < 2 && c.clicks > 10) {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Search CTR is ${c.ctr.toFixed(2)}% (benchmark: 2%+) — ${c.clicks} clicks from ${c.impressions.toLocaleString()} impressions`,
        action: 'Improve headline relevance to search intent, add negative keywords to filter irrelevant queries',
        metrics: baseMetrics,
      });
    }
    if (!isSearch && c.ctr < 0.3 && c.impressions > 1000) {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Display CTR is ${c.ctr.toFixed(2)}% (benchmark: 0.3%+) — ${c.clicks} clicks from ${c.impressions.toLocaleString()} impressions`,
        action: 'Refresh creative assets, check for audience overlap across campaigns, or narrow placement targeting',
        metrics: baseMetrics,
      });
    }
    if (c.clicks > 20 && c.conversions === 0) {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `${c.clicks} clicks ($${c.spend.toFixed(2)} spent) but 0 conversions — traffic is not converting`,
        action: 'Verify conversion tracking is firing correctly, check landing page load speed, and review if the CTA matches the ad promise',
        metrics: baseMetrics,
      });
    }
    if (c.avgCpc > 5 && c.clicks > 10) {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Avg CPC is $${c.avgCpc.toFixed(2)} — spending $${c.spend.toFixed(2)} for only ${c.clicks} clicks`,
        action: 'Switch to a Target CPA or Maximize Clicks bid strategy, add long-tail keywords with lower competition',
        metrics: baseMetrics,
      });
    }
    if (c.impressions > 0 && c.clicks === 0) {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `${c.impressions.toLocaleString()} impressions but 0 clicks — ads are showing but no one is clicking`,
        action: 'Rewrite ad copy to be more compelling, ensure headlines match search intent, test different CTAs',
        metrics: baseMetrics,
      });
    }
    if (c.status === 'draft') {
      items.push({
        eventName: c.eventName,
        campaigns: [c.shortName],
        campaignUrls: { [c.shortName]: c.googleAdsUrl },
        priority: 'MED',
        issue: `Campaign is still in draft — $${c.budgetDay.toFixed(2)}/day budget allocated but not running`,
        action: 'Upload creative assets, review ad groups, publish the campaign (then pause if not ready to go live)',
        metrics: baseMetrics,
      });
    }
  }

  const priorityOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  items.sort((a: CampaignActionItem, b: CampaignActionItem) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  return items;
}

function parseKeywordRow(row: unknown): KeywordMetrics {
  const r = row as Record<string, unknown>;
  const costMicros = Number(extractNested(r, 'metrics.cost_micros') || 0);
  const clicks = Number(extractNested(r, 'metrics.clicks') || 0);
  const campaignId = String(extractNested(r, 'campaign.id') || '');
  return {
    keyword: (extractNested(r, 'ad_group_criterion.keyword.text') as string) || '',
    matchType: (extractNested(r, 'ad_group_criterion.keyword.match_type') as string) || '',
    qualityScore: (extractNested(r, 'ad_group_criterion.quality_info.quality_score') as number) ?? null,
    status: (extractNested(r, 'ad_group_criterion.status') as string) || '',
    adGroup: (extractNested(r, 'ad_group.name') as string) || '',
    adGroupId: String(extractNested(r, 'ad_group.id') || ''),
    criterionId: String(extractNested(r, 'ad_group_criterion.criterion_id') || ''),
    campaign: (extractNested(r, 'campaign.name') as string) || '',
    campaignId,
    googleAdsUrl: buildGoogleAdsUrl(campaignId),
    impressions: Number(extractNested(r, 'metrics.impressions') || 0),
    clicks,
    ctr: Number(extractNested(r, 'metrics.ctr') || 0) * 100,
    avgCpc: clicks > 0 ? costMicros / 1_000_000 / clicks : 0,
    spend: costMicros / 1_000_000,
    conversions: Number(extractNested(r, 'metrics.conversions') || 0),
  };
}

function aggregateDemoBuckets(rows: unknown[], labelExtractor: (row: Record<string, unknown>) => string): AudienceBucket[] {
  const buckets = new Map<string, AudienceBucket>();

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const label = labelExtractor(r) || 'Unknown';
    const existing = buckets.get(label) || { label, impressions: 0, clicks: 0, ctr: 0, spend: 0, conversions: 0 };
    existing.impressions += Number(extractNested(r, 'metrics.impressions') || 0);
    existing.clicks += Number(extractNested(r, 'metrics.clicks') || 0);
    existing.spend += Number(extractNested(r, 'metrics.cost_micros') || 0) / 1_000_000;
    existing.conversions += Number(extractNested(r, 'metrics.conversions') || 0);
    existing.ctr = existing.impressions > 0 ? (existing.clicks / existing.impressions) * 100 : 0;
    buckets.set(label, existing);
  }

  return [...buckets.values()];
}

// ---------------------------------------------------------------------------
// CampaignMetricsService — LinkedIn analytics
// ---------------------------------------------------------------------------

export class LinkedInMetricsService {
  public async getLinkedInMonitorData(req: Request, accountId: string, days: number): Promise<LinkedInMonitorResponse> {
    logger.debug(req, 'linkedin_monitor', 'Fetching LinkedIn campaign analytics', { accountId, days });
    return getLinkedInAnalytics(req, accountId, days);
  }
}

// ---------------------------------------------------------------------------
// CampaignMetricsService — Reddit analytics
// ---------------------------------------------------------------------------

export class RedditMetricsService {
  public async getRedditMonitorData(req: Request, accountId: string, days: number): Promise<RedditMonitorResponse> {
    logger.debug(req, 'reddit_monitor', 'Fetching Reddit campaign analytics', { accountId, days });
    return getRedditAnalytics(req, accountId, days);
  }
}
