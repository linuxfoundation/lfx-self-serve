// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignStatusUpdateResult,
  RedditActionItem,
  RedditAccountTotals,
  RedditAuthoredPostInput,
  RedditCallToAction,
  RedditCampaignCreateRequest,
  RedditCampaignCreateResult,
  RedditCampaignMetrics,
  RedditMonitorResponse,
  RedditObjective,
  RedditPacingLabel,
} from '@lfx-one/shared/interfaces';

import {
  CAMPAIGN_ALERT_THRESHOLDS,
  DEFAULT_REDDIT_CALL_TO_ACTION,
  MAX_REDDIT_HEADLINE_LENGTH,
  REDDIT_CALL_TO_ACTIONS,
  REDDIT_OBJECTIVE_LABELS,
  REDDIT_OBJECTIVE_PARAMS,
} from '@lfx-one/shared/constants';
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

/**
 * A non-2xx from the Reddit Ads API, carrying the status separately from the message.
 *
 * The message keeps the response body, because that is what makes a 400 diagnosable in the server
 * log. The STATUS is split out because the body cannot go everywhere the message can: `steps` is an
 * operator-facing narrative that is returned to the browser and persisted with the campaign, and an
 * upstream error body is up to 400 characters of whatever Reddit chose to return — including the
 * request fields its reflective validation errors echo back. None of that is actionable by the
 * operator reading `steps`, so those arms report `HTTP <status>` and nothing else.
 *
 * This is not a claim that the tagged click URL is a secret from the operator: the no-ad branch
 * deliberately prints that URL, `utm_campaign` and all, because they need it to build the ad by
 * hand. It is a claim about what belongs in a persisted narrative versus in a log line.
 *
 * Message shape is unchanged from the plain `Error` this replaces, so existing callers that only
 * read `err.message` behave exactly as before.
 */
export class RedditApiError extends Error {
  public readonly status: number;

  public constructor(status: number, method: string, path: string, body: string) {
    super(`Reddit API ${method} ${path} → ${status}: ${body.slice(0, 400)}`);
    this.name = 'RedditApiError';
    this.status = status;
  }
}

/**
 * Whether a failed mutating call may nonetheless have created something upstream.
 *
 * Only a 4xx OTHER THAN 429 proves it did not: Reddit received the request and rejected it on the
 * merits. A 5xx may have been raised after the write, and a `fetch` rejection (timeout, abort, DNS)
 * cannot say whether the request was ever sent — so both are ambiguous. The asymmetry is deliberate
 * and matches `createOutcomeAmbiguous` upstream: calling an ambiguous outcome definite tells the
 * operator to author the post again and is how a duplicate PAID post gets made, while calling a
 * definite one ambiguous costs a check in Reddit Ads Manager that finds nothing.
 *
 * 429 is the one 4xx that is NOT a semantic rejection, and upstream says so in as many words:
 * Reddit received the request and SHED it, which says nothing about whether the mutation committed
 * first. This client sends creates with no retry at all, so a 429 arrives on the first attempt —
 * but the classification does not depend on that, because a shed request is unconfirmed either way.
 *
 * Anything below 400 is ambiguous for the same reason upstream gives for a 3xx on a mutating
 * method: receiving it proves the request REACHED a responder but not that nothing was committed
 * before the redirect. `fetch` here follows redirects, so a 3xx should never surface as a
 * `RedditApiError` at all — the branch is a floor, not a live path, and it costs only a check that
 * finds nothing if it is ever reached.
 *
 * Two branches deliberately do NOT mirror `createOutcomeAmbiguous`, and both err toward ambiguous.
 * Upstream separates a transport error from any OTHER non-`apiError` and calls that second group
 * definite; `fetch` makes the split impossible here, because a network rejection and an error thrown
 * locally arrive as the same shape — so everything that is not a `RedditApiError` is ambiguous, and
 * a failure raised before the request leaves (token acquisition, say) costs one check that finds
 * nothing. Upstream also gates its 3xx branch on a mutating method, which this one does not: both
 * call sites are creates, so the gate could never change an answer.
 */
export function redditOutcomeAmbiguous(err: unknown): boolean {
  if (!(err instanceof RedditApiError)) return true;
  return err.status >= 500 || err.status === 429 || err.status < 400;
}

/**
 * A 2xx that carried no id for the resource it was supposed to create.
 *
 * Deliberately NOT a `RedditApiError`: there is no failing status to report, and the outcome must
 * stay on `redditOutcomeAmbiguous`'s ambiguous arm because the resource may well exist. It needs its
 * own type only so `describeRedditFailure` does not call this "no response from Reddit" — Reddit
 * responded, and with a success status.
 */
export class RedditMissingIdError extends Error {}

/** `HTTP <status>` when Reddit answered, or a no-status phrase when it may never have been asked. */
function describeRedditFailure(err: unknown): string {
  if (err instanceof RedditApiError) return `HTTP ${err.status}`;
  if (err instanceof RedditMissingIdError) return 'Reddit accepted the request but returned no id';
  return 'no response from Reddit';
}

async function redditRequest(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<RedditApiResponse> {
  const segments = path.split('/').map((s) => {
    try {
      return encodeURIComponent(decodeURIComponent(s));
    } catch {
      return encodeURIComponent(s);
    }
  });
  const sanitizedPath = segments.join('/');
  const url = `${REDDIT_ADS_BASE_URL}${sanitizedPath}`;
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
    throw new RedditApiError(resp.status, method, path, text);
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
  const objective = REDDIT_OBJECTIVE_LABELS[(config.objective ?? 'conversions') as RedditObjective] ?? 'Conversions';
  const project = (config.project || 'Linux Foundation').replace(/\|/g, '-');
  return `Events | ${event} | ${region} | ${objective} | Intent | Social | ${project} | ToFU`;
}

// EXPORTED so the utm_campaign omission can be pinned directly, as `buildFinalUrl` is on
// the Google path. The behaviour is one conditional inside a URL builder, and asserting it
// through a full campaign create would test the dispatch plumbing instead of the rule.
export function buildRedditUtmUrl(config: RedditCampaignCreateRequest, variantIndex: number): string {
  const base = config.registrationUrl.replace(/\/$/, '');
  const params = new URLSearchParams({
    utm_source: 'reddit',
    utm_medium: 'paid-social',
    utm_term: config.eventName.replace(/\s+/g, '-').toLowerCase(),
    utm_content: `variant-${variantIndex + 1}`,
  });
  // utm_campaign is OMITTED when HubSpot issued no token, matching the Google Ads builder
  // (`campaign-proxy.service.ts`). `hsToken || slug` fabricated a plausible-looking token HubSpot
  // never minted: indistinguishable from a real one downstream, and it attributes traffic to a
  // campaign HubSpot cannot report on. An ABSENT parameter is visibly absent, and analytics tools
  // treat it as untagged rather than mis-tagged.
  //
  // Applied here because attribution must not vary by platform -- the fix landed on Google Ads
  // alone, so the same tokenless campaign was honestly untagged on one platform and falsely
  // tagged on the other two (Copilot).
  if (config.hsToken) {
    params.set('utm_campaign', config.hsToken);
  }
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${params.toString()}`;
}

/**
 * Reject an image URL Reddit could not fetch, before anything upstream is created.
 *
 * Mirrors `validateImageURL` in `internal/platform/reddit/client.go`. Reddit ingests and re-hosts `media_url` at
 * create time — there is no separate upload step — so the URL has to be publicly reachable http(s)
 * with a host. Embedded credentials are refused outright rather than forwarded to Reddit.
 *
 * The raw value never appears in the thrown message: it reaches the browser and the campaign's
 * persisted `steps`, and a URL an operator pasted can carry a signed-asset query string.
 */
function validateRedditImageUrl(imageUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('Invalid Reddit image URL: must be an absolute http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid Reddit image URL: scheme ${parsed.protocol.replace(':', '')} is not supported — must be http or https`);
  }
  // No host check here, deliberately, where upstream's Go `url.Parse` needs one: WHATWG `URL`
  // already refuses a hostless http(s) URL at the `new URL` above (`https://` and `https://:8080/x`
  // both throw, and `https:///a` normalizes to host `a`). A `!parsed.hostname` guard after the
  // scheme check is unreachable, and an unreachable guard reads as a check that is doing work.
  if (parsed.username || parsed.password) {
    throw new Error('Invalid Reddit image URL: must not embed credentials');
  }
}

/**
 * Resolve the three author-a-post inputs, or `null` when no post is to be authored.
 *
 * `postUrl` always wins: an operator who named an existing post gets that post promoted, and
 * `imageUrl`/`callToAction` are ignored rather than used to author a second one. That is upstream's
 * rule in `CreateCampaign`, and both arms must agree on it or the same request creates different
 * things depending on which one serves.
 *
 * Every refusal here happens BEFORE the first upstream call, so a bad input costs nothing: no
 * campaign, no ad group, no post. That ordering is upstream's and is stated as its reason in
 * `CreateCampaign` — validate "before any mutating call, so a bad image URL / CTA / headline
 * fails fast rather than after paid resources exist".
 */
export function resolveRedditAuthoredPost(config: RedditCampaignCreateRequest, validatedPostId: string | undefined): RedditAuthoredPostInput | null {
  const imageUrl = config.imageUrl?.trim() ?? '';
  if (validatedPostId || imageUrl === '') return null;

  validateRedditImageUrl(imageUrl);

  const requestedCta = config.callToAction?.trim() ?? '';
  let callToAction: RedditCallToAction = DEFAULT_REDDIT_CALL_TO_ACTION;
  if (requestedCta !== '') {
    // Matched case-insensitively against the catalogue and sent back in the catalogue's own
    // casing, because that casing is what Reddit accepts. Upstream matches the same way
    // (`CreateCampaign`), so a value either arm accepts is accepted by both.
    const canonical = REDDIT_CALL_TO_ACTIONS.find((known) => known.toLowerCase() === requestedCta.toLowerCase());
    if (!canonical) {
      throw new Error(`Invalid Reddit call to action "${requestedCta}": must be one of ${REDDIT_CALL_TO_ACTIONS.join(', ')}`);
    }
    callToAction = canonical;
  }

  // The first variant's headline is the post's, falling back to the event name — the same
  // precedence upstream uses. Only variant 0 is consulted because one post carries one headline;
  // the remaining variants stay in `steps` for Reddit Ads Manager, exactly as they do when no post
  // is authored at all.
  const firstHeadline = config.variants[0]?.headline?.trim() ?? '';
  const headline = firstHeadline !== '' ? firstHeadline : config.eventName;
  const headlineLength = [...headline].length;
  if (headlineLength > MAX_REDDIT_HEADLINE_LENGTH) {
    throw new Error(`Promoted-post headline is too long: ${headlineLength} characters (max ${MAX_REDDIT_HEADLINE_LENGTH})`);
  }

  return { imageUrl, headline, callToAction };
}

/**
 * Author a promoted image post on the ad account's own profile and return its id.
 *
 * Mirrors `createPromotedPost` in `internal/platform/reddit/client.go`. Three details are upstream's, not
 * invented here:
 *
 * - the profile id IS the ad-account id (`t2_...`), so there is no separate profile to look up;
 * - `media_url` is ingested and re-hosted by Reddit at create time, which is why a public absolute
 *   URL is required and why there is no upload call before this one;
 * - `destination_url` is the SAME UTM'd click URL the ad's `click_url` carries for variant 0 —
 *   they must match, or the post and the ad promoting it send traffic to differently-tagged URLs.
 *
 * `allow_comments: false` is upstream's too. It is NOT a visibility control: whether an ads-API
 * post appears in feeds is undocumented, which is why a post left unattached to an ad is treated
 * as a stray for the operator to delete rather than a harmless orphan.
 */
async function createRedditPromotedPost(accountId: string, config: RedditCampaignCreateRequest, post: RedditAuthoredPostInput): Promise<string> {
  const body = {
    data: {
      type: 'IMAGE',
      headline: post.headline,
      allow_comments: false,
      content: [
        {
          media_url: post.imageUrl,
          call_to_action: post.callToAction,
          destination_url: buildRedditUtmUrl(config, 0),
        },
      ],
    },
  };

  const resp = await redditRequest('POST', `/profiles/${accountId}/posts`, body);
  const postId = String(((resp.data as RedditCampaignData) ?? {}).id ?? '');
  if (!postId) {
    // A 2xx with no id is not a success with a missing field — there is no id to attach an ad to,
    // and treating it as one would attach the ad to `undefined`. Thrown so it lands on the
    // ambiguous arm: a post may well exist.
    throw new RedditMissingIdError('Reddit post creation returned no id');
  }
  return postId;
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
    success: true,
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

  let validatedPostId: string | undefined;
  if (config.postUrl) {
    validatedPostId = extractRedditPostId(config.postUrl);
  }

  // Resolved here, with the budget and date checks, so every author-a-post refusal happens before
  // the first upstream call — see `resolveRedditAuthoredPost`.
  const authoredPost = resolveRedditAuthoredPost(config, validatedPostId);

  const account = REDDIT_ACCOUNTS[0];
  const accountId = account.accountId;

  // Step 1: Verify account
  try {
    await redditRequest('GET', `/ad_accounts/${accountId}`);
    steps.push(`Account verified: ${account.label} (${accountId})`);
  } catch (err) {
    // Same rule as the two arms below — see `RedditApiError`: no arm in this function puts a raw
    // upstream body into `steps`, which is an operator-facing narrative, not a diagnostic. The body
    // stays in the log line, which is where a failed call gets diagnosed.
    logger.warning(req, 'reddit_account_verify', `Account verification failed: ${err instanceof Error ? err.message : 'Unknown error'}`, {
      account_id: accountId,
    });
    steps.push(`Account verification warning (${describeRedditFailure(err)})`);
  }

  // Step 2: Create campaign (PAUSED, lifetime budget, objective-aware params)
  const campaignName = buildRedditCampaignName(config);
  const campaignStartTime = toIsoTimestamp(config.startDate);
  const campaignEndTime = toIsoTimestamp(config.endDate);

  const objective = config.objective ?? 'conversions';
  const objParams = REDDIT_OBJECTIVE_PARAMS[objective];
  // Belt-and-suspenders: TypeScript guarantees coverage but this guards against runtime widening
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

  // Step 4: Attach an ad — promoting the post the operator named, or one authored here from
  // `imageUrl` — otherwise log manual instructions
  let adCount = 0;
  let adId: string | undefined;
  let postId = validatedPostId;
  // Tracked separately from `postId` so the ad-failure arm can say whether a post this service
  // authored is now sitting unattached, which is a stray to clean up rather than a pre-existing
  // post of the operator's that nothing happened to.
  let authoredPostId: string | undefined;

  if (!postId && authoredPost) {
    try {
      authoredPostId = await createRedditPromotedPost(accountId, config, authoredPost);
      postId = authoredPostId;
      steps.push(`Promoted post authored: ${authoredPostId} (CTA: ${authoredPost.callToAction})`);
    } catch (err) {
      logger.warning(req, 'reddit_post_create', `Promoted post creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`, {
        campaign_id: campaignId,
        ad_group_id: adGroupId,
      });
      // Status only, never the body — see `RedditApiError`. The two arms differ in exactly one
      // instruction, and it is the one that matters: whether authoring again risks a duplicate.
      steps.push(
        redditOutcomeAmbiguous(err)
          ? `Promoted post authoring UNCONFIRMED (${describeRedditFailure(err)}) — continuing without an ad. Check this ad account's posts in Reddit Ads Manager BEFORE authoring the post again, to avoid creating a duplicate, and delete any post that is not attached to an ad.`
          : `Promoted post authoring failed: Reddit rejected the post (${describeRedditFailure(err)}) — continuing without an ad. No post was created; author the post and add the ad to this campaign in Reddit Ads Manager.`
      );
    }
  }

  if (postId) {
    if (validatedPostId) {
      steps.push(`Extracted post ID: ${postId} from ${config.postUrl}`);
    }

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

    // Appended to EVERY arm that ends with no ad, because a post this service authored is then
    // sitting unattached and only this result tells the operator it exists. Empty when the post was
    // the operator's own: nothing happened to it, and calling it a stray would be wrong.
    //
    // Two wordings, for the same reason the two ad-failure arms differ: "is now unattached" is only
    // true when the ad definitely was not created. On an ambiguous outcome the ad may exist and the
    // post may be attached to it, so asserting the stray would send the operator to delete a post
    // that is in fact serving.
    const strayNote = authoredPostId
      ? ` A promoted post was authored for this campaign (${authoredPostId}) and is now unattached — attach it to an ad in Reddit Ads Manager, or delete it there.`
      : '';
    const unconfirmedStrayNote = authoredPostId
      ? ` A promoted post was authored for this campaign (${authoredPostId}) and may now be unattached — if no ad exists, attach it to one in Reddit Ads Manager, or delete it there.`
      : '';

    try {
      const adResp = await redditRequest('POST', `/ad_accounts/${accountId}/ads`, adBody);
      const adData = (adResp.data as RedditCampaignData) ?? {};
      adId = String(adData.id ?? '');
      if (adId) {
        adCount = 1;
        steps.push(`Ad created: ${adId} (post: ${postId}, click URL: ${utmUrl})`);
      } else {
        // A 2xx carrying no id is still an ad that cannot be reported, toggled, or found — and
        // before this branch existed it produced NO step at all, so an authored post could be left
        // unattached with the result saying nothing about it. Reported like a failure, but worded
        // for what actually happened: Reddit accepted the call, so "no response" would be false and
        // an ad may well exist.
        logger.warning(req, 'reddit_ad_create', 'Ad creation returned no ad id', {
          campaign_id: campaignId,
          ad_group_id: adGroupId,
          post_id: postId,
        });
        steps.push(
          `Ad creation UNCONFIRMED (Reddit accepted the request but returned no ad id) — check this campaign in Reddit Ads Manager BEFORE adding an ad, to avoid creating a duplicate.${unconfirmedStrayNote}`
        );
      }
    } catch (err) {
      logger.warning(req, 'reddit_ad_create', `Ad creation failed: ${err instanceof Error ? err.message : 'Unknown error'}`, {
        campaign_id: campaignId,
        ad_group_id: adGroupId,
        post_id: postId,
      });
      // Status only, never the body — see `RedditApiError`. The full message is in the log line
      // above, which is where a 400 gets diagnosed.
      //
      // Split on the same rule as the post arm above, and for the same consequence: a 5xx may have
      // been raised after the ad was written and a `fetch` rejection cannot say whether the request
      // was sent, so "add the ad in Reddit Ads Manager" is how a duplicate AD gets made. Two ads in
      // one paused ad group both go live the moment the campaign is activated.
      steps.push(
        redditOutcomeAmbiguous(err)
          ? `Ad creation UNCONFIRMED (${describeRedditFailure(err)}) — check this campaign in Reddit Ads Manager BEFORE adding an ad, to avoid creating a duplicate.${unconfirmedStrayNote}`
          : `Ad creation failed (${describeRedditFailure(err)}) — add the ad to this campaign in Reddit Ads Manager.${strayNote}`
      );
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
      // Two ways to reach here with no variants, and they are not the same thing: nothing was
      // supplied at all, or an image URL was supplied and the authoring above failed. The second
      // already pushed its own step saying so, and repeating "no image URL provided" after it would
      // contradict it.
      steps.push(
        authoredPost
          ? 'No ad variants, and no ad was attached — add ads manually in Reddit Ads Manager'
          : 'No ad variants, post URL or image URL provided — add ads manually in Reddit Ads Manager'
      );
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

    if (
      c.impressions > CAMPAIGN_ALERT_THRESHOLDS['reddit-ads'].minImpressions &&
      c.ctr < CAMPAIGN_ALERT_THRESHOLDS['reddit-ads'].lowCtrPct &&
      c.status === 'ACTIVE'
    ) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Low CTR at ${c.ctr.toFixed(2)}% — ${c.clicks} clicks from ${c.impressions.toLocaleString()} impressions`,
        action: 'Refresh ad creative, test different headlines, or narrow targeting to more relevant subreddits',
      });
    }

    if (c.clicks > CAMPAIGN_ALERT_THRESHOLDS['reddit-ads'].clicksWithoutConversions && c.conversions === 0) {
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
