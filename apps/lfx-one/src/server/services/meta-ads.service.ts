// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignStatusUpdateResult,
  MetaActionItem,
  MetaAccountTotals,
  MetaCampaignCreateRequest,
  MetaCampaignCreateResult,
  MetaCampaignMetrics,
  MetaMonitorResponse,
  MetaObjective,
  MetaPacingLabel,
  MetaPlacement,
} from '@lfx-one/shared/interfaces';

import { CAMPAIGN_PACING_THRESHOLDS, META_DEFAULT_PLACEMENTS, META_OBJECTIVE_PARAMS } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { META_ACCOUNTS, META_ADS_MANAGER_URL, META_BASE_URL, META_REQUEST_TIMEOUT_MS } from '../constants';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// HTTP Helper
// ---------------------------------------------------------------------------

function getMetaAccessToken(): string {
  const token = process.env['META_ACCESS_TOKEN'];
  if (!token) throw new Error('META_ACCESS_TOKEN environment variable is not configured');
  return token;
}

async function metaRequest<T>(req: Request | undefined, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const token = getMetaAccessToken();
  const url = `${META_BASE_URL}${path}`;

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
  };

  if (body && method === 'POST') {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url, init);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logger.warning(req, 'meta_api_error', `Meta API ${method} ${path} → ${resp.status}: ${text.slice(0, 400)}`, { method, path, status: resp.status });
    throw new Error(`Meta API request failed (${resp.status}). Check server logs for details.`);
  }

  return (await resp.json()) as T;
}

// ---------------------------------------------------------------------------
// Campaign Creation — validation helpers
// ---------------------------------------------------------------------------

function validateRegistrationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Registration URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Registration URL must use HTTPS');
  }
}

const GEO_CODE_RE = /^[A-Z]{2}$/;

function validateGeoTargets(geoTargets: string[]): string[] {
  const valid = geoTargets.map((g) => g.trim().toUpperCase()).filter((g) => GEO_CODE_RE.test(g));
  return valid.length > 0 ? valid : ['US'];
}

// ---------------------------------------------------------------------------
// Campaign Creation — objective / placement helpers
// ---------------------------------------------------------------------------

function buildPromotedObject(objective: MetaObjective, pageId: string, pixelId?: string): Record<string, unknown> | null {
  const params = META_OBJECTIVE_PARAMS[objective];
  if (params.promotedObjectType === 'page_id') return { page_id: pageId };
  if (params.promotedObjectType === 'pixel_id') {
    if (!pixelId) throw new Error(`pixelId is required for '${objective}' objective but was not provided`);
    return { pixel_id: pixelId, custom_event_type: 'PURCHASE' };
  }
  return null;
}

function buildPlacementTargeting(placements: Partial<MetaPlacement>): Record<string, unknown> {
  const pl = { ...META_DEFAULT_PLACEMENTS, ...placements };
  const publisherPlatforms: string[] = [];
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];
  const messengerPositions: string[] = [];

  if (pl.facebookFeed) {
    if (!publisherPlatforms.includes('facebook')) publisherPlatforms.push('facebook');
    facebookPositions.push('feed');
  }
  if (pl.instagramFeed) {
    if (!publisherPlatforms.includes('instagram')) publisherPlatforms.push('instagram');
    instagramPositions.push('stream');
  }
  if (pl.stories) {
    if (!publisherPlatforms.includes('facebook')) publisherPlatforms.push('facebook');
    if (!publisherPlatforms.includes('instagram')) publisherPlatforms.push('instagram');
    facebookPositions.push('story');
    instagramPositions.push('story');
  }
  if (pl.reels) {
    if (!publisherPlatforms.includes('facebook')) publisherPlatforms.push('facebook');
    if (!publisherPlatforms.includes('instagram')) publisherPlatforms.push('instagram');
    facebookPositions.push('facebook_reels');
    instagramPositions.push('reels');
  }
  if (pl.audienceNetwork) publisherPlatforms.push('audience_network');
  if (pl.messengerInbox) {
    publisherPlatforms.push('messenger');
    messengerPositions.push('messenger_home');
  }

  if (publisherPlatforms.length === 0) {
    publisherPlatforms.push('facebook');
    facebookPositions.push('feed');
  }

  const targeting: Record<string, unknown> = { publisher_platforms: publisherPlatforms };
  if (facebookPositions.length > 0) targeting['facebook_positions'] = facebookPositions;
  if (instagramPositions.length > 0) targeting['instagram_positions'] = instagramPositions;
  if (messengerPositions.length > 0) targeting['messenger_positions'] = messengerPositions;
  return targeting;
}

// ---------------------------------------------------------------------------
// Campaign Creation — region / name helpers
// ---------------------------------------------------------------------------

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

const OBJECTIVE_LABELS = {
  awareness: 'Awareness',
  traffic: 'Traffic',
  engagement: 'Engagement',
  leads: 'Leads',
  conversions: 'Conversions',
} as const satisfies Record<MetaObjective, string>;

function buildMetaCampaignName(config: MetaCampaignCreateRequest): string {
  const event = config.eventName.replace(/\|/g, '-');
  const region = resolveRegion(config.geoTargets);
  const objective = OBJECTIVE_LABELS[config.objective ?? 'traffic'];
  const project = (config.project || 'Linux Foundation').replace(/\|/g, '-');
  return `Events | ${event} | ${region} | ${objective} | Intent | Social | ${project} | MoFU`;
}

function buildMetaUtmUrl(config: MetaCampaignCreateRequest, variantIndex: number): string {
  const base = config.registrationUrl.replace(/\/$/, '');
  const slug = config.eventSlug || config.eventName.toLowerCase().replace(/\s+/g, '-');
  const params = new URLSearchParams({
    utm_source: 'meta',
    utm_medium: 'paid-social',
    utm_campaign: config.hsToken || slug,
    utm_term: config.eventName.replace(/\s+/g, '-').toLowerCase(),
    utm_content: `variant-${variantIndex + 1}`,
  });
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Meta API response shapes
// ---------------------------------------------------------------------------

interface MetaCreateResponse {
  id: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Campaign Creation
// ---------------------------------------------------------------------------

export async function executeMetaCampaignCreation(req: Request | undefined, config: MetaCampaignCreateRequest): Promise<MetaCampaignCreateResult> {
  const startTime = logger.startOperation(req, 'meta_campaign_create', { eventName: config.eventName });
  const steps: string[] = [];

  if (!config.variants || config.variants.length === 0) {
    throw new Error('At least one ad variant is required for Meta campaign creation');
  }

  const validVariants = config.variants.filter((v) => v.primaryText.trim() && v.headline.trim());
  if (validVariants.length === 0) {
    throw new Error('At least one variant must have non-empty primary text and headline');
  }

  validateRegistrationUrl(config.registrationUrl);

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

  const account = META_ACCOUNTS[0];
  const accountId = account.accountId;

  // Step 1: Verify account access
  try {
    await metaRequest<Record<string, unknown>>(req, 'GET', `/${accountId}?fields=name,account_status`);
    steps.push(`Account verified: ${account.label} (${accountId})`);
  } catch {
    steps.push('Account verification warning — check server logs for details');
  }

  // Step 2: Create campaign (PAUSED)
  const allGeoCountries = validateGeoTargets(config.geoTargets ?? []);

  // Countries requiring Universal Ads Declaration or regional compliance — exclude from API targeting,
  // users can add them manually in Meta Ads Manager after completing the declaration.
  const REGULATED_COUNTRIES = new Set(['SG', 'TW', 'KR']);
  const geoCountries = allGeoCountries.filter((g) => !REGULATED_COUNTRIES.has(g));
  const skippedGeos = allGeoCountries.filter((g) => REGULATED_COUNTRIES.has(g));
  if (geoCountries.length === 0) {
    throw new Error(
      `Meta campaign skipped: selected geo targets (${skippedGeos.join(', ')}) require manual compliance declaration in Meta Ads Manager. Add at least one non-regulated country or complete the declaration first.`
    );
  }
  if (skippedGeos.length > 0) {
    steps.push(`Geo targets skipped (require regional compliance declaration in Meta Ads Manager): ${skippedGeos.join(', ')}`);
  }

  const objective: MetaObjective = config.objective ?? 'traffic';
  const objParams = META_OBJECTIVE_PARAMS[objective];
  const campaignName = buildMetaCampaignName({ ...config, geoTargets: geoCountries });

  const campaignResp = await metaRequest<MetaCreateResponse>(req, 'POST', `/${accountId}/campaigns`, {
    name: campaignName,
    objective: objParams.campaignObjective,
    status: 'PAUSED',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId = campaignResp.id;
  if (!campaignId) throw new Error('Meta campaign creation succeeded but returned no campaign ID');
  steps.push(`Campaign created: ${campaignId} (${OBJECTIVE_LABELS[objective]}, PAUSED)`);

  // Step 3: Create ad set with budget, schedule, geo targeting, and placements
  const budgetCents = Math.round(config.budgetUsd * 100);
  const adSetName = `${config.eventName} - ${OBJECTIVE_LABELS[objective]}`;
  const placementTargeting = buildPlacementTargeting(config.placements ?? {});

  const adSetBody: Record<string, unknown> = {
    name: adSetName,
    campaign_id: campaignId,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: objParams.optimizationGoal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: {
      geo_locations: { countries: geoCountries },
      ...placementTargeting,
    },
    start_time: `${config.startDate}T00:00:00+0000`,
    end_time: `${config.endDate}T23:59:59+0000`,
  };

  const promotedObject = buildPromotedObject(objective, account.pageId, config.pixelId);
  if (promotedObject) {
    adSetBody['promoted_object'] = promotedObject;
  }

  if (config.lifetimeBudget) {
    adSetBody['lifetime_budget'] = budgetCents;
  } else {
    adSetBody['daily_budget'] = budgetCents;
  }

  const adSetResp = await metaRequest<MetaCreateResponse>(req, 'POST', `/${accountId}/adsets`, adSetBody);
  const adSetId = adSetResp.id;
  if (!adSetId) throw new Error('Meta ad set creation succeeded but returned no ad set ID');
  const budgetLabel = config.lifetimeBudget ? 'lifetime' : 'daily';
  steps.push(`Ad set created: ${adSetId} ($${config.budgetUsd.toFixed(2)} ${budgetLabel}, geo: ${geoCountries.join(', ')})`);

  // Step 4: Create ad creative + ad for each variant
  let adCount = 0;
  for (let i = 0; i < validVariants.length; i++) {
    const variant = validVariants[i];
    const utmUrl = buildMetaUtmUrl(config, i);

    try {
      const creativeResp = await metaRequest<MetaCreateResponse>(req, 'POST', `/${accountId}/adcreatives`, {
        name: `${config.eventName} - Variant ${i + 1}`,
        object_story_spec: {
          page_id: account.pageId,
          link_data: {
            link: utmUrl,
            message: variant.primaryText,
            name: variant.headline,
            description: variant.description || undefined,
            call_to_action: { type: 'LEARN_MORE', value: { link: utmUrl } },
          },
        },
      });
      const creativeId = creativeResp.id;
      if (!creativeId) throw new Error('Creative creation returned no ID');

      const adResp = await metaRequest<MetaCreateResponse>(req, 'POST', `/${accountId}/ads`, {
        name: `${config.eventName} - Ad ${i + 1}`,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
      });
      if (!adResp.id) throw new Error('Ad creation returned no ID');

      adCount++;
      steps.push(`Ad ${i + 1} created: ${adResp.id} (creative: ${creativeId}) → ${utmUrl}`);
    } catch {
      steps.push(`Ad ${i + 1} failed — check server logs for details`);
    }
  }

  if (adCount === 0 && config.variants.length > 0) {
    steps.push('No ads could be created — create them manually in Meta Ads Manager');
  }

  logger.success(req, 'meta_campaign_create', startTime, { campaignId, adSetId, adCount });

  return {
    platform: 'meta-ads',
    campaignName,
    campaignId,
    adSetName,
    adSetId,
    adCount,
    metaUrl: `${META_ADS_MANAGER_URL}/adsmanager/manage/campaigns?act=${accountId.replace('act_', '')}`,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Campaign Status Toggle
// ---------------------------------------------------------------------------

export async function updateMetaCampaignStatus(req: Request | undefined, campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<CampaignStatusUpdateResult> {
  const startTime = logger.startOperation(req, 'meta_campaign_status_update', { campaignId, status });

  const currentResp = await metaRequest<Partial<{ status: string }>>(req, 'GET', `/${campaignId}?fields=status`);
  if (!currentResp.status) {
    throw new Error('Meta API returned no status field for the campaign. The campaign may not exist or access may be restricted.');
  }
  const previousStatus = currentResp.status;

  const updateResp = await metaRequest<{ success: boolean }>(req, 'POST', `/${campaignId}`, { status });

  logger.success(req, 'meta_campaign_status_update', startTime, { campaignId, previousStatus, newStatus: status });

  return {
    platform: 'meta-ads',
    campaignId,
    previousStatus,
    newStatus: status,
    success: updateResp.success ?? true,
  };
}

// ---------------------------------------------------------------------------
// Campaign Monitoring — metrics builder
// ---------------------------------------------------------------------------

interface MetaInsightRow {
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  actions?: { action_type: string; value: string }[];
}

interface MetaCampaignRow {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: { data?: MetaInsightRow[] };
}

function buildCampaignMetrics(camp: MetaCampaignRow, days: number): MetaCampaignMetrics {
  const insight = camp.insights?.data?.[0];

  const impressions = parseInt(insight?.impressions ?? '0', 10);
  const clicks = parseInt(insight?.clicks ?? '0', 10);
  const spend = parseFloat(insight?.spend ?? '0');
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

  const CONVERSION_TYPES = new Set(['omni_purchase', 'omni_lead']);
  const conversions = (insight?.actions ?? [])
    .filter((a) => a.action_type && CONVERSION_TYPES.has(a.action_type))
    .reduce((sum, a) => sum + (parseInt(a.value, 10) || 0), 0);

  // Meta Graph API returns budgets in cents; convert to dollars
  const dailyBudget = parseFloat(camp.daily_budget ?? '0') / 100;
  const lifetimeBudget = parseFloat(camp.lifetime_budget ?? '0') / 100;
  const totalBudget = lifetimeBudget > 0 ? lifetimeBudget : dailyBudget * days;

  const schedStart = camp.start_time ? new Date(camp.start_time).getTime() : 0;
  const schedEnd = camp.stop_time ? new Date(camp.stop_time).getTime() : 0;
  const now = Date.now();

  let pacingPct = 0;
  if (totalBudget > 0 && schedStart > 0) {
    const flightEnd = schedEnd || now;
    const totalFlightDays = Math.max(1, Math.ceil((flightEnd - schedStart) / 86_400_000));
    const elapsedDays = Math.max(1, Math.ceil((now - schedStart) / 86_400_000));
    const expectedSpend = (totalBudget / totalFlightDays) * Math.min(elapsedDays, totalFlightDays);
    pacingPct = expectedSpend > 0 ? Math.round((spend / expectedSpend) * 100) : 0;
  } else if (dailyBudget > 0) {
    const expectedSpend = dailyBudget * days;
    pacingPct = expectedSpend > 0 ? Math.round((spend / expectedSpend) * 100) : 0;
  }

  let pacingLabel: MetaPacingLabel = 'normal';
  if (pacingPct < CAMPAIGN_PACING_THRESHOLDS.underspending) pacingLabel = 'underspending';
  else if (pacingPct > CAMPAIGN_PACING_THRESHOLDS.constrained) pacingLabel = 'overspending';
  else if (pacingPct > CAMPAIGN_PACING_THRESHOLDS.normal) pacingLabel = 'constrained';

  return {
    campaignId: camp.id,
    campaignName: camp.name,
    status: camp.status,
    totalBudget,
    dailyBudget,
    spend,
    impressions,
    clicks,
    ctr,
    conversions,
    pacingPct,
    pacingLabel,
    startDate: camp.start_time?.slice(0, 10) ?? '',
    endDate: camp.stop_time?.slice(0, 10) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Campaign Monitoring — action items
// ---------------------------------------------------------------------------

function buildMetaActionItems(campaigns: MetaCampaignMetrics[]): MetaActionItem[] {
  const items: MetaActionItem[] = [];

  for (const c of campaigns) {
    if (c.status === 'ACTIVE' && c.impressions === 0 && c.spend === 0) {
      items.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: 'Campaign active but no delivery — 0 impressions and $0 spent',
        action: 'Check ad set targeting, budget, and creative approval status in Meta Ads Manager',
      });
    }
    if (c.ctr < 0.5 && c.impressions > 500) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Low CTR: ${c.ctr.toFixed(2)}% across ${c.impressions.toLocaleString()} impressions`,
        action: 'Refresh creative assets, test new ad formats, or narrow audience targeting',
      });
    }
    if (c.clicks > 20 && c.conversions === 0) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `${c.clicks} clicks ($${c.spend.toFixed(2)} spent) but 0 conversions`,
        action: 'Verify Meta Pixel / Conversions API is firing; check landing page and CTA alignment',
      });
    }
    if (c.pacingLabel === 'underspending' && c.status === 'ACTIVE') {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Underspending: ${c.pacingPct}% of budget used ($${c.spend.toFixed(2)} of $${c.totalBudget.toFixed(2)})`,
        action: 'Broaden audience targeting or increase bid cap to improve delivery',
      });
    }
    if ((c.pacingLabel === 'constrained' || c.pacingLabel === 'overspending') && c.status === 'ACTIVE') {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Budget ${c.pacingLabel}: ${c.pacingPct}% of budget used`,
        action: 'Increase daily budget or narrow targeting to focus spend on highest-value audiences',
      });
    }
  }

  const priorityOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  return items;
}

// ---------------------------------------------------------------------------
// Campaign Monitoring — public entry point
// ---------------------------------------------------------------------------

interface MetaCampaignsApiResponse {
  data: MetaCampaignRow[];
  paging?: { next?: string };
}

export async function getMetaAnalytics(req: Request, accountId: string, days: number): Promise<MetaMonitorResponse> {
  const account = META_ACCOUNTS.find((a) => a.accountId === accountId);
  const accountLabel = account?.label ?? accountId;

  logger.debug(req, 'meta_analytics', 'Fetching Meta campaign analytics', { accountId, days });

  const dateEnd = new Date();
  const dateStart = new Date();
  dateStart.setUTCDate(dateStart.getUTCDate() - (days - 1));
  const since = dateStart.toISOString().slice(0, 10);
  const until = dateEnd.toISOString().slice(0, 10);

  const fields = 'id,name,status,daily_budget,lifetime_budget,start_time,stop_time';
  const insightFields = 'impressions,clicks,spend,ctr,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  const statusFilter = encodeURIComponent('["ACTIVE","PAUSED"]');
  // accountId is pre-validated against the META_ACCOUNTS allowlist by the controller
  const path = `/${accountId}/campaigns?fields=${fields},insights.fields(${insightFields}).time_range(${timeRange})&effective_status=${statusFilter}&limit=100`;
  const response = await metaRequest<MetaCampaignsApiResponse>(req, 'GET', path);

  if (response.paging?.next) {
    logger.warning(req, 'meta_analytics', 'Meta API returned pagination; some campaigns may be missing', { accountId });
  }

  const allCampaigns = response.data ?? [];
  const campaigns = allCampaigns.map((c) => buildCampaignMetrics(c, days)).filter((c) => c.impressions > 0 || c.status === 'ACTIVE');

  const accountTotals: MetaAccountTotals = {
    spend: campaigns.reduce((s, c) => s + c.spend, 0),
    impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
    clicks: campaigns.reduce((s, c) => s + c.clicks, 0),
    conversions: campaigns.reduce((s, c) => s + c.conversions, 0),
    campaignCount: campaigns.length,
  };

  const actionItems = buildMetaActionItems(campaigns);

  return {
    accountLabel,
    pulledAt: new Date().toISOString(),
    dateRange: { mode: `last_${days}_days` },
    campaigns,
    accountTotals,
    actionItems,
  };
}
