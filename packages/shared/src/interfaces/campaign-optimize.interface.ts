// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LINKEDIN_AUDIENCE_WINDOWS, TWITTER_AUDIENCE_WINDOWS } from '../constants/campaign-optimize.constants';
import type { CampaignMetricsWindow, CampaignServiceCampaign, CampaignServiceCampaignRef, MicrosoftKeywordsWindow } from './campaign.interface';

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

/** One Reddit audience bucket (`reddit-ads-audience-bucket`, campaign-service #306). No age dimension: Reddit has none. */
export interface CampaignServiceRedditAdsAudienceBucket {
  dimension: 'gender' | 'country' | 'community';
  /** ABSENT when Reddit reported an explicit null: unattributed traffic, not a read failure. */
  value?: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** `reddit-ads-audience`: all three breakdowns, or a 503. Spend is in the account's own (unreported) currency. */
export interface CampaignServiceRedditAdsAudience {
  window: RedditAudienceWindow;
  buckets: CampaignServiceRedditAdsAudienceBucket[];
  bucket_count: number;
}

/** The LinkedIn professional-demographic pivots the LinkedIn audience read returns. */
export type LinkedInAudienceDimension = 'job_function' | 'seniority' | 'industry' | 'company_size' | 'country';

/** The reporting windows the LinkedIn audience read accepts. */
export type LinkedInAudienceWindow = (typeof LINKEDIN_AUDIENCE_WINDOWS)[number];

/**
 * One LinkedIn audience bucket (`linkedin-ads-audience-bucket`, campaign-service
 * `design/linkedin_audience.go`): one pivot value's counters, summed across the project's own
 * campaigns. Every counter is APPROXIMATE (LinkedIn's privacy approximation).
 */
export interface CampaignServiceLinkedInAdsAudienceBucket {
  dimension: LinkedInAudienceDimension;
  /** LinkedIn's pivot value VERBATIM: a URN such as `urn:li:function:8`, never resolved to a name. */
  value: string;
  impressions: number;
  clicks: number;
  /** Micro-units of USD (LinkedIn's `costInUsd`); there is no account currency. */
  cost_micros: number;
  ctr: number;
}

/** `linkedin-ads-audience`: all five pivots, or a 503. */
export interface CampaignServiceLinkedInAdsAudience {
  window: LinkedInAudienceWindow;
  buckets: CampaignServiceLinkedInAdsAudienceBucket[];
  bucket_count: number;
  /** Always true: every counter is an estimate, privacy-thresholded and delayed 12-24 hours. */
  approximate: boolean;
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
  /**
   * true when this is the `recorded` ad set and campaign-service holds a DELIBERATE pause of it:
   * resuming the campaign then leaves it PAUSED. campaign-service's record, not Meta's (`status`
   * is Meta's). After a pause whose outcome was unconfirmed it is normally true but NOT guaranteed,
   * so it must be re-read; always false on an adopted campaign.
   */
  deliberately_paused: boolean;
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

/** One Meta ad under an ad set (`meta-ad`). Every descriptive field is absent when `listed` is false. */
export interface CampaignServiceMetaAd {
  id: string;
  /** false for an ad that delivered in the window but the listing did not return (deleted, archived, or past the cap). */
  listed: boolean;
  name?: string;
  /** Configured status (ACTIVE, PAUSED, DELETED, ARCHIVED). */
  status?: string;
  /** Effective status, verbatim (e.g. ADSET_PAUSED, PENDING_REVIEW, DISAPPROVED). */
  effective_status?: string;
  creative_id?: string;
  creative_name?: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  ctr: number;
}

/** `meta-ads`: the ads under ONE ad set of a Meta campaign, read live. Strictly read-only upstream. */
export interface CampaignServiceMetaAds {
  campaign_id: string;
  platform_campaign_id: string;
  ad_set_id: string;
  window: CampaignMetricsWindow;
  currency: string;
  read_at: string;
  /** true when the ad LISTING passed its page cap: `ads` holds the ads read, not every ad. Delivery is never truncated. */
  truncated: boolean;
  ads: CampaignServiceMetaAd[];
  ad_count: number;
}

/**
 * `meta-ad-set-status-change`. `etag` is the campaign row's version: UNCHANGED for most changes,
 * but NEW when the call wrote or cleared the deliberate-pause record of the recorded ad set, so the
 * caller must adopt it for its next write on the row. The BFF fills it from the `ETag` header.
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

/**
 * Response of `GET /api/campaigns/:campaignId/record?project=&briefId=`: the campaign row read from
 * campaign-service itself (not the asynchronous index), with its CURRENT ETag, plus whether this
 * deployment can service a pause/resume (`CampaignListResult.statusToggleEnabled`).
 */
export interface CampaignRecordResult {
  campaign: CampaignServiceCampaign;
  statusToggleEnabled: boolean;
}

/** A platform `adopt-campaign` may be asked for through the BFF (Google Ads is excluded). */
export type CampaignAdoptPlatform = 'microsoft-ads' | 'meta-ads' | 'reddit-ads' | 'twitter-ads' | 'linkedin-ads';

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
 * One campaign's latest keyword-targeting removal, as `CampaignKeywordTargetingService` keeps it
 * ACROSS the panel's lifetime: the panel can be closed or unmounted while the removal runs on, and a
 * reopened panel reads this back.
 */
export interface KeywordTargetingRemovalState {
  pending: boolean;
  /** Per-keyword outcomes, in the order the keywords were SENT. */
  outcomeRows: KeywordTargetingRemovalOutcomeRow[];
  /** The removal's outcome when it produced no per-keyword results at all. */
  batchOutcome: KeywordTargetingRemovalBatchOutcome | null;
  /** The keywords sent, in order, so a batch outcome can name them. */
  sent: string[];
  /** How many removals of this campaign have settled: a change means the targeting must be read again. */
  settleCount: number;
}

/** One removal, as the panel hands it to `CampaignKeywordTargetingService`. */
export interface KeywordTargetingRemovalSubmission {
  projectSlug: string;
  briefId: string;
  campaignId: string;
  campaignName: string;
  /** The READ's platform: decides the failure wording. */
  platform: KeywordTargetingPlatform;
  /** The request body, built by the panel (Reddit keywords with `revision`, X criterion ids without). */
  request: KeywordTargetingRemovalsRequest;
  /** The keyword text of each item, in request order: the outcomes are zipped onto this list. */
  sent: string[];
}

/**
 * The Reddit `revision` the negative-keyword editor must send, read from the campaign's keyword
 * targeting. `idle` for a platform that takes none.
 */
export interface NegativeKeywordsRevisionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  revision: string | null;
}

/** A platform whose campaign-ref resolve the BFF exposes. */
export type CampaignRefPlatform = 'meta-ads' | 'reddit-ads' | 'twitter-ads' | 'linkedin-ads' | 'microsoft-ads';

/** The reporting windows the Reddit keyword read accepts: the Microsoft set (`yesterday` and `last_14_days` are 400 upstream). */
export type RedditKeywordsWindow = MicrosoftKeywordsWindow;

/**
 * One (campaign, keyword) row of campaign-service's `get-reddit-ads-keywords` (`reddit-ads-keyword`).
 * Reddit's KEYWORD report carries no keyword id, match type or status, so a row cannot address the
 * keyword itself; its TEXT can still be added as a negative through `add-negative-keywords`.
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

/**
 * The brief campaign a Reddit keyword row's "Add as negative" writes to, keyed by Reddit's campaign
 * id: campaign-service's own campaign UUID, which `add-negative-keywords` is addressed by.
 */
export interface RedditKeywordNegativeTarget {
  campaignId: string;
  campaignName: string;
}

/**
 * Where one Reddit keyword row's "Add as negative" stands.
 *
 * - `none`: no action is offered — the keyword's campaign is not an available Reddit campaign of
 *   this brief, the delivery is attributed to no keyword, or the text is one the lever refuses.
 * - `available`: the button is offered.
 * - `busy`: a negative-keyword request of the campaign is in flight, or its revision is being read.
 * - `negative`: this session's last request for the campaign confirmed the keyword as a negative.
 */
export interface RedditKeywordNegativeAction {
  state: 'none' | 'available' | 'busy' | 'negative';
  /** True on the row whose keyword is being sent (or whose revision is being read). */
  sending: boolean;
  /** The button's accessible name, naming the keyword and the campaign. `''` when nothing is offered. */
  ariaLabel: string;
  /** This keyword's LAST write outcome on the campaign ("Added", "Not confirmed", ...), or `''`. */
  outcomeLabel: string;
  /** What to tell the operator beyond the label: the verify-first advice, the refusal, or `''`. */
  outcomeDetail: string;
  /**
   * How the outcome reads when the operator must act on it: `warning` for not confirmed (it may have
   * been added — verify first), `error` for not added, `none` otherwise.
   */
  outcomeTone: 'none' | 'warning' | 'error';
  /**
   * Why the latest attempt from the table was NOT sent (revision read failed or answered none, or
   * another keyword change started first), or `''`. Shown beside the write outcome, never instead
   * of it: the write outcome (and its verify-first advice) still describes the campaign.
   */
  notSentMessage: string;
}

/**
 * A confirmed "Add as negative" that went nowhere, kept by the table under a READ-INDEPENDENT key
 * (`redditKeywordNoteKey`: project, Reddit campaign id, keyword as sent) so it survives a re-read
 * that re-ranks or drops rows.
 */
export interface RedditKeywordNotSentNote {
  /** The keyword read current when the note was recorded: a later read clears it. */
  read: string;
  /**
   * The `seq` of the keyword's last write outcome when the note was recorded (`0` for none): only an
   * outcome with a HIGHER `seq` supersedes the note. An outcome that is merely gone (its result
   * dismissed) does not.
   */
  outcomeSeq: number;
  message: string;
  /** The keyword as it would have been sent. */
  keyword: string;
  campaignName: string;
  /** The project and Reddit campaign the add was for: a note is never shown under another project. */
  projectSlug: string;
  redditCampaignId: string;
  /** campaign-service's campaign UUID the add was for: what the keyword's outcome high-water mark is keyed by. */
  campaignId: string;
}

/** A not-sent note whose keyword is not in the report shown: listed above the table instead of on a row. */
export interface RedditKeywordUnplacedNote {
  key: string;
  testIdKey: string;
  keyword: string;
  campaignName: string;
  message: string;
}

/** What holds a Reddit keyword row's "Add as negative" besides the campaign's own negative-keyword request. */
export interface RedditKeywordNegativeHolds {
  /** The table is reading the campaign's revision (the campaign is reserved). */
  campaignReading: boolean;
  /** That read is for THIS row's keyword. */
  rowReading: boolean;
  /** A negative-keyword request of the campaign is in flight under ANOTHER brief key (the page's brief id changed under it). */
  negativeWritePending: boolean;
  /** A keyword-targeting removal of the campaign is in flight: its Reddit targeting is one domain. */
  targetingRemovalPending: boolean;
}

/** A Reddit keyword row as the table draws it: the campaign column's label and the row's action precomputed. */
export interface RedditKeywordDisplayRow extends RedditKeywordMetrics {
  /** The brief's name for the campaign, or Reddit's campaign id when the brief does not know it. */
  campaignLabel: string;
  /** `key` as a testid-safe slug, for the row's action testids. */
  testIdKey: string;
  negative: RedditKeywordNegativeAction;
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

// ---------------------------------------------------------------------------
// Optimize/Monitor UI view models over the reads above
// ---------------------------------------------------------------------------

/** An audience platform the Monitor tab shows a panel for: every one campaign-service serves. */
export type PlatformAudiencePanelPlatform = CampaignAudiencePlatform;

/** One platform choice offered by the audience insights section. */
export interface PlatformAudiencePlatformOption {
  value: PlatformAudiencePanelPlatform;
  label: string;
}

/** One reporting-window choice offered by an audience panel. */
export interface PlatformAudienceWindowOption {
  value: string;
  label: string;
}

/**
 * One breakdown row as rendered. A `null` counter is NOT MEASURED (absent on the wire, or a
 * dimension the platform reported with no measurement at all) and is never shown as `0`.
 */
export interface PlatformAudienceRow {
  key: string;
  label: string;
  impressions: number | null;
  clicks: number | null;
  /** Whole units of the section's currency (`cost_micros / 1e6`). */
  spend: number | null;
  /** A fraction (clicks / impressions), as the wire carries it. */
  ctr: number | null;
  /** Share of the largest impressions count in the section, 0-100, for the bar. 0 when not measured. */
  barPct: number;
}

/** One breakdown (age, gender, placement, job function, ...) of one platform's audience read. */
export interface PlatformAudienceSection {
  key: string;
  title: string;
  rows: PlatformAudienceRow[];
  /** True when the platform said this breakdown's counters are not a measurement. */
  notMeasured: boolean;
}

/** One platform's audience read, normalised for the panel. */
export interface PlatformAudienceView {
  sections: PlatformAudienceSection[];
  /** ISO 4217 code the spend is in, or `null` when the read does not say (shown as the ad account's currency). */
  currency: string | null;
  /** Every counter is an estimate (LinkedIn). */
  approximate: boolean;
  /** No finished report covers the project yet (Microsoft): empty sections mean "building", never "no audience". */
  reportBuilding: boolean;
  /** A newer report is building (Microsoft). */
  metricsPending: boolean;
  /** The served report may still rise (Microsoft). */
  dataIncomplete: boolean;
  /** When the served report was requested (Microsoft), or `null`. */
  metricsAsOf: string | null;
  /** At least one breakdown carried no measurement at all (X `all_counters_null`). */
  someNotMeasured: boolean;
  /** No bucket in any breakdown. */
  empty: boolean;
}

/**
 * Why an audience read failed, as the panel states it:
 * - `no-connection`: 404, the project has no connection for the platform;
 * - `conflict`: 409, the campaigns cannot be read together (another or no recorded account, a
 *   malformed stored id, too many campaigns); campaign-service does not say which;
 * - `unavailable`: 503, the platform did not confirm the read (rate-limited, unreachable, partial);
 * - `not-enabled`: 400, the read is switched off here, or the connection is inactive or has no account;
 * - `failed`: anything else.
 */
export type PlatformAudienceErrorKind = 'no-connection' | 'conflict' | 'unavailable' | 'not-enabled' | 'failed';

/**
 * Which ad-set action was asked for: the row's Pause/Resume (`toggle`), or the re-send that records
 * or clears a deliberate pause without changing Meta's status (`record`).
 */
export type MetaAdSetActionKind = 'toggle' | 'record';

/** The pause or resume the ad-set panel asks its parent to send. */
export interface MetaAdSetToggleRequest {
  adSetId: string;
  adSetName: string;
  status: MetaAdSetStatus;
  kind: MetaAdSetActionKind;
}

/**
 * A campaign row held on an UNKNOWN validator after an ad-set write that may have bumped its
 * version (the Optimize tab's `validatorHolds`).
 */
export interface CampaignValidatorHold {
  /** This hold's identity: an answer started for another hold (earlier, released, replaced) is ignored. */
  id: number;
  /** The etag the write was sent with; the index releases the hold only once it is past this. */
  preWriteEtag: string;
  /** Whether a campaign-list read has begun since THIS hold was created. */
  readStarted: boolean;
  /** The sequence of the latest authoritative row read started for this hold; only it may release the hold. */
  latestRead: number;
}

/** The ad-set change in flight on a campaign, so the panel can mark the button that is running. */
export interface MetaAdSetPendingChange {
  adSetId: string;
  kind: MetaAdSetActionKind;
}

/**
 * The follow-up check after an unconfirmed change, decided only once the re-read for that change
 * has landed: whether the created ad set's `deliberately_paused` now says what the requested
 * direction should leave (true after a PAUSE, false after a RESUME).
 * - `pending`: the re-read has not completed yet;
 * - `confirmed`: it shows the expected record;
 * - `missing`: it does not (`not-shown`), it does not list the ad set (`absent`), or it failed
 *   (`read-failed`). The last two are treated as the record being wrong, never as fine;
 * - `unknown`: the ad set is listed but carries no `deliberately_paused` value, so the re-read can
 *   say neither (matching `toMetaAdSetDisplayRow`, which offers no record action on it).
 */
export interface MetaAdSetRecordCheck {
  direction: MetaAdSetStatus;
  state: 'pending' | 'confirmed' | 'missing' | 'unknown';
  reason: 'not-shown' | 'absent' | 'read-failed' | null;
}

/**
 * How the last ad-set status change on a campaign ended, as the panel states it:
 * - `applied` / `already`: confirmed (`ALREADY_IN_STATE` means nothing was sent);
 * - `conflict`: 412, the campaign changed since it was loaded and nothing was changed;
 * - `unconfirmed`: may or may not have been applied; the ad sets are re-read;
 * - `failed`: a definite refusal (409 included), its message shown verbatim.
 */
export interface MetaAdSetToggleOutcome {
  state: 'applied' | 'already' | 'conflict' | 'unconfirmed' | 'failed';
  message: string;
  adSetId: string;
  adSetName: string;
  requestedStatus: MetaAdSetStatus;
}

/** One ad set as the panel renders it. */
export interface MetaAdSetDisplayRow {
  adSet: CampaignServiceMetaAdSet;
  name: string;
  /** Meta's configured status, or `null` when not reported. */
  status: string | null;
  /** The effective status when it differs from the configured one (e.g. CAMPAIGN_PAUSED), else `null`. */
  effectiveStatus: string | null;
  /** `"50.00 USD daily"`, or `null` when the ad set holds no budget of its own (or its scale is unknown). */
  budget: string | null;
  /** The action offered, or `null` when none can be sent from here. */
  action: MetaAdSetStatus | null;
  /** The button's visible word. */
  actionLabel: string;
  /** Why no action is offered, or `''`. */
  noActionReason: string;
  /**
   * A second action that re-sends the status Meta already reports, to fix the deliberate-pause
   * record without changing Meta (campaign-service answers `ALREADY_IN_STATE` and writes the record):
   * - `PAUSED` ("Pause again (record)"): the created ad set is PAUSED but `deliberately_paused` is
   *   explicitly `false` — a campaign resume would re-activate it;
   * - `ACTIVE` ("Resume again (clear record)"): it is ACTIVE but still `deliberately_paused: true`;
   * - `null` otherwise, including when `deliberately_paused` is absent (unknown is never acted on).
   */
  recordAction: MetaAdSetStatus | null;
  /** The second action's visible words, or `''`. */
  recordActionLabel: string;
  /** Why `action` cannot be sent while the CAMPAIGN is in its current state (see `MetaAdSetCampaignEligibility`), or `''`. */
  actionBlockedReason: string;
  /** Why `recordAction` cannot be sent while the campaign is in its current state, or `''`. */
  recordActionBlockedReason: string;
  /**
   * What the budget cell says when `budget` is `null`, which is NOT proof the ad set has no budget:
   * the amount, the type or the currency's minor-unit scale may simply be unreported. `''` when
   * `budget` is set.
   */
  budgetNote: string;
}

/** One ad as the ad-set panel's Ads section renders it (`toMetaAdDisplayRow`). Read-only: no action. */
export interface MetaAdDisplayRow {
  id: string;
  /** The ad's name, or its id when Meta reported none. */
  name: string;
  listed: boolean;
  /** Meta's configured status, or `null` when not reported. */
  status: string | null;
  /** The effective status when it differs from the configured one (e.g. ADSET_PAUSED), else `null`. */
  effectiveStatus: string | null;
  /** The creative's name, else its id, else what is missing. */
  creative: string;
  /** Counters, or `null` when the wire value is not a finite number. */
  impressions: number | null;
  clicks: number | null;
  /** A fraction (clicks / impressions). */
  ctr: number | null;
  /** Whole units of the read's currency (`cost_micros / 1e6`). */
  spend: number | null;
}

/**
 * A display row as the ad-set panel binds it: the ids each action's `aria-describedby` points at,
 * or `null`, and whether the row's read-only Ads section is expanded.
 */
export interface MetaAdSetPanelRow extends MetaAdSetDisplayRow {
  actionDescribedBy: string | null;
  recordActionDescribedBy: string | null;
  adsExpanded: boolean;
}

/**
 * Which ad-set directions campaign-service accepts for a campaign in its current state, mirroring
 * `ToggleMetaAdSetStatus`: any change on a toggleable campaign (`created`, `active`, `paused`), and
 * only a PAUSE on a `created_degraded` one (it needs reconciliation, so nothing may be switched on
 * beneath it). Every other state refuses both (409). `reason` explains a refused direction, or `''`.
 */
export interface MetaAdSetCampaignEligibility {
  pause: boolean;
  resume: boolean;
  reason: string;
}

/** How a lever reports an outcome it cannot confirm: its own error code and fixed client message. */
export interface CampaignLeverUnconfirmedOutcome {
  code: string;
  message: string;
  /** Matched against an ANSWERED 503's message; a match means the write may have reached the platform. */
  marker: RegExp;
}

// ---------------------------------------------------------------------------
// Live-settings drift, act-from-monitor and adoption (lfx-self-serve#3299)
// ---------------------------------------------------------------------------

/** How the drift drawer styles a verdict; the `lfx-tag` severities it uses. */
export type CampaignSettingsVerdictSeverity = 'success' | 'warn' | 'secondary';

/**
 * One setting as the live-settings drawer renders it: the readback's field with display-ready sides.
 * `intended` and `live` are `null` when that side is ABSENT from the readback, never an empty string
 * or a zero, so the drawer can say "not recorded" / "not reported" instead of inventing a value.
 */
export interface CampaignSettingsDriftRow {
  field: string;
  label: string;
  /** What the campaign row recorded (what LFX One asked for), or `null` when it records nothing. */
  intended: string | null;
  /** What the platform holds now, or `null` when the platform did not report it. */
  live: string | null;
  comparison: CampaignSettingsComparison;
  verdictLabel: string;
  verdictSeverity: CampaignSettingsVerdictSeverity;
  /** Why an `unknown` verdict is unknown; `''` for `match` and `diverged`. */
  note: string;
}

/** The drawer's view of one readback: its rows plus the counts the header states. */
export interface CampaignSettingsDrift {
  platform: string;
  readAt: string;
  rows: CampaignSettingsDriftRow[];
  divergedCount: number;
  matchCount: number;
  unknownCount: number;
}

/** A brief as the Query Service indexes it (`campaign_brief`). Only the fields the adopt picker reads. */
export interface CampaignServiceBriefIndexDoc {
  id: string;
  project_id?: string;
  program_type?: string;
  event_slug?: string;
  /** ABSENT on a document indexed before the field existed, which means `paid-marketing`. */
  delivery_type?: string;
  stage?: string;
  url?: string;
  status?: string;
  version?: number;
  platforms?: string[];
}

/** One brief a campaign can be adopted into: approved and paid-marketing. */
export interface CampaignAdoptableBrief {
  id: string;
  eventSlug: string;
  programType: string;
  platforms: string[];
}

/** Response of `GET /api/campaigns/briefs?project=`. */
export interface CampaignAdoptableBriefsResponse {
  briefs: CampaignAdoptableBrief[];
}

/** The platforms whose Monitor rows offer actions: each has a campaign-ref resolve and adoption. */
export type CampaignMonitorActPlatform = 'linkedin-ads' | 'reddit-ads' | 'meta-ads' | 'microsoft-ads' | 'twitter-ads';

/** The lever a Monitor row action opens. */
export type CampaignMonitorActLever = 'pause_resume' | 'budget' | 'bid';

/** `DialogService` data of the act-from-monitor dialog. */
export interface CampaignActDialogData {
  projectSlug: string;
  platform: CampaignMonitorActPlatform;
  /** The platform's own campaign id, as the Monitor row carries it. */
  platformCampaignId: string;
  campaignName: string;
  lever: CampaignMonitorActLever;
}

/** What the act dialog closes with: a request to adopt the unmanaged campaign, or nothing. */
export interface CampaignActDialogResult {
  adopt: true;
}

/** `DialogService` data of the adopt dialog. A Monitor platform: adoptable, and resolvable to check an unconfirmed adoption. */
export interface CampaignAdoptDialogData {
  projectSlug: string;
  platform: CampaignMonitorActPlatform;
  platformCampaignId: string;
  campaignName: string;
}

/** Where the act dialog is: resolving the id, refusing, or holding the one campaign it resolved to. */
export type CampaignActDialogState = 'resolving' | 'resolve-failed' | 'unowned' | 'ambiguous' | 'loading-record' | 'record-failed' | 'ready';

/** A failed adoption, classified for the dialog. `unconfirmed` may already have been recorded. */
export interface CampaignAdoptFailure {
  state: 'failed' | 'unconfirmed';
  title: string;
  message: string;
  /** campaign-service's own sentence, shown under the mapped message when it adds a reason. */
  detail: string;
}

/** The live-settings drawer's read: nothing asked yet, in flight, answered, or refused. */
export interface CampaignSettingsDrawerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  drift: CampaignSettingsDrift | null;
  /** What to show for `error`; `''` otherwise. */
  message: string;
}

/** The adopt dialog's brief picker read. */
export interface CampaignAdoptBriefsState {
  status: 'loading' | 'ready' | 'error';
  briefs: CampaignAdoptableBrief[];
  /** What to show for `error`; `''` otherwise. */
  message: string;
}

/** One entry of the adopt dialog's brief select. */
export interface CampaignAdoptBriefOption {
  label: string;
  value: string;
}

/**
 * What a campaign-ref answer may be acted on as. `unexpected` is an answer that contradicts itself
 * (a count that differs from the list, another id echoed back, a malformed match): it names no
 * campaign the operator asked about, so nothing is done on its strength.
 */
export type CampaignRefVerdict =
  | { kind: 'none' }
  | { kind: 'one'; match: CampaignServiceCampaignRef }
  | { kind: 'several'; count: number }
  | { kind: 'unexpected' };

/**
 * An adoption kept per (project, platform, platform campaign id) beyond the dialog that sent it:
 * `pending` while the write is in flight, `unconfirmed` once it ended without an answer anyone could
 * trust, `adopted` once it succeeded but no dialog has shown that yet. Every state locks Adopt for that
 * campaign; `adopted` is cleared by the dialog that shows it.
 */
export interface CampaignAdoptionInFlight {
  state: 'pending' | 'unconfirmed' | 'adopted';
  /** The brief the adoption was sent for: a check confirms it only on a match bound to THIS brief. */
  briefId: string;
  /** For `unconfirmed`: what the dialog shows. */
  failure: CampaignAdoptFailure | null;
  /** For `adopted`: when the success landed (ISO 8601). */
  adoptedAt?: string;
}
