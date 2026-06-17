// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MetaCampaignCreateRequest, MetaCampaignCreateResult } from '@lfx-one/shared/interfaces';

import type { Request } from 'express';

import { META_ACCOUNTS, META_BASE_URL, META_REQUEST_TIMEOUT_MS } from '../constants';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// HTTP Helper
// ---------------------------------------------------------------------------

function getMetaAccessToken(): string {
  const token = process.env['META_ACCESS_TOKEN'];
  if (!token) throw new Error('META_ACCESS_TOKEN environment variable is not configured');
  return token;
}

async function metaRequest<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
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
    logger.warning(undefined, 'meta_api_error', `Meta API ${method} ${path} → ${resp.status}: ${text.slice(0, 400)}`, { method, path, status: resp.status });
    throw new Error(`Meta API request failed (${resp.status}). Check server logs for details.`);
  }

  return (await resp.json()) as T;
}

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
// Region / Name helpers
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

function buildMetaCampaignName(config: MetaCampaignCreateRequest): string {
  const event = config.eventName.replace(/\|/g, '-');
  const region = resolveRegion(config.geoTargets);
  const project = (config.project || 'Linux Foundation').replace(/\|/g, '-');
  return `Events | ${event} | ${region} | Conversions | Intent | Social | ${project} | MoFU`;
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

const META_ADS_MANAGER_URL = 'https://adsmanager.facebook.com';

export async function executeMetaCampaignCreation(req: Request | undefined, config: MetaCampaignCreateRequest): Promise<MetaCampaignCreateResult> {
  const startTime = logger.startOperation(req, 'meta_campaign_create', { eventName: config.eventName });
  const steps: string[] = [];

  if (!config.variants || config.variants.length === 0) {
    throw new Error('At least one ad variant is required for Meta campaign creation');
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
    await metaRequest<Record<string, unknown>>('GET', `/${accountId}?fields=name,account_status`);
    steps.push(`Account verified: ${account.label} (${accountId})`);
  } catch (err) {
    logger.warning(req, 'meta_account_verify', 'Account verification failed', { error: err instanceof Error ? err.message : 'Unknown error' });
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

  const campaignName = buildMetaCampaignName({ ...config, geoTargets: geoCountries });

  const campaignResp = await metaRequest<MetaCreateResponse>('POST', `/${accountId}/campaigns`, {
    name: campaignName,
    objective: 'OUTCOME_TRAFFIC',
    status: 'PAUSED',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId = campaignResp.id;
  if (!campaignId) throw new Error('Meta campaign creation succeeded but returned no campaign ID');
  steps.push(`Campaign created: ${campaignId} (PAUSED)`);

  // Step 3: Create ad set with budget, schedule, and geo targeting
  const budgetCents = Math.round(config.budgetUsd * 100);
  const adSetName = `${config.eventName} - Traffic`;

  const adSetBody: Record<string, unknown> = {
    name: adSetName,
    campaign_id: campaignId,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: {
      geo_locations: { countries: geoCountries },
      publisher_platforms: ['facebook', 'instagram'],
    },
    start_time: `${config.startDate}T00:00:00+0000`,
    end_time: `${config.endDate}T23:59:59+0000`,
  };

  if (config.lifetimeBudget) {
    adSetBody['lifetime_budget'] = budgetCents;
  } else {
    adSetBody['daily_budget'] = budgetCents;
  }

  const adSetResp = await metaRequest<MetaCreateResponse>('POST', `/${accountId}/adsets`, adSetBody);
  const adSetId = adSetResp.id;
  if (!adSetId) throw new Error('Meta ad set creation succeeded but returned no ad set ID');
  const budgetLabel = config.lifetimeBudget ? 'lifetime' : 'daily';
  steps.push(`Ad set created: ${adSetId} ($${config.budgetUsd.toFixed(2)} ${budgetLabel}, geo: ${geoCountries.join(', ')})`);

  // Step 4: Create ad creative + ad for each variant
  let adCount = 0;
  for (let i = 0; i < config.variants.length; i++) {
    const variant = config.variants[i];
    const utmUrl = buildMetaUtmUrl(config, i);

    try {
      const creativeResp = await metaRequest<MetaCreateResponse>('POST', `/${accountId}/adcreatives`, {
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

      const adResp = await metaRequest<MetaCreateResponse>('POST', `/${accountId}/ads`, {
        name: `${config.eventName} - Ad ${i + 1}`,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
      });
      if (!adResp.id) throw new Error('Ad creation returned no ID');

      adCount++;
      steps.push(`Ad ${i + 1} created: ${adResp.id} (creative: ${creativeId}) → ${utmUrl}`);
    } catch (err) {
      logger.warning(req, 'meta_ad_create', `Ad variant ${i + 1} creation failed`, { error: err instanceof Error ? err.message : 'Unknown error' });
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
