// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AI_MODEL } from '@lfx-one/shared/constants';

import type {
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignCreateResult,
  CampaignJobStatus,
  CampaignKeyword,
  CampaignSSEEventType,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// Google Ads gRPC client (via google-ads-api)
// ---------------------------------------------------------------------------

import { GoogleAdsApi, enums } from 'google-ads-api';

import type { Customer } from 'google-ads-api';

// ---------------------------------------------------------------------------
// Required environment variables — log warnings at startup for missing ones
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = ['GADS_CLIENT_ID', 'GADS_CLIENT_SECRET', 'GADS_DEVELOPER_TOKEN', 'GADS_CUSTOMER_ID', 'GADS_REFRESH_TOKEN'];

let envChecked = false;

function checkRequiredEnv(req?: Request): void {
  if (envChecked) return;
  envChecked = true;
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      logger.warning(req, 'campaign_proxy_init', `Missing environment variable: ${envVar} — Google Ads features will not work`, { envVar });
    }
  }
}

function getEnv(key: string): string {
  return process.env[key] || '';
}

// ---------------------------------------------------------------------------
// SSRF validation for user-provided URLs
// ---------------------------------------------------------------------------

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // link-local / AWS IMDS
  /^::1$/,
  /^::ffff:\d+\.\d+\.\d+\.\d+$/i, // IPv4-mapped IPv6
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7 covers both fc and fd)
  /^fe80:/i, // IPv6 link-local
];

export async function validateScrapeUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  const port = parsed.port ? Number(parsed.port) : 443;
  if (port !== 80 && port !== 443) {
    throw new Error('Only ports 80 and 443 are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(hostname))) {
    throw new Error('URLs targeting private/internal hosts are not allowed');
  }

  const { promises: dns } = await import('node:dns');
  let addresses4: string[];
  let addresses6: string[];
  try {
    [addresses4, addresses6] = await Promise.all([
      dns.resolve4(hostname).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
        throw err;
      }),
      dns.resolve6(hostname).catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return [];
        throw err;
      }),
    ]);
  } catch {
    throw new Error('DNS resolution failed — cannot verify host safety');
  }
  for (const addr of [...addresses4, ...addresses6]) {
    if (PRIVATE_IP_PATTERNS.some((p) => p.test(addr))) {
      throw new Error('Blocked host: resolves to private IP');
    }
  }

  return `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

let gadsClient: GoogleAdsApi | null = null;
let gadsCustomer: Customer | null = null;

function getGadsClient(): GoogleAdsApi {
  if (!gadsClient) {
    const clientId = getEnv('GADS_CLIENT_ID');
    const clientSecret = getEnv('GADS_CLIENT_SECRET');
    const developerToken = getEnv('GADS_DEVELOPER_TOKEN');
    if (!clientId || !clientSecret || !developerToken) {
      throw new Error('Google Ads credentials not configured (GADS_CLIENT_ID, GADS_CLIENT_SECRET, GADS_DEVELOPER_TOKEN)');
    }
    gadsClient = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken,
    });
  }
  return gadsClient;
}

export function getCustomer(): Customer {
  if (!gadsCustomer) {
    gadsCustomer = getGadsClient().Customer({
      customer_id: getEnv('GADS_CUSTOMER_ID'),
      refresh_token: getEnv('GADS_REFRESH_TOKEN'),
      login_customer_id: getEnv('GADS_LOGIN_CUSTOMER_ID') || undefined,
    });
  }
  return gadsCustomer;
}

export async function gaqlSearch(query: string): Promise<unknown[]> {
  return getCustomer().query(query);
}

// ---------------------------------------------------------------------------
// HubSpot campaign UTM helpers
// ---------------------------------------------------------------------------

const HS_BASE = 'https://api.hubapi.com';

interface HubSpotUtmResult {
  found: boolean;
  hsUtm: string | null;
  campaignName: string;
  campaignId: string | null;
}

function hsHeaders(): Record<string, string> {
  const token = getEnv('HUBSPOT_ACCESS_TOKEN');
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN not configured');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function buildUtmTokenFallback(campaignId: string, name: string): string {
  return `${campaignId}-${name}`;
}

async function hubspotSearchCampaign(eventName: string): Promise<HubSpotUtmResult> {
  const response = await fetch(`${HS_BASE}/crm/v3/objects/0-35/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      query: eventName,
      limit: 10,
      properties: ['hs_name', 'hs_utm', 'hs_start_date'],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HubSpot search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { results?: { id: string; properties: Record<string, string> }[] };
  const results = data.results ?? [];

  if (results.length === 0) {
    return { found: false, hsUtm: null, campaignName: '', campaignId: null };
  }

  const queryLower = eventName.toLowerCase();
  const scored = results.map((c) => {
    const name = c.properties['hs_name'] || '';
    const hsUtm = c.properties['hs_utm'] || buildUtmTokenFallback(c.id, name);
    const nameLower = name.toLowerCase();
    const score =
      (nameLower === queryLower ? 1 : 0) +
      (queryLower.includes(nameLower) || nameLower.includes(queryLower) ? 1 : 0) +
      (queryLower.split(' ').filter((w) => w.length > 3 && nameLower.includes(w)).length > 0 ? 1 : 0);
    return { id: c.id, name, hsUtm, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best.score === 0) {
    return { found: false, hsUtm: null, campaignName: '', campaignId: null };
  }

  return { found: true, hsUtm: best.hsUtm, campaignName: best.name, campaignId: best.id };
}

async function hubspotCreateCampaign(eventName: string): Promise<HubSpotUtmResult> {
  const createResponse = await fetch(`${HS_BASE}/marketing/v3/campaigns`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({ properties: { hs_name: eventName } }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!createResponse.ok) {
    const text = await createResponse.text().catch(() => '');
    throw new Error(`HubSpot create failed (${createResponse.status}): ${text}`);
  }

  const created = (await createResponse.json()) as { id: string };
  const campaignUuid = created.id;

  const searchResponse = await fetch(`${HS_BASE}/crm/v3/objects/0-35/search`, {
    method: 'POST',
    headers: hsHeaders(),
    body: JSON.stringify({
      query: eventName,
      limit: 1,
      properties: ['hs_name', 'hs_utm'],
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  let hsUtm: string | null = null;
  let campaignId = campaignUuid;

  if (searchResponse?.ok) {
    const searchData = (await searchResponse.json()) as { results?: { id: string; properties: Record<string, string> }[] };
    const results = searchData.results ?? [];
    if (results.length > 0) {
      campaignId = results[0].id;
      hsUtm = results[0].properties['hs_utm'] || null;
    }
  }

  if (!hsUtm) {
    hsUtm = buildUtmTokenFallback(campaignUuid, eventName);
  }

  return { found: true, hsUtm, campaignName: eventName, campaignId };
}

async function resolveHubSpotUtm(eventName: string): Promise<string | null> {
  if (!getEnv('HUBSPOT_ACCESS_TOKEN')) return null;

  const searchResult = await hubspotSearchCampaign(eventName);
  if (searchResult.found && searchResult.hsUtm) return searchResult.hsUtm;

  const createResult = await hubspotCreateCampaign(eventName);
  return createResult.hsUtm;
}

// ---------------------------------------------------------------------------
// AI service helpers (LiteLLM proxy — same pattern as ai.service.ts)
// ---------------------------------------------------------------------------

async function aiChat(systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string> {
  const aiProxyUrl = getEnv('AI_PROXY_URL');
  const aiApiKey = getEnv('AI_API_KEY');
  if (!aiProxyUrl || !aiApiKey) throw new Error('AI_PROXY_URL and AI_API_KEY required');

  const response = await fetch(aiProxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AI request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI proxy returned an empty or malformed response');
  }
  return content;
}

async function* aiChatStream(systemPrompt: string, userPrompt: string, signal: AbortSignal, maxTokens = 4096): AsyncGenerator<string> {
  const aiProxyUrl = getEnv('AI_PROXY_URL');
  const aiApiKey = getEnv('AI_API_KEY');
  if (!aiProxyUrl || !aiApiKey) throw new Error('AI_PROXY_URL and AI_API_KEY required');

  const response = await fetch(aiProxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${aiApiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      stream: true,
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI streaming request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as { choices: { delta: { content?: string } }[] };
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// AI prompts
// ---------------------------------------------------------------------------

const COPY_SYSTEM_PROMPT = `You are an expert digital marketer specialising in developer events and open-source conferences.
Generate high-quality, conversion-focused ad copy for the Linux Foundation's LFX events.

PLATFORM SPECIFICATIONS (hard limits — never exceed):

GOOGLE SEARCH (RSA):
- Headlines: 15 total, each ≤ 30 characters (STRICT — Google rejects longer)
- Descriptions: 4 total, each ≤ 90 characters (STRICT)
- Tone: direct, benefit-led, include CTA ("Register Now", "Join Today", "Secure Your Spot")

GOOGLE DEMAND GEN (key: "google_display" — runs on YouTube, Discover, Gmail, Display):
- headlines: 5 variations, each ≤ 40 characters (STRICT — Demand Gen limit is 40, not 30)
- descriptions: 5 variations, each ≤ 90 characters (STRICT)
- business_name: ≤ 25 chars — use the event's parent organization (e.g. "CNCF" for KubeCon). Default to "Linux Foundation" only if no specific foundation is identifiable.
- call_to_action: one of "Learn More", "Register", "Sign Up", "Book Now", "Apply Now"

IMPORTANT RULES:
1. Dates must come ONLY from the event data provided — never use training-data memory
2. CHARACTER LIMITS ARE HARD — Google Ads REJECTS copy that exceeds them. Verify EVERY line.
3. NEVER abbreviate month names, city names, or event names unless required to fit character limits
4. NEVER use em-dashes (—) or en-dashes (–) in ad copy. Use commas, periods, or colons instead.
5. Demand Gen headlines are 40 chars max (not 30) — use the extra space for better copy.

Respond with a JSON object (no markdown fences). Keys: "google_search" and "google_display".`;

const KEYWORD_SYSTEM_PROMPT = `You are a Google Ads keyword strategist. Return only a valid JSON array. No markdown fences, no explanation.`;

const EVENT_EXTRACTION_PROMPT = `Extract structured event details from this HTML. Return valid JSON:
{
  "name": "event name",
  "dates": "human-readable date range",
  "city": "city name or Virtual",
  "country_code": "ISO 2-letter code",
  "audience": "target audience description",
  "themes": ["theme1", "theme2"],
  "registration_url": "URL",
  "slug": "url-friendly-slug",
  "format_notes": "in-person/virtual/hybrid"
}

If a field cannot be determined, use null.`;

// ---------------------------------------------------------------------------
// Background job management
// ---------------------------------------------------------------------------

const jobs = new Map<string, CampaignJobStatus>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — mark hung jobs as failed

function createJob(): string {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, { status: 'running' });

  setTimeout(() => {
    const job = jobs.get(jobId);
    if (job?.status === 'running') {
      failJob(jobId, 'Job timed out after 5 minutes');
    }
  }, JOB_TIMEOUT_MS);

  return jobId;
}

function completeJob(jobId: string, result: CampaignCreateResponse): void {
  jobs.set(jobId, { status: 'done', result });
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
}

function failJob(jobId: string, error: string): void {
  jobs.set(jobId, { status: 'error', error });
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
}

// ---------------------------------------------------------------------------
// Country code to Google Ads geo target constant ID
// ---------------------------------------------------------------------------

const GEO_TARGET_MAP: Record<string, string> = {
  US: '2840',
  CA: '2124',
  GB: '2826',
  DE: '2276',
  FR: '2250',
  JP: '2392',
  AU: '2036',
  IN: '2356',
  BR: '2076',
  CN: '2156',
  KR: '2410',
  NL: '2528',
  SE: '2752',
  CH: '2756',
  IL: '2376',
  SG: '2702',
  IE: '2372',
  ES: '2724',
  IT: '2380',
  AT: '2040',
  FI: '2246',
  NO: '2578',
  DK: '2208',
  BE: '2056',
  PL: '2616',
  CZ: '2203',
  NZ: '2554',
  TW: '2158',
  HK: '2344',
  MX: '2484',
};

// ---------------------------------------------------------------------------
// CampaignProxyService — brief generation + campaign creation
// ---------------------------------------------------------------------------

export class CampaignProxyService {
  // === HubSpot UTM lookup/create ===

  public async lookupHubSpotUtm(
    _req: Request,
    eventName: string
  ): Promise<{ found: boolean; hs_utm: string | null; campaign_name: string; all_matches: { name: string; hs_utm: string }[] }> {
    const result = await hubspotSearchCampaign(eventName);
    return {
      found: result.found,
      hs_utm: result.hsUtm,
      campaign_name: result.campaignName,
      all_matches: result.found && result.hsUtm ? [{ name: result.campaignName, hs_utm: result.hsUtm }] : [],
    };
  }

  public async createHubSpotUtm(_req: Request, eventName: string): Promise<{ created: boolean; hs_utm: string | null; campaign_name: string }> {
    const result = await hubspotCreateCampaign(eventName);
    return {
      created: result.found,
      hs_utm: result.hsUtm,
      campaign_name: result.campaignName,
    };
  }

  // === Brief generation (SSE stream) ===

  public async *streamBrief(req: Request, body: CampaignBriefRequest, signal: AbortSignal): AsyncGenerator<{ type: CampaignSSEEventType; data: unknown }> {
    checkRequiredEnv(req);

    const unsupported = (body.platforms ?? []).filter((p) => p !== 'google-ads');
    if (unsupported.length > 0) {
      yield { type: 'error', data: `Unsupported platforms: ${unsupported.join(', ')}. Only google-ads is currently supported.` };
      return;
    }

    yield { type: 'status', data: `Scraping ${body.url}...` };

    let safeUrl: string;
    try {
      safeUrl = await validateScrapeUrl(body.url);
    } catch (error) {
      yield { type: 'error', data: `Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}` };
      return;
    }

    let html = '';
    try {
      let scrapeResponse = await fetch(safeUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LFX/1.0)' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: 'manual',
      });

      // Follow redirects manually to validate each target against SSRF
      let redirectCount = 0;
      let currentUrl = safeUrl;
      while (scrapeResponse.status >= 300 && scrapeResponse.status < 400 && redirectCount < 5) {
        const location = scrapeResponse.headers.get('location');
        if (!location) break;
        currentUrl = await validateScrapeUrl(new URL(location, currentUrl).href);
        scrapeResponse = await fetch(currentUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LFX/1.0)' },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          redirect: 'manual',
        });
        redirectCount++;
      }

      if (!scrapeResponse.ok) {
        yield { type: 'error', data: `Event page returned HTTP ${scrapeResponse.status}` };
        return;
      }
      html = await scrapeResponse.text();
    } catch (error) {
      yield { type: 'error', data: `Failed to fetch event page: ${error instanceof Error ? error.message : 'Unknown error'}` };
      return;
    }

    yield { type: 'status', data: 'Extracting event details...' };

    let eventDetails: Record<string, unknown> | null = null;
    try {
      const extraction = await aiChat(EVENT_EXTRACTION_PROMPT, `URL: ${body.url}\n\nHTML:\n${html.slice(0, 30_000)}`);
      eventDetails = JSON.parse(extraction) as Record<string, unknown>;
      yield { type: 'event', data: eventDetails };
    } catch (error) {
      logger.warning(req, 'campaign_brief_extract', 'Event extraction failed, continuing with URL only', { err: error });
      yield { type: 'status', data: 'Could not extract structured event details, generating copy from URL...' };
    }

    const eventName = (eventDetails?.['name'] as string) || extractEventNameFromUrl(body.url);
    if (eventName) {
      yield { type: 'status', data: 'Looking up HubSpot campaign...' };
      try {
        const hsUtm = await resolveHubSpotUtm(eventName);
        if (hsUtm) {
          yield { type: 'hubspot_utm', data: { hsUtm, eventName } };
        } else {
          yield { type: 'status', data: 'HubSpot not configured, skipping UTM lookup...' };
        }
      } catch (error) {
        logger.warning(req, 'campaign_brief_hubspot', 'HubSpot UTM lookup failed, continuing without', { err: error });
        yield { type: 'status', data: 'HubSpot UTM lookup failed, continuing...' };
      }
    }

    const platformList = (body.platforms || ['google-ads']).join(', ');
    yield { type: 'status', data: `Generating copy for ${platformList}...` };

    const userPrompt = buildCopyPrompt(body, eventDetails);
    let fullCopy = '';

    try {
      for await (const token of aiChatStream(COPY_SYSTEM_PROMPT, userPrompt, signal)) {
        yield { type: 'copy_token', data: token };
        fullCopy += token;
      }
      yield { type: 'copy_done', data: null };

      try {
        let text = fullCopy.trim();
        if (text.startsWith('```')) {
          const firstNewline = text.indexOf('\n');
          if (firstNewline !== -1) text = text.slice(firstNewline + 1);
          const lastFence = text.lastIndexOf('```');
          if (lastFence !== -1) text = text.slice(0, lastFence);
          text = text.trim();
        }
        const structured = JSON.parse(text) as Record<string, unknown>;

        truncateAdCopy(structured);
        yield { type: 'copy_structured', data: structured };
      } catch {
        yield { type: 'copy_structured', data: { raw: fullCopy } };
      }
    } catch (error) {
      if (signal.aborted) return;
      yield { type: 'error', data: `Ad copy generation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
      return;
    }

    if (body.platforms?.includes('google-ads') || !body.platforms || body.platforms.length === 0) {
      yield { type: 'status', data: 'Generating keyword list...' };

      try {
        const kwPrompt = buildKeywordPrompt(body, eventDetails);
        let kwText = (await aiChat(KEYWORD_SYSTEM_PROMPT, kwPrompt)).trim();
        if (kwText.startsWith('```')) {
          const firstNl = kwText.indexOf('\n');
          if (firstNl !== -1) kwText = kwText.slice(firstNl + 1);
          const lastFence = kwText.lastIndexOf('```');
          if (lastFence !== -1) kwText = kwText.slice(0, lastFence);
          kwText = kwText.trim();
        }
        let kwList = JSON.parse(kwText);
        if (kwList && typeof kwList === 'object' && !Array.isArray(kwList) && Array.isArray(kwList.keywords)) {
          kwList = kwList.keywords;
        }
        const keywords = (kwList as Record<string, string>[]).map((k) => ({
          term: k['term'] || k['keyword'] || '',
          matchType: k['match_type'] || k['matchType'] || 'Broad',
          intentLevel: k['intent_level'] || k['intentLevel'] || 'Medium',
          notes: k['notes'] || '',
        }));
        yield { type: 'keywords', data: keywords };
      } catch (error) {
        logger.warning(req, 'campaign_brief_keywords', 'Keyword generation failed', { err: error });
        yield { type: 'status', data: 'Keyword generation failed, skipping...' };
      }
    }

    yield { type: 'done', data: null };
  }

  // === Campaign creation (async job) ===

  public async createCampaign(_req: Request, body: CampaignCreateRequest): Promise<{ jobId: string }> {
    const jobId = createJob();

    this.executeCampaignCreation(jobId, body).catch((error) => {
      failJob(jobId, error instanceof Error ? error.message : 'Campaign creation failed');
    });

    return { jobId };
  }

  // === Job polling ===

  public async getJobStatus(_req: Request, jobId: string): Promise<CampaignJobStatus> {
    const job = jobs.get(jobId);
    if (!job) return { status: 'not_found', error: 'Job not found' };
    return job;
  }

  // === Private: campaign creation orchestration ===

  private async executeCampaignCreation(jobId: string, body: CampaignCreateRequest): Promise<void> {
    const effectiveBody = { ...body };
    if (!effectiveBody.hsToken) {
      try {
        const hsUtm = await resolveHubSpotUtm(effectiveBody.eventName);
        if (hsUtm) effectiveBody.hsToken = hsUtm;
      } catch {
        // HubSpot unavailable — fall back to event slug for UTM
      }
    }

    const results: CampaignCreateResult[] = [];
    const errors: string[] = [];

    for (const campaignType of effectiveBody.campaignTypes) {
      const startTime = Date.now();
      try {
        const result = campaignType === 'search' ? await this.createSearchCampaign(effectiveBody) : await this.createDemandGenCampaign(effectiveBody);
        results.push(result);
      } catch (error: unknown) {
        if (getGadsErrorCode(error) === 'DUPLICATE_CAMPAIGN_NAME') {
          try {
            const retryBody = { ...effectiveBody, eventName: `${effectiveBody.eventName}-${Date.now().toString(36).slice(-4)}` };
            const result = campaignType === 'search' ? await this.createSearchCampaign(retryBody) : await this.createDemandGenCampaign(retryBody);
            results.push(result);
            continue;
          } catch (retryError: unknown) {
            const detail = extractGadsErrorMessage(retryError);
            logger.error(undefined, 'campaign_create_type', startTime, retryError as Error, { campaignType, detail });
            errors.push(`${campaignType}: ${detail}`);
            continue;
          }
        }
        const detail = extractGadsErrorMessage(error);
        logger.error(undefined, 'campaign_create_type', startTime, error as Error, { campaignType, detail });
        errors.push(`${campaignType}: ${detail}`);
      }
    }

    completeJob(jobId, { success: errors.length === 0, campaigns: results, errors });
  }

  private async createSearchCampaign(body: CampaignCreateRequest): Promise<CampaignCreateResult> {
    const steps: string[] = [];
    const customer = getCustomer();
    const { searchPct } = normalizeBudgetSplit(body.searchBudgetPct, body.campaignTypes);
    const budgetMicros = Math.round(body.budgetUsd * searchPct * 1_000_000);
    const campaignName = buildCampaignName(body, 'Search');

    // 1. Create budget
    const budgetResult = await customer.campaignBudgets.create([
      {
        name: `${campaignName} Budget ${Date.now()}`,
        amount_micros: budgetMicros,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    ]);
    const budgetResource = budgetResult.results[0]?.resource_name;
    if (!budgetResource) throw new Error('Budget creation did not return a resource_name');
    steps.push(`Created budget: $${(budgetMicros / 1_000_000).toFixed(2)}/day`);

    // 2. Create campaign
    const campaignResult = await customer.campaigns.create([
      {
        name: campaignName,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: enums.CampaignStatus.PAUSED,
        campaign_budget: budgetResource,
        start_date_time: `${body.startDate} 00:00:00`,
        end_date_time: `${body.endDate} 23:59:59`,
        maximize_conversions: {},
        network_settings: {
          target_google_search: true,
          target_search_network: true,
          target_content_network: false,
        },
      },
    ]);
    const campaignResource = campaignResult.results[0]?.resource_name;
    if (!campaignResource) throw new Error('Campaign creation did not return a resource_name');
    const campaignId = campaignResource.split('/').pop() || '';
    steps.push(`Created campaign: ${campaignName}`);

    // 3. Geo targeting
    const geoOps = body.geoTargets
      .map((geo) => {
        const geoConstantId = GEO_TARGET_MAP[geo.toUpperCase()];
        return geoConstantId ? { campaign: campaignResource, location: { geo_target_constant: `geoTargetConstants/${geoConstantId}` } } : null;
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (geoOps.length > 0) {
      await customer.campaignCriteria.create(geoOps);
      steps.push(`Added ${geoOps.length} geo target(s)`);
    }

    // 4. Create ad group
    const adGroupResult = await customer.adGroups.create([
      {
        name: `${body.eventName} - Keywords`,
        campaign: campaignResource,
        type: enums.AdGroupType.SEARCH_STANDARD,
        status: enums.AdGroupStatus.ENABLED,
      },
    ]);
    const adGroupResource = adGroupResult.results[0]?.resource_name;
    if (!adGroupResource) throw new Error('Ad group creation did not return a resource_name');
    steps.push('Created ad group');

    // 5. Add keywords
    const keywordOps = (body.keywords as CampaignKeyword[])
      .filter((kw) => kw.term.trim())
      .map((kw) => ({
        ad_group: adGroupResource,
        keyword: { text: kw.term, match_type: resolveMatchType(kw.matchType) },
        status: enums.AdGroupCriterionStatus.ENABLED,
      }));

    if (keywordOps.length > 0) {
      await customer.adGroupCriteria.create(keywordOps);
      steps.push(`Added ${keywordOps.length} keywords`);
    }

    // 6. Create RSA ad
    const finalUrl = buildFinalUrl(body, 'search');
    const headlines = body.headlines.filter((h) => h.trim()).slice(0, 15);
    const descriptions = body.descriptions.filter((d) => d.trim()).slice(0, 4);

    await customer.adGroupAds.create([
      {
        ad_group: adGroupResource,
        ad: {
          responsive_search_ad: {
            headlines: headlines.map((h, i) => ({
              text: h.slice(0, 30),
              pinned_field: i < 3 ? HEADLINE_PIN_FIELDS[i] : undefined,
            })),
            descriptions: descriptions.map((d) => ({ text: d.slice(0, 90) })),
          },
          final_urls: [finalUrl],
        },
        status: enums.AdGroupAdStatus.ENABLED,
      },
    ]);
    steps.push(`Created RSA ad with ${headlines.length} headlines, ${descriptions.length} descriptions`);

    return {
      type: 'search',
      campaignName,
      campaignId,
      adGroupCount: 1,
      keywordCount: keywordOps.length,
      adCount: 1,
      googleAdsUrl: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`,
      steps,
    };
  }

  private async createDemandGenCampaign(body: CampaignCreateRequest): Promise<CampaignCreateResult> {
    const steps: string[] = [];
    const customer = getCustomer();
    const { displayPct } = normalizeBudgetSplit(body.searchBudgetPct, body.campaignTypes);
    const budgetMicros = Math.round(body.budgetUsd * displayPct * 1_000_000);
    const campaignName = buildCampaignName(body, 'DemandGen');

    const budgetResult = await customer.campaignBudgets.create([
      {
        name: `${campaignName} Budget ${Date.now()}`,
        amount_micros: budgetMicros,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        explicitly_shared: false,
      },
    ]);
    const budgetResource = budgetResult.results[0]?.resource_name;
    if (!budgetResource) throw new Error('Budget creation did not return a resource_name');
    steps.push(`Created budget: $${(budgetMicros / 1_000_000).toFixed(2)}/day`);

    const campaignResult = await customer.campaigns.create([
      {
        name: campaignName,
        advertising_channel_type: enums.AdvertisingChannelType.DEMAND_GEN,
        status: enums.CampaignStatus.PAUSED,
        campaign_budget: budgetResource,
        start_date_time: `${body.startDate} 00:00:00`,
        end_date_time: `${body.endDate} 23:59:59`,
        target_spend: {},
      },
    ]);
    const campaignResource = campaignResult.results[0]?.resource_name;
    if (!campaignResource) throw new Error('Campaign creation did not return a resource_name');
    const campaignId = campaignResource.split('/').pop() || '';
    steps.push(`Created Demand Gen campaign: ${campaignName}`);

    const adGroupResult = await customer.adGroups.create([
      {
        name: `${body.eventName} - Display`,
        campaign: campaignResource,
        type: enums.AdGroupType.DISPLAY_STANDARD,
        status: enums.AdGroupStatus.ENABLED,
      },
    ]);
    const adGroupResource = adGroupResult.results[0]?.resource_name;
    if (!adGroupResource) throw new Error('Ad group creation did not return a resource_name');
    steps.push('Created ad group');

    // Geo targeting at ad group level (Demand Gen doesn't support campaign-level location criteria)
    const geoOps = body.geoTargets
      .map((geo) => {
        const geoConstantId = GEO_TARGET_MAP[geo.toUpperCase()];
        return geoConstantId ? { ad_group: adGroupResource, location: { geo_target_constant: `geoTargetConstants/${geoConstantId}` } } : null;
      })
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (geoOps.length > 0) {
      try {
        await customer.adGroupCriteria.create(geoOps);
        steps.push(`Added ${geoOps.length} geo target(s) at ad group level`);
      } catch {
        steps.push('Geo targeting skipped (configure manually in Google Ads UI)');
      }
    }

    steps.push('Demand Gen campaign created — upload images and publish in Google Ads UI');

    return {
      type: 'demand-gen',
      campaignName,
      campaignId,
      adGroupCount: 1,
      keywordCount: 0,
      adCount: 0,
      googleAdsUrl: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`,
      steps,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveMatchType(matchType: string): number {
  const normalized = matchType.toLowerCase();
  if (normalized === 'exact') return enums.KeywordMatchType.EXACT;
  if (normalized === 'phrase') return enums.KeywordMatchType.PHRASE;
  return enums.KeywordMatchType.BROAD;
}

const HEADLINE_PIN_FIELDS = [enums.ServedAssetFieldType.HEADLINE_1, enums.ServedAssetFieldType.HEADLINE_2, enums.ServedAssetFieldType.HEADLINE_3];

function normalizeBudgetSplit(searchBudgetPct: number, campaignTypes: string[]): { searchPct: number; displayPct: number } {
  const hasSearch = campaignTypes.includes('search');
  const hasDisplay = campaignTypes.includes('demand-gen');
  if (hasSearch && !hasDisplay) return { searchPct: 1, displayPct: 0 };
  if (!hasSearch && hasDisplay) return { searchPct: 0, displayPct: 1 };
  const raw = Math.max(0, Math.min(100, searchBudgetPct)) / 100;
  return { searchPct: raw, displayPct: 1 - raw };
}

function truncateAdCopy(obj: Record<string, unknown>): void {
  const truncateStrings = (arr: unknown[], max: number): string[] => (arr as string[]).filter((s) => typeof s === 'string').map((s) => s.slice(0, max));

  const gs = obj['google_search'] as Record<string, unknown> | undefined;
  if (gs) {
    if (Array.isArray(gs['headlines'])) gs['headlines'] = truncateStrings(gs['headlines'], 30);
    if (Array.isArray(gs['descriptions'])) gs['descriptions'] = truncateStrings(gs['descriptions'], 90);
  }

  const gd = obj['google_display'] as Record<string, unknown> | undefined;
  if (gd) {
    if (Array.isArray(gd['headlines'])) gd['headlines'] = truncateStrings(gd['headlines'], 40);
    if (Array.isArray(gd['descriptions'])) gd['descriptions'] = truncateStrings(gd['descriptions'], 90);
    if (typeof gd['business_name'] === 'string') gd['business_name'] = (gd['business_name'] as string).slice(0, 25);
  }

  const platforms = obj['platforms'] as Record<string, unknown> | undefined;
  if (platforms) {
    if (platforms['google_search']) truncateAdCopy({ google_search: platforms['google_search'] } as Record<string, unknown>);
    if (platforms['google_display'] || platforms['demand_gen']) {
      const key = platforms['google_display'] ? 'google_display' : 'demand_gen';
      truncateAdCopy({ google_display: platforms[key] } as Record<string, unknown>);
    }
  }
}

function extractEventNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/\/$/, '');
    const slug = pathname.split('/').pop() || '';
    return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return '';
  }
}

function buildCopyPrompt(body: CampaignBriefRequest, eventDetails: Record<string, unknown> | null): string {
  const extraParts: string[] = [];
  if (body.campaignGoal) extraParts.push(`Campaign Goal: ${body.campaignGoal}`);
  if (body.targetAudience) extraParts.push(`Target Audience: ${body.targetAudience}`);
  if (body.valueProp) extraParts.push(`Key Value Prop / Offer: ${body.valueProp}`);
  if (body.totalBudget) extraParts.push(`Total Campaign Budget: $${body.totalBudget}`);
  const extraBlock = extraParts.length > 0 ? `\n\nADDITIONAL CAMPAIGN CONTEXT:\n${extraParts.join('\n')}` : '';

  if (eventDetails) {
    const e = eventDetails;
    const themes = Array.isArray(e['themes']) ? (e['themes'] as string[]).join(', ') : '';
    const speakers = Array.isArray(e['speakers']) ? (e['speakers'] as string[]).slice(0, 5).join(', ') : '';
    return `Generate ad copy for this LF event across the requested platforms.

EVENT DATA:
Name: ${e['name'] || ''}
Dates: ${e['dates'] || ''}
City: ${e['city'] || ''}
Country: ${e['country_code'] || ''}
Audience: ${e['audience'] || ''}
Themes: ${themes}
Registration URL: ${e['registration_url'] || body.url}
Speakers: ${speakers}
Format: ${e['format_notes'] || ''}${extraBlock}

REQUESTED PLATFORMS: google_search, google_display

Return a JSON object with keys "google_search" and "google_display" following the schema in the system prompt.`;
  }

  return `Generate ad copy for: ${body.url}${extraBlock}

REQUESTED PLATFORMS: google_search, google_display

Return a JSON object with keys "google_search" and "google_display" following the schema in the system prompt.`;
}

function buildKeywordPrompt(body: CampaignBriefRequest, eventDetails: Record<string, unknown> | null): string {
  const extraParts: string[] = [];
  if (body.campaignGoal) extraParts.push(`Campaign Goal: ${body.campaignGoal}`);
  if (body.targetAudience) extraParts.push(`Target Audience: ${body.targetAudience}`);
  if (body.valueProp) extraParts.push(`Key Value Prop / Offer: ${body.valueProp}`);
  const extraBlock = extraParts.length > 0 ? `\n\nADDITIONAL CAMPAIGN CONTEXT:\n${extraParts.join('\n')}` : '';

  const e = eventDetails || {};
  const name = (e['name'] as string) || '';
  const dates = (e['dates'] as string) || '';
  const themes = Array.isArray(e['themes']) ? (e['themes'] as string[]).join(', ') : '';
  const audience = (e['audience'] as string) || '';
  const city = (e['city'] as string) || '';
  const yearMatch = dates.match(/20\d{2}/);
  const eventYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  return `Generate 25-40 high-intent Google Search keywords for this event.

EVENT: ${name || body.url}
Dates: ${dates}
Location: ${city}
Themes: ${themes}
Audience: ${audience}${extraBlock}

Keyword categories to cover:
1. Brand/event name exact: e.g. "${name}", "${name} ${eventYear}"
2. Topic exact/phrase: conference names, protocol/tech names + "conference"/"summit"/"event"
3. Role-based: "[role] conference", "[role] summit" for relevant job titles
4. Competitor/adjacent: alternative events, "open source [topic] conference [city]"

Return a JSON array where each object has EXACTLY these keys:
- "term": the keyword string
- "match_type": "Exact", "Phrase", or "Broad"
- "intent_level": "High" (direct event search), "Medium" (related topic), "Low" (broad)
- "notes": any flag (e.g. "new term, low search volume expected")

CRITICAL RULES:
- The event year is ${eventYear}. NEVER use any other year in keywords.
- Prefer HIGH INTENT — keywords that indicate someone actively searching for this event.
- Avoid generic broad terms that waste budget (e.g. "conference" alone).`;
}

const REGION_MAP: Record<string, string> = {
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
  JP: 'Japan',
  KR: 'APAC',
  SG: 'APAC',
  AU: 'APAC',
  CN: 'APAC',
  BR: 'LATAM',
};

function sanitizeDelimiter(value: string): string {
  return value.replace(/\|/g, '-');
}

function buildCampaignName(body: CampaignCreateRequest, campaignType: string): string {
  const region = REGION_MAP[body.countryCode.toUpperCase()] || 'Global';
  const adFormat = campaignType === 'Search' ? 'Search' : 'DG Display';
  const targeting = campaignType === 'Search' ? 'Prospecting' : 'Intent';
  const funnel = campaignType === 'Search' ? 'BoFU' : 'MoFU';
  const project = sanitizeDelimiter(body.project || 'Linux Foundation');
  const eventName = sanitizeDelimiter(body.eventName);
  const dateSuffix = body.startDate || new Date().toISOString().split('T')[0];
  return `Events | ${eventName} | ${region} | Conversions | ${targeting} | ${adFormat} | ${project} | ${funnel} | ${dateSuffix}`;
}

function buildFinalUrl(body: CampaignCreateRequest, platform = 'search'): string {
  const base = body.registrationUrl.replace(/\/$/, '');
  const slug = body.eventSlug || body.eventName.toLowerCase().replace(/\s+/g, '-');
  const termSlug = body.eventName ? body.eventName.replace(/\s+/g, '-').toLowerCase() : slug;
  const params = new URLSearchParams({
    utm_source: 'google',
    utm_medium: platform === 'search' ? 'paid-search' : 'display',
    utm_campaign: body.hsToken || slug,
    utm_term: termSlug,
    utm_content: platform,
  });
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}

function getGadsErrorCode(error: unknown): string | null {
  const e = error as Record<string, unknown>;
  if (!Array.isArray(e['errors']) || e['errors'].length === 0) return null;
  const first = e['errors'][0] as Record<string, unknown>;
  const code = first['error_code'] as Record<string, string> | undefined;
  if (!code) return null;
  return Object.values(code)[0] || null;
}

function extractGadsErrorMessage(error: unknown): string {
  const code = getGadsErrorCode(error);

  const friendlyMessages: Record<string, string> = {
    DUPLICATE_CAMPAIGN_NAME: 'A campaign with this name already exists in Google Ads. Change the event name or dates to create a unique campaign.',
    CAMPAIGN_BUDGET_REMOVED: 'The campaign budget was removed before the campaign could be created. Please try again.',
    REQUIRED: 'A required field is missing. Please fill in all required fields and try again.',
    INVALID_INPUT: 'One or more fields contain invalid values. Please check your inputs.',
  };

  if (code && friendlyMessages[code]) return friendlyMessages[code];

  if (error instanceof Error) return error.message;

  const e = error as Record<string, unknown>;
  if (Array.isArray(e['errors']) && e['errors'].length > 0) {
    const first = e['errors'][0] as Record<string, unknown>;
    const msg = typeof first['message'] === 'string' ? first['message'] : '';
    if (msg) return msg;
  }

  if (typeof e['message'] === 'string' && e['message']) return e['message'];
  if (typeof e['details'] === 'string' && e['details']) return e['details'];

  return 'Campaign creation failed. Please try again or contact support.';
}
