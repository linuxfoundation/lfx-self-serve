// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TWITTER_AUDIENCE_WINDOWS } from '../constants/campaign-optimize.constants';
import type { CampaignMetricsWindow, MicrosoftKeywordsWindow } from './campaign.interface';

// ---------------------------------------------------------------------------
// Optimize-tab reads and levers proxied to lfx-v2-campaign-service
//
// The `CampaignService*` response types below are campaign-service WIRE shapes (snake_case, as its
// Goa design publishes them) and the BFF passes them through unchanged, like
// `CampaignServiceAudience` for Google Ads. The `*Request` types are what the browser sends the BFF
// (camelCase, like `CampaignBudgetUpdateRequest`); the BFF maps them onto the wire.
// ---------------------------------------------------------------------------

/** One campaign under its brief, as every per-campaign campaign-service route addresses it. */
export interface CampaignServiceCampaignTarget {
  projectSlug: string;
  briefId: string;
  campaignId: string;
}

/** A per-platform audience read the BFF proxies (campaign-service's own platform path segment). */
export type CampaignAudiencePlatform = 'meta-ads' | 'twitter-ads' | 'microsoft-ads' | 'reddit-ads' | 'linkedin-ads';

/** The reporting windows the X audience read accepts. */
export type TwitterAudienceWindow = (typeof TWITTER_AUDIENCE_WINDOWS)[number];

/** The reporting windows the Reddit audience read accepts (the Microsoft set). */
export type RedditAudienceWindow = MicrosoftKeywordsWindow;

/** One Meta audience bucket (`meta-ads-audience-bucket`). Age/gender fields and placement fields are exclusive by `dimension`. */
export interface CampaignServiceMetaAdsAudienceBucket {
  dimension: 'age_gender' | 'placement';
  age?: string;
  gender?: string;
  publisher_platform?: string;
  platform_position?: string;
  impressions: number;
  clicks: number;
  /** Micro-units of `account_currency`; no FX conversion anywhere. */
  cost_micros: number;
  ctr: number;
}

/** `meta-ads-audience`: both breakdowns, or a 503 — never one without the other. */
export interface CampaignServiceMetaAdsAudience {
  window: CampaignMetricsWindow;
  buckets: CampaignServiceMetaAdsAudienceBucket[];
  bucket_count: number;
  /** ABSENT when no bucket was returned. */
  account_currency?: string;
}

/** One X audience bucket (`twitter-ads-audience-bucket`). */
export interface CampaignServiceTwitterAdsAudienceBucket {
  dimension: 'age' | 'gender' | 'platform';
  value: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** `twitter-ads-audience`. Days are on the ad ACCOUNT's calendar, not UTC. */
export interface CampaignServiceTwitterAdsAudience {
  window: TwitterAudienceWindow;
  buckets: CampaignServiceTwitterAdsAudienceBucket[];
  bucket_count: number;
  /** ABSENT when X was not contacted. */
  account_currency?: string;
  /** True when a dimension's rows carried no measurement at all: its zeros are not observations. */
  all_counters_null: boolean;
}

/** One Microsoft audience bucket (`microsoft-ads-audience-bucket`): one per (age group, gender). */
export interface CampaignServiceMicrosoftAdsAudienceBucket {
  age_group: string;
  gender: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** `microsoft-ads-audience`, served from the last finished asynchronous report. */
export interface CampaignServiceMicrosoftAdsAudience {
  window: MicrosoftKeywordsWindow;
  buckets: CampaignServiceMicrosoftAdsAudienceBucket[];
  bucket_count: number;
  /** When the served report was requested. ABSENT when no finished report covers every campaign. */
  metrics_as_of?: string;
  metrics_pending: boolean;
  data_incomplete: boolean;
}

/**
 * One Reddit audience bucket (`reddit-ads-audience-bucket`), as the campaign-service branch
 * `feat/LFXV2-2665-reddit-audience-insights` defines it — not on its `main` yet.
 */
export interface CampaignServiceRedditAdsAudienceBucket {
  dimension: 'gender' | 'country' | 'community';
  /** ABSENT when Reddit reported an explicit null: unattributed traffic, not a read failure. */
  value?: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** `reddit-ads-audience` (pending upstream; see the bucket). */
export interface CampaignServiceRedditAdsAudience {
  window: RedditAudienceWindow;
  buckets: CampaignServiceRedditAdsAudienceBucket[];
  bucket_count: number;
}

/**
 * PROVISIONAL: campaign-service has no LinkedIn audience read yet. Typed on its siblings'
 * dimension/value bucket shape so the route can be wired behind its flag; re-check against the
 * published design before the flag is turned on.
 */
export interface CampaignServiceLinkedInAdsAudienceBucket {
  dimension: string;
  value?: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** PROVISIONAL LinkedIn audience read; see `CampaignServiceLinkedInAdsAudienceBucket`. */
export interface CampaignServiceLinkedInAdsAudience {
  window: string;
  buckets: CampaignServiceLinkedInAdsAudienceBucket[];
  bucket_count: number;
}

/** Each audience platform's wire result. */
export interface CampaignServicePlatformAudienceMap {
  'meta-ads': CampaignServiceMetaAdsAudience;
  'twitter-ads': CampaignServiceTwitterAdsAudience;
  'microsoft-ads': CampaignServiceMicrosoftAdsAudience;
  'reddit-ads': CampaignServiceRedditAdsAudience;
  'linkedin-ads': CampaignServiceLinkedInAdsAudience;
}

/** Any one platform's audience read. */
export type CampaignServicePlatformAudience = CampaignServicePlatformAudienceMap[CampaignAudiencePlatform];

/** `match` and `diverged` need both sides read; `unknown` is never folded into either. */
export type CampaignSettingsComparison = 'match' | 'diverged' | 'unknown';

/** One compared setting (`campaign-settings-field`). */
export interface CampaignServiceSettingsField {
  field: string;
  /** What the row recorded (what dispatch ASKED FOR). ABSENT when it records nothing. */
  recorded?: string;
  /** What the platform holds now. ABSENT when the platform did not return the field. */
  upstream?: string;
  comparison: CampaignSettingsComparison;
}

/** `campaign-settings-readback`: a live, never-persisted comparison of the row against the platform. */
export interface CampaignServiceSettingsReadback {
  campaign_id: string;
  platform_campaign_id: string;
  platform: string;
  read_at: string;
  fields: CampaignServiceSettingsField[];
  diverged_count: number;
  unknown_count: number;
}

/** A Meta ad set's status in Meta's vocabulary, as `toggle-meta-ad-set-status` accepts it. */
export type MetaAdSetStatus = 'ACTIVE' | 'PAUSED';

/** One Meta ad set (`meta-ad-set`). */
export interface CampaignServiceMetaAdSet {
  id: string;
  /** false for an ad set that delivered in the window but the listing no longer returns. */
  listed: boolean;
  name?: string;
  /** Configured status (ACTIVE, PAUSED, DELETED, ARCHIVED). */
  status?: string;
  effective_status?: string;
  bid_strategy?: string;
  /** ABSENT when the ad set holds no budget of its own (Campaign Budget Optimization). */
  budget_type?: 'daily' | 'lifetime';
  /** Whole units of `currency`, two decimals. */
  budget_amount?: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
  /** true for the ONE ad set this service created; only that one may be set ACTIVE here. */
  recorded: boolean;
}

/** `meta-ad-sets`: one Meta campaign's ad sets, read live. */
export interface CampaignServiceMetaAdSets {
  campaign_id: string;
  platform_campaign_id: string;
  window: CampaignMetricsWindow;
  currency: string;
  read_at: string;
  ad_sets: CampaignServiceMetaAdSet[];
  ad_set_count: number;
}

/**
 * `meta-ad-set-status-change`. `etag` is the campaign row's version, UNCHANGED: an ad set's status
 * is not stored on the row. The BFF fills it from the `ETag` response header.
 */
export interface CampaignServiceMetaAdSetStatusChange {
  campaign_id: string;
  ad_set_id: string;
  requested_status: MetaAdSetStatus;
  previous_status?: string;
  /** ALREADY_IN_STATE means NOTHING was sent to Meta. */
  outcome: 'APPLIED' | 'ALREADY_IN_STATE';
  etag?: string;
}

/** Body of `POST /api/campaigns/:campaignId/meta-ad-sets/:adSetId/status?project=`. */
export interface MetaAdSetStatusRequest {
  briefId: string;
  status: MetaAdSetStatus;
  /** The campaign row's ETag, sent upstream as `If-Match`. */
  etag: string;
}

/** Arguments of `CampaignService.updateMetaAdSetStatus` on the client. */
export interface MetaAdSetStatusParams extends MetaAdSetStatusRequest {
  projectSlug: string;
  campaignId: string;
  adSetId: string;
}

/** A platform `adopt-campaign` may be asked for through the BFF (Google Ads is excluded). */
export type CampaignAdoptPlatform = 'microsoft-ads' | 'meta-ads' | 'reddit-ads' | 'twitter-ads';

/** Body of `POST /api/campaigns/adopt?project=`. */
export interface CampaignAdoptRequest {
  briefId: string;
  platform: CampaignAdoptPlatform;
  /** The ad platform's own id for the existing campaign. */
  platformCampaignId: string;
}

/** One keyword in a Reddit or X campaign's targeting (`keyword-targeting-entry`). */
export interface CampaignServiceKeywordTargetingEntry {
  keyword: string;
  /** X only: the criterion that holds the keyword, which a removal names. */
  criterion_id?: string;
  /** X only: BROAD_KEYWORD, PHRASE_KEYWORD, EXACT_KEYWORD or UNORDERED_KEYWORD. */
  match_type?: string;
}

/** A platform whose campaigns have keyword TARGETING that can be read and removed (`get-keyword-targeting`). */
export type KeywordTargetingPlatform = 'reddit-ads' | 'twitter-ads';

/** `keyword-targeting`: the positive keywords of a Reddit ad group or X line item, read live. */
export interface CampaignServiceKeywordTargeting {
  campaign_id: string;
  platform: KeywordTargetingPlatform;
  targeting_entity_id: string;
  keywords: CampaignServiceKeywordTargetingEntry[];
  /** Reddit only: a fingerprint of the whole targeting, which a removal must send back. */
  revision?: string;
}

/** One keyword to remove: `keyword` on Reddit, `criterionId` on X — exactly one of the two. */
export interface KeywordTargetingRemovalItem {
  keyword?: string;
  criterionId?: string;
}

/** Body of `POST /api/campaigns/:campaignId/keyword-targeting/removals?project=`. */
export interface KeywordTargetingRemovalsRequest {
  briefId: string;
  keywords: KeywordTargetingRemovalItem[];
  /** Reddit: the `revision` the read returned. Must be absent on X. */
  revision?: string;
}

/** One removal's outcome (`keyword-targeting-removal-result`); `results[i]` answers `keywords[i]`. */
export interface CampaignServiceKeywordTargetingRemovalResult {
  keyword?: string;
  criterion_id?: string;
  /** UNCONFIRMED means it may have been removed: read the targeting again before retrying. */
  outcome: 'APPLIED' | 'FAILED' | 'UNCONFIRMED';
  error_code?: string;
}

/** `keyword-targeting-removals`. */
export interface CampaignServiceKeywordTargetingRemovals {
  campaign_id: string;
  results: CampaignServiceKeywordTargetingRemovalResult[];
  applied_count: number;
}

/** One removal's outcome. UNCONFIRMED is never worded as a failure: the keyword may already be gone. */
export type KeywordTargetingRemovalOutcome = CampaignServiceKeywordTargetingRemovalResult['outcome'];

/** One keyword of the targeting panel's list, with what a removal of it would send. */
export interface KeywordTargetingListItem {
  /** Stable within one read: the X criterion id, or the Reddit keyword exactly as read. */
  key: string;
  keyword: string;
  /** X's match type in words ("Phrase"), or `''` on Reddit, whose keywords carry none. */
  matchLabel: string;
  /** What a removal names for this keyword, or `null` when the read gave it no handle (an X entry with no criterion id). */
  removalItem: KeywordTargetingRemovalItem | null;
}

/** The targeting panel's read: the list, or why it could not be shown. */
export interface KeywordTargetingReadState {
  status: 'loading' | 'loaded' | 'error';
  targeting: CampaignServiceKeywordTargeting | null;
  /** A fixed sentence for `error`, never upstream text. `''` otherwise. */
  message: string;
}

/** One SENT keyword joined, by POSITION, to the outcome the removal gave it. */
export interface KeywordTargetingRemovalOutcomeRow {
  /** The index in the request, which is also the index in `results`. */
  index: number;
  keyword: string;
  outcome: KeywordTargetingRemovalOutcome;
  label: string;
  /** What to tell the operator beyond the label (why it was not removed, or reload-to-verify), or `''`. */
  detail: string;
}

/** A removal that produced no per-keyword results at all. `unconfirmed`: any of them may have been removed. */
export interface KeywordTargetingRemovalBatchOutcome {
  state: 'failed' | 'unconfirmed';
  /** A fixed sentence, never upstream text. */
  message: string;
}

/**
 * The Reddit `revision` the negative-keyword editor must send, read from the campaign's keyword
 * targeting. `idle` for a platform that takes none.
 */
export interface NegativeKeywordsRevisionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  revision: string | null;
}

/** A platform whose campaign-ref resolve the BFF exposes (`linkedin-ads` is pending upstream). */
export type CampaignRefPlatform = 'meta-ads' | 'reddit-ads' | 'twitter-ads' | 'linkedin-ads';

/** The reporting windows the Reddit keyword read accepts: the Microsoft set (`yesterday` and `last_14_days` are 400 upstream). */
export type RedditKeywordsWindow = MicrosoftKeywordsWindow;

/**
 * One (campaign, keyword) row of campaign-service's `get-reddit-ads-keywords` (`reddit-ads-keyword`).
 * READ-ONLY: Reddit's KEYWORD report carries no keyword id, match type or status, so a row addresses
 * no action; Reddit keywords are acted on through the keyword-targeting levers.
 */
export interface CampaignServiceRedditKeywordRow {
  /** Reddit's campaign id (map it with `/reddit-ads/campaign-ref`). */
  campaign_id: string;
  /** Reddit's keyword, verbatim. ABSENT when Reddit attributed the delivery to no keyword (community or interest targeting). */
  text?: string;
  impressions: number;
  clicks: number;
  /** Reddit SPEND, already micro-units, in the ad account's own currency. */
  cost_micros: number;
  /** A FRACTION (0.045), not a percentage. */
  ctr: number;
}

/** `reddit-ads-keywords`: the top 50 rows by impressions across the project's own Reddit campaigns, read live. */
export interface CampaignServiceRedditKeywords {
  window: RedditKeywordsWindow;
  rows: CampaignServiceRedditKeywordRow[];
  row_count: number;
  /** True when the project's campaigns have more rows than were returned: the totals are then a subtotal. */
  truncated: boolean;
}

/** A Reddit keyword row as the UI renders it: currency amounts and CTR as a percentage. */
export interface RedditKeywordMetrics {
  /** Stable within one read: the row's campaign and keyword. */
  key: string;
  /** Reddit's campaign id. */
  campaignId: string;
  /** The keyword, or `null` for delivery Reddit attributed to no keyword. */
  keyword: string | null;
  impressions: number;
  clicks: number;
  /** A percentage (4.5), not a fraction. */
  ctr: number;
  /** In the ad account's own currency. */
  spend: number;
}

/** Totals over the rows returned (a subtotal when the read was truncated). No conversions: Reddit's read has none. */
export interface RedditKeywordTotals {
  impressions: number;
  clicks: number;
  spend: number;
  avgCtr: number;
}

/** Response of `GET /api/campaigns/reddit/keywords?project=&window=`. */
export interface RedditKeywordMetricsResponse {
  pulledAt: string;
  window: RedditKeywordsWindow;
  totalKeywords: number;
  truncated: boolean;
  totals: RedditKeywordTotals;
  keywords: RedditKeywordMetrics[];
}

/** What the Reddit keyword table shows: the read in flight, its rows, or why there are none. */
export interface RedditKeywordsView {
  state: 'idle' | 'loading' | 'loaded' | 'unavailable' | 'error';
  data: RedditKeywordMetricsResponse | null;
  /** A fixed sentence for `unavailable` and `error`, never upstream text. `''` otherwise. */
  message: string;
}

/** One reporting-window choice of the Reddit keyword table. */
export interface RedditKeywordsWindowOption {
  value: RedditKeywordsWindow;
  label: string;
}

/** How a lever reports an outcome it cannot confirm: its own error code and fixed client message. */
export interface CampaignLeverUnconfirmedOutcome {
  code: string;
  message: string;
  /** Matched against an ANSWERED 503's message; a match means the write may have reached the platform. */
  marker: RegExp;
}
