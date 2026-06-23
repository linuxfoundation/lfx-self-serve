// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AI_MODEL, META_CHAR_LIMITS } from '@lfx-one/shared/constants';

import type {
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignCreateResult,
  CampaignJobStatus,
  CampaignKeyword,
  CampaignPlatform,
  CampaignProgramType,
  CampaignSSEEventType,
  CampaignStatusUpdateRequest,
  CampaignStatusUpdateResult,
  KeywordActionResponse,
  LinkedInCampaignCreateResult,
  MetaCampaignCreateResult,
  RedditCampaignCreateResult,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { validateScrapeUrl, fetchSafeUrl } from '../helpers/url-validation';
import { executeLinkedInCampaignCreation, resolveGeoTargets } from './linkedin-ads.service';
import { logger } from './logger.service';
import { executeMetaCampaignCreation, updateMetaCampaignStatus } from './meta-ads.service';
import { executeRedditCampaignCreation, updateRedditCampaignStatus } from './reddit-ads.service';

// ---------------------------------------------------------------------------
// Google Ads gRPC client (via google-ads-api)
// ---------------------------------------------------------------------------

import { GoogleAdsApi, enums } from 'google-ads-api';

import type { Customer } from 'google-ads-api';

// ---------------------------------------------------------------------------
// Required environment variables — log warnings on first use for missing ones
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
  allMatches: { name: string; hsUtm: string }[];
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
    return { found: false, hsUtm: null, campaignName: '', campaignId: null, allMatches: [] };
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
  const matches = scored.filter((s) => s.score > 0);

  if (matches.length === 0) {
    return { found: false, hsUtm: null, campaignName: '', campaignId: null, allMatches: [] };
  }

  const best = matches[0];
  return {
    found: true,
    hsUtm: best.hsUtm,
    campaignName: best.name,
    campaignId: best.id,
    allMatches: matches.map((m) => ({ name: m.name, hsUtm: m.hsUtm })),
  };
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

  return { found: true, hsUtm, campaignName: eventName, campaignId, allMatches: [{ name: eventName, hsUtm: hsUtm! }] };
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

async function aiChat(systemPrompt: string, userPrompt: string, externalSignal?: AbortSignal, maxTokens = 4096): Promise<string> {
  const aiProxyUrl = getEnv('AI_PROXY_URL');
  const aiApiKey = getEnv('AI_API_KEY');
  if (!aiProxyUrl || !aiApiKey) throw new Error('AI_PROXY_URL and AI_API_KEY required');

  const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);

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
    signal,
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

const COPY_SYSTEM_PROMPT_EVENTS = `You are an expert digital marketer specialising in developer events and open-source conferences.
Generate high-quality, conversion-focused ad copy for the Linux Foundation's LFX events.`;

const COPY_SYSTEM_PROMPT_EDUCATION = `You are an expert digital marketer specialising in professional training, certifications, and online education for software developers and IT professionals.
Generate high-quality, conversion-focused ad copy for the Linux Foundation's training and certification programs.`;

function getCopySystemPromptBase(programType?: CampaignProgramType): string {
  return programType === 'education' ? COPY_SYSTEM_PROMPT_EDUCATION : COPY_SYSTEM_PROMPT_EVENTS;
}

const COPY_GOOGLE_SECTION = `
GOOGLE SEARCH (RSA):
- Headlines: 15 total, each ≤ 30 characters (STRICT — Google rejects longer)
- Descriptions: 4 total, each ≤ 90 characters (STRICT)
- Tone: direct, benefit-led, include CTA (e.g. "Register Now", "Enroll Now", "Learn More")

GOOGLE DEMAND GEN (key: "google_display" — runs on YouTube, Discover, Gmail, Display):
- headlines: 5 variations, each ≤ 40 characters (STRICT — Demand Gen limit is 40, not 30)
- descriptions: 5 variations, each ≤ 90 characters (STRICT)
- business_name: ≤ 25 chars — use the event's parent organization (e.g. "CNCF" for KubeCon). Default to "Linux Foundation" only if no specific foundation is identifiable.
- call_to_action: one of "Learn More", "Register", "Sign Up", "Book Now", "Apply Now"`;

const COPY_LINKEDIN_SECTION = `
LINKEDIN SPONSORED CONTENT (key: "linkedin_sponsored"):
- variants: array of 2-4 ad variations, each containing:
  - intro_text: ≤ 600 characters (the post body — compelling, professional, conversational)
  - headline: ≤ 200 characters (appears below the link card — clear CTA)
- recommended_geos: array of 3-8 location names (e.g. "United States", "India", "Germany") — select based on event location, audience, and topic relevance. Use full country/region names.
- recommended_targeting_profile: one of "cloud-native" or "mcp" — select "cloud-native" for Kubernetes, CNCF, DevOps, infrastructure, containers, or cloud events; select "mcp" for AI, GenAI, LLM, agents, or machine learning events.

LINKEDIN COPY RULES:
- Intro text tone: professional but engaging, speak to the developer community, highlight learning opportunities and networking
- Use line breaks in intro text for readability (\\n between paragraphs)
- NEVER use em-dashes (—) or en-dashes (–) — use commas or periods
- Include event dates and location naturally in at least one variant
- Headline should drive action: "Register Now", "Secure Your Spot", "Join Us in [City]"`;

const COPY_REDDIT_SECTION = `
REDDIT PROMOTED POSTS (key: "reddit_promoted"):
- variants: array of 2-3 ad variations, each containing:
  - headline: ≤ 300 characters (the post title — must feel native to Reddit, not corporate)
  - body: ≤ 500 characters (optional body text for text ads — conversational, community-focused)
- recommended_subreddits: array of 10-15 REAL subreddit names that exist on Reddit (e.g. "kubernetes", "devops", "opensource", "programming", "cloudcomputing", "docker", "homelab", "sysadmin", "linux", "CNCF"). Use lowercase subreddit names WITHOUT the "r/" prefix. Only include subreddits that actually exist and are active. Select based on event topic and target audience.
- recommended_interests: array of 3-5 Reddit interest categories (e.g. "Technology", "Programming", "Cloud Computing")
- recommended_keywords: array of 10-15 high-intent keywords related to the event topic (e.g. "kubernetes conference", "cloud native summit", "devops training", "container orchestration"). These are used for Reddit keyword targeting.
- recommended_geos: array of 2-5 ISO 3166-1 alpha-2 country codes for geo targeting, based on the event location and surrounding high-intent countries. For example, an event in Japan should target ["JP", "KR", "SG", "AU", "IN"]. An event in San Francisco should target ["US", "CA"]. Always include the event's host country first.

REDDIT COPY RULES:
- Headlines must feel like organic Reddit posts — no marketing jargon, no ALL CAPS
- Use a conversational, community tone — Reddit users reject overtly corporate messaging
- Ask questions or share insights rather than making demands
- Avoid exclamation marks — Reddit culture finds them inauthentic
- Include event dates and key value props naturally
- NEVER use em-dashes (—) or en-dashes (–) — use commas or periods`;

const COPY_META_SECTION = `
META ADS (key: "meta_ads"):
- variants: array of 2-3 ad variations, each containing:
  - primary_text: ≤ ${META_CHAR_LIMITS.primaryText} characters (the main ad body — concise, benefit-focused)
  - headline: ≤ ${META_CHAR_LIMITS.headline} characters (appears below the image — clear CTA)
  - description: ≤ ${META_CHAR_LIMITS.description} characters (optional secondary text below headline)
- recommended_geos: array of 2-5 ISO 3166-1 alpha-2 country codes for geo targeting, based on the event location and surrounding high-intent countries.

META COPY RULES:
- Primary text must be punchy and benefit-driven — Facebook/Instagram users scroll fast
- Headlines should drive action: "Register Now", "Save Your Spot", "Learn More"
- NEVER use em-dashes (—) or en-dashes (–) — use commas or periods
- Include event dates naturally in at least one variant's primary text`;

const COPY_RULES_SECTION = `
IMPORTANT RULES:
1. Dates and details must come ONLY from the data provided — never use training-data memory.
2. CHARACTER LIMITS ARE HARD — platforms REJECT copy that exceeds them. Verify EVERY line.
3. NEVER abbreviate month names, city names, or proper nouns unless required to fit character limits.
4. NEVER use em-dashes (—) or en-dashes (–) in ad copy. Use commas, periods, or colons instead.
5. Demand Gen headlines are 40 chars max (not 30) — use the extra space for better copy.`;

function buildCopySystemPrompt(platforms: string[], programType?: CampaignProgramType): string {
  const includeGoogle = platforms.includes('google-ads');
  const includeLinkedIn = platforms.includes('linkedin-ads');
  const includeReddit = platforms.includes('reddit-ads');
  const includeMeta = platforms.includes('meta-ads');

  let prompt = getCopySystemPromptBase(programType) + '\n\nPLATFORM SPECIFICATIONS (hard limits — never exceed):\n';

  if (includeGoogle) prompt += COPY_GOOGLE_SECTION;
  if (includeLinkedIn) prompt += COPY_LINKEDIN_SECTION;
  if (includeReddit) prompt += COPY_REDDIT_SECTION;
  if (includeMeta) prompt += COPY_META_SECTION;
  prompt += COPY_RULES_SECTION;

  const keys: string[] = [];
  if (includeGoogle) keys.push('"google_search"', '"google_display"');
  if (includeLinkedIn) keys.push('"linkedin_sponsored"');
  if (includeReddit) keys.push('"reddit_promoted"');
  if (includeMeta) keys.push('"meta_ads"');
  prompt += `\n\nRespond with a JSON object (no markdown fences). Keys: ${keys.join(' and ')}.`;

  return prompt;
}

const KEYWORD_SYSTEM_PROMPT = `You are a Google Ads keyword strategist. Return only a valid JSON array. No markdown fences, no explanation.`;

const LINKEDIN_STRATEGY_SYSTEM_PROMPT_EVENTS = `You are a LinkedIn Ads strategist specializing in developer and open-source technology events.
Analyze the event details and generate a comprehensive targeting strategy for LinkedIn Sponsored Content campaigns.
Return only valid JSON. No markdown fences, no explanation.`;

const LINKEDIN_STRATEGY_SYSTEM_PROMPT_EDUCATION = `You are a LinkedIn Ads strategist specializing in professional training, certifications, and career development for software developers and IT professionals.
Analyze the course/certification details and generate a comprehensive targeting strategy for LinkedIn Sponsored Content campaigns.
Return only valid JSON. No markdown fences, no explanation.`;

function getLinkedInStrategySystemPrompt(programType?: CampaignProgramType): string {
  return programType === 'education' ? LINKEDIN_STRATEGY_SYSTEM_PROMPT_EDUCATION : LINKEDIN_STRATEGY_SYSTEM_PROMPT_EVENTS;
}

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

const EDUCATION_EXTRACTION_PROMPT = `Extract structured course/certification details from this HTML. Return valid JSON:
{
  "name": "course or certification name",
  "dates": "duration (e.g. Self-paced, 3 days, 40 hours)",
  "city": "delivery location or null if online-only",
  "country_code": "ISO country code or null if online-only",
  "audience": "target audience description",
  "themes": ["technology1", "skill1"],
  "registration_url": "enrollment URL",
  "slug": "url-friendly-slug",
  "format_notes": "self-paced/instructor-led/hybrid",
  "price": "price or price range if found",
  "certification_code": "e.g. CKA, LFCS, CKAD if applicable",
  "prerequisites": "prerequisites if listed"
}

If a field cannot be determined, use null.`;

function getExtractionPrompt(programType?: CampaignProgramType): string {
  return programType === 'education' ? EDUCATION_EXTRACTION_PROMPT : EVENT_EXTRACTION_PROMPT;
}

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set(['google-ads', 'linkedin-ads', 'reddit-ads', 'meta-ads']);
const SUPPORTED_PROGRAM_TYPES: ReadonlySet<CampaignProgramType> = new Set<CampaignProgramType>(['events', 'education']);

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
      logger.warning(undefined, 'campaign_job_timeout', `Job ${jobId} timed out after 5 minutes`, { jobId });
      failJob(jobId, 'Campaign creation timed out. Check Google Ads to see if your campaign was created.');
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
      all_matches: result.allMatches.map((m) => ({ name: m.name, hs_utm: m.hsUtm })),
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

    const unsupported = (body.platforms ?? []).filter((p) => !SUPPORTED_PLATFORMS.has(p));
    if (unsupported.length > 0) {
      yield { type: 'error', data: `Unsupported platforms: ${unsupported.join(', ')}. Supported: google-ads, linkedin-ads, reddit-ads, meta-ads.` };
      return;
    }

    if (body.programType !== undefined && !SUPPORTED_PROGRAM_TYPES.has(body.programType)) {
      yield { type: 'error', data: `Unsupported programType. Supported: events, education.` };
      return;
    }

    const isRefinement = !!body.refineFeedback && !!body.previousCopy;
    const isEducation = body.programType === 'education';
    const pageLabel = isEducation ? 'course page' : 'event page';
    let html = '';

    if (!isRefinement) {
      yield { type: 'status', data: `Scraping ${body.url}...` };

      let safeUrl: string;
      try {
        safeUrl = await validateScrapeUrl(body.url);
      } catch (error) {
        yield { type: 'error', data: `Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}` };
        return;
      }

      try {
        const { html: scrapedHtml, ok, status } = await fetchSafeUrl(safeUrl, signal);
        if (!ok) {
          yield { type: 'error', data: `Page returned HTTP ${status}` };
          return;
        }
        html = scrapedHtml;
      } catch (error) {
        yield { type: 'error', data: `Failed to fetch ${pageLabel}: ${error instanceof Error ? error.message : 'Unknown error'}` };
        return;
      }
    }
    const extractLabel = isEducation ? 'course details' : 'event details';
    yield { type: 'status', data: isRefinement ? 'Refining brief...' : `Extracting ${extractLabel}...` };

    let eventDetails: Record<string, unknown> | null = null;

    if (!isRefinement) {
      try {
        const extraction = await aiChat(getExtractionPrompt(body.programType), `URL: ${body.url}\n\nHTML:\n${html.slice(0, 30_000)}`);
        eventDetails = JSON.parse(extraction) as Record<string, unknown>;
        // Education extraction also yields price, certification_code, prerequisites — deferred until CampaignEventDetails supports them
        yield {
          type: 'event',
          data: {
            name: eventDetails['name'] ?? '',
            dates: eventDetails['dates'] ?? '',
            city: eventDetails['city'] ?? '',
            countryCode: eventDetails['country_code'] ?? '',
            audience: eventDetails['audience'] ?? '',
            themes: Array.isArray(eventDetails['themes']) ? eventDetails['themes'] : [],
            registrationUrl: eventDetails['registration_url'] ?? '',
            speakers: Array.isArray(eventDetails['speakers']) ? eventDetails['speakers'] : [],
            slug: eventDetails['slug'] ?? '',
            formatNotes: eventDetails['format_notes'] ?? '',
          },
        };
      } catch (error) {
        logger.warning(req, 'campaign_brief_extract', `${isEducation ? 'Course' : 'Event'} extraction failed, continuing with URL only`, { err: error });
        yield { type: 'status', data: `Could not extract structured ${extractLabel}, generating copy from URL...` };
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
    }

    const selectedPlatforms = body.platforms?.length ? body.platforms : ['google-ads'];
    const platformList = selectedPlatforms.join(', ');
    yield { type: 'status', data: `Generating copy for ${platformList}...` };

    const copySystemPrompt = buildCopySystemPrompt(selectedPlatforms, body.programType);
    const userPrompt = buildCopyPrompt(body, eventDetails);
    let fullCopy = '';

    try {
      for await (const token of aiChatStream(copySystemPrompt, userPrompt, signal)) {
        yield { type: 'copy_token', data: token };
        fullCopy += token;
      }
      yield { type: 'copy_done', data: null };

      try {
        const text = stripJsonFences(fullCopy);
        const structured = JSON.parse(text) as Record<string, unknown>;

        truncateAdCopy(structured);

        if (selectedPlatforms.includes('linkedin-ads')) {
          const liData = (structured['linkedin_sponsored'] || (structured['platforms'] as Record<string, unknown> | undefined)?.['linkedin_sponsored']) as
            | Record<string, unknown>
            | undefined;
          if (liData) {
            const rawGeos = liData['recommended_geos'];
            const MAX_GEO_LENGTH = 100;
            const MAX_GEO_COUNT = 20;
            const sanitizedGeos = (Array.isArray(rawGeos) ? rawGeos : [])
              .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
              .slice(0, MAX_GEO_COUNT)
              .map((g) =>
                g
                  .trim()
                  .slice(0, MAX_GEO_LENGTH)
                  .replace(/[^a-zA-Z0-9 ,.-]/g, '')
              );
            if (sanitizedGeos.length > 0) {
              try {
                const resolved = await resolveGeoTargets(sanitizedGeos);
                liData['resolved_geo_targets'] = resolved;
              } catch (geoError) {
                logger.warning(req, 'campaign_brief_geo_resolve', 'Failed to resolve LinkedIn geo targets', { err: geoError });
              }
            }
          }
        }

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
        const kwText = stripJsonFences(await aiChat(KEYWORD_SYSTEM_PROMPT, kwPrompt));
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

    if (selectedPlatforms.includes('linkedin-ads') && !isRefinement) {
      yield { type: 'status', data: 'Generating LinkedIn targeting strategy...' };
      try {
        const strategyPrompt = buildLinkedInStrategyPrompt(body, eventDetails);
        let strategyText = (await aiChat(getLinkedInStrategySystemPrompt(body.programType), strategyPrompt)).trim();
        if (strategyText.startsWith('```')) {
          const firstNl = strategyText.indexOf('\n');
          if (firstNl !== -1) strategyText = strategyText.slice(firstNl + 1);
          const lastFence = strategyText.lastIndexOf('```');
          if (lastFence !== -1) strategyText = strategyText.slice(0, lastFence);
          strategyText = strategyText.trim();
        }
        const strategy = JSON.parse(strategyText) as Record<string, unknown>;
        yield { type: 'linkedin_strategy', data: strategy };
      } catch (error) {
        logger.warning(req, 'campaign_brief_linkedin_strategy', 'LinkedIn strategy generation failed', { err: error });
        yield { type: 'status', data: 'LinkedIn strategy generation failed, skipping...' };
      }
    }

    yield { type: 'done', data: null };
  }

  // === Brief refinement (SSE stream) ===

  public async *streamRefinedBrief(
    req: Request,
    body: CampaignBriefRefineRequest,
    signal: AbortSignal
  ): AsyncGenerator<{ type: CampaignSSEEventType; data: unknown }> {
    checkRequiredEnv(req);

    const unsupported = (body.platforms ?? []).filter((p) => !SUPPORTED_PLATFORMS.has(p));
    if (unsupported.length > 0) {
      yield { type: 'error', data: `Unsupported platforms: ${unsupported.join(', ')}. Supported: google-ads, linkedin-ads, reddit-ads, meta-ads.` };
      return;
    }

    if (body.programType !== undefined && !SUPPORTED_PROGRAM_TYPES.has(body.programType)) {
      yield { type: 'error', data: `Unsupported programType. Supported: events, education.` };
      return;
    }

    yield { type: 'status', data: 'Refining brief based on your feedback...' };

    const userPrompt = buildRefinePrompt(body);
    let fullCopy = '';
    const refinePlatforms = body.platforms?.length ? body.platforms : ['google-ads'];

    try {
      for await (const token of aiChatStream(buildCopySystemPrompt(refinePlatforms, body.programType), userPrompt, signal)) {
        yield { type: 'copy_token', data: token };
        fullCopy += token;
      }
      yield { type: 'copy_done', data: null };

      try {
        const text = stripJsonFences(fullCopy);
        const structured = JSON.parse(text) as Record<string, unknown>;
        truncateAdCopy(structured);
        yield { type: 'copy_structured', data: structured };
      } catch {
        yield { type: 'copy_structured', data: { raw: fullCopy } };
      }
    } catch (error) {
      if (signal.aborted) return;
      yield { type: 'error', data: `Brief refinement failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
      return;
    }

    if (refinePlatforms.includes('google-ads')) {
      yield { type: 'status', data: 'Regenerating keywords...' };

      try {
        const kwPrompt = buildRefineKeywordPrompt(body);
        const kwText = stripJsonFences(await aiChat(KEYWORD_SYSTEM_PROMPT, kwPrompt, signal));
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
        if (signal.aborted) return;
        logger.warning(req, 'campaign_refine_keywords', 'Keyword regeneration failed', { err: error });
        yield { type: 'status', data: 'Keyword regeneration failed, keeping existing keywords...' };
      }
    }

    yield { type: 'done', data: null };
  }

  // === Campaign creation (async job) ===

  public async createCampaign(_req: Request, body: CampaignCreateRequest): Promise<{ jobId: string; result?: CampaignCreateResponse; error?: string }> {
    const jobId = createJob();
    const startTime = Date.now();

    this.executeCampaignCreation(jobId, body).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(undefined, 'campaign_create_unhandled', startTime, err, { jobId });
      failJob(jobId, 'Campaign creation was unsuccessful. Please try again.');
    });

    const POLL_INTERVAL_MS = 500;
    // Must stay under ingress-nginx proxy-read-timeout (default 60s)
    const INLINE_WAIT_MS = 45_000;
    const deadline = Date.now() + INLINE_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const job = jobs.get(jobId);
      if (job?.status === 'done') return { jobId, result: job.result };
      if (job?.status === 'error') return { jobId, error: job.error };
    }

    return { jobId };
  }

  // === Job polling ===

  public async getJobStatus(req: Request, jobId: string): Promise<CampaignJobStatus> {
    const job = jobs.get(jobId);
    if (!job) {
      logger.warning(req, 'campaign_job_status', `Job ${jobId} not found on this instance — likely routed to a different replica`, { jobId });
      return { status: 'not_found', error: 'Lost connection to the campaign creation process. Please try again.' };
    }
    return job;
  }

  // === Keyword actions (pause / remove) ===

  public async executeKeywordActions(req: Request, body: BulkKeywordActionRequest): Promise<BulkKeywordActionResponse> {
    checkRequiredEnv(req);
    const customer = getCustomer();
    const customerId = getEnv('GADS_CUSTOMER_ID');
    const results: KeywordActionResponse[] = [];

    for (const kw of body.keywords) {
      try {
        const resourceName = `customers/${customerId}/adGroupCriteria/${kw.adGroupId}~${kw.criterionId}`;

        if (body.action === 'remove') {
          await customer.adGroupCriteria.remove([resourceName]);
        } else {
          await customer.adGroupCriteria.update([
            {
              resource_name: resourceName,
              status: enums.AdGroupCriterionStatus.PAUSED,
            },
          ]);
        }

        results.push({
          success: true,
          action: body.action,
          keyword: `Criterion ${kw.criterionId}`,
          message: `Keyword ${body.action === 'remove' ? 'removed' : 'paused'} successfully`,
        });
      } catch (error) {
        results.push({
          success: false,
          action: body.action,
          keyword: `Criterion ${kw.criterionId}`,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    return {
      success: succeeded === results.length,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  }

  // ---------------------------------------------------------------------------
  // Campaign Status Toggle
  // ---------------------------------------------------------------------------

  public async updateCampaignStatus(req: Request, campaignId: string, body: CampaignStatusUpdateRequest): Promise<CampaignStatusUpdateResult> {
    const { platform, status } = body;
    logger.debug(req, 'campaign_status_update', 'Dispatching status update', { platform, campaignId, status });

    switch (platform) {
      case 'meta-ads':
        return updateMetaCampaignStatus(req, campaignId, status);
      case 'reddit-ads': {
        const { REDDIT_ACCOUNTS } = await import('../constants');
        const accountId = (typeof body.accountId === 'string' && body.accountId.trim()) || REDDIT_ACCOUNTS[0]?.accountId;
        if (!accountId) {
          throw new Error('No Reddit ad account configured');
        }
        if (!REDDIT_ACCOUNTS.some((a) => a.accountId === accountId)) {
          throw new Error(`Reddit ad account ${accountId} is not whitelisted`);
        }
        return updateRedditCampaignStatus(req, accountId, campaignId, status);
      }
      default:
        throw new Error(`Status toggle is not supported for platform: ${platform}`);
    }
  }

  // === Private: campaign creation orchestration ===

  private async executeCampaignCreation(jobId: string, body: CampaignCreateRequest): Promise<void> {
    const startTime = logger.startOperation(undefined, 'campaign_create', { jobId, types: body.campaignTypes, platforms: body.platforms });
    const effectiveBody = { ...body };
    if (!effectiveBody.hsToken) {
      try {
        const hsUtm = await resolveHubSpotUtm(effectiveBody.eventName);
        if (hsUtm) effectiveBody.hsToken = hsUtm;
      } catch {
        // HubSpot unavailable — fall back to event slug for UTM
      }
    }

    const supportedPlatforms: CampaignPlatform[] = ['google-ads', 'linkedin-ads', 'reddit-ads', 'meta-ads'];
    const platforms = effectiveBody.platforms?.length ? effectiveBody.platforms : ['google-ads'];
    const unsupported = platforms.filter((p) => !supportedPlatforms.includes(p as CampaignPlatform));
    const includeGoogle = platforms.includes('google-ads');
    const includeLinkedIn = platforms.includes('linkedin-ads');
    const includeReddit = platforms.includes('reddit-ads');
    const includeMeta = platforms.includes('meta-ads');

    const results: CampaignCreateResult[] = [];
    const linkedInResults: LinkedInCampaignCreateResult[] = [];
    const redditResults: RedditCampaignCreateResult[] = [];
    const metaResults: MetaCampaignCreateResult[] = [];
    const errors: string[] = [];

    if (unsupported.length > 0) {
      errors.push(`Unsupported platform(s): ${unsupported.join(', ')}. Supported: ${supportedPlatforms.join(', ')}`);
    }

    const promises: Promise<void>[] = [];

    if (includeGoogle) {
      promises.push(this.executeGoogleCampaignCreation(effectiveBody, results, errors));
    }

    if (includeLinkedIn) {
      if (effectiveBody.linkedInConfig) {
        promises.push(this.executeLinkedInDispatch(effectiveBody, linkedInResults, errors));
      } else {
        errors.push('LinkedIn Ads was selected but no LinkedIn configuration was provided.');
      }
    }

    if (includeReddit) {
      if (effectiveBody.redditConfig) {
        promises.push(this.executeRedditDispatch(effectiveBody, redditResults, errors));
      } else {
        errors.push('Reddit Ads was selected but no Reddit configuration was provided.');
      }
    }

    if (includeMeta) {
      if (effectiveBody.metaConfig) {
        promises.push(this.executeMetaDispatch(effectiveBody, metaResults, errors));
      } else {
        errors.push('Meta Ads was selected but no Meta configuration was provided.');
      }
    }

    const settled = await Promise.allSettled(promises);
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        const msg = outcome.reason instanceof Error ? outcome.reason.message : 'Unknown platform error';
        errors.push(msg);
      }
    }

    const allCampaigns = [
      ...results,
      ...linkedInResults.map((li) => ({
        platform: 'linkedin-ads' as const,
        type: 'sponsored' as const,
        campaignName: li.campaignName,
        campaignId: li.campaignId,
        adGroupCount: 1,
        keywordCount: 0,
        adCount: li.creativeCount,
        campaignUrl: li.linkedInUrl,
        steps: li.steps,
      })),
      ...redditResults.map((r) => ({
        platform: 'reddit-ads' as const,
        type: 'social' as const,
        campaignName: r.campaignName,
        campaignId: r.campaignId,
        adGroupCount: 1,
        keywordCount: 0,
        adCount: r.adCount,
        campaignUrl: r.redditUrl,
        steps: r.steps,
      })),
      ...metaResults.map((m) => ({
        platform: 'meta-ads' as const,
        type: 'social' as const,
        campaignName: m.campaignName,
        campaignId: m.campaignId,
        adGroupCount: 1,
        keywordCount: 0,
        adCount: m.adCount,
        campaignUrl: m.metaUrl,
        steps: m.steps,
      })),
    ];

    const response: CampaignCreateResponse = { success: errors.length === 0, campaigns: allCampaigns, errors };
    completeJob(jobId, response);
    if (errors.length > 0) {
      logger.warning(undefined, 'campaign_create', `Campaign creation completed with ${errors.length} error(s)`, {
        jobId,
        campaignCount: allCampaigns.length,
        errorCount: errors.length,
        duration_ms: Date.now() - startTime,
      });
    } else {
      logger.success(undefined, 'campaign_create', startTime, { jobId, campaignCount: allCampaigns.length });
    }
  }

  private async executeGoogleCampaignCreation(effectiveBody: CampaignCreateRequest, results: CampaignCreateResult[], errors: string[]): Promise<void> {
    for (const campaignType of effectiveBody.campaignTypes) {
      const typeStartTime = Date.now();
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
            logger.error(undefined, 'campaign_create_type', typeStartTime, retryError as Error, { campaignType, detail });
            errors.push(`google-ads/${campaignType}: ${detail}`);
            continue;
          }
        }
        const detail = extractGadsErrorMessage(error);
        logger.error(undefined, 'campaign_create_type', typeStartTime, error as Error, { campaignType, detail });
        errors.push(`google-ads/${campaignType}: ${detail}`);
      }
    }
  }

  private async executeLinkedInDispatch(body: CampaignCreateRequest, results: LinkedInCampaignCreateResult[], errors: string[]): Promise<void> {
    const config = body.linkedInConfig!;
    try {
      const result = await executeLinkedInCampaignCreation(undefined, {
        ...config,
        eventName: config.eventName || body.eventName,
        eventSlug: config.eventSlug || body.eventSlug,
        registrationUrl: config.registrationUrl || body.registrationUrl,
        hsToken: config.hsToken || body.hsToken,
        startDate: config.startDate || body.startDate,
        endDate: config.endDate || body.endDate,
        project: config.project || body.project,
      });
      results.push(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown LinkedIn error';
      errors.push(`linkedin-ads: ${msg}`);
    }
  }

  private async executeRedditDispatch(body: CampaignCreateRequest, results: RedditCampaignCreateResult[], errors: string[]): Promise<void> {
    const config = body.redditConfig!;
    try {
      const result = await executeRedditCampaignCreation(undefined, {
        ...config,
        eventName: config.eventName || body.eventName,
        eventSlug: config.eventSlug || body.eventSlug,
        registrationUrl: config.registrationUrl || body.registrationUrl,
        hsToken: config.hsToken || body.hsToken,
        startDate: config.startDate || body.startDate,
        endDate: config.endDate || body.endDate,
        geoTargets: config.geoTargets?.length ? config.geoTargets : [body.countryCode],
        project: config.project || body.project,
      });
      results.push(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown Reddit error';
      errors.push(`reddit-ads: ${msg}`);
    }
  }

  private async executeMetaDispatch(body: CampaignCreateRequest, results: MetaCampaignCreateResult[], errors: string[]): Promise<void> {
    const config = body.metaConfig!;
    try {
      const result = await executeMetaCampaignCreation(undefined, {
        ...config,
        eventName: config.eventName || body.eventName,
        eventSlug: config.eventSlug || body.eventSlug,
        registrationUrl: config.registrationUrl || body.registrationUrl,
        hsToken: config.hsToken || body.hsToken,
        startDate: config.startDate || body.startDate,
        endDate: config.endDate || body.endDate,
        geoTargets: config.geoTargets?.length ? config.geoTargets : [body.countryCode],
        project: config.project || body.project,
      });
      results.push(result);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown Meta error';
      errors.push(`meta-ads: ${msg}`);
    }
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
    if (!budgetResource) throw new Error('Search budget creation returned no resource name');
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
        contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      },
    ]);
    const campaignResource = campaignResult.results[0]?.resource_name;
    if (!campaignResource) throw new Error('Search campaign creation returned no resource name');
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
    if (!adGroupResource) throw new Error('Search ad group creation returned no resource name');
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
      platform: 'google-ads' as const,
      type: 'search',
      campaignName,
      campaignId,
      adGroupCount: 1,
      keywordCount: keywordOps.length,
      adCount: 1,
      campaignUrl: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`,
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
    if (!budgetResource) throw new Error('Demand Gen budget creation returned no resource name');
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
        contains_eu_political_advertising: enums.EuPoliticalAdvertisingStatus.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING,
      },
    ]);
    const campaignResource = campaignResult.results[0]?.resource_name;
    if (!campaignResource) throw new Error('Demand Gen campaign creation returned no resource name');
    const campaignId = campaignResource.split('/').pop() || '';
    steps.push(`Created Demand Gen campaign: ${campaignName}`);

    const adGroupResult = await customer.adGroups.create([
      {
        name: `${body.eventName} - Display`,
        campaign: campaignResource,
        status: enums.AdGroupStatus.ENABLED,
      },
    ]);
    const adGroupResource = adGroupResult.results[0]?.resource_name;
    if (!adGroupResource) throw new Error('Demand Gen ad group creation returned no resource name');
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
      platform: 'google-ads' as const,
      type: 'demand-gen',
      campaignName,
      campaignId,
      adGroupCount: 1,
      keywordCount: 0,
      adCount: 0,
      campaignUrl: `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`,
      steps,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstNewline = trimmed.indexOf('\n');
  const inner = firstNewline !== -1 ? trimmed.slice(firstNewline + 1) : trimmed;
  const lastFence = inner.lastIndexOf('```');
  return (lastFence !== -1 ? inner.slice(0, lastFence) : inner).trim();
}

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

  const li = obj['linkedin_sponsored'] as Record<string, unknown> | undefined;
  if (li) {
    const variants = li['variants'] as unknown[] | undefined;
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (v == null || typeof v !== 'object') continue;
        const rec = v as Record<string, unknown>;
        if (typeof rec['intro_text'] === 'string') rec['intro_text'] = (rec['intro_text'] as string).slice(0, 600);
        if (typeof rec['headline'] === 'string') rec['headline'] = (rec['headline'] as string).slice(0, 200);
      }
    }
  }

  const rd = obj['reddit_promoted'] as Record<string, unknown> | undefined;
  if (rd) {
    const variants = rd['variants'] as unknown[] | undefined;
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (v == null || typeof v !== 'object') continue;
        const rec = v as Record<string, unknown>;
        if (typeof rec['headline'] === 'string') rec['headline'] = (rec['headline'] as string).slice(0, 300);
        if (typeof rec['body'] === 'string') rec['body'] = (rec['body'] as string).slice(0, 500);
      }
    }
  }

  const ma = obj['meta_ads'] as Record<string, unknown> | undefined;
  if (ma) {
    const variants = ma['variants'] as unknown[] | undefined;
    if (Array.isArray(variants)) {
      for (const v of variants) {
        if (v == null || typeof v !== 'object') continue;
        const rec = v as Record<string, unknown>;
        if (typeof rec['primary_text'] === 'string') rec['primary_text'] = (rec['primary_text'] as string).slice(0, META_CHAR_LIMITS.primaryText);
        if (typeof rec['headline'] === 'string') rec['headline'] = (rec['headline'] as string).slice(0, META_CHAR_LIMITS.headline);
        if (typeof rec['description'] === 'string') rec['description'] = (rec['description'] as string).slice(0, META_CHAR_LIMITS.description);
      }
    }
  }

  const platforms = obj['platforms'] as Record<string, unknown> | undefined;
  if (platforms) {
    if (platforms['google_search']) truncateAdCopy({ google_search: platforms['google_search'] } as Record<string, unknown>);
    if (platforms['google_display'] || platforms['demand_gen']) {
      const key = platforms['google_display'] ? 'google_display' : 'demand_gen';
      truncateAdCopy({ google_display: platforms[key] } as Record<string, unknown>);
    }
    if (platforms['linkedin_sponsored']) truncateAdCopy({ linkedin_sponsored: platforms['linkedin_sponsored'] } as Record<string, unknown>);
    if (platforms['reddit_promoted']) truncateAdCopy({ reddit_promoted: platforms['reddit_promoted'] } as Record<string, unknown>);
    if (platforms['meta_ads']) truncateAdCopy({ meta_ads: platforms['meta_ads'] } as Record<string, unknown>);
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
  const platforms = body.platforms?.length ? body.platforms : ['google-ads'];
  const includeGoogle = platforms.includes('google-ads');
  const includeLinkedIn = platforms.includes('linkedin-ads');
  const includeReddit = platforms.includes('reddit-ads');
  const includeMeta = platforms.includes('meta-ads');

  const requestedKeys: string[] = [];
  if (includeGoogle) requestedKeys.push('google_search', 'google_display');
  if (includeLinkedIn) requestedKeys.push('linkedin_sponsored');
  if (includeReddit) requestedKeys.push('reddit_promoted');
  if (includeMeta) requestedKeys.push('meta_ads');

  const extraParts: string[] = [];
  if (body.campaignGoal) extraParts.push(`Campaign Goal: ${body.campaignGoal}`);
  if (body.targetAudience) extraParts.push(`Target Audience: ${body.targetAudience}`);
  if (body.valueProp) extraParts.push(`Key Value Prop / Offer: ${body.valueProp}`);
  if (body.totalBudget) extraParts.push(`Total Campaign Budget: $${body.totalBudget}`);
  const extraBlock = extraParts.length > 0 ? `\n\nADDITIONAL CAMPAIGN CONTEXT:\n${extraParts.join('\n')}` : '';

  const platformInstruction = `REQUESTED PLATFORMS: ${requestedKeys.join(', ')}\n\nReturn a JSON object with keys ${requestedKeys.map((k) => `"${k}"`).join(' and ')} following the schema in the system prompt.`;

  const serializedPreviousCopy = body.previousCopy ? JSON.stringify(body.previousCopy, null, 2).slice(0, 10_000) : '';
  const refinementBlock =
    body.refineFeedback && body.previousCopy
      ? `\n\nREFINEMENT REQUEST — do not generate from scratch. Revise the previous copy below based on the user's feedback.\n\nUSER FEEDBACK:\n${body.refineFeedback}\n\nPREVIOUS COPY:\n${serializedPreviousCopy}`
      : '';

  const isEducation = body.programType === 'education';
  const contentLabel = isEducation ? 'training/certification program' : 'event';
  const ctaVerb = isEducation ? 'Enroll Now' : 'Register Now';

  if (eventDetails) {
    const e = eventDetails;
    const themes = Array.isArray(e['themes']) ? (e['themes'] as string[]).join(', ') : '';
    const speakers = Array.isArray(e['speakers']) ? (e['speakers'] as string[]).slice(0, 5).join(', ') : '';
    const educationNote = isEducation
      ? `\n\nEDUCATION CAMPAIGN NOTES:\n- This is a training/certification campaign, NOT an event. Do not reference venues, travel, or in-person attendance.\n- Focus on career advancement, skill-building, and certification value.\n- Primary CTA should be "${ctaVerb}" or "Start Learning" — never "Register Now" or "Join Us in [City]".\n- Highlight self-paced learning, exam prep, industry recognition, and bundle discounts where relevant.\n- Sitelink ideas: course curriculum, exam details, certification paths, student testimonials, pricing/bundles.`
      : '';
    return `Generate ad copy for this LF ${contentLabel} across the requested platforms.

${isEducation ? 'COURSE' : 'EVENT'} DATA:
Name: ${e['name'] || ''}
${isEducation ? 'Duration' : 'Dates'}: ${e['dates'] || ''}
${isEducation ? '' : `City: ${e['city'] || ''}\nCountry: ${e['country_code'] || ''}\n`}Audience: ${e['audience'] || ''}
Themes: ${themes}
${isEducation ? 'Enrollment' : 'Registration'} URL: ${e['registration_url'] || body.url}
${isEducation ? '' : `Speakers: ${speakers}\nFormat: ${e['format_notes'] || ''}\n`}${extraBlock}${educationNote}${refinementBlock}

${platformInstruction}`;
  }

  return `Generate ad copy for this ${contentLabel}: ${body.url}${extraBlock}${refinementBlock}

${platformInstruction}`;
}

function buildKeywordPrompt(body: CampaignBriefRequest, eventDetails: Record<string, unknown> | null): string {
  const extraParts: string[] = [];
  if (body.campaignGoal) extraParts.push(`Campaign Goal: ${body.campaignGoal}`);
  if (body.targetAudience) extraParts.push(`Target Audience: ${body.targetAudience}`);
  if (body.valueProp) extraParts.push(`Key Value Prop / Offer: ${body.valueProp}`);
  const extraBlock = extraParts.length > 0 ? `\n\nADDITIONAL CAMPAIGN CONTEXT:\n${extraParts.join('\n')}` : '';

  const isEducation = body.programType === 'education';
  const e = eventDetails || {};
  const name = (e['name'] as string) || '';
  const dates = (e['dates'] as string) || '';
  const themes = Array.isArray(e['themes']) ? (e['themes'] as string[]).join(', ') : '';
  const audience = (e['audience'] as string) || '';
  const city = (e['city'] as string) || '';
  const yearMatch = dates.match(/20\d{2}/);
  const eventYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  if (isEducation) {
    return `Generate 25-40 high-intent Google Search keywords for this training/certification program.

COURSE: ${name || body.url}
Themes: ${themes}
Audience: ${audience}${extraBlock}

Keyword categories to cover:
1. Course/certification name exact: e.g. "${name}", "${name} certification"
2. Certification acronyms: e.g. "CKA", "LFCS", "CKS" and their full names + "certification"/"exam"/"training"
3. Topic training: "[technology] training", "[technology] certification", "[technology] course"
4. Career/role: "[role] certification", "become a [role]", "[role] training"
5. Competitor/adjacent: alternative certifications, "best [topic] certification ${eventYear}"

Return a JSON array where each object has EXACTLY these keys:
- "term": the keyword string
- "match_type": "Exact", "Phrase", or "Broad"
- "intent_level": "High" (direct course/cert search), "Medium" (related topic), "Low" (broad)
- "notes": any flag (e.g. "evergreen term", "seasonal spike")

CRITICAL RULES:
- Focus on certification and training intent, NOT event/conference keywords.
- Prefer HIGH INTENT — keywords that indicate someone actively looking to learn or get certified.
- Include "linux foundation" branded terms where relevant.
- Avoid generic broad terms that waste budget (e.g. "training" alone).`;
  }

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

function buildRefinePrompt(body: CampaignBriefRefineRequest): string {
  const isEducation = body.programType === 'education';
  const eventBlock = body.eventDetails
    ? `\n${isEducation ? 'COURSE' : 'EVENT'}: ${body.eventDetails.name}\n${isEducation ? 'Duration' : 'Dates'}: ${body.eventDetails.dates}\n${isEducation ? '' : `City: ${body.eventDetails.city}\n`}`
    : '';
  const platforms = body.platforms?.length ? body.platforms : ['google-ads'];
  const hasGoogle = platforms.includes('google-ads');
  const hasLinkedIn = platforms.includes('linkedin-ads');
  const hasReddit = platforms.includes('reddit-ads');
  const hasMeta = platforms.includes('meta-ads');

  const keyInstructions: string[] = [];
  if (hasGoogle) keyInstructions.push('"google_search" and "google_display"');
  if (hasLinkedIn) keyInstructions.push('"linkedin_sponsored"');
  if (hasReddit) keyInstructions.push('"reddit_promoted"');
  if (hasMeta) keyInstructions.push('"meta_ads"');
  const keyList = keyInstructions.join(', ');

  return `I have existing ad copy that needs refinement based on user feedback.

CURRENT AD COPY:
${JSON.stringify(body.currentCopy, null, 2)}
${eventBlock}
USER FEEDBACK:
${body.feedback}

Please regenerate the ad copy incorporating the user's feedback while maintaining the same JSON structure.
Respect all character limits from the system prompt. Return the same JSON format with keys ${keyList}.`;
}

function buildRefineKeywordPrompt(body: CampaignBriefRefineRequest): string {
  const currentKws = (body.currentKeywords ?? []).map((kw) => kw.term).join(', ');
  const eventName = body.eventDetails?.name || '';
  const isEducation = body.programType === 'education';
  const contentLabel = isEducation ? 'course/certification' : 'event';
  const intentLabel = isEducation ? 'direct course/cert search' : 'direct event search';

  return `Regenerate keywords for this ${contentLabel} based on user feedback.

${isEducation ? 'COURSE' : 'EVENT'}: ${eventName}
CURRENT KEYWORDS: ${currentKws}

USER FEEDBACK: ${body.feedback}

Based on the feedback, generate 25-40 refined Google Search keywords.

Return a JSON array where each object has EXACTLY these keys:
- "term": the keyword string
- "match_type": "Exact", "Phrase", or "Broad"
- "intent_level": "High" (${intentLabel}), "Medium" (related topic), "Low" (broad)
- "notes": any flag (e.g. "added per user feedback")

Prefer HIGH INTENT keywords. Incorporate the user's feedback to improve the keyword list.`;
}

function buildLinkedInStrategyPrompt(body: CampaignBriefRequest, eventDetails: Record<string, unknown> | null): string {
  const isEducation = body.programType === 'education';
  const e = eventDetails || {};
  const name = (e['name'] as string) || '';
  const dates = (e['dates'] as string) || '';
  const city = (e['city'] as string) || '';
  const audience = (e['audience'] as string) || '';
  const themes = Array.isArray(e['themes']) ? (e['themes'] as string[]).join(', ') : '';

  const contentLabel = isEducation ? 'training/certification program' : 'event';
  const dataHeader = isEducation ? 'COURSE' : 'EVENT';
  const locationLine = isEducation ? '' : `Location: ${city}\n`;

  return `Generate a LinkedIn Ads targeting strategy for this ${contentLabel}.

${dataHeader}:
Name: ${name || body.url}
${isEducation ? '' : `Dates: ${dates}\n`}${locationLine}Audience: ${audience}
Themes: ${themes}
${body.campaignGoal ? `Campaign Goal: ${body.campaignGoal}` : ''}
${body.totalBudget ? `Total Budget: $${body.totalBudget}` : ''}

Return a JSON object with these keys:
{
  "targeting_profile": "cloud-native" or "mcp" (select based on ${isEducation ? 'course' : 'event'} topics),
  "targeting_rationale": "why this profile fits the ${contentLabel}",
  "recommended_skills": ["skill names relevant to the audience"],
  "recommended_groups": ["LinkedIn group names relevant to the audience"],
  "recommended_job_functions": ["job functions to target, e.g. Engineering, IT, Product"],
  "geo_targets": [{"name": "Country/Region", "rationale": "why this geo"}],
  "budget_recommendation": {
    "daily_budget_usd": number,
    "lifetime_budget_usd": number,
    "rationale": "budget reasoning"
  },
  "audience_estimate": "estimated audience size description",
  "campaign_structure_notes": "notes on campaign structure and optimization"
}

RULES:
- Select 3-8 geo targets based on ${isEducation ? 'audience demographics and course topic relevance (education campaigns are always-on and global)' : 'event location, audience, and topic relevance'}
- Budget should be realistic for LinkedIn CPMs ($8-15 range)
- Skills and groups should be specific to the ${isEducation ? "course's" : "event's"} technology focus
- Job functions should target ${isEducation ? 'career-changers, practitioners seeking certification, and hiring managers who value certified professionals' : 'decision-makers and practitioners'}`;
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

  if (code) return `Google Ads rejected the campaign (${code}). Please try again or contact your administrator.`;
  return 'Google Ads could not create the campaign. Please try again.';
}
