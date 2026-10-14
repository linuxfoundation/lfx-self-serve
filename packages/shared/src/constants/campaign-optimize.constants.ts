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
  RedditKeywordsWindow,
  RedditKeywordsWindowOption,
} from '../interfaces/campaign-optimize.interface';
import { CAMPAIGN_METRICS_WINDOWS, MICROSOFT_KEYWORDS_WINDOWS } from './campaign.constants';

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
 * Every per-platform audience read the BFF proxies, mapped to the windows that platform's
 * campaign-service read accepts. The keys are campaign-service's own platform path segments.
 *
 * Google Ads is absent on purpose: its audience read is `GET /api/campaigns/audience`, owned by the
 * Insights cutover and not by this table.
 *
 * `linkedin-ads` has NO campaign-service endpoint yet. Its window set is the generic metrics set,
 * a placeholder until upstream publishes one; the route is behind
 * `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` until then (see `CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM`).
 */
export const CAMPAIGN_AUDIENCE_WINDOWS: Readonly<Record<CampaignAudiencePlatform, readonly string[]>> = {
  'meta-ads': CAMPAIGN_METRICS_WINDOWS,
  'twitter-ads': TWITTER_AUDIENCE_WINDOWS,
  'microsoft-ads': MICROSOFT_KEYWORDS_WINDOWS,
  'reddit-ads': REDDIT_AUDIENCE_WINDOWS,
  'linkedin-ads': CAMPAIGN_METRICS_WINDOWS,
};

/**
 * Audience reads whose campaign-service endpoint is not on campaign-service `main` yet: Reddit's is
 * on a feature branch (`get-reddit-ads-audience`), LinkedIn's is not written. The BFF answers 404 for
 * these unless `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on, so no deployment calls a route upstream
 * does not serve.
 */
export const CAMPAIGN_AUDIENCE_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignAudiencePlatform> = new Set<CampaignAudiencePlatform>([
  'reddit-ads',
  'linkedin-ads',
]);

/**
 * The id rule each campaign-ref resolve applies to a platform's own campaign id, mirrored from
 * campaign-service's `localCampaignRefMethod` calls (`design/connection.go`). The id is a query
 * parameter upstream, so this refuses early what upstream would refuse with a 400.
 *
 * Google Ads and Microsoft Advertising are absent: their resolves are internal to the keyword
 * actions and have no BFF route. LinkedIn's is the decoder Pattern of `resolve-linkedin-ads-campaign`
 * (a positive int64 with no leading zero; upstream also refuses one past int64 with 400).
 */
export const CAMPAIGN_REF_ID_PATTERNS: Readonly<Record<CampaignRefPlatform, RegExp>> = {
  'meta-ads': /^[1-9][0-9]{0,31}$/,
  'reddit-ads': /^[A-Za-z0-9_]{1,64}$/,
  'twitter-ads': /^[A-Za-z0-9]{1,64}$/,
  'linkedin-ads': /^[1-9][0-9]{0,18}$/,
};

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
// Act from Monitor
// ---------------------------------------------------------------------------

/** The Monitor tables whose rows offer actions: LinkedIn, Reddit and Meta (Google Ads is another owner's lane). */
export const CAMPAIGN_MONITOR_ACT_PLATFORMS: ReadonlySet<CampaignMonitorActPlatform> = new Set<CampaignMonitorActPlatform>([
  'linkedin-ads',
  'reddit-ads',
  'meta-ads',
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

// --- Keyword targeting panel (Reddit and X) ----------------------------------

/** The platforms whose campaigns have keyword targeting the Optimize tab can read and remove from. */
export const KEYWORD_TARGETING_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<KeywordTargetingPlatform>(['reddit-ads', 'twitter-ads']);

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
 * The statuses a keyword lever (keyword-targeting removal, negative-keyword add) may report as a
 * DEFINITE failure, and only when the BFF's own envelope carries them: campaign-service documents
 * 400 (malformed batch, unsupported platform, Reddit writes off) and 409 (refused before anything
 * changed), and 401/403/404 are refused before dispatch. Every other status, every 5xx included, and
 * any timeout or lost connection is UNCONFIRMED: both writes are irreversible, and a failure after
 * dispatch says nothing about what the platform did.
 */
export const KEYWORD_LEVER_DEFINITE_FAILURE_STATUSES: ReadonlySet<number> = new Set<number>([400, 401, 403, 404, 409]);
