// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  AudienceBucket,
  AudienceDemographics,
  CampaignMetrics,
  CampaignMonitorResponse,
  KeywordMetrics,
  KeywordMetricsResponse,
  PacingLabel,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { gaqlSearch } from './campaign-proxy.service';
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
      SELECT campaign.name, campaign.status, campaign_budget.amount_micros,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${gaqlRange}
        AND campaign.advertising_channel_type IN ('SEARCH', 'DEMAND_GEN')
      ORDER BY metrics.cost_micros DESC`;

    const rows = await gaqlSearch(query);
    const campaigns = rows.map((row) => parseCampaignMetrics(row, effectiveDays));
    const actionItems = generateActionItems(campaigns);

    for (const campaign of campaigns) {
      campaign.actionRules = actionItems.filter((a) => a.campaign === campaign.shortName);
    }

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
             ad_group.name, campaign.name,
             metrics.impressions, metrics.clicks, metrics.ctr,
             metrics.cost_micros, metrics.conversions
      FROM keyword_view
      WHERE segments.date DURING ${gaqlRange}
      ORDER BY metrics.impressions DESC
      LIMIT 200`;

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

    const { gaqlRange } = resolveDateRange(days);

    const ageQuery = `SELECT ad_group_criterion.age_range.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM age_range_view WHERE segments.date DURING ${gaqlRange}`;

    const genderQuery = `SELECT ad_group_criterion.gender.type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM gender_view WHERE segments.date DURING ${gaqlRange}`;

    const [ageRows, genderRows] = await Promise.all([gaqlSearch(ageQuery), gaqlSearch(genderQuery)]);

    const age = aggregateDemoBuckets(ageRows, (r) => (extractNested(r, 'adGroupCriterion.ageRange.type') as string) || 'Unknown');
    const gender = aggregateDemoBuckets(genderRows, (r) => (extractNested(r, 'adGroupCriterion.gender.type') as string) || 'Unknown');

    return { pulledAt: new Date().toISOString(), days, age, gender, device: [] };
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

const VALID_CAMPAIGN_STATUSES = new Set<CampaignMetrics['status']>(['enabled', 'paused', 'removed', 'limited', 'draft']);

function normalizeCampaignStatus(raw: string | undefined): CampaignMetrics['status'] {
  const status = (raw ?? 'unknown').toLowerCase() as CampaignMetrics['status'];
  return VALID_CAMPAIGN_STATUSES.has(status) ? status : 'unknown';
}

function parseCampaignMetrics(row: unknown, days: number): CampaignMetrics {
  const r = row as Record<string, unknown>;
  const name = (extractNested(r, 'campaign.name') as string) || '';
  const parts = name.split(' | ');
  const budgetMicros = Number(extractNested(r, 'campaignBudget.amountMicros') || 0);
  const costMicros = Number(extractNested(r, 'metrics.costMicros') || 0);
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
    shortName: parts[1] || name,
    eventName: parts[1] || '',
    adFormat: parts[5] || '',
    targeting: parts[4] || '',
    status: normalizeCampaignStatus(extractNested(r, 'campaign.status') as string | undefined),
    budgetDay,
    spend,
    impressions,
    clicks,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    avgCpc: clicks > 0 ? spend / clicks : 0,
    conversions,
    pacingPct,
    pacingLabel,
    actionRules: [],
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

function generateActionItems(campaigns: CampaignMetrics[]) {
  const items: CampaignMetrics['actionRules'] = [];
  for (const c of campaigns) {
    const isSearch = c.adFormat.toLowerCase().includes('search');

    if (c.status === 'limited') {
      items.push({
        campaign: c.shortName,
        priority: 'HIGH',
        issue: 'Campaign limited by Google',
        action: 'Switch bid to Maximize Clicks or expand keyword match types',
        owner: 'ads-manager',
      });
    }
    if (c.budgetDay <= 1 && c.status === 'enabled') {
      items.push({
        campaign: c.shortName,
        priority: 'HIGH',
        issue: 'Placeholder $1/day budget',
        action: 'Set real budget before activation',
        owner: 'stakeholder',
      });
    }
    if (c.status === 'paused') {
      items.push({ campaign: c.shortName, priority: 'MED', issue: 'Campaign paused', action: 'Verify pause reason or activate', owner: 'ads-manager' });
    }
    if (c.pacingLabel === 'underspending' && c.status === 'enabled') {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: `Underspending (${c.pacingPct}% of budget)`,
        action: 'Broaden targeting or increase bids',
        owner: 'ads-manager',
      });
    }
    if (c.pacingLabel === 'constrained' && c.status === 'enabled') {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: `Budget constrained (${c.pacingPct}%)`,
        action: 'Consider budget increase',
        owner: 'stakeholder',
      });
    }
    if (isSearch && c.ctr < 2 && c.clicks > 50) {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: 'Low Search CTR (<2%)',
        action: 'Review headline relevance, add negative keywords',
        owner: 'ads-manager',
      });
    }
    if (!isSearch && c.ctr < 0.3 && c.clicks > 50) {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: 'Low Display CTR (<0.3%)',
        action: 'Refresh creative, check audience overlap',
        owner: 'ads-manager',
      });
    }
    if (c.clicks > 100 && c.conversions === 0) {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: 'Clicks with zero conversions',
        action: 'Audit conversion tracking setup',
        owner: 'ads-manager',
      });
    }
    if (c.status === 'draft') {
      items.push({
        campaign: c.shortName,
        priority: 'MED',
        issue: 'Campaign in draft',
        action: 'Complete setup: upload images, publish, then pause',
        owner: 'ads-manager',
      });
    }
  }
  const priorityOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  return items;
}

function parseKeywordRow(row: unknown): KeywordMetrics {
  const r = row as Record<string, unknown>;
  const costMicros = Number(extractNested(r, 'metrics.costMicros') || 0);
  const clicks = Number(extractNested(r, 'metrics.clicks') || 0);
  return {
    keyword: (extractNested(r, 'adGroupCriterion.keyword.text') as string) || '',
    matchType: (extractNested(r, 'adGroupCriterion.keyword.matchType') as string) || '',
    qualityScore: (extractNested(r, 'adGroupCriterion.qualityInfo.qualityScore') as number) ?? null,
    status: (extractNested(r, 'adGroupCriterion.status') as string) || '',
    adGroup: (extractNested(r, 'adGroup.name') as string) || '',
    campaign: (extractNested(r, 'campaign.name') as string) || '',
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
    existing.spend += Number(extractNested(r, 'metrics.costMicros') || 0) / 1_000_000;
    existing.conversions += Number(extractNested(r, 'metrics.conversions') || 0);
    existing.ctr = existing.impressions > 0 ? (existing.clicks / existing.impressions) * 100 : 0;
    buckets.set(label, existing);
  }

  return [...buckets.values()];
}
