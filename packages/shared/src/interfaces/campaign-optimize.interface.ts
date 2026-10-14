// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TWITTER_AUDIENCE_WINDOWS } from '../constants/campaign-optimize.constants';
import type {
  CampaignMetricsWindow,
  CampaignServiceCampaign,
  CampaignServiceCampaignRef,
  CampaignServiceMicrosoftKeywords,
  MicrosoftKeywordMetricsResponse,
  MicrosoftKeywordsWindow,
} from './campaign.interface';

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

/** `keyword-targeting`: the positive keywords of a Reddit ad group or X line item, read live. */
export interface CampaignServiceKeywordTargeting {
  campaign_id: string;
  platform: 'reddit-ads' | 'twitter-ads';
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

/** A platform whose campaign-ref resolve the BFF exposes. */
export type CampaignRefPlatform = 'meta-ads' | 'reddit-ads' | 'twitter-ads' | 'linkedin-ads';

/** The reporting windows the Reddit keyword read accepts (provisionally the Microsoft set). */
export type RedditKeywordsWindow = MicrosoftKeywordsWindow;

/**
 * PROVISIONAL: campaign-service has no Reddit keyword read yet. Typed on the Microsoft keyword
 * read it is meant to mirror (`get-microsoft-ads-keywords`); re-check against the published
 * design before `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is turned on.
 */
export type CampaignServiceRedditKeywords = CampaignServiceMicrosoftKeywords;

/** Response of `GET /api/campaigns/reddit/keywords`: the Microsoft keyword table's shape. */
export type RedditKeywordMetricsResponse = MicrosoftKeywordMetricsResponse;

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

/**
 * Response of `GET /api/campaigns/:campaignId/record?project=&briefId=`: the campaign row read from
 * campaign-service itself (not the asynchronous index), with its CURRENT ETag, plus whether this
 * deployment can service a pause/resume (`CampaignListResult.statusToggleEnabled`).
 */
export interface CampaignRecordResult {
  campaign: CampaignServiceCampaign;
  statusToggleEnabled: boolean;
}

/** The platforms whose Monitor rows offer actions: each has a campaign-ref resolve and adoption. */
export type CampaignMonitorActPlatform = 'linkedin-ads' | 'reddit-ads' | 'meta-ads';

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
