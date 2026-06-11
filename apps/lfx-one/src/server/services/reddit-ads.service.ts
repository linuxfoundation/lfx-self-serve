// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  RedditActionItem,
  RedditAccountTotals,
  RedditCampaignCreateRequest,
  RedditCampaignCreateResult,
  RedditCampaignMetrics,
  RedditMonitorResponse,
  RedditPacingLabel,
} from '@lfx-one/shared/interfaces';

import type { Request } from 'express';

import {
  REDDIT_ACCOUNTS,
  REDDIT_REPORT_MAX_POLLS,
  REDDIT_REPORT_POLL_INTERVAL_MS,
  REDDIT_REQUEST_TIMEOUT_MS,
  REDDIT_TOKEN_EXPIRY_BUFFER_SECONDS,
} from '../constants';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// Reddit Ads API Constants
// ---------------------------------------------------------------------------

const REDDIT_ADS_BASE_URL = 'https://ads-api.reddit.com/api/v3';
const REDDIT_TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const REDDIT_USER_AGENT = 'LFXAdsManager/1.0';

// ---------------------------------------------------------------------------
// Token Cache
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function getRedditEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function refreshRedditToken(): Promise<string> {
  if (cachedToken && Date.now() / 1000 < tokenExpiresAt - REDDIT_TOKEN_EXPIRY_BUFFER_SECONDS) {
    return cachedToken;
  }

  const clientId = getRedditEnv('REDDIT_CLIENT_ID');
  const clientSecret = getRedditEnv('REDDIT_CLIENT_SECRET');
  const refreshToken = getRedditEnv('REDDIT_REFRESH_TOKEN');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });

  const resp = await fetch(REDDIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REDDIT_REQUEST_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Reddit token refresh failed: ${resp.status}: ${text.slice(0, 400)}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() / 1000 + data.expires_in;
  return cachedToken;
}

// ---------------------------------------------------------------------------
// HTTP Helper
// ---------------------------------------------------------------------------

interface RedditApiResponse {
  data?: unknown;
  [key: string]: unknown;
}

async function redditRequest(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>): Promise<RedditApiResponse> {
  const token = await refreshRedditToken();

  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': REDDIT_USER_AGENT,
    },
    signal: AbortSignal.timeout(REDDIT_REQUEST_TIMEOUT_MS),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Reddit API ${method} ${url} → ${resp.status}: ${text.slice(0, 400)}`);
  }

  return (await resp.json()) as RedditApiResponse;
}

// ---------------------------------------------------------------------------
// Async Report Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RedditReportRow {
  campaign_id?: string;
  campaign_name?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  conversions?: string;
  [key: string]: string | undefined;
}

function parseCsv(csv: string): RedditReportRow[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: RedditReportRow = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = values[i]?.trim();
    }
    return row;
  });
}

async function requestAndPollReport(accountId: string, startDate: string, endDate: string): Promise<RedditReportRow[]> {
  const reportBody = {
    level: 'campaign',
    metrics: ['impressions', 'clicks', 'spend', 'conversions'],
    date_range: { since: startDate, until: endDate },
  };

  const createResp = await redditRequest('POST', `${REDDIT_ADS_BASE_URL}/accounts/${accountId}/reports`, reportBody);
  const reportId = (createResp.data as { id?: string })?.id;
  if (!reportId) {
    throw new Error('Reddit report creation returned no report ID');
  }

  for (let poll = 0; poll < REDDIT_REPORT_MAX_POLLS; poll++) {
    await sleep(REDDIT_REPORT_POLL_INTERVAL_MS);

    const statusResp = await redditRequest('GET', `${REDDIT_ADS_BASE_URL}/accounts/${accountId}/reports/${reportId}`);
    const reportData = statusResp.data as { status?: string; download_url?: string } | undefined;
    const status = reportData?.status;

    if (status === 'FAILED') {
      throw new Error(`Reddit report ${reportId} failed`);
    }

    if (status === 'COMPLETED' && reportData?.download_url) {
      const csvResp = await fetch(reportData.download_url, {
        headers: { 'User-Agent': REDDIT_USER_AGENT },
        signal: AbortSignal.timeout(REDDIT_REQUEST_TIMEOUT_MS),
      });
      if (!csvResp.ok) {
        throw new Error(`Reddit report download failed: ${csvResp.status}`);
      }
      const csv = await csvResp.text();
      return parseCsv(csv);
    }
  }

  throw new Error(`Reddit report ${reportId} timed out after ${REDDIT_REPORT_MAX_POLLS} polls`);
}

// ---------------------------------------------------------------------------
// Campaign List
// ---------------------------------------------------------------------------

interface RedditCampaignElement {
  id: string;
  name: string;
  status: string;
  budget_total?: { amount_micros: number };
  budget_daily?: { amount_micros: number };
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
}

async function fetchCampaigns(accountId: string): Promise<RedditCampaignElement[]> {
  const resp = await redditRequest('GET', `${REDDIT_ADS_BASE_URL}/accounts/${accountId}/campaigns`);
  const data = resp.data as { campaigns?: RedditCampaignElement[] } | RedditCampaignElement[] | undefined;

  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { campaigns?: RedditCampaignElement[] }).campaigns)) {
    return (data as { campaigns: RedditCampaignElement[] }).campaigns;
  }

  const elements = resp.data as unknown;
  if (Array.isArray(elements)) return elements as RedditCampaignElement[];
  return [];
}

// ---------------------------------------------------------------------------
// Public API — Analytics
// ---------------------------------------------------------------------------

export async function getRedditAnalytics(req: Request, accountId: string, days: number): Promise<RedditMonitorResponse> {
  const startTime = logger.startOperation(req, 'reddit_analytics', { accountId, days });

  const account = REDDIT_ACCOUNTS.find((a) => a.accountId === accountId) ?? REDDIT_ACCOUNTS[0];
  const endDate = new Date().toISOString().split('T')[0];
  const startDateObj = new Date();
  startDateObj.setUTCDate(startDateObj.getUTCDate() - days);
  const startDate = startDateObj.toISOString().split('T')[0];

  const campaigns = await fetchCampaigns(accountId);
  const activeCampaigns = campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'PAUSED');

  if (activeCampaigns.length === 0) {
    logger.success(req, 'reddit_analytics', startTime, { campaigns: 0 });
    return {
      accountLabel: account?.label ?? accountId,
      pulledAt: new Date().toISOString(),
      dateRange: { mode: `last_${days}_days` },
      campaigns: [],
      accountTotals: { spend: 0, impressions: 0, clicks: 0, conversions: 0, campaignCount: 0 },
      actionItems: [],
    };
  }

  let reportRows: RedditReportRow[] = [];
  try {
    reportRows = await requestAndPollReport(accountId, startDate, endDate);
  } catch (err) {
    logger.warning(req, 'reddit_analytics', 'Reddit report fetch failed — metrics will show zero', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  const metricsMap = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number }>();
  for (const row of reportRows) {
    const campId = row.campaign_id ?? '';
    if (!campId) continue;
    metricsMap.set(campId, {
      impressions: parseInt(row.impressions ?? '0', 10),
      clicks: parseInt(row.clicks ?? '0', 10),
      spend: parseInt(row.spend ?? '0', 10) / 1_000_000,
      conversions: parseInt(row.conversions ?? '0', 10),
    });
  }

  const campaignMetrics: RedditCampaignMetrics[] = activeCampaigns.map((camp) => {
    const metrics = metricsMap.get(camp.id) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    const totalBudget = (camp.budget_total?.amount_micros ?? 0) / 1_000_000;
    const dailyBudget = (camp.budget_daily?.amount_micros ?? 0) / 1_000_000;

    const schedStart = camp.start_time ? new Date(camp.start_time).getTime() : 0;
    const schedEnd = camp.end_time ? new Date(camp.end_time).getTime() : 0;
    const now = Date.now();

    let pacingPct = 0;
    if (totalBudget > 0 && schedStart > 0) {
      const flightEnd = schedEnd || now;
      const totalFlightDays = Math.max(1, Math.ceil((flightEnd - schedStart) / 86_400_000));
      const elapsedDays = Math.max(1, Math.ceil((now - schedStart) / 86_400_000));
      const expectedSpend = (totalBudget / totalFlightDays) * Math.min(elapsedDays, totalFlightDays);
      pacingPct = expectedSpend > 0 ? Math.round((metrics.spend / expectedSpend) * 100) : 0;
    } else if (dailyBudget > 0) {
      const expectedSpend = dailyBudget * days;
      pacingPct = expectedSpend > 0 ? Math.round((metrics.spend / expectedSpend) * 100) : 0;
    }

    let pacingLabel: RedditPacingLabel = 'normal';
    if (pacingPct < 50) pacingLabel = 'underspending';
    else if (pacingPct > 100) pacingLabel = 'overspending';
    else if (pacingPct > 90) pacingLabel = 'constrained';

    return {
      campaignId: camp.id,
      campaignName: camp.name,
      status: camp.status,
      totalBudget,
      dailyBudget,
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      ctr: metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0,
      conversions: metrics.conversions,
      pacingPct,
      pacingLabel,
      startDate: camp.start_time ? new Date(camp.start_time).toISOString().split('T')[0] : startDate,
      endDate: camp.end_time ? new Date(camp.end_time).toISOString().split('T')[0] : endDate,
    };
  });

  const accountTotals: RedditAccountTotals = {
    spend: campaignMetrics.reduce((s, c) => s + c.spend, 0),
    impressions: campaignMetrics.reduce((s, c) => s + c.impressions, 0),
    clicks: campaignMetrics.reduce((s, c) => s + c.clicks, 0),
    conversions: campaignMetrics.reduce((s, c) => s + c.conversions, 0),
    campaignCount: campaignMetrics.length,
  };

  const actionItems = buildRedditActionItems(campaignMetrics);

  logger.success(req, 'reddit_analytics', startTime, { campaigns: campaignMetrics.length });

  return {
    accountLabel: account?.label ?? accountId,
    pulledAt: new Date().toISOString(),
    dateRange: { mode: `last_${days}_days` },
    campaigns: campaignMetrics,
    accountTotals,
    actionItems,
  };
}

// ---------------------------------------------------------------------------
// Campaign Creation
// ---------------------------------------------------------------------------

const REDDIT_ADS_MANAGER_URL = 'https://ads.reddit.com';

function toMicrodollars(usd: number): number {
  return Math.round(usd * 1_000_000);
}

function toRedditTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function toIsoTimestamp(dateStr: string): string {
  return toRedditTimestamp(new Date(`${dateStr}T00:00:00+00:00`));
}

interface RedditCampaignData {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

interface CampaignLookupResult {
  id: string;
  startTime?: string;
  endTime?: string;
}

async function findCampaignByName(accountId: string, name: string): Promise<CampaignLookupResult | null> {
  try {
    const resp = await redditRequest('GET', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}/campaigns`);
    const data = resp.data as { campaigns?: RedditCampaignData[] } | RedditCampaignData[] | undefined;
    const items = Array.isArray(data) ? data : ((data as { campaigns?: RedditCampaignData[] })?.campaigns ?? []);
    for (const item of items) {
      if (item.name === name) {
        return {
          id: String(item.id ?? ''),
          startTime: item['start_time'] as string | undefined,
          endTime: item['end_time'] as string | undefined,
        };
      }
    }
  } catch {
    // Campaign search failed — proceed to create
  }
  return null;
}

async function findAdGroupByName(accountId: string, campaignId: string, name: string): Promise<string | null> {
  try {
    const resp = await redditRequest('GET', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}/ad_groups?campaign_id=${campaignId}`);
    const groups = (resp.data as { ad_groups?: RedditCampaignData[] })?.ad_groups ?? [];
    for (const item of groups) {
      if (item.name === name) return String(item.id ?? '');
    }
  } catch {
    // Ad group search failed — proceed to create
  }
  return null;
}

const GEO_TO_REGION: Record<string, string> = {
  US: 'NA',
  CA: 'NA',
  MX: 'NA',
  GB: 'EMEA',
  DE: 'EMEA',
  FR: 'EMEA',
  NL: 'EMEA',
  SE: 'EMEA',
  CH: 'EMEA',
  ES: 'EMEA',
  IT: 'EMEA',
  AT: 'EMEA',
  BE: 'EMEA',
  IL: 'EMEA',
  IN: 'India',
  JP: 'APAC',
  KR: 'APAC',
  SG: 'APAC',
  AU: 'APAC',
  CN: 'APAC',
  TW: 'APAC',
  HK: 'APAC',
  BR: 'LATAM',
};

function resolveRegion(geoTargets: string[]): string {
  if (geoTargets.length === 0) return 'Global';
  const primaryGeo = geoTargets[0].toUpperCase();
  return GEO_TO_REGION[primaryGeo] || 'Global';
}

function buildRedditCampaignName(config: RedditCampaignCreateRequest): string {
  const event = config.eventName.replace(/\|/g, '-');
  const region = resolveRegion(config.geoTargets);
  const project = (config.project || 'Linux Foundation').replace(/\|/g, '-');
  return `Events | ${event} | ${region} | Conversions | Intent | Social | ${project} | ToFU`;
}

function buildRedditUtmUrl(config: RedditCampaignCreateRequest, variantIndex: number): string {
  const base = config.registrationUrl.replace(/\/$/, '');
  const slug = config.eventSlug || config.eventName.toLowerCase().replace(/\s+/g, '-');
  const params = new URLSearchParams({
    utm_source: 'reddit',
    utm_medium: 'paid-social',
    utm_campaign: config.hsToken || slug,
    utm_term: config.eventName.replace(/\s+/g, '-').toLowerCase(),
    utm_content: `variant-${variantIndex + 1}`,
  });
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}

export async function executeRedditCampaignCreation(req: Request | undefined, config: RedditCampaignCreateRequest): Promise<RedditCampaignCreateResult> {
  const startTime = logger.startOperation(req, 'reddit_campaign_create', { eventName: config.eventName });
  const steps: string[] = [];
  const account = REDDIT_ACCOUNTS[0];
  const accountId = account.accountId;

  // Step 1: Verify account
  try {
    await redditRequest('GET', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}`);
    steps.push(`Account verified: ${account.label} (${accountId})`);
  } catch (err) {
    steps.push(`Account verification warning: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Step 2: Create or reuse campaign (PAUSED, lifetime budget)
  const campaignName = buildRedditCampaignName(config);
  const existingCampaign = await findCampaignByName(accountId, campaignName);
  let campaignId: string;
  let campaignStartTime = toIsoTimestamp(config.startDate);
  let campaignEndTime = toIsoTimestamp(config.endDate);

  if (existingCampaign) {
    campaignId = existingCampaign.id;
    if (existingCampaign.startTime) campaignStartTime = existingCampaign.startTime;
    if (existingCampaign.endTime) campaignEndTime = existingCampaign.endTime;
    steps.push(`Reusing existing campaign: ${campaignId}`);
  } else {
    const campaignBody = {
      data: {
        name: campaignName,
        objective: 'CONVERSIONS',
        configured_status: 'PAUSED',
        is_campaign_budget_optimization: true,
        bid_strategy: 'BIDLESS',
        bid_type: 'CPM',
        optimization_goal: 'PURCHASE',
        goal_type: 'LIFETIME_SPEND',
        goal_value: toMicrodollars(config.budgetUsd),
        view_through_conversion_type: 'SEVEN_DAY_CLICKS_ONE_DAY_VIEW',
        start_time: campaignStartTime,
        end_time: campaignEndTime,
      },
    };

    const campaignResp = await redditRequest('POST', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}/campaigns`, campaignBody);
    const campData = (campaignResp.data as RedditCampaignData) ?? {};
    campaignId = String(campData.id ?? '');
    steps.push(`Campaign created: ${campaignId} (PAUSED, $${config.budgetUsd.toFixed(2)} lifetime)`);
  }

  // Step 3: Create or reuse ad group with targeting
  const geoLabel = config.geoTargets.length > 0 ? config.geoTargets.join('+') : 'Global';
  const adGroupName = `Events | ${config.eventName.replace(/\|/g, '-')} | ${geoLabel} | Intent | Communities + Keywords`;
  let adGroupId = await findAdGroupByName(accountId, campaignId, adGroupName);

  if (adGroupId) {
    steps.push(`Reusing existing ad group: ${adGroupId}`);
  } else {
    const geos = config.geoTargets.length > 0 ? config.geoTargets.map((g) => g.toUpperCase()) : ['US'];
    const baseTargeting: Record<string, unknown> = {
      geolocations: geos,
      locations: ['FEED', 'COMMENTS_PAGE'],
      platforms: ['ALL'],
      expand_targeting: true,
    };

    if (config.keywords.length > 0) {
      baseTargeting['keywords'] = config.keywords;
    }

    const communityNames = config.subreddits.map((s) => s.replace(/^r\//, ''));
    const targetingWithCommunities = communityNames.length > 0 ? { ...baseTargeting, communities: communityNames } : baseTargeting;

    const campaignStartMs = new Date(campaignStartTime).getTime();
    const nowMs = Date.now();
    const effectiveStart = campaignStartMs < nowMs ? toRedditTimestamp(new Date(nowMs + 60_000)) : campaignStartTime;

    const buildAdGroupBody = (targeting: Record<string, unknown>) => ({
      data: {
        name: adGroupName,
        campaign_id: campaignId,
        configured_status: 'PAUSED',
        bid_strategy: 'BIDLESS',
        bid_type: 'CPM',
        optimization_goal: 'PURCHASE',
        targeting,
        start_time: effectiveStart,
        end_time: campaignEndTime,
      },
    });

    let adGroupResp: RedditApiResponse;
    let usedCommunities = communityNames.length > 0;
    try {
      adGroupResp = await redditRequest('POST', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}/ad_groups`, buildAdGroupBody(targetingWithCommunities));
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '';
      if (communityNames.length > 0 && errMsg.includes('invalid communities')) {
        steps.push(`Community targeting failed (invalid subreddits: ${communityNames.join(', ')}), retrying with keywords only`);
        usedCommunities = false;
        adGroupResp = await redditRequest('POST', `${REDDIT_ADS_BASE_URL}/ad_accounts/${accountId}/ad_groups`, buildAdGroupBody(baseTargeting));
      } else {
        throw err;
      }
    }

    const agData = (adGroupResp.data as RedditCampaignData) ?? {};
    adGroupId = String(agData.id ?? '');
    steps.push(`Ad group created: ${adGroupId} (PAUSED, geo: ${geos.join(', ')})`);
    if (usedCommunities) {
      steps.push(`Targeting: ${communityNames.length} communities, ${config.keywords.length} keywords, ${geos.length} geos`);
    } else {
      steps.push(`Targeting: ${config.keywords.length} keywords, ${geos.length} geos (communities skipped — add manually in Reddit Ads Manager)`);
    }
  }

  // Step 4: Reddit ads require a post_id — log UTM URLs and headlines for manual ad creation
  const variantCount = config.variants.length;
  if (variantCount > 0) {
    steps.push(`${variantCount} ad variant(s) ready — create ads in Reddit Ads Manager with these headlines:`);
    for (let i = 0; i < variantCount; i++) {
      const utmUrl = buildRedditUtmUrl(config, i);
      steps.push(`  Variant ${i + 1}: "${config.variants[i].headline}" → ${utmUrl}`);
    }
  } else {
    steps.push('No ad variants provided — add ads manually in Reddit Ads Manager');
  }

  logger.success(req, 'reddit_campaign_create', startTime, { campaignId, adGroupId });

  return {
    platform: 'reddit-ads',
    campaignName,
    campaignId,
    adGroupName,
    adGroupId,
    adCount: 0,
    redditUrl: REDDIT_ADS_MANAGER_URL,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Action Items
// ---------------------------------------------------------------------------

function buildRedditActionItems(campaigns: RedditCampaignMetrics[]): RedditActionItem[] {
  const items: RedditActionItem[] = [];

  for (const c of campaigns) {
    if (c.impressions === 0 && c.clicks === 0 && c.status === 'ACTIVE') {
      items.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: `Campaign "${c.campaignName}" has zero impressions and zero clicks — ads may not be delivering`,
        action: 'Check ad group targeting, bid amount, and creative approval status in Reddit Ads Manager',
      });
    }

    if (c.pacingPct > 0 && c.pacingPct < 40 && c.status === 'ACTIVE') {
      items.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: `Underspending at ${c.pacingPct}% of budget — $${c.spend.toFixed(2)} spent`,
        action: 'Broaden targeting (add subreddits/interests), increase bid, or expand geographic targeting',
      });
    }

    if (c.impressions > 1000 && c.ctr < 0.3 && c.status === 'ACTIVE') {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Low CTR at ${c.ctr.toFixed(2)}% — ${c.clicks} clicks from ${c.impressions.toLocaleString()} impressions`,
        action: 'Refresh ad creative, test different headlines, or narrow targeting to more relevant subreddits',
      });
    }

    if (c.clicks > 100 && c.conversions === 0) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `${c.clicks} clicks but 0 conversions — traffic is not converting`,
        action: 'Verify Reddit pixel is firing correctly, check landing page relevance, and review conversion event setup',
      });
    }
  }

  const priorityOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  return items;
}
