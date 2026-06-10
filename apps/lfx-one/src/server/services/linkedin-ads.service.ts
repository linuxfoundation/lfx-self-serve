// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LinkedInCampaignCreateRequest, LinkedInCampaignCreateResult, LinkedInGeoTarget, LinkedInTargetingProfile } from '@lfx-one/shared/interfaces';

import { LINKEDIN_API_VERSION, LINKEDIN_GEO_RESOLVE_MAP } from '@lfx-one/shared/constants';

import { LINKEDIN_EMPLOYER_EXCLUSIONS, LINKEDIN_TARGETING_PROFILES } from '../constants';

import type { Request } from 'express';

import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// LinkedIn Marketing API Constants
// ---------------------------------------------------------------------------

const LINKEDIN_BASE_URL = 'https://api.linkedin.com/rest';

const JOB_FUNCTIONS = ['urn:li:function:8', 'urn:li:function:13', 'urn:li:function:16'];

const SENIORITY_EXCLUSIONS = ['urn:li:seniority:1', 'urn:li:seniority:3'];

const SKIP_STATUSES = new Set(['ARCHIVED', 'CANCELED', 'COMPLETED', 'DRAFT', 'REMOVED', 'DELETED']);

const LINKEDIN_REQUEST_TIMEOUT_MS = 30_000;

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

function getAccountId(): string {
  return getLinkedInEnv('LINKEDIN_AD_ACCOUNT_ID');
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
  const url = new URL(`${LINKEDIN_BASE_URL}/${path.replace(/^\//, '')}`);
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
  const pageSize = 50;
  let start = 0;
  try {
    while (true) {
      const resp = await linkedInRequest('GET', nestedPath, undefined, {
        q: 'search',
        count: String(pageSize),
        start: String(start),
      });
      const elements = resp.elements || [];
      for (const el of elements) {
        if (el.name === name) {
          const status = el.status || '';
          if (SKIP_STATUSES.has(status)) continue;
          const rawId = el.id || el.$URN || '';
          if (rawId) return rawId.includes(':') ? rawId.split(':').pop()! : rawId;
        }
      }
      if (elements.length < pageSize) break;
      start += pageSize;
    }
  } catch (error: unknown) {
    logger.warning(undefined, 'linkedin_find_by_name', `Search failed for "${name}" on ${nestedPath}`, { name, nestedPath, err: error });
  }
  return null;
}

function toMs(dateStr: string, eod = false): number {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: expected YYYY-MM-DD, got "${dateStr}"`);
  }
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`Invalid date string: "${dateStr}" — expected YYYY-MM-DD`);
  }
  if (eod) return Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const utcStart = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  if (utcStart <= Date.now()) return Date.now() + 5 * 60 * 1000;
  return utcStart;
}

function accountUrn(): string {
  return `urn:li:sponsoredAccount:${getAccountId()}`;
}

function orgUrn(): string {
  return `urn:li:organization:${getOrgId()}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyAccount(): Promise<{ name: string; status: string }> {
  const data = await linkedInRequest('GET', `adAccounts/${getAccountId()}`);
  return { name: data.name || getAccountId(), status: data.status || 'UNKNOWN' };
}

export async function resolveGeoTargets(locationNames: string[], req?: Request): Promise<LinkedInGeoTarget[]> {
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
    } catch (error: unknown) {
      logger.warning(req, 'linkedin_resolve_geo', `Failed to resolve geo: ${name}`, { name, err: error });
    }
  }

  return resolved;
}

export async function findOrCreateCampaignGroup(name: string, startDate: string, endDate: string): Promise<string> {
  const groupsPath = `adAccounts/${getAccountId()}/adCampaignGroups`;

  const existing = await findByName(groupsPath, name);
  if (existing) return existing;

  const body = {
    account: accountUrn(),
    name,
    status: 'ACTIVE',
    runSchedule: {
      start: toMs(startDate),
      end: toMs(endDate, true),
    },
  };

  const data = await linkedInRequest('POST', groupsPath, body);
  const id = (data.id as string) || '';
  if (!id) throw new Error('LinkedIn API returned no ID for campaign group');
  return id.includes(':') ? id.split(':').pop()! : id;
}

export async function createCampaign(
  groupId: string,
  name: string,
  budgetUsd: number,
  geoUrns: string[],
  targetingProfile: LinkedInTargetingProfile,
  startDate: string,
  endDate: string,
  lifetimeBudget = false
): Promise<string> {
  const campaignsPath = `adAccounts/${getAccountId()}/adCampaigns`;

  const existing = await findByName(campaignsPath, name);
  if (existing) return existing;

  const targeting = buildTargetingCriteria(targetingProfile, geoUrns);

  const budgetField = lifetimeBudget
    ? { totalBudget: { amount: budgetUsd.toFixed(2), currencyCode: 'USD' } }
    : { dailyBudget: { amount: budgetUsd.toFixed(2), currencyCode: 'USD' } };

  const body = {
    account: accountUrn(),
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
      start: toMs(startDate),
      end: toMs(endDate, true),
    },
    ...targeting,
  };

  const data = await linkedInRequest('POST', campaignsPath, body);
  const id = (data.id as string) || '';
  if (!id) throw new Error('LinkedIn API returned no ID for campaign');
  return id.includes(':') ? id.split(':').pop()! : id;
}

export async function createDarkPost(introText: string, headline: string, destUrl: string, imageUrn?: string): Promise<string> {
  const intro = stripEmDashes(introText);
  const head = stripEmDashes(headline);

  const article: Record<string, string> = {
    source: destUrl,
    title: head.slice(0, 200),
    description: '',
    ...(imageUrn ? { thumbnail: imageUrn } : {}),
  };

  const body: Record<string, unknown> = {
    author: orgUrn(),
    commentary: intro,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'NONE',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    content: { article },
    lifecycleState: 'PUBLISHED',
    adContext: { dscAdAccount: accountUrn() },
  };

  const data = await linkedInRequest('POST', 'posts', body);
  if (!data.id) throw new Error('LinkedIn dark post creation succeeded but returned no ID');
  return data.id;
}

export async function createCreative(campaignId: string, shareUrn: string, adName: string): Promise<string> {
  const body = {
    campaign: `urn:li:sponsoredCampaign:${campaignId}`,
    intendedStatus: 'DRAFT',
    content: { reference: shareUrn },
    ...(adName ? { name: adName.slice(0, 255) } : {}),
  };

  const data = await linkedInRequest('POST', `adAccounts/${getAccountId()}/creatives`, body);
  if (!data.id) throw new Error('LinkedIn creative creation succeeded but returned no ID');
  return data.id;
}

export function buildTargetingCriteria(profile: LinkedInTargetingProfile, geoUrns: string[]): Record<string, unknown> {
  let skills: readonly string[] = [];
  let groups: readonly string[] = [];

  if (profile === 'custom') {
    throw new Error('Custom targeting profile is not yet supported — use a named profile (cloud-native, mcp)');
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

  if (params.endDate <= params.startDate) {
    const err = new Error(`Invalid date range: endDate (${params.endDate}) must be after startDate (${params.startDate})`);
    logger.error(req, 'linkedin_campaign_create', startTime, err, { startDate: params.startDate, endDate: params.endDate });
    throw err;
  }

  try {
    const account = await verifyAccount();
    steps.push(`Verified account: ${account.name} (${account.status})`);

    const groupName = `Events | ${params.eventName} | ${params.project || 'TLF'}`;
    const groupId = await findOrCreateCampaignGroup(groupName, params.startDate, params.endDate);
    steps.push(`Campaign group: ${groupName} (ID: ${groupId})`);

    const geoUrns = params.geoTargets.map((g) => g.urn);
    const campaignName = `Events | ${params.eventName} | LinkedIn | Conversions | Prospecting | Static | ${params.project || 'TLF'} | MoFU`;
    const campaignId = await createCampaign(
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
      const shareUrn = await createDarkPost(variant.introText, variant.headline, destUrl, variant.imageUrn);
      steps.push(`Dark post variant-${i + 1}: ${shareUrn}`);

      const adName = `${params.eventName} | variant-${i + 1}`;
      const creativeId = await createCreative(campaignId, shareUrn, adName);
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
      campaignUrl: `https://www.linkedin.com/campaignmanager/accounts/${getAccountId()}/campaigns/${campaignId}`,
      steps,
    };

    logger.success(req, 'linkedin_campaign_create', startTime, { campaignId, creativeCount });
    return result;
  } catch (error: unknown) {
    logger.error(req, 'linkedin_campaign_create', startTime, error, { event: params.eventName });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripEmDashes(text: string): string {
  return text
    .replace(/ [—–] /g, ', ')
    .replace(/[—–]/g, ', ')
    .replace(/^, |, $/g, '');
}
