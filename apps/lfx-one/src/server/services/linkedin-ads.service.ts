// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  LinkedInActionItem,
  LinkedInCampaignCreateRequest,
  LinkedInCampaignCreateResult,
  LinkedInCampaignMetrics,
  LinkedInCreativeMetrics,
  LinkedInGeoTarget,
  LinkedInMonitorResponse,
  LinkedInPacingLabel,
  LinkedInTargetingProfile,
} from '@lfx-one/shared/interfaces';

import { LINKEDIN_AD_ACCOUNTS, LINKEDIN_API_VERSION, LINKEDIN_GEO_RESOLVE_MAP } from '@lfx-one/shared/constants';
import { LINKEDIN_ACCOUNTS, LINKEDIN_EMPLOYER_EXCLUSIONS, LINKEDIN_REQUEST_TIMEOUT_MS, LINKEDIN_TARGETING_PROFILES } from '../constants';

import type { Request } from 'express';

import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// LinkedIn Marketing API Constants
// ---------------------------------------------------------------------------

const LINKEDIN_BASE_URL = 'https://api.linkedin.com/rest';

const JOB_FUNCTIONS = ['urn:li:function:8', 'urn:li:function:13', 'urn:li:function:16'];

const SENIORITY_EXCLUSIONS = ['urn:li:seniority:1', 'urn:li:seniority:3'];

const SKIP_STATUSES = new Set(['ARCHIVED', 'CANCELED', 'COMPLETED', 'DRAFT', 'REMOVED', 'DELETED']);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function getLinkedInEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function resolveAccountId(override?: string): string {
  const id = override || getLinkedInEnv('LINKEDIN_AD_ACCOUNT_ID');
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid LinkedIn account ID: must be numeric, got "${id}"`);
  }
  if (override && !LINKEDIN_AD_ACCOUNTS.some((a) => a.accountId === id)) {
    throw new Error(`Unsupported LinkedIn ad account ID: "${id}"`);
  }
  return id;
}

function getOrgId(): string {
  return getLinkedInEnv('LINKEDIN_ORG_ID');
}

function getAccessToken(): string {
  return getLinkedInEnv('LINKEDIN_ACCESS_TOKEN');
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

interface LinkedInResponseElement {
  name?: string;
  status?: string;
  id?: string;
  $URN?: string;
  urn?: string;
  [key: string]: unknown;
}

interface LinkedInResponse {
  id?: string;
  name?: string;
  status?: string;
  elements?: LinkedInResponseElement[];
  [key: string]: unknown;
}

async function linkedInRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  params?: Record<string, string>
): Promise<LinkedInResponse> {
  const sanitizedPath = path.replace(/^\//, '');
  if (/[^a-zA-Z0-9/_:?=&.-]/.test(sanitizedPath) || sanitizedPath.includes('..')) {
    throw new Error(`Invalid LinkedIn API path: "${sanitizedPath}"`);
  }
  const url = new URL(`${LINKEDIN_BASE_URL}/${sanitizedPath}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAccessToken()}`,
    'LinkedIn-Version': LINKEDIN_API_VERSION,
    'X-RestLi-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };

  const response = await fetch(url.toString(), {
    method,
    headers,
    signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LinkedIn API ${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
  }

  const contentType = response.headers.get('content-type') || '';
  let data: LinkedInResponse = {};
  if (contentType.includes('application/json')) {
    data = (await response.json()) as LinkedInResponse;
  }

  const resourceId = response.headers.get('x-restli-id') || response.headers.get('X-RestLi-Id');
  if (resourceId && !data.id) {
    data.id = resourceId;
  }

  return data;
}

async function findByName(nestedPath: string, name: string): Promise<string | null> {
  try {
    let start = 0;
    const pageSize = 50;
    const maxPages = 5;
    for (let page = 0; page < maxPages; page++) {
      const resp = await linkedInRequest('GET', nestedPath, undefined, { q: 'search', count: String(pageSize), start: String(start) });
      const elements = resp.elements || [];
      for (const el of elements) {
        if (el.name === name) {
          const status = el.status || '';
          if (SKIP_STATUSES.has(status)) continue;
          const rawId = el.id || el.$URN || '';
          if (rawId) {
            return rawId.includes(':') ? rawId.split(':').pop()! : rawId;
          }
        }
      }
      if (elements.length < pageSize) break;
      start += pageSize;
    }
  } catch (err) {
    logger.warning(undefined, 'linkedin_find_by_name', `Search failed for "${name}" at ${nestedPath}`, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
  return null;
}

function toMs(dateStr: string, eod = false): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr} — expected YYYY-MM-DD`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  if (eod) {
    const endMs = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
    if (endMs <= Date.now()) {
      throw new Error(`End date ${dateStr} is in the past`);
    }
    return endMs;
  }
  const utcStart = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  if (utcStart <= Date.now()) {
    return Date.now() + 5 * 60 * 1000;
  }
  return utcStart;
}

function accountUrn(accountId: string): string {
  return `urn:li:sponsoredAccount:${accountId}`;
}

function resolveOrgId(accountId: string): string {
  const account = LINKEDIN_AD_ACCOUNTS.find((a) => a.accountId === accountId);
  if (account) return account.organizationId;
  return getOrgId();
}

function orgUrn(accountId: string): string {
  return `urn:li:organization:${resolveOrgId(accountId)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyAccount(accountId: string): Promise<{ name: string; status: string }> {
  const data = await linkedInRequest('GET', `adAccounts/${accountId}`);
  return { name: data.name || accountId, status: data.status || 'UNKNOWN' };
}

export async function resolveGeoTargets(locationNames: string[]): Promise<LinkedInGeoTarget[]> {
  const resolved: LinkedInGeoTarget[] = [];

  for (const name of locationNames) {
    const key = name.toLowerCase().trim();
    const cached = LINKEDIN_GEO_RESOLVE_MAP[key];
    if (cached) {
      resolved.push(cached);
      continue;
    }

    try {
      const resp = await linkedInRequest('GET', 'geoTargeting', undefined, { q: 'search', query: name });
      const elements = resp.elements || [];
      if (elements.length > 0) {
        const first = elements[0];
        const resolvedUrn = first.urn || first.$URN || first.id || '';
        if (resolvedUrn) {
          resolved.push({
            label: first.name || name,
            urn: resolvedUrn,
          });
        }
      }
    } catch {
      logger.warning(undefined, 'linkedin_resolve_geo', `Failed to resolve geo: ${name}`, { name });
    }
  }

  return resolved;
}

export async function findOrCreateCampaignGroup(accountId: string, name: string, startDate: string, endDate: string): Promise<string> {
  const groupsPath = `adAccounts/${accountId}/adCampaignGroups`;

  const existing = await findByName(groupsPath, name);
  if (existing) return existing;

  const startMs = toMs(startDate);
  const endMs = toMs(endDate, true);
  if (endMs <= startMs) {
    throw new Error(`End date (${endDate}) must be after start date (${startDate})`);
  }

  const body = {
    account: accountUrn(accountId),
    name,
    status: 'ACTIVE',
    runSchedule: {
      start: startMs,
      end: endMs,
    },
  };

  const data = await linkedInRequest('POST', groupsPath, body);
  const id = (data.id as string) || '';
  if (!id) throw new Error('LinkedIn API returned no ID for campaign group creation');
  return id.includes(':') ? id.split(':').pop()! : id;
}

export async function createCampaign(
  accountId: string,
  groupId: string,
  name: string,
  budgetUsd: number,
  geoUrns: string[],
  targetingProfile: LinkedInTargetingProfile,
  startDate: string,
  endDate: string,
  lifetimeBudget = false
): Promise<string> {
  const campaignsPath = `adAccounts/${accountId}/adCampaigns`;

  const existing = await findByName(campaignsPath, name);
  if (existing) return existing;

  const startMs = toMs(startDate);
  const endMs = toMs(endDate, true);
  if (endMs <= startMs) {
    throw new Error(`End date (${endDate}) must be after start date (${startDate})`);
  }

  const targeting = buildTargetingCriteria(targetingProfile, geoUrns);

  const budgetField = lifetimeBudget
    ? { totalBudget: { amount: budgetUsd.toFixed(2), currencyCode: 'USD' } }
    : { dailyBudget: { amount: budgetUsd.toFixed(2), currencyCode: 'USD' } };

  const body = {
    account: accountUrn(accountId),
    campaignGroup: `urn:li:sponsoredCampaignGroup:${groupId}`,
    name,
    status: 'PAUSED',
    type: 'SPONSORED_UPDATES',
    objectiveType: 'WEBSITE_CONVERSION',
    costType: 'CPM',
    locale: { country: 'US', language: 'en' },
    offsiteDeliveryEnabled: true,
    politicalIntent: 'NOT_POLITICAL',
    ...budgetField,
    runSchedule: {
      start: startMs,
      end: endMs,
    },
    ...targeting,
  };

  const data = await linkedInRequest('POST', campaignsPath, body);
  const id = (data.id as string) || '';
  if (!id) throw new Error('LinkedIn API returned no ID for campaign creation');
  return id.includes(':') ? id.split(':').pop()! : id;
}

export async function createDarkPost(accountId: string, introText: string, headline: string, destUrl: string, imageUrn?: string): Promise<string> {
  const intro = stripDashes(introText);
  const head = stripDashes(headline);

  const article: Record<string, string> = {
    source: destUrl,
    title: head.slice(0, 200),
    description: '',
    ...(imageUrn ? { thumbnail: imageUrn } : {}),
  };

  const body: Record<string, unknown> = {
    author: orgUrn(accountId),
    commentary: intro,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'NONE',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: { article },
    lifecycleState: 'PUBLISHED',
    adContext: { dscAdAccount: accountUrn(accountId) },
  };

  const data = await linkedInRequest('POST', 'posts', body);
  if (!data.id) throw new Error('LinkedIn API returned no ID for dark post creation');
  return data.id;
}

export async function createCreative(accountId: string, campaignId: string, shareUrn: string, adName: string): Promise<string> {
  const body = {
    campaign: `urn:li:sponsoredCampaign:${campaignId}`,
    intendedStatus: 'DRAFT',
    content: { reference: shareUrn },
    ...(adName ? { name: adName.slice(0, 255) } : {}),
  };

  const data = await linkedInRequest('POST', `adAccounts/${accountId}/creatives`, body);
  if (!data.id) throw new Error('LinkedIn API returned no ID for creative creation');
  return data.id;
}

export function buildTargetingCriteria(profile: LinkedInTargetingProfile, geoUrns: string[]): Record<string, unknown> {
  let skills: readonly string[] = [];
  let groups: readonly string[] = [];

  if (profile === 'custom') {
    const cloudNative = LINKEDIN_TARGETING_PROFILES.find((p) => p.id === 'cloud-native');
    skills = cloudNative?.skills || [];
    groups = cloudNative?.groups || [];
  } else {
    const profileConfig = LINKEDIN_TARGETING_PROFILES.find((p) => p.id === profile);
    skills = profileConfig?.skills || [];
    groups = profileConfig?.groups || [];
  }

  return {
    targetingCriteria: {
      include: {
        and: [
          { or: { 'urn:li:adTargetingFacet:locations': geoUrns } },
          {
            or: {
              'urn:li:adTargetingFacet:skills': [...skills],
              'urn:li:adTargetingFacet:groups': [...groups],
              'urn:li:adTargetingFacet:jobFunctions': JOB_FUNCTIONS,
            },
          },
        ],
      },
      exclude: {
        or: {
          'urn:li:adTargetingFacet:employers': [...LINKEDIN_EMPLOYER_EXCLUSIONS],
          'urn:li:adTargetingFacet:seniorities': SENIORITY_EXCLUSIONS,
        },
      },
    },
  };
}

export function buildLinkedInUtmUrl(baseUrl: string, hsToken: string | undefined, campaignName: string, variantIndex: number): string {
  const term = campaignName.replace(/ \| /g, '_').replace(/\s+/g, '-').toLowerCase();

  const utmParams = new URLSearchParams();
  utmParams.set('utm_source', 'linkedin');
  utmParams.set('utm_medium', 'paid-social');
  if (hsToken) {
    utmParams.set('utm_campaign', hsToken);
  }
  utmParams.set('utm_term', term);
  utmParams.set('utm_content', `variant-${variantIndex}`);

  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl.replace(/\/$/, '')}${sep}${utmParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Orchestrator — full campaign creation flow
// ---------------------------------------------------------------------------

export async function executeLinkedInCampaignCreation(req: Request | undefined, params: LinkedInCampaignCreateRequest): Promise<LinkedInCampaignCreateResult> {
  const steps: string[] = [];
  const startTime = logger.startOperation(req, 'linkedin_campaign_create', { event: params.eventName });
  const accountId = resolveAccountId(params.adAccountId);

  try {
    const account = await verifyAccount(accountId);
    steps.push(`Verified account: ${account.name} (${account.status})`);

    const groupName = `Events | ${params.eventName} | ${params.project || 'TLF'}`;
    const groupId = await findOrCreateCampaignGroup(accountId, groupName, params.startDate, params.endDate);
    steps.push(`Campaign group: ${groupName} (ID: ${groupId})`);

    const geoUrns = params.geoTargets.map((g) => g.urn);
    const campaignName = `Events | ${params.eventName} | LinkedIn | Conversions | Prospecting | Static | ${params.project || 'TLF'} | MoFU`;
    const campaignId = await createCampaign(
      accountId,
      groupId,
      campaignName,
      params.budgetUsd,
      geoUrns,
      params.targetingProfile,
      params.startDate,
      params.endDate,
      params.lifetimeBudget
    );
    steps.push(`Campaign created (PAUSED): ${campaignName} (ID: ${campaignId})`);

    let creativeCount = 0;
    for (let i = 0; i < params.variants.length; i++) {
      const variant = params.variants[i];
      const destUrl = buildLinkedInUtmUrl(params.registrationUrl, params.hsToken, campaignName, i + 1);
      const shareUrn = await createDarkPost(accountId, variant.introText, variant.headline, destUrl, variant.imageUrn);
      steps.push(`Dark post variant-${i + 1}: ${shareUrn}`);

      const adName = `${params.eventName} | variant-${i + 1}`;
      const creativeId = await createCreative(accountId, campaignId, shareUrn, adName);
      steps.push(`Creative (DRAFT): ${creativeId}`);
      creativeCount++;
    }

    const result: LinkedInCampaignCreateResult = {
      platform: 'linkedin-ads',
      campaignGroupName: groupName,
      campaignGroupId: groupId,
      campaignName,
      campaignId,
      creativeCount,
      linkedInUrl: `https://www.linkedin.com/campaignmanager/accounts/${accountId}/campaigns/${campaignId}`,
      steps,
    };

    logger.success(req, 'linkedin_campaign_create', startTime, { campaignId, creativeCount });
    return result;
  } catch (error) {
    logger.error(req, 'linkedin_campaign_create', startTime, error, { event: params.eventName });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Analytics — campaign + creative metrics via adAnalytics
// ---------------------------------------------------------------------------

function toDateParts(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month: m, day: d };
}

function dateRangeParams(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (days - 1)));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return {
    start: start.toISOString().split('T')[0],
    end: endUtc.toISOString().split('T')[0],
  };
}

interface LinkedInCampaignElement {
  id: number;
  name: string;
  status: string;
  totalBudget?: { amount: string };
  dailyBudget?: { amount: string };
  runSchedule?: { start: number; end: number };
}

export async function getLinkedInAnalytics(req: Request | undefined, accountId: string, days: number): Promise<LinkedInMonitorResponse> {
  const startTime = logger.startOperation(req, 'linkedin_analytics', { accountId, days });
  const token = getAccessToken();
  const version = LINKEDIN_API_VERSION;

  const { start, end } = dateRangeParams(days);
  const startParts = toDateParts(start);
  const endParts = toDateParts(end);

  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': version,
    'X-RestLi-Protocol-Version': '2.0.0',
  };

  // --- Fetch campaign list for this account (paginated) ---
  const campaigns: LinkedInCampaignElement[] = [];
  const pageSize = 100;
  let campaignStart = 0;
  while (true) {
    const campaignParams = new URLSearchParams({
      q: 'search',
      search: '(status:(values:List(ACTIVE,PAUSED)))',
      count: String(pageSize),
      start: String(campaignStart),
    });
    const campaignsUrl = `${LINKEDIN_BASE_URL}/adAccounts/${accountId}/adCampaigns?${campaignParams.toString()}`;
    const campaignsResp = await fetch(campaignsUrl, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS),
    });
    if (!campaignsResp.ok) {
      const text = await campaignsResp.text().catch(() => '');
      const err = new Error(`LinkedIn adCampaigns fetch failed: ${campaignsResp.status}: ${text.slice(0, 400)}`);
      logger.error(req, 'linkedin_analytics', startTime, err, { accountId });
      throw err;
    }
    const campaignsData = (await campaignsResp.json()) as { elements?: LinkedInCampaignElement[] };
    const page = campaignsData.elements ?? [];
    campaigns.push(...page);
    if (page.length < pageSize) break;
    campaignStart += pageSize;
  }

  if (campaigns.length === 0) {
    const account = LINKEDIN_ACCOUNTS.find((a) => a.accountId === accountId);
    const result: LinkedInMonitorResponse = {
      accountLabel: account?.label ?? accountId,
      pulledAt: new Date().toISOString(),
      dateRange: { mode: `last_${days}_days` },
      campaigns: [],
      accountTotals: { spend: 0, impressions: 0, clicks: 0, conversions: 0, campaignCount: 0 },
      actionItems: [],
    };
    logger.success(req, 'linkedin_analytics', startTime, { campaigns: 0 });
    return result;
  }

  // --- Fetch analytics for all campaigns via account-level filter ---
  const analyticsParams = new URLSearchParams({
    q: 'analytics',
    pivot: 'CAMPAIGN',
    dateRange: `(start:(year:${startParts.year},month:${startParts.month},day:${startParts.day}),end:(year:${endParts.year},month:${endParts.month},day:${endParts.day}))`,
    timeGranularity: 'ALL',
    accounts: `List(urn:li:sponsoredAccount:${accountId})`,
    fields: 'impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivot,pivotValue',
  });

  const analyticsUrl = `${LINKEDIN_BASE_URL}/adAnalytics?${analyticsParams.toString()}`;
  const analyticsResp = await fetch(analyticsUrl, {
    headers: baseHeaders,
    signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS),
  });

  const analyticsMap = new Map<string, { impressions: number; clicks: number; spend: number; conversions: number }>();
  if (!analyticsResp.ok) {
    logger.warning(req, 'linkedin_analytics', `LinkedIn adAnalytics returned ${analyticsResp.status} — campaign metrics will show zero`, { accountId });
  }
  if (analyticsResp.ok) {
    const analyticsData = (await analyticsResp.json()) as {
      elements?: {
        pivotValue?: string;
        impressions?: number;
        clicks?: number;
        costInLocalCurrency?: string;
        externalWebsiteConversions?: number;
      }[];
    };
    for (const el of analyticsData.elements ?? []) {
      if (el.pivotValue) {
        analyticsMap.set(el.pivotValue, {
          impressions: el.impressions ?? 0,
          clicks: el.clicks ?? 0,
          spend: parseFloat(el.costInLocalCurrency ?? '0'),
          conversions: el.externalWebsiteConversions ?? 0,
        });
      }
    }
  }

  // --- Fetch creative metrics per campaign (batched, max 5 concurrent) ---
  const CREATIVE_BATCH_SIZE = 5;
  const creativeAnalyticsMap = new Map<string, LinkedInCreativeMetrics[]>();
  const creativeFetchFailed = new Set<string>();

  const fetchCreativeForCampaign = async (camp: (typeof campaigns)[number]): Promise<void> => {
    const creativeParams = new URLSearchParams({
      q: 'analytics',
      pivot: 'CREATIVE',
      dateRange: `(start:(year:${startParts.year},month:${startParts.month},day:${startParts.day}),end:(year:${endParts.year},month:${endParts.month},day:${endParts.day}))`,
      timeGranularity: 'ALL',
      campaigns: `List(urn:li:sponsoredCampaign:${camp.id})`,
      fields: 'impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivot,pivotValue',
    });
    const creativeResp = await fetch(`${LINKEDIN_BASE_URL}/adAnalytics?${creativeParams.toString()}`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(LINKEDIN_REQUEST_TIMEOUT_MS),
    });
    if (creativeResp.ok) {
      const creativeData = (await creativeResp.json()) as {
        elements?: {
          pivotValue?: string;
          impressions?: number;
          clicks?: number;
          costInLocalCurrency?: string;
          externalWebsiteConversions?: number;
        }[];
      };
      const creatives: LinkedInCreativeMetrics[] = (creativeData.elements ?? [])
        .filter((el) => !!el.pivotValue)
        .map((el) => {
          const creativeId = el.pivotValue!.replace('urn:li:sponsoredCreative:', '');
          const clicks = el.clicks ?? 0;
          const impressions = el.impressions ?? 0;
          return {
            creativeId,
            creativeName: `Creative ${creativeId}`,
            impressions,
            clicks,
            ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
            spend: parseFloat(el.costInLocalCurrency ?? '0'),
            conversions: el.externalWebsiteConversions ?? 0,
            status: camp.status,
          };
        });
      creativeAnalyticsMap.set(String(camp.id), creatives);
    } else {
      const text = await creativeResp.text().catch(() => '');
      logger.warning(req, 'linkedin_creative_analytics', `Creative analytics failed for campaign ${camp.id}: ${creativeResp.status}: ${text.slice(0, 200)}`, {
        campaignId: camp.id,
        status: creativeResp.status,
      });
      creativeFetchFailed.add(String(camp.id));
    }
  };

  for (let i = 0; i < campaigns.length; i += CREATIVE_BATCH_SIZE) {
    const batch = campaigns.slice(i, i + CREATIVE_BATCH_SIZE);
    await Promise.allSettled(batch.map((camp) => fetchCreativeForCampaign(camp)));
  }

  // --- Build campaign metrics ---
  const campaignMetrics: LinkedInCampaignMetrics[] = campaigns.map((camp) => {
    const urn = `urn:li:sponsoredCampaign:${camp.id}`;
    const analytics = analyticsMap.get(urn) ?? { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    const totalBudget = parseFloat(camp.totalBudget?.amount ?? '0');
    const dailyBudget = parseFloat(camp.dailyBudget?.amount ?? '0');
    const schedStart = camp.runSchedule?.start ?? 0;
    const schedEnd = camp.runSchedule?.end ?? 0;
    const now = Date.now();
    const rangeStartMs = new Date(start).getTime();
    let pacingPct = 0;
    if (totalBudget > 0) {
      const flightStart = schedStart || rangeStartMs;
      const flightEnd = schedEnd || now;
      const totalFlightDays = Math.max(1, Math.ceil((flightEnd - flightStart) / 86_400_000));
      const effectiveStart = Math.max(flightStart, rangeStartMs);
      const effectiveEnd = Math.min(flightEnd, now);
      const windowDays = Math.max(1, Math.ceil((effectiveEnd - effectiveStart) / 86_400_000));
      const expectedSpend = (totalBudget / totalFlightDays) * windowDays;
      pacingPct = expectedSpend > 0 ? (analytics.spend / expectedSpend) * 100 : 0;
    } else if (dailyBudget > 0) {
      const effectiveStart = Math.max(schedStart || rangeStartMs, rangeStartMs);
      const effectiveEnd = Math.min(schedEnd || now, now);
      const flightDays = Math.max(1, Math.ceil((effectiveEnd - effectiveStart) / 86_400_000));
      pacingPct = (analytics.spend / (dailyBudget * flightDays)) * 100;
    }
    const hasBudget = totalBudget > 0 || dailyBudget > 0;
    let pacingLabel: LinkedInPacingLabel = 'normal';
    if (hasBudget) {
      if (pacingPct < 40) {
        pacingLabel = 'underspending';
      } else if (pacingPct < 90) {
        pacingLabel = 'normal';
      } else if (pacingPct < 105) {
        pacingLabel = 'constrained';
      } else {
        pacingLabel = 'overspending';
      }
    }
    const startMs = camp.runSchedule?.start ?? 0;
    const endMs = camp.runSchedule?.end ?? 0;
    return {
      campaignId: String(camp.id),
      campaignName: camp.name,
      eventName: camp.name.split(' | ')[1] ?? camp.name,
      status: camp.status,
      totalBudget,
      dailyBudget,
      spend: analytics.spend,
      impressions: analytics.impressions,
      clicks: analytics.clicks,
      ctr: analytics.impressions > 0 ? (analytics.clicks / analytics.impressions) * 100 : 0,
      conversions: analytics.conversions,
      pacingPct,
      pacingLabel,
      creatives: creativeAnalyticsMap.get(String(camp.id)) ?? [],
      startDate: startMs ? new Date(startMs).toISOString().split('T')[0] : '',
      endDate: endMs ? new Date(endMs).toISOString().split('T')[0] : '',
    };
  });

  // --- Action items ---
  const actionItems: LinkedInActionItem[] = [];
  for (const c of campaignMetrics) {
    if (c.creatives.length === 0 && c.status === 'ACTIVE' && !creativeFetchFailed.has(c.campaignId)) {
      actionItems.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: 'No ad creatives — campaign cannot deliver',
        action: 'Upload ad images and copy in LinkedIn Campaign Manager to start delivery',
      });
    } else if (c.pacingLabel === 'underspending') {
      actionItems.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: 'Underspending — pacing below 40%',
        action: 'Check targeting breadth, bid strategy, or budget floor',
      });
    }
    if (c.pacingLabel === 'constrained' || c.pacingLabel === 'overspending') {
      actionItems.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: 'Budget constrained — pacing above 90%',
        action: 'Consider increasing budget if event is in peak registration period',
      });
    }
    if (c.ctr > 0 && c.ctr < 0.3) {
      actionItems.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Low CTR: ${c.ctr.toFixed(2)}%`,
        action: 'Refresh ad copy or images; review audience targeting',
      });
    }
    if (c.clicks > 50 && c.conversions === 0) {
      actionItems.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: 'Clicks without conversions',
        action: 'Audit LinkedIn Insight Tag on registration landing page',
      });
    }
    if (c.status === 'PAUSED' && (c.totalBudget > 10 || c.dailyBudget > 1)) {
      actionItems.push({
        priority: 'LOW',
        campaignName: c.campaignName,
        issue: 'Campaign is PAUSED with real budget',
        action: 'Confirm intentional pause or activate',
      });
    }
  }
  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  actionItems.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

  const totals = campaignMetrics.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      impressions: acc.impressions + c.impressions,
      clicks: acc.clicks + c.clicks,
      conversions: acc.conversions + c.conversions,
      campaignCount: acc.campaignCount + 1,
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, campaignCount: 0 }
  );

  const account = LINKEDIN_ACCOUNTS.find((a) => a.accountId === accountId);
  const result: LinkedInMonitorResponse = {
    accountLabel: account?.label ?? accountId,
    pulledAt: new Date().toISOString(),
    dateRange: { mode: `last_${days}_days` },
    campaigns: campaignMetrics,
    accountTotals: totals,
    actionItems,
  };

  logger.success(req, 'linkedin_analytics', startTime, { campaigns: campaignMetrics.length, actionItems: actionItems.length });
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripDashes(text: string): string {
  return text
    .replace(/ [—–] /g, ', ')
    .replace(/[—–]/g, ', ')
    .replace(/^, |, $/g, '');
}
