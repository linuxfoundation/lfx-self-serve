// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignAdoptPlatform,
  CampaignAudiencePlatform,
  CampaignLeverUnconfirmedOutcome,
  CampaignMonitorActLever,
  CampaignMonitorActPlatform,
  CampaignRefPlatform,
  CampaignSettingsComparison,
  CampaignSettingsVerdictSeverity,
  KeywordTargetingPlatform,
  KeywordTargetingRemovalOutcome,
  MetaAdSetStatus,
  PlatformAudienceErrorKind,
  PlatformAudiencePanelPlatform,
  PlatformAudiencePlatformOption,
  PlatformAudienceWindowOption,
  RedditKeywordsWindow,
  RedditKeywordsWindowOption,
} from '../interfaces/campaign-optimize.interface';
import type { CampaignMetricsWindow } from '../interfaces/campaign.interface';
import { CAMPAIGN_METRICS_WINDOWS, isCanonicalPositiveInt64, MICROSOFT_KEYWORDS_WINDOWS } from './campaign.constants';

// ---------------------------------------------------------------------------
// Optimize-tab reads and levers proxied to lfx-v2-campaign-service
// ---------------------------------------------------------------------------

/**
 * The reporting windows X accepts for its audience read (`twitterAudienceWindowEnum`,
 * campaign-service `design/brief.go`). X serves segmented stats through asynchronous jobs capped at
 * seven days, so every longer window is refused upstream with a 400.
 */
export const TWITTER_AUDIENCE_WINDOWS = ['today', 'yesterday', 'last_7_days'] as const;

/**
 * The reporting windows the Reddit audience read accepts (`redditAudienceWindowEnum`). The same set
 * as Microsoft's: `yesterday` and `last_14_days` are not available on Reddit.
 */
export const REDDIT_AUDIENCE_WINDOWS = MICROSOFT_KEYWORDS_WINDOWS;

/**
 * The reporting windows the LinkedIn audience read accepts (`linkedInAudienceWindowEnum`,
 * campaign-service `design/linkedin_audience.go`): the windows the LinkedIn metrics read maps to an
 * explicit Ad Analytics date range. `yesterday` and `last_14_days` are refused upstream.
 */
export const LINKEDIN_AUDIENCE_WINDOWS = ['today', 'last_7_days', 'last_30_days', 'this_month', 'last_month'] as const;

/**
 * Every per-platform audience read the BFF proxies, mapped to the windows that platform's
 * campaign-service read accepts. The keys are campaign-service's own platform path segments.
 *
 * Google Ads is absent on purpose: its audience read is `GET /api/campaigns/audience`, owned by the
 * Insights cutover and not by this table.
 */
export const CAMPAIGN_AUDIENCE_WINDOWS: Readonly<Record<CampaignAudiencePlatform, readonly string[]>> = {
  'meta-ads': CAMPAIGN_METRICS_WINDOWS,
  'twitter-ads': TWITTER_AUDIENCE_WINDOWS,
  'microsoft-ads': MICROSOFT_KEYWORDS_WINDOWS,
  'reddit-ads': REDDIT_AUDIENCE_WINDOWS,
  'linkedin-ads': LINKEDIN_AUDIENCE_WINDOWS,
};

/**
 * Audience reads whose campaign-service endpoint is not on campaign-service `main` yet; the BFF
 * answers 404 for these unless `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on, so no deployment calls a
 * route upstream does not serve. Empty: every audience read is published (Reddit's
 * `get-reddit-ads-audience` in campaign-service #306, LinkedIn's in #314) and served ungated. Kept so
 * a future read can be wired before its endpoint lands.
 */
export const CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignAudiencePlatform> = new Set<CampaignAudiencePlatform>([]);

/**
 * The `code`s and fixed messages a failed audience read answers with. campaign-service's own
 * sentence is never relayed: the BFF maps each answered status to one of these, so the UI can
 * branch on `code` and nothing upstream wrote reaches the browser.
 */
export const CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE = 'CAMPAIGN_AUDIENCE_NO_CONNECTION';
export const CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE = 'This project has no connection for this ad platform, so its audience cannot be read.';
/**
 * Every answered 409 on an audience read. campaign-service answers 409 for several unrelated
 * reasons (a campaign created under another ad account, one that does not record its account, a
 * malformed stored campaign id, more campaigns than the read covers) and its `conflict-error`
 * carries no `reason` for any of them, so the BFF cannot say which. The message names them all;
 * campaign-service's own sentence is logged at DEBUG.
 */
export const CAMPAIGN_AUDIENCE_CONFLICT_CODE = 'CAMPAIGN_AUDIENCE_CONFLICT';
export const CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE =
  "These campaigns can't be read together: a campaign was created under another ad account or doesn't record its account, a stored campaign id is malformed, or the project has more campaigns than this read covers.";
export const CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE = 'CAMPAIGN_AUDIENCE_UNAVAILABLE';
export const CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE =
  'The ad platform did not confirm the audience read (it may be rate-limited or unreachable), so nothing is shown rather than a partial picture. Try again in a few minutes.';
export const CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE = 'CAMPAIGN_AUDIENCE_NOT_ENABLED';
export const CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE =
  "Audience insights for this ad platform are not available: they are not enabled in this environment, or the project's connection is inactive or has no ad account selected.";
/**
 * The most characters of campaign-service's own sentence the BFF logs (at DEBUG) when it answers an
 * upstream 400 or 409 on an audience read with one fixed message (`CAMPAIGN_AUDIENCE_NOT_ENABLED`,
 * `CAMPAIGN_AUDIENCE_CONFLICT`). Bounded like the other upstream-text log lines; the logger's field
 * scrubber still applies to it.
 */
export const CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH = 300;

/** Every other failure (an auth refusal, a server error, a read nobody answered); the code stays the status's. */
export const CAMPAIGN_AUDIENCE_FAILED_MESSAGE = 'The audience read failed. Try again.';

/**
 * The id rule each campaign-ref resolve applies to a platform's own campaign id, mirrored from
 * campaign-service's `localCampaignRefMethod` calls (`design/connection.go`). The id is a query
 * parameter upstream, so this refuses early what upstream would refuse with a 400.
 *
 * Google Ads is absent: its resolve is internal to the keyword actions and has no BFF route.
 * LinkedIn's is the decoder Pattern of `resolve-linkedin-ads-campaign` and Microsoft's that of
 * `resolve-microsoft-ads-campaign` (each a positive int64 with no leading zero; upstream also refuses
 * one past int64 with 400).
 */
export const CAMPAIGN_REF_ID_PATTERNS: Readonly<Record<CampaignRefPlatform, RegExp>> = {
  'meta-ads': /^[1-9][0-9]{0,31}$/,
  'reddit-ads': /^[A-Za-z0-9_]{1,64}$/,
  'twitter-ads': /^[A-Za-z0-9]{1,64}$/,
  'linkedin-ads': /^[1-9][0-9]{0,18}$/,
  'microsoft-ads': /^[1-9][0-9]{0,18}$/,
};

/** The campaign-ref platforms whose ids are int64 upstream, so must also be within its range. */
export const CAMPAIGN_REF_INT64_PLATFORMS: ReadonlySet<CampaignRefPlatform> = new Set<CampaignRefPlatform>(['linkedin-ads', 'microsoft-ads']);

/**
 * Whether a platform campaign id passes the campaign-ref resolve's id rule. The pattern is the shape;
 * LinkedIn's and Microsoft's ids must also be within int64 (upstream refuses one past 9223372036854775807 with 400),
 * which a regex states badly, so that range is checked arithmetically.
 */
export function isValidCampaignRefId(platform: CampaignRefPlatform, value: unknown): boolean {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(CAMPAIGN_REF_ID_PATTERNS, platform)) {
    return false;
  }
  if (!CAMPAIGN_REF_ID_PATTERNS[platform].test(value)) {
    return false;
  }
  return CAMPAIGN_REF_INT64_PLATFORMS.has(platform) ? isCanonicalPositiveInt64(value) : true;
}

/**
 * Campaign-ref resolves whose campaign-service endpoint is not on `main` yet; 404 unless
 * `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on. Empty since LinkedIn's resolve shipped
 * (campaign-service #318); kept so the next platform can be wired behind the same gate.
 */
export const CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignRefPlatform> = new Set<CampaignRefPlatform>();

/**
 * The reporting windows `get-reddit-ads-keywords` accepts (campaign-service #331): the Reddit
 * metrics read's ranges, the same set as the Microsoft keyword read. `yesterday` and
 * `last_14_days` are refused upstream with 400.
 */
export const REDDIT_KEYWORDS_WINDOWS = MICROSOFT_KEYWORDS_WINDOWS;

/**
 * The platforms the BFF lets a caller ADOPT an existing campaign on. campaign-service's
 * `adopt-campaign` also accepts `google-ads`; that is left to the Google Ads owner and refused here
 * until they wire it. LinkedIn joined with campaign-service #318.
 */
export const CAMPAIGN_ADOPT_PLATFORMS: ReadonlySet<CampaignAdoptPlatform> = new Set<CampaignAdoptPlatform>([
  'microsoft-ads',
  'meta-ads',
  'reddit-ads',
  'twitter-ads',
  'linkedin-ads',
]);

/**
 * A platform's own campaign id as `adopt-campaign` accepts it: 1-64 characters (`MinLength(1)`,
 * `MaxLength(64)`). Upstream validates each platform's own shape and names the reason in its 400;
 * this only refuses what upstream would refuse on length or what cannot be a platform id at all.
 */
export const ADOPT_PLATFORM_CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A Meta ad set id: digits with no leading zero, at most 32 (the `ad_set_id` `Pattern` and
 * `MaxLength` of `toggle-meta-ad-set-status`). It is interpolated into the upstream path, so it is
 * checked here as well as upstream.
 */
export const META_AD_SET_ID_PATTERN = /^[1-9][0-9]{0,31}$/;

/** The ad-set statuses `toggle-meta-ad-set-status` accepts, in Meta's own vocabulary. */
export const META_AD_SET_STATUSES: ReadonlySet<MetaAdSetStatus> = new Set<MetaAdSetStatus>(['ACTIVE', 'PAUSED']);

/** Most keywords one `remove-keyword-targeting` request may name (the payload's `MaxLength(20)`). */
export const MAX_KEYWORD_TARGETING_REMOVALS = 20;

/** Longest Reddit keyword a removal may name, in characters (`KeywordTargetingRemovalInput.keyword` `MaxLength(200)`). */
export const MAX_KEYWORD_TARGETING_KEYWORD_LENGTH = 200;

/** Longest Reddit targeting `revision` a removal may carry (`MaxLength(128)`). */
export const MAX_KEYWORD_TARGETING_REVISION_LENGTH = 128;

/**
 * An X targeting criterion id: base-36 alphanumerics, at most 32 (`criterion_id` `Pattern` and
 * `MaxLength`). Interpolated into an upstream DELETE path, so it is checked here as well.
 */
export const X_TARGETING_CRITERION_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/;

/**
 * The `code` the BFF answers when an ad-set status change may or may not have reached Meta: an
 * answered campaign-service 503 whose message says the change is unconfirmed, or a failure nobody
 * answered (timeout, lost connection, gateway error page). Distinct from `SERVICE_UNAVAILABLE`, which
 * a DEFINITE failure keeps, so the UI can tell "retry" from "read the ad sets first".
 */
export const META_AD_SET_STATUS_UNCONFIRMED_CODE = 'META_AD_SET_STATUS_UNCONFIRMED';

/** What the BFF says alongside `META_AD_SET_STATUS_UNCONFIRMED_CODE`. */
export const META_AD_SET_STATUS_OUTCOME_UNCONFIRMED =
  'The ad set status change could not be confirmed and may or may not have been applied. Reload the ad sets to verify before retrying.';

/**
 * The `code` the BFF answers when an ad-set status change is CONFIRMED on Meta but campaign-service
 * could not confirm whether it recorded (after a pause) or cleared (after a resume) the deliberate
 * pause on the campaign row. The caller knows which from the status it sent. campaign-service's
 * answered 503 says the record "could not be confirmed" and asks for `deliberately_paused` to be
 * re-read. A campaign resume reads that record, so the operator must check it before resuming.
 */
export const META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE = 'META_AD_SET_PAUSE_RECORD_UNCONFIRMED';

/** What the BFF says alongside `META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE`. */
export const META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED =
  "The ad set's status on Meta is as requested, but whether the campaign's deliberate-pause record was updated could not be confirmed. Reload the ad sets and check Deliberately paused before resuming the campaign.";

/**
 * Matched against an answered 503 AFTER `META_AD_SET_STATUS_UNCONFIRMED_OUTCOME`'s marker missed:
 * campaign-service's `adSetRecordErr` says "... could not be confirmed: read the ad sets
 * (deliberately_paused) ...". No definite 503 on that route uses those words.
 */
export const META_AD_SET_PAUSE_RECORD_UNCONFIRMED_MARKER = /\bcould not be confirmed\b/i;

/**
 * The `code` the BFF answers when a keyword-targeting removal may or may not have been applied: an
 * answered 503 whose message says the removals are unconfirmed, or a failure nobody answered.
 */
export const KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE = 'KEYWORD_TARGETING_REMOVAL_UNCONFIRMED';

/** What the BFF says alongside `KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE`. */
export const KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED =
  'The keyword removal could not be confirmed and may or may not have been applied. Reload the keyword targeting to verify before retrying.';

/**
 * How the BFF classifies a failed ad-set status change. campaign-service's words for a toggle that
 * may have reached Meta are "is unconfirmed — it may or may not have been applied" and "status was
 * changed on Meta, but verifying the campaign row failed"; every other answered 503 on that route
 * says "nothing was changed" (so never match a bare "was changed") and is a definite failure.
 */
export const META_AD_SET_STATUS_UNCONFIRMED_OUTCOME: CampaignLeverUnconfirmedOutcome = {
  code: META_AD_SET_STATUS_UNCONFIRMED_CODE,
  message: META_AD_SET_STATUS_OUTCOME_UNCONFIRMED,
  marker: /\bunconfirmed\b|\bstatus was changed\b/i,
};

/** How the BFF classifies a failed keyword removal: the unconfirmed arm says "are unconfirmed", the definite one "could not be removed". */
export const KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_OUTCOME: CampaignLeverUnconfirmedOutcome = {
  code: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  message: KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
  marker: /\bunconfirmed\b/i,
};

/**
 * What an adopt reports when no campaign-service answer came back. The campaign row may have been
 * written, so the caller is told to reload the campaign list rather than adopt again (a second
 * adopt of a bound campaign is a 409, not a duplicate, but the operator should not have to learn
 * that from an error).
 */
export const CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED =
  'The campaign adoption could not be confirmed and may already have been recorded. Reload the campaign list before retrying.';

/** The `code` for a write refused because the caller's ETag is stale (upstream 412). */
export const CAMPAIGN_ETAG_STALE_CODE = 'PRECONDITION_FAILED';

/** What the BFF says for a stale ETag. Nothing was changed. */
export const CAMPAIGN_ETAG_STALE_MESSAGE = 'This campaign changed since it was loaded, and nothing was changed. Reload it and try again.';

/** The `code` for a write that reached upstream without an ETag (upstream 428). */
export const CAMPAIGN_ETAG_REQUIRED_CODE = 'PRECONDITION_REQUIRED';

/** What the BFF says when upstream required an ETag it did not receive. Nothing was changed. */
export const CAMPAIGN_ETAG_REQUIRED_MESSAGE =
  'This change requires the campaign version it was made against, and nothing was changed. Reload it and try again.';

// ---------------------------------------------------------------------------
// Live-settings drift drawer (`GET /api/campaigns/:campaignId/settings`)
// ---------------------------------------------------------------------------

/**
 * Readable names for the settings readback's field vocabulary (campaign-service `campaign-settings-field`).
 * The vocabulary is per platform and may grow, so a field missing here is rendered under its own
 * name rather than dropped.
 */
export const CAMPAIGN_SETTINGS_FIELD_LABELS: Readonly<Record<string, string>> = {
  budget_amount: 'Budget amount',
  budget_type: 'Budget type',
  campaign_name: 'Campaign name',
  advertising_channel_type: 'Channel type',
  start_date: 'Start date',
  end_date: 'End date',
  status: 'Delivery status',
  budget_delivery_method: 'Budget delivery',
  budget_explicitly_shared: 'Shared budget',
  bidding_strategy_type: 'Bid strategy',
  cost_type: 'Cost type',
  unit_cost: 'Bid',
  unit_cost_currency: 'Bid currency',
  objective_type: 'Objective',
  is_campaign_budget_optimization: 'Campaign budget optimization',
  budget_optimization: 'Budget optimization',
};

/**
 * LinkedIn's bid amount and its currency arrive as two upstream-only fields. The drawer shows the
 * amount WITH its currency in one row, because a LinkedIn bid without its currency is not a bid:
 * an adopted campaign may bid in EUR, and campaign-service omits the amount when no currency came back.
 */
export const CAMPAIGN_SETTINGS_BID_AMOUNT_FIELD = 'unit_cost';
export const CAMPAIGN_SETTINGS_BID_CURRENCY_FIELD = 'unit_cost_currency';

/** The verdict tag's text. `unknown` is never shown as a match. */
export const CAMPAIGN_SETTINGS_VERDICT_LABELS: Readonly<Record<CampaignSettingsComparison, string>> = {
  match: 'Matches',
  diverged: 'Differs',
  unknown: 'Not compared',
};

export const CAMPAIGN_SETTINGS_VERDICT_SEVERITIES: Readonly<Record<CampaignSettingsComparison, CampaignSettingsVerdictSeverity>> = {
  match: 'success',
  diverged: 'warn',
  unknown: 'secondary',
};

/** Why an `unknown` setting was not compared, by which side is missing. */
export const CAMPAIGN_SETTINGS_UNKNOWN_NOTES = {
  liveOnly: 'LFX One records no value for this setting, so the live value is shown but not compared.',
  notReported: 'The platform did not report this setting, so it could not be compared.',
  neither: 'Neither LFX One nor the platform has a value for this setting.',
  both: 'Both values are shown, but they cannot be compared reliably (for example, a start date the platform moved forward at launch).',
} as const;

/** Under the counts: `unknown_count` has a floor on every healthy read and is not a failure count. */
export const CAMPAIGN_SETTINGS_UNKNOWN_COUNT_NOTE =
  'Some settings are never compared, because LFX One does not record them. "Not compared" is not a read failure.';

/** What the drawer says when the readback is refused, by status. */
export const CAMPAIGN_SETTINGS_READ_ERRORS: Readonly<Record<number, string>> = {
  400: 'Live settings are not available for this platform.',
  403: 'You do not have permission to read this campaign.',
  404: 'The platform holds no such campaign (it may have been deleted there), or this project has no connection for its channel.',
  500: 'The live settings could not be read because of a connection problem an administrator must fix.',
  503: 'The platform could not be reached, or answered with something LFX One could not trust. Nothing was changed; try again.',
};

/** A 409's fallback when the response carried no readable reason. */
export const CAMPAIGN_SETTINGS_READ_CONFLICT_FALLBACK =
  'The live settings cannot be compared for this campaign: it was not created on its platform, or it belongs to a different ad account than this project now uses.';

export const CAMPAIGN_SETTINGS_READ_FALLBACK = 'The live settings could not be read. Nothing was changed; try again.';

// ---------------------------------------------------------------------------
// Live counters (one campaign's get-campaign-metrics read, on demand)
// ---------------------------------------------------------------------------

/** The email channel's platform token on a campaign row: its live counters are opens to date, with no cost. */
export const CAMPAIGN_EMAIL_CHANNEL_PLATFORM = 'hubspot';

/**
 * Platforms whose metrics read reports cost in USD whatever the ad account bills in: LinkedIn, whose
 * Ad Analytics `costInUsd` campaign-service converts to micros. Every other platform reports the ad
 * account's own currency (Google Ads, Meta, Microsoft, Reddit's "microcurrency", X's
 * `billed_charge_local_micro`), which the read does not name.
 */
export const CAMPAIGN_USD_COST_PLATFORMS: ReadonlySet<string> = new Set(['linkedin-ads']);

/** The live cost counter's label, by what the platform's read reports cost in. */
export const CAMPAIGN_LIVE_COST_LABELS = {
  usd: 'Cost (USD)',
  account: 'Cost (ad account currency)',
} as const;

/** The window a row's live counters cover, in words, keyed by campaign-service's `window`. */
export const CAMPAIGN_LIVE_METRICS_WINDOW_PHRASES: Readonly<Record<CampaignMetricsWindow, string>> = {
  today: 'today',
  yesterday: 'yesterday',
  last_7_days: 'the last 7 days',
  last_14_days: 'the last 14 days',
  last_30_days: 'the last 30 days',
  this_month: 'this month',
  last_month: 'last month',
};

/**
 * Upstream's 400: no metrics read is wired for the campaign's platform. Not a failure, so it is shown
 * as a property of the row and offers no retry.
 */
export const CAMPAIGN_LIVE_METRICS_UNSUPPORTED_MESSAGE = 'Live counters are not available for this platform.';

/**
 * What a row says when its live counters read is refused, by status. A 404 is either campaign-service
 * (no connection for the channel) or this BFF (the read is not served while campaign-service briefs
 * are off); the sentence covers both.
 */
export const CAMPAIGN_LIVE_METRICS_READ_ERRORS: Readonly<Record<number, string>> = {
  403: 'You do not have permission to read this campaign.',
  404: "Live counters are not available here: this project has no connection for the campaign's channel, or this deployment does not serve them.",
  500: 'The live counters could not be read because of a connection problem an administrator must fix.',
  503: 'The platform could not be reached, or answered with something LFX One could not trust. Try again.',
};

/** A 409's fallback when the response carried no readable reason. */
export const CAMPAIGN_LIVE_METRICS_READ_CONFLICT_FALLBACK =
  'The live counters cannot be read for this campaign: it is not created on its platform yet, reported no data for the window, or belongs to a different ad account than this project now uses.';

export const CAMPAIGN_LIVE_METRICS_READ_FALLBACK = 'The live counters could not be read. Try again.';

// ---------------------------------------------------------------------------
// Act from Monitor
// ---------------------------------------------------------------------------

/**
 * The Monitor tables whose rows offer actions: LinkedIn, Reddit, Meta, Microsoft Ads and X (Google Ads
 * is another owner's lane). X shares Microsoft's report-backed panel. Its rows are adopted ones, since X
 * create is off, so the act dialog withholds Resume (`PAUSE_ONLY_CAMPAIGN_PLATFORMS`) and offers a
 * daily budget only (`DAILY_ONLY_BUDGET_CAMPAIGN_PLATFORMS`).
 */
export const CAMPAIGN_MONITOR_ACT_PLATFORMS: ReadonlySet<CampaignMonitorActPlatform> = new Set<CampaignMonitorActPlatform>([
  'linkedin-ads',
  'reddit-ads',
  'meta-ads',
  'microsoft-ads',
  'twitter-ads',
]);

/** The act dialog's header per lever, and the Monitor row button's visible text. */
export const CAMPAIGN_MONITOR_ACT_LEVER_LABELS: Readonly<Record<CampaignMonitorActLever, string>> = {
  pause_resume: 'Pause or resume',
  budget: 'Budget',
  bid: 'Bid',
};

/** The resolve route answered 404: this deployment does not serve the platform's campaign-ref yet. */
export const CAMPAIGN_ACT_RESOLVE_UNAVAILABLE_MESSAGE = "Acting on this platform's campaigns from Monitor is not available in this deployment yet.";

/** The resolve route refused the id (400). */
export const CAMPAIGN_ACT_RESOLVE_INVALID_ID_MESSAGE = 'This campaign id is not in the format the platform uses, so LFX One cannot look it up.';

/** Any other failed resolve. Nothing was written: the resolve is a read of LFX One's own records. */
export const CAMPAIGN_ACT_RESOLVE_FAILED_MESSAGE = 'LFX One could not look up this campaign. Nothing was changed; try again.';

/** The lookup answered with something that contradicts itself (count vs. list, another id echoed back). */
export const CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE =
  'LFX One got an answer it could not trust while looking up this campaign, so nothing was changed. Try again.';

/** No match: the project owns no campaign with this platform id. */
export const CAMPAIGN_ACT_UNOWNED_MESSAGE =
  'LFX One does not manage this campaign, so it cannot be changed from here. Adopt it into an approved brief to manage it in LFX One.';

/**
 * More than one match: refused, never chosen. Reachable on Reddit and X, whose binding indexes
 * (campaign-service 000045/000046) allow one live row per (id, ad account), so a connection re-pointed
 * between accounts leaves two; Meta's and LinkedIn's global indexes keep a valid database to one, but
 * any count above one is still refused. Picking one would change a campaign nobody named.
 */
export const CAMPAIGN_ACT_AMBIGUOUS_MESSAGE =
  'This campaign id matches more than one campaign in LFX One, so no action was taken: LFX One will not guess which one you mean. Change it from the Optimize tab of the brief it belongs to, or in the ad platform.';

/** The one match resolved, but its campaign record could not be read. */
export const CAMPAIGN_ACT_RECORD_FAILED_MESSAGE = 'LFX One found this campaign but could not read its current state. Nothing was changed; try again.';

/**
 * The foundation changed while the act or adopt dialog was open, so the next dialog is not opened:
 * it would resolve the campaign against the project now selected, not the one it came from.
 */
export const CAMPAIGN_ACT_FOUNDATION_CHANGED_MESSAGE =
  'You switched foundations while this was open, so LFX One did not continue with this campaign. Switch back to that foundation to act on it.';

/** Shown beside a Resume: campaign-service refuses to activate an adopted campaign on every platform. */
export const CAMPAIGN_ACT_RESUME_ADOPTED_NOTE =
  "A campaign adopted into LFX One cannot be resumed from here; resume it in the ad platform's own UI. Pausing always works.";

/**
 * The BFF's `code` for a resume that campaign-service refused with 409 for a reason it did not name
 * as adoption. The UI branches on this code, never on the wording.
 *
 * Besides adoption, campaign-service answers a resume with 409 when the campaign is not fully
 * provisioned for another reason, a Meta ad set paused on purpose is running again, the campaign is
 * under another ad account, or another write holds its lock. A service deployed before
 * `reason: "campaign_adopted"` (lfx-v2-campaign-service#366) also refuses an adopted campaign this
 * way, so the message (`campaignResumeRefusedMessage`) states the adoption case as a condition and
 * keeps campaign-service's own sentence for the others.
 */
export const CAMPAIGN_RESUME_REFUSED_CODE = 'CAMPAIGN_RESUME_REFUSED';

/**
 * The BFF's `code` for a resume campaign-service refused because the campaign was ADOPTED: its 409
 * carries `reason: "campaign_adopted"` (lfx-v2-campaign-service#366). The message
 * (`campaignResumeRefusedAdoptedMessage`) says so without hedging.
 */
export const CAMPAIGN_RESUME_REFUSED_ADOPTED_CODE = 'CAMPAIGN_RESUME_REFUSED_ADOPTED';

/** campaign-service's `reason` on the 409 that refuses to resume an adopted campaign. Matched exactly; the message text is never read. */
export const CAMPAIGN_ADOPTED_REFUSAL_REASON = 'campaign_adopted';

/**
 * Why an ADOPTED campaign cannot be resumed from LFX One, naming its platform. Shown beside the
 * unavailable Resume of a row campaign-service marks `adopted: true`, and inside
 * `campaignResumeRefusedAdoptedMessage`.
 */
export function campaignResumeAdoptedReason(platformLabel: string): string {
  return `This campaign was adopted from ${platformLabel}, so LFX One can pause it but not resume it — resume it in ${platformLabel} itself.`;
}

/** The message for `CAMPAIGN_RESUME_REFUSED_ADOPTED`: the resume was refused because the campaign was adopted. */
export function campaignResumeRefusedAdoptedMessage(platformLabel: string): string {
  return `Could not resume this campaign; it is still paused. ${campaignResumeAdoptedReason(platformLabel)}`;
}

/**
 * Why a resume was refused (409), naming the platform where an adopted campaign is resumed.
 * It does not say a retry is futile: one of those 409s (another write in progress) clears on retry.
 * `reason` is campaign-service's own sentence, kept for the refusals that are not about adoption.
 */
export function campaignResumeRefusedMessage(platformLabel: string, reason?: string): string {
  const adopted = `Could not resume this campaign; it is still paused. If it was adopted from ${platformLabel}, LFX One can pause it but not resume it — resume it in ${platformLabel} itself.`;
  const trimmed = reason?.trim();
  return trimmed ? `${adopted} Otherwise, the reason given was: ${trimmed}` : adopted;
}

/**
 * Shown beside a Meta Resume. campaign-service keeps an ad set paused on purpose PAUSED through a
 * campaign resume, and refuses the resume (409) when Meta reports that ad set ACTIVE.
 */
export const CAMPAIGN_ACT_META_RESUME_NOTE =
  'On Meta, a resume is refused while an ad set you paused on purpose is running again. Pause or resume that ad set first, then resume the campaign.';

/** The record carried no ETag, so a write would be refused (428). */
export const CAMPAIGN_ACT_NO_ETAG_MESSAGE = "This campaign's version could not be read, so it cannot be changed safely. Reload it and try again.";

// ---------------------------------------------------------------------------
// Adopt dialog
// ---------------------------------------------------------------------------

/** The briefs route answered 404 (briefs are not served by campaign-service in this deployment). */
export const CAMPAIGN_ADOPT_BRIEFS_UNAVAILABLE_MESSAGE = 'Adopting campaigns is not available in this deployment.';

export const CAMPAIGN_ADOPT_BRIEFS_FAILED_MESSAGE = 'The approved briefs could not be loaded. Try again.';

export const CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE = 'This project has no approved paid-marketing brief to adopt into. Approve a brief on the Plan tab first.';

/** What adopting does and does not do, stated before the operator commits. */
export const CAMPAIGN_ADOPT_EXPLAINER =
  'Adopting records this campaign under the brief so LFX One can read and pause it. Nothing is created or changed on the ad platform. An adopted campaign cannot be resumed or have its bid changed from LFX One.';

/**
 * Each documented `adopt-campaign` refusal mapped to an actionable message, by HTTP status.
 * `{platform}` is replaced with the platform's label. A 400 or 409 also shows campaign-service's own
 * sentence under the message, because each covers several reasons only that sentence tells apart.
 * The "already bound to another brief" 409 applies on every platform since campaign-service #328
 * added binding indexes for Meta, Microsoft, Reddit and X (Google Ads and LinkedIn already had them).
 */
export const CAMPAIGN_ADOPT_FAILURE_COPY: Readonly<Record<'400' | '403' | '404' | '409' | '503' | 'default', { title: string; message: string }>> = {
  '400': {
    title: 'Not adopted: the request was refused',
    message: 'Check that the campaign id is exactly as {platform} shows it and that the brief is an approved paid-marketing brief. Nothing was changed.',
  },
  '403': {
    title: 'Not adopted: permission denied',
    message: 'You do not have permission to manage campaigns in this project. Nothing was changed.',
  },
  '404': {
    title: 'Not adopted: no such campaign',
    message:
      "{platform} reports no campaign with this id in this project's ad account (a deleted, removed or archived campaign counts as absent). Check the id. Nothing was changed.",
  },
  '409': {
    title: 'Not adopted: this campaign cannot be bound to this brief',
    message:
      "The brief may already have a live {platform} campaign, the campaign may already belong to another brief, it may sit in a different ad account than this project's connection, or this project has no usable {platform} connection of its own. Nothing was changed.",
  },
  '503': {
    title: 'Not adopted: the campaign could not be verified',
    message:
      '{platform} could not confirm whether this campaign exists, so nothing was recorded. This does not mean the campaign is missing; try again in a few minutes.',
  },
  default: {
    title: 'Not adopted',
    message: 'The campaign could not be adopted. Nothing was changed; try again.',
  },
};

/** An adoption whose outcome nobody could confirm: the row may already be written. */
export const CAMPAIGN_ADOPT_UNCONFIRMED_TITLE = 'Adoption not confirmed';

/** After an unconfirmed adoption, the check found no campaign bound to this id: it did not happen. */
export const CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE = 'LFX One has no record of this campaign, so the adoption did not happen. You can adopt it again.';

/** After an unconfirmed adoption, the check got an answer that contradicts itself: still unconfirmed. */
export const CAMPAIGN_ADOPT_VERIFY_UNEXPECTED_MESSAGE =
  'LFX One got an answer it could not trust while checking the adoption, so it is still unconfirmed. Try the check again before adopting again.';

/** After an unconfirmed adoption, the check found the campaign bound to a DIFFERENT brief: not this adoption. */
export const CAMPAIGN_ADOPT_VERIFY_OTHER_BRIEF_MESSAGE =
  'This campaign is bound to a different brief, not the one you chose, so this adoption did not happen. Change it from that brief, or remove that binding first.';

/** A reopened dialog while an adoption of the same campaign is still in flight. */
export const CAMPAIGN_ADOPT_PENDING_MESSAGE = 'An adoption of this campaign is still in progress. Wait for it to finish before trying again.';

/** After an unconfirmed adoption, the check itself failed. */
export const CAMPAIGN_ADOPT_VERIFY_FAILED_MESSAGE = 'LFX One could not check whether the adoption happened. Try the check again before adopting again.';

// ---------------------------------------------------------------------------
// Optimize/Monitor UI: audience panels and the Meta ad-set panel
// ---------------------------------------------------------------------------

/** The audience panels the Monitor tab offers, in display order. */
export const PLATFORM_AUDIENCE_PLATFORM_OPTIONS: readonly PlatformAudiencePlatformOption[] = [
  { value: 'meta-ads', label: 'Meta' },
  { value: 'linkedin-ads', label: 'LinkedIn' },
  { value: 'microsoft-ads', label: 'Microsoft Advertising' },
  { value: 'reddit-ads', label: 'Reddit' },
  { value: 'twitter-ads', label: 'X' },
] as const;

/** The display label of each window name any audience read takes. */
export const PLATFORM_AUDIENCE_WINDOW_LABELS: Readonly<Record<string, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: '7d',
  last_14_days: '14d',
  last_30_days: '30d',
  this_month: 'This month',
  last_month: 'Last month',
};

/** The window each panel opens on: upstream's own default for that read (X serves at most 7 days). */
export const PLATFORM_AUDIENCE_DEFAULT_WINDOWS: Readonly<Record<PlatformAudiencePanelPlatform, string>> = {
  'meta-ads': 'last_30_days',
  'linkedin-ads': 'last_30_days',
  'microsoft-ads': 'last_30_days',
  'reddit-ads': 'last_30_days',
  'twitter-ads': 'last_7_days',
};

/** The window choices each panel offers: exactly the windows its campaign-service read accepts. */
export const PLATFORM_AUDIENCE_WINDOW_OPTIONS: Readonly<Record<PlatformAudiencePanelPlatform, readonly PlatformAudienceWindowOption[]>> = {
  'meta-ads': CAMPAIGN_METRICS_WINDOWS.map((value) => ({ value, label: PLATFORM_AUDIENCE_WINDOW_LABELS[value] ?? value })),
  'linkedin-ads': LINKEDIN_AUDIENCE_WINDOWS.map((value) => ({ value, label: PLATFORM_AUDIENCE_WINDOW_LABELS[value] ?? value })),
  'microsoft-ads': MICROSOFT_KEYWORDS_WINDOWS.map((value) => ({ value, label: PLATFORM_AUDIENCE_WINDOW_LABELS[value] ?? value })),
  'reddit-ads': REDDIT_AUDIENCE_WINDOWS.map((value) => ({ value, label: PLATFORM_AUDIENCE_WINDOW_LABELS[value] ?? value })),
  'twitter-ads': TWITTER_AUDIENCE_WINDOWS.map((value) => ({ value, label: PLATFORM_AUDIENCE_WINDOW_LABELS[value] ?? value })),
};

/** The breakdown titles of each platform's audience read, keyed by its wire `dimension`, in display order. */
export const PLATFORM_AUDIENCE_SECTION_TITLES: Readonly<Record<PlatformAudiencePanelPlatform, Readonly<Record<string, string>>>> = {
  'meta-ads': { age_gender: 'Age and gender', placement: 'Placement' },
  'linkedin-ads': { job_function: 'Job function', seniority: 'Seniority', industry: 'Industry', company_size: 'Company size', country: 'Country' },
  'microsoft-ads': { age_gender: 'Age and gender' },
  'reddit-ads': { gender: 'Gender', country: 'Country', community: 'Community (subreddit)' },
  'twitter-ads': { age: 'Age', gender: 'Gender', platform: 'Device platform' },
};

/**
 * What an audience panel says for each failure, `{platform}` replaced by the platform's label.
 * Written by this UI: the BFF never relays campaign-service's own sentence for an audience read.
 */
export const PLATFORM_AUDIENCE_ERROR_MESSAGES: Readonly<Record<PlatformAudienceErrorKind, string>> = {
  'no-connection': "This project has no {platform} connection. Connect the {platform} ad account in the project's channel connections to see its audience.",
  conflict:
    "{platform} can't read these campaigns together: a campaign was created under another ad account or doesn't record its account, a stored campaign id is malformed, or the project has more campaigns than this read covers. Reconnect the account the campaigns run in, or re-dispatch the campaigns that don't record one, then retry.",
  unavailable:
    "{platform} didn't confirm the audience read — it may be rate-limited or temporarily unreachable. Nothing is shown rather than a partial picture. Try again in a few minutes.",
  'not-enabled':
    "{platform} audience insights aren't available: they aren't enabled in this environment, or the project's {platform} connection is inactive or has no ad account selected.",
  failed: "{platform} audience insights couldn't be loaded. Try again.",
};

/** The audience panel's failure kind for each BFF audience error code; any other code is `failed`. */
export const PLATFORM_AUDIENCE_ERROR_KIND_BY_CODE: Readonly<Record<string, PlatformAudienceErrorKind>> = {
  [CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE]: 'no-connection',
  [CAMPAIGN_AUDIENCE_CONFLICT_CODE]: 'conflict',
  [CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE]: 'unavailable',
  [CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE]: 'not-enabled',
};

/** What a breakdown row is labelled when the platform reported no value for it. */
export const PLATFORM_AUDIENCE_UNKNOWN_LABEL = 'Unknown';

/** A Reddit bucket with no value: traffic Reddit did not attribute to any value (an explicit null), not a read failure. */
export const PLATFORM_AUDIENCE_UNATTRIBUTED_LABEL = 'Unattributed';

/** What a counter shows when it was not measured. Never `0`. */
export const PLATFORM_AUDIENCE_NOT_MEASURED_LABEL = 'Not measured';

/** The platform whose campaigns have an ad-set panel on the Optimize tab. */
export const META_AD_SETS_CAMPAIGN_PLATFORM = 'meta-ads';

/** Why a Meta row's ad-set panel is disabled for a campaign never created on Meta. */
export const META_AD_SETS_UNAVAILABLE_UNPROVISIONED_REASON = 'This campaign has not been created on Meta, so it has no ad sets to show.';

/** Why the ad-set toggles cannot be used while another change to the same campaign is in flight. */
export const META_AD_SET_BLOCKED_BUSY_REASON = 'Another change to this campaign is still in progress. Change an ad set once it finishes.';

/** Why the ad-set toggles cannot be used after a 412 proved the row's validator stale. */
export const META_AD_SET_BLOCKED_STALE_REASON = 'This campaign changed since the list was read. Refresh the campaign list before changing an ad set.';

/** Why the budget editor cannot submit while an ad-set change of the same row is in flight. */
export const CAMPAIGN_BUDGET_BLOCKED_AD_SET_REASON = 'An ad set change of this campaign is still in progress. Change the budget once it finishes.';

/** What the panel says after a 412. The ad sets are re-read; the campaign's version needs a list refresh. */
export const META_AD_SET_CONFLICT_MESSAGE =
  'This campaign changed since it was loaded, and nothing was changed. The ad sets were reloaded; refresh the campaign list before trying again.';

/** What the panel says when the change may or may not have reached Meta. Never retried here. */
export const META_AD_SET_UNCONFIRMED_MESSAGE =
  'The ad set status change may or may not have been applied — reload to verify. The ad sets were reloaded below; check the status before trying again.';

/**
 * campaign-service's advice after a PAUSE whose outcome was unconfirmed (`deliberately_paused` on
 * `meta-ad-set`, `toggle-meta-ad-set-status`): the deliberate-pause record is normally kept but not
 * guaranteed, and a campaign resume re-activates an ad set it does not find recorded.
 */
export const META_AD_SET_DELIBERATE_PAUSE_ADVICE =
  'Re-read Deliberately paused before resuming the campaign: if this ad set is not shown as deliberately paused, pause it here again first — otherwise resuming the campaign may re-activate it.';

/** What the panel says for a refusal whose response carried no readable message. */
export const META_AD_SET_FAILURE_FALLBACK = "The ad set's status could not be changed.";

/** Why a non-recorded ad set offers no Resume: campaign-service activates only the ad set it created. */
export const META_AD_SET_RESUME_ELSEWHERE_REASON = 'Only the ad set created here can be resumed here; resume this one in Meta Ads Manager.';

/** The visible word of the action that re-sends PAUSED to record a deliberate pause (see `MetaAdSetDisplayRow.recordAction`). */
export const META_AD_SET_RECORD_PAUSE_LABEL = 'Pause again (record)';

/** The visible word of the action that re-sends ACTIVE to clear a stale deliberate-pause record (see `MetaAdSetDisplayRow.recordAction`). */
export const META_AD_SET_CLEAR_RECORD_LABEL = 'Resume again (clear record)';

/**
 * campaign-service's advice after a RESUME whose outcome was unconfirmed: an unconfirmed resume does
 * not clear the deliberate-pause record, so a campaign resume would leave the ad set paused.
 */
export const META_AD_SET_DELIBERATE_RESUME_ADVICE =
  'Re-read Deliberately paused: if this ad set is still shown as deliberately paused, resume it here again — otherwise resuming the campaign will leave it paused.';

/**
 * Statuses an ad-set write is refused with BEFORE campaign-service takes the campaign's write lock:
 * malformed (400), not allowed (401/403), no campaign or connection (404), unprocessable (422), no
 * validator (428). A refusal with one of these, in the BFF's envelope, leaves the row's version known.
 */
export const META_AD_SET_PRE_SEND_REFUSAL_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 422, 428]);

/**
 * Why Resume is refused on a `created_degraded` campaign: campaign-service will not switch delivery
 * ON beneath a campaign that still needs reconciliation (409), but a PAUSE stays allowed.
 */
export const META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON =
  "This campaign still needs reconciliation, so its ad sets can't be resumed here. They can still be paused to stop any spend.";

/**
 * Why every ad-set change is refused on a campaign that is still provisioning or needs
 * reconciliation (`pending`, `group_created`, `unconfirmed`, or any state campaign-service does not
 * call toggleable): it answers 409 in both directions.
 */
export const META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON =
  "This campaign is still provisioning or needs reconciliation, so its ad sets can't be changed here until its status is resolved.";

/** The budget cell when the ad set was not listed by Meta: every descriptive field is absent. */
export const META_AD_SET_BUDGET_NOT_REPORTED = 'Budget not reported';

/** The budget cell when neither a type nor an amount is reported: possibly Campaign Budget Optimization, but not proven. */
export const META_AD_SET_BUDGET_NONE_REPORTED = 'No ad set budget reported (it may use the campaign budget)';

/** The budget cell when the type is reported but the amount is not (an unknown currency scale, for one). */
export const META_AD_SET_BUDGET_AMOUNT_NOT_REPORTED = '{type} budget, amount not reported';

/** Why an ad set Meta reports deleted or archived, or no longer lists, offers no action. */
export const META_AD_SET_NO_ACTION_REASON = 'This ad set cannot be paused or resumed.';

/**
 * A reporting window as a sentence names it ("Last 30 days"), for a read that states which window
 * its counters cover. `PLATFORM_AUDIENCE_WINDOW_LABELS` covers the same values but in the audience
 * selector's compact form ("30d"), which does not read as a label beside a timestamp.
 */
export const CAMPAIGN_METRICS_WINDOW_LABELS: Readonly<Record<CampaignMetricsWindow, string>> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_14_days: 'Last 14 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  last_month: 'Last month',
};

/** What the Ads section says when the read fails without a readable message. */
export const META_ADS_READ_FAILED_MESSAGE = "This ad set's ads could not be read from Meta.";

/**
 * What the Ads section says when `truncated` is true: the LISTING passed its page cap, so some ads
 * are missing, but delivery is all or nothing, so any unlisted ad that delivered is still shown.
 */
export const META_ADS_TRUNCATED_NOTE =
  'Meta lists more ads in this ad set than can be read at once, so not every ad is shown. Any ad past the listing that delivered in this window is still shown, with its counters only.';

/** An ad Meta's listing did not return (`listed: false`): its counters count, but nothing describes it. */
export const META_AD_UNLISTED_NOTE = 'Not listed by Meta (deleted, archived, or past the listing); counters only.';

/** The creative cell when neither the creative's name nor its id is reported. */
export const META_AD_CREATIVE_NOT_REPORTED = 'Creative not reported';

// --- Keyword targeting panel (Reddit and X) ----------------------------------

/** The platforms whose campaigns have keyword targeting the Optimize tab can read and remove from. */
export const KEYWORD_TARGETING_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<KeywordTargetingPlatform>(['reddit-ads', 'twitter-ads']);

/**
 * The keyword-targeting platforms whose read carries a `revision` fingerprinting the WHOLE targeting
 * (excluded keywords included), which a removal must send back: Reddit. A negative-keyword add there
 * rewrites the same object, so it makes a read stale and the two levers are serialized. X keeps each
 * keyword as its own criterion with no revision, so its negatives neither invalidate nor hold a removal.
 */
export const KEYWORD_TARGETING_REVISION_PLATFORMS: ReadonlySet<KeywordTargetingPlatform> = new Set<KeywordTargetingPlatform>(['reddit-ads']);

/** Why Remove is held: a removal of the same campaign, sent under another brief id, is still running. */
export const KEYWORD_TARGETING_REMOVAL_IN_PROGRESS_REASON = 'Another removal for this campaign is already running. Wait for it to finish.';

/** Why a removal the operator CONFIRMED was not sent, stated on the panel rather than dropped silently. */
export const KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES: Readonly<Record<'busy' | 'held' | 'reread' | 'noRevision', string>> = {
  busy: 'Another removal for this campaign is already running. Nothing was sent.',
  held: 'Negative keywords started being added to this campaign while you were confirming. Nothing was sent; try again once that finishes.',
  reread: 'The keyword targeting was read again while you were confirming. Nothing was sent; check the list and try again.',
  noRevision: 'The read did not include the version Reddit needs. Nothing was sent; reload the keyword targeting and try again.',
};

/** Each keyword-targeting platform's name in the panel's text. */
export const KEYWORD_TARGETING_PLATFORM_LABELS: Readonly<Record<KeywordTargetingPlatform, string>> = {
  'reddit-ads': 'Reddit',
  'twitter-ads': 'X',
};

/** X's keyword criterion types in words. Anything else is shown as read. */
export const KEYWORD_TARGETING_X_MATCH_LABELS: Readonly<Record<string, string>> = {
  BROAD_KEYWORD: 'Broad',
  PHRASE_KEYWORD: 'Phrase',
  EXACT_KEYWORD: 'Exact',
  UNORDERED_KEYWORD: 'Unordered',
};

/** Visible label of each removal outcome. UNCONFIRMED is never worded as a failure. */
export const KEYWORD_TARGETING_REMOVAL_OUTCOME_LABELS: Readonly<Record<KeywordTargetingRemovalOutcome, string>> = {
  APPLIED: 'Removed',
  FAILED: 'Not removed',
  UNCONFIRMED: 'Not confirmed',
};

/** What an UNCONFIRMED removal tells the operator. The panel re-reads the targeting itself. */
export const KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE =
  'This keyword may or may not have been removed. Reload the keyword targeting to verify before retrying.';

/**
 * Why a FAILED removal was not made, per campaign-service `error_code`. Fixed sentences: the
 * platform's own text is never shown. An unknown code falls back to `..._FAILED_FALLBACK`.
 */
export const KEYWORD_TARGETING_REMOVAL_ERROR_DETAILS: Readonly<Record<string, string>> = {
  NOT_SENT: 'It was not sent, so nothing changed.',
  NOT_FOUND: 'It is no longer in the targeting.',
  REJECTED: 'The ad platform refused it.',
  WOULD_EMPTY: 'It was not sent: it is now the last keyword, and removing it would leave no keyword targeting.',
};

/** Why a FAILED removal was not made when its code is not one this UI knows. */
export const KEYWORD_TARGETING_REMOVAL_FAILED_FALLBACK = 'The ad platform did not remove it.';

/** Why the keyword-targeting control is disabled for a campaign never created on its ad platform. */
export const KEYWORD_TARGETING_UNAVAILABLE_UNPROVISIONED_REASON =
  'This campaign has not been created on its ad platform, so it has no keyword targeting to show.';

/** Why Remove is held back when every keyword is selected: upstream refuses (409) a removal that would empty the targeting. */
export const KEYWORD_TARGETING_REMOVE_ALL_REASON =
  'Keep at least one keyword. Removing every keyword would leave the campaign without keyword targeting, which widens where it serves.';

/** The targeting read's failures, by HTTP status, in fixed words. */
export const KEYWORD_TARGETING_READ_ERROR_MESSAGES: Readonly<Record<'conflict' | 'unavailable' | 'refused' | 'forbidden' | 'other', string>> = {
  conflict:
    "This campaign's keyword targeting can't be read: it may not be fully created on its ad platform, may belong to a different ad account, or may not target a keyword list.",
  unavailable: "The ad platform couldn't be reached to read the keyword targeting. Try again.",
  refused: 'Keyword targeting can only be read for Reddit and X campaigns.',
  forbidden: "You don't have access to this campaign's keyword targeting.",
  other: "The keyword targeting couldn't be loaded. Try again.",
};

/**
 * A removal's DOCUMENTED refusals (`KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES`), in fixed words.
 * Nothing was removed. Every other failure is reported as unconfirmed.
 */
export const KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES: Readonly<Record<'conflict' | 'refusedReddit' | 'refused' | 'forbidden' | 'notFound', string>> = {
  conflict:
    'Nothing was removed: the keyword targeting changed since it was read, or this campaign cannot take the change right now. The targeting has been reloaded; review it and try again.',
  refusedReddit: 'Nothing was removed: the request was refused. Keyword changes on Reddit campaigns may not be switched on yet.',
  refused: 'Nothing was removed: the request was refused.',
  forbidden: "Nothing was removed: you don't have access to change this campaign.",
  notFound: 'Nothing was removed: this campaign could not be found.',
};

// --- Reddit keyword performance table ------------------------------------------

/** The window selector of the Reddit keyword table, in display order, over `REDDIT_KEYWORDS_WINDOWS`. */
export const REDDIT_KEYWORDS_WINDOW_OPTIONS: readonly RedditKeywordsWindowOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: '7d' },
  { value: 'last_30_days', label: '30d' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
] as const;

/** The window the Reddit keyword table opens on: upstream's own default. */
export const DEFAULT_REDDIT_KEYWORDS_WINDOW: RedditKeywordsWindow = 'last_30_days';

/** The Reddit keyword read's failures, by HTTP status, in fixed words. Upstream text is never shown. */
export const REDDIT_KEYWORDS_ERROR_MESSAGES: Readonly<Record<'notConnected' | 'disabled' | 'conflict' | 'other', string>> = {
  notConnected: "Reddit keyword metrics aren't available for this foundation: it has no Reddit Ads connection.",
  disabled: 'Reddit keyword metrics are not switched on in this environment.',
  conflict:
    "Reddit keyword metrics can't be read for this foundation: it has more Reddit campaigns than one report can cover, or a campaign belongs to a different ad account.",
  other: 'Reddit keyword metrics are unavailable right now. Try again.',
};

/**
 * What a Reddit keyword row says when its "Add as negative" could not read the `revision` Reddit
 * requires (the read failed, or answered none): nothing was sent. The negative-keyword editor's own wording.
 */
export const REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR =
  "The ad group's targeting couldn't be read, and Reddit needs it before keywords can be excluded. Nothing was sent.";

/**
 * What a Reddit keyword row says when, by the time its revision read answered, another change to the
 * campaign's keywords (a negative-keyword request or a keyword-targeting removal) had started: the
 * add was not sent, and the operator tries again once that one settles.
 */
export const REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE = 'Another keyword change for this campaign started first. Nothing was sent.';

/**
 * What a Reddit keyword row says when, by the time its revision read answered, the page had moved
 * to another project or brief or the campaign had stopped taking negative keywords: nothing was sent.
 */
export const REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE =
  "This campaign can't take negative keywords from here any more (the page changed project or brief, or the campaign changed). Nothing was sent.";

/**
 * The statuses a keyword lever (keyword-targeting removal, negative-keyword add) may report as a
 * DEFINITE failure, and only when the BFF's own envelope carries them: campaign-service documents
 * 400 (malformed batch, unsupported platform, Reddit writes off) and 409 (refused before anything
 * changed), and 401/403/404 are refused before dispatch. Every other status, every 5xx included, and
 * any timeout or lost connection is UNCONFIRMED: both writes are irreversible, and a failure after
 * dispatch says nothing about what the platform did.
 */
export const KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES: ReadonlySet<number> = new Set<number>([400, 401, 403, 404, 409]);
