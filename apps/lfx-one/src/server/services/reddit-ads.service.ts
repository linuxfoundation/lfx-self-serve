// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignStatusUpdateResult,
  RedditActionItem,
  RedditAccountTotals,
  RedditCampaignCreateRequest,
  RedditCampaignCreateResult,
  RedditCampaignMetrics,
  RedditMonitorResponse,
  RedditPacingLabel,
} from '@lfx-one/shared/interfaces';

import { REDDIT_OBJECTIVE_LABELS, REDDIT_OBJECTIVE_PARAMS } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { REDDIT_ACCOUNTS, REDDIT_REQUEST_TIMEOUT_MS, REDDIT_TOKEN_EXPIRY_BUFFER_SECONDS } from '../constants';
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

async function redditRequest(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<RedditApiResponse> {
  const url = new URL(`${REDDIT_ADS_BASE_URL}${path}`).href;
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
    throw new Error(`Reddit API ${method} ${path} → ${resp.status}: ${text.slice(0, 400)}`);
  }

  return (await resp.json()) as RedditApiResponse;
}

// ---------------------------------------------------------------------------
// Report Helpers (v3 sync API)
// ---------------------------------------------------------------------------

interface RedditAccountMetrics {
  impressions: number;
  clicks: number;
  spend: number;
}

async function fetchAccountMetrics(accountId: string, startDate: string, endDate: string): Promise<RedditAccountMetrics> {
  const reportBody = {
    data: {
      starts_at: `${startDate}T00:00:00Z`,
      ends_at: `${endDate}T00:00:00Z`,
      fields: ['IMPRESSIONS', 'CLICKS', 'SPEND'],
    },
  };

  const resp = await redditRequest('POST', `/ad_accounts/${accountId}/reports`, reportBody);
  const metrics = ((resp.data as { metrics?: { impressions?: number; clicks?: number; spend?: number }[] })?.metrics ?? [])[0];

  return {
    impressions: metrics?.impressions ?? 0,
    clicks: metrics?.clicks ?? 0,
    spend: (metrics?.spend ?? 0) / 1_000_000,
  };
}

async function fetchCampaignMetrics(accountId: string, campaignId: string, startDate: string, endDate: string): Promise<RedditAccountMetrics> {
  const reportBody = {
    data: {
      starts_at: `${startDate}T00:00:00Z`,
      ends_at: `${endDate}T00:00:00Z`,
      fields: ['IMPRESSIONS', 'CLICKS', 'SPEND'],
    },
  };

  const resp = await redditRequest('POST', `/ad_accounts/${accountId}/campaigns/${campaignId}/reports`, reportBody);
  const m = ((resp.data as { metrics?: { impressions?: number; clicks?: number; spend?: number }[] })?.metrics ?? [])[0];

  return {
    impressions: m?.impressions ?? 0,
    clicks: m?.clicks ?? 0,
    spend: (m?.spend ?? 0) / 1_000_000,
  };
}

// ---------------------------------------------------------------------------
// Campaign List
// ---------------------------------------------------------------------------

interface RedditCampaignElement {
  id: string;
  name: string;
  configured_status: string;
  effective_status: string;
  goal_value?: number | null;
  goal_type?: string | null;
  start_time?: string;
  end_time?: string;
  [key: string]: unknown;
}

async function fetchCampaigns(accountId: string): Promise<RedditCampaignElement[]> {
  const resp = await redditRequest('GET', `/ad_accounts/${accountId}/campaigns`);
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
  startDateObj.setUTCDate(startDateObj.getUTCDate() - (days - 1));
  const startDate = startDateObj.toISOString().split('T')[0];

  const campaigns = await fetchCampaigns(accountId);
  const activeCampaigns = campaigns.filter((c) => c.configured_status === 'ACTIVE' || c.configured_status === 'PAUSED');

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

  const CAMPAIGN_BATCH_SIZE = 5;
  const perCampaignMetrics = new Map<string, RedditAccountMetrics>();
  const defaultMetrics: RedditAccountMetrics = { impressions: 0, clicks: 0, spend: 0 };

  for (let i = 0; i < activeCampaigns.length; i += CAMPAIGN_BATCH_SIZE) {
    const batch = activeCampaigns.slice(i, i + CAMPAIGN_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((camp) => fetchCampaignMetrics(accountId, camp.id, startDate, endDate)));

    for (let j = 0; j < batch.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        perCampaignMetrics.set(batch[j].id, result.value);
      } else {
        logger.warning(req, 'reddit_analytics', 'Per-campaign report fetch failed — metrics will show zero', {
          campaignId: batch[j].id,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
        perCampaignMetrics.set(batch[j].id, defaultMetrics);
      }
    }
  }

  let accountMetrics: RedditAccountMetrics = { impressions: 0, clicks: 0, spend: 0 };
  try {
    accountMetrics = await fetchAccountMetrics(accountId, startDate, endDate);
  } catch (err) {
    logger.warning(req, 'reddit_analytics', 'Reddit account report fetch failed — totals will show zero', {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  const campaignMetrics: RedditCampaignMetrics[] = activeCampaigns.map((camp) => {
    const metrics = perCampaignMetrics.get(camp.id) ?? defaultMetrics;
    const totalBudget = (camp.goal_value ?? 0) / 1_000_000;
    const dailyBudget = 0;

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
      status: camp.configured_status,
      totalBudget,
      dailyBudget,
      spend: metrics.spend,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      ctr: metrics.impressions > 0 ? (metrics.clicks / metrics.impressions) * 100 : 0,
      conversions: 0,
      pacingPct,
      pacingLabel,
      startDate: camp.start_time ? new Date(camp.start_time).toISOString().split('T')[0] : startDate,
      endDate: camp.end_time ? new Date(camp.end_time).toISOString().split('T')[0] : endDate,
    };
  });

  const accountTotals: RedditAccountTotals = {
    spend: accountMetrics.spend,
    impressions: accountMetrics.impressions,
    clicks: accountMetrics.clicks,
    conversions: 0,
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
  configured_status?: string;
  effective_status?: string;
  [key: string]: unknown;
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
  const objective = REDDIT_OBJECTIVE_LABELS[config.objective ?? 'conversions'];
  const project = (config.project || 'Linux Foundation').replace(/\|/g, '-');
  return `Events | ${event} | ${region} | ${objective} | Intent | Social | ${project} | ToFU`;
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

function extractRedditPostId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  const fullMatch = trimmed.match(/reddit\.com\/(?:r\/\w+\/)?comments\/([a-z0-9]+)/i);
  if (fullMatch) return `t3_${fullMatch[1]}`;
  const shortMatch = trimmed.match(/redd\.it\/([a-z0-9]+)/i);
  if (shortMatch) return `t3_${shortMatch[1]}`;
  if (trimmed.startsWith('t3_')) return trimmed;
  if (/^[a-z0-9]+$/i.test(trimmed)) return `t3_${trimmed}`;
  throw new Error(`Cannot extract Reddit post ID from: ${trimmed}`);
}

export async function updateRedditCampaignStatus(
  req: Request | undefined,
  accountId: string,
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<CampaignStatusUpdateResult> {
  const startTime = logger.startOperation(req, 'reddit_campaign_status_update', { campaignId, status });

  const currentResp = await redditRequest('GET', `/ad_accounts/${accountId}/campaigns/${campaignId}`);
  const currentData = currentResp.data as RedditCampaignData | undefined;
  const previousStatus = String(currentData?.configured_status ?? currentData?.effective_status ?? 'unknown');

  await redditRequest('PATCH', `/ad_accounts/${accountId}/campaigns/${campaignId}`, {
    data: { configured_status: status },
  });

  logger.success(req, 'reddit_campaign_status_update', startTime, { campaignId, previousStatus, newStatus: status });

  return {
    platform: 'reddit-ads',
    campaignId,
    previousStatus,
    newStatus: status,
  };
}

export async function executeRedditCampaignCreation(req: Request | undefined, config: RedditCampaignCreateRequest): Promise<RedditCampaignCreateResult> {
  const startTime = logger.startOperation(req, 'reddit_campaign_create', { eventName: config.eventName });
  const steps: string[] = [];

  if (!Number.isFinite(config.budgetUsd) || config.budgetUsd <= 0) {
    throw new Error('Invalid budget: must be a positive number');
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(config.startDate)) {
    throw new Error(`Invalid start date format: ${config.startDate} — expected YYYY-MM-DD`);
  }
  if (!dateRe.test(config.endDate)) {
    throw new Error(`Invalid end date format: ${config.endDate} — expected YYYY-MM-DD`);
  }
  if (config.endDate <= config.startDate) {
    throw new Error(`End date ${config.endDate} must be after start date ${config.startDate}`);
  }

  if (config.postUrl) {
    extractRedditPostId(config.postUrl);
  }

  const account = REDDIT_ACCOUNTS[0];
  const accountId = account.accountId;

  // Step 1: Verify account
  try {
    await redditRequest('GET', `/ad_accounts/${accountId}`);
    steps.push(`Account verified: ${account.label} (${accountId})`);
  } catch (err) {
    steps.push(`Account verification warning: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }

  // Step 2: Create campaign (PAUSED, lifetime budget, objective-aware params)
  const campaignName = buildRedditCampaignName(config);
  const campaignStartTime = toIsoTimestamp(config.startDate);
  const campaignEndTime = toIsoTimestamp(config.endDate);

  const objective = config.objective ?? 'conversions';
  const objParams = REDDIT_OBJECTIVE_PARAMS[objective];
  if (!objParams) {
    throw new Error(`Unsupported Reddit objective: ${objective}`);
  }

  const campaignBody: Record<string, unknown> = {
    data: {
      name: campaignName,
      objective: objParams.redditObjective,
      configured_status: 'PAUSED',
      is_campaign_budget_optimization: true,
      bid_strategy: 'BIDLESS',
      bid_type: objParams.bidType,
      optimization_goal: objParams.optimizationGoal,
      goal_type: 'LIFETIME_SPEND',
      goal_value: toMicrodollars(config.budgetUsd),
      start_time: campaignStartTime,
      end_time: campaignEndTime,
      ...(objParams.viewThroughConversionType && { view_through_conversion_type: objParams.viewThroughConversionType }),
    },
  };

  const campaignResp = await redditRequest('POST', `/ad_accounts/${accountId}/campaigns`, campaignBody);
  const campData = (campaignResp.data as RedditCampaignData) ?? {};
  const campaignId = String(campData.id ?? '');
  if (!campaignId) {
    throw new Error('Reddit campaign creation succeeded but returned no campaign ID');
  }
  steps.push(`Campaign created: ${campaignId} (PAUSED, $${config.budgetUsd.toFixed(2)} lifetime)`);

  // Step 3: Create ad group with targeting
  const geoLabel = config.geoTargets.length > 0 ? config.geoTargets.join('+') : 'Global';
  const adGroupName = `Events | ${config.eventName.replace(/\|/g, '-')} | ${geoLabel} | Intent | Communities + Keywords`;
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
  if (config.interests.length > 0) {
    baseTargeting['interests'] = config.interests;
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
      bid_type: objParams.bidType,
      optimization_goal: objParams.optimizationGoal,
      targeting,
      start_time: effectiveStart,
      end_time: campaignEndTime,
    },
  });

  let adGroupResp: RedditApiResponse;
  let usedCommunities = communityNames.length > 0;
  try {
    adGroupResp = await redditRequest('POST', `/ad_accounts/${accountId}/ad_groups`, buildAdGroupBody(targetingWithCommunities));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '';
    if (communityNames.length > 0 && errMsg.includes('invalid communities')) {
      steps.push(`Community targeting failed (invalid subreddits: ${communityNames.join(', ')}), retrying with keywords only`);
      usedCommunities = false;
      adGroupResp = await redditRequest('POST', `/ad_accounts/${accountId}/ad_groups`, buildAdGroupBody(baseTargeting));
    } else {
      throw err;
    }
  }

  const agData = (adGroupResp.data as RedditCampaignData) ?? {};
  const adGroupId = String(agData.id ?? '');
  if (!adGroupId) {
    throw new Error('Reddit ad group creation succeeded but returned no ad group ID');
  }
  steps.push(`Ad group created: ${adGroupId} (PAUSED, geo: ${geos.join(', ')})`);
  if (usedCommunities) {
    steps.push(`Targeting: ${communityNames.length} communities, ${config.keywords.length} keywords, ${geos.length} geos`);
  } else {
    steps.push(`Targeting: ${config.keywords.length} keywords, ${geos.length} geos (communities skipped — add manually in Reddit Ads Manager)`);
  }

  // Step 4: Create ads from post URL if provided, otherwise log manual instructions
  let adCount = 0;
  let adId: string | undefined;

  if (config.postUrl) {
    const postId = extractRedditPostId(config.postUrl);
    steps.push(`Extracted post ID: ${postId} from ${config.postUrl}`);

    const utmUrl = buildRedditUtmUrl(config, 0);
    const adBody = {
      data: {
        ad_group_id: adGroupId,
        name: `${config.eventName.replace(/\|/g, '-')} - Ad`,
        post_id: postId,
        configured_status: 'PAUSED',
        click_url: utmUrl,
      },
    };

    try {
      const adResp = await redditRequest('POST', `/ad_accounts/${accountId}/ads`, adBody);
      const adData = (adResp.data as RedditCampaignData) ?? {};
      adId = String(adData.id ?? '');
      if (adId) {
        adCount = 1;
        steps.push(`Ad created: ${adId} (post: ${postId}, click URL: ${utmUrl})`);
      }
    } catch (err) {
      steps.push(`Ad creation failed: ${err instanceof Error ? err.message : 'Unknown error'} — add ad manually in Reddit Ads Manager`);
    }
  } else {
    const variantCount = config.variants.length;
    if (variantCount > 0) {
      steps.push(`${variantCount} ad variant(s) ready — create ads in Reddit Ads Manager with these headlines:`);
      for (let i = 0; i < variantCount; i++) {
        const utmUrl = buildRedditUtmUrl(config, i);
        steps.push(`  Variant ${i + 1}: "${config.variants[i].headline}" → ${utmUrl}`);
      }
    } else {
      steps.push('No ad variants or post URL provided — add ads manually in Reddit Ads Manager');
    }
  }

  logger.success(req, 'reddit_campaign_create', startTime, { campaignId, adGroupId, adCount });

  return {
    platform: 'reddit-ads',
    campaignName,
    campaignId,
    adGroupName,
    adGroupId,
    adCount,
    adId,
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
