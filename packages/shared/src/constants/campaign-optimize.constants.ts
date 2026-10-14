// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignAdoptPlatform,
  CampaignAudiencePlatform,
  CampaignLeverUnconfirmedOutcome,
  CampaignRefPlatform,
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
 * actions and have no BFF route. `linkedin-ads` has NO campaign-service endpoint yet; its rule
 * (digits, as LinkedIn campaign ids are numeric) is a placeholder until one is published.
 */
export const CAMPAIGN_REF_ID_PATTERNS: Readonly<Record<CampaignRefPlatform, RegExp>> = {
  'meta-ads': /^[1-9][0-9]{0,31}$/,
  'reddit-ads': /^[A-Za-z0-9_]{1,64}$/,
  'twitter-ads': /^[A-Za-z0-9]{1,64}$/,
  'linkedin-ads': /^[0-9]{1,64}$/,
};

/** Campaign-ref resolves whose campaign-service endpoint is not on `main` yet; 404 unless `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS` is on. */
export const CAMPAIGN_REF_PLATFORMS_PENDING_UPSTREAM: ReadonlySet<CampaignRefPlatform> = new Set<CampaignRefPlatform>(['linkedin-ads']);

/**
 * The reporting windows `get-reddit-ads-keywords` accepts (campaign-service #331): the Reddit
 * metrics read's ranges, the same set as the Microsoft keyword read. `yesterday` and
 * `last_14_days` are refused upstream with 400.
 */
export const REDDIT_KEYWORDS_WINDOWS = MICROSOFT_KEYWORDS_WINDOWS;

/**
 * The platforms the BFF lets a caller ADOPT an existing campaign on. campaign-service's
 * `adopt-campaign` also accepts `google-ads`; that is left to the Google Ads owner and refused here
 * until they wire it.
 */
export const CAMPAIGN_ADOPT_PLATFORMS: ReadonlySet<CampaignAdoptPlatform> = new Set<CampaignAdoptPlatform>([
  'microsoft-ads',
  'meta-ads',
  'reddit-ads',
  'twitter-ads',
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

/** A removal's failures that produced no per-keyword results, in fixed words. Nothing was removed unless it says otherwise. */
export const KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES: Readonly<
  Record<'conflict' | 'refusedReddit' | 'refused' | 'forbidden' | 'notFound' | 'unavailable' | 'other', string>
> = {
  conflict:
    'Nothing was removed: the keyword targeting changed since it was read, or this campaign cannot take the change right now. The targeting has been reloaded; review it and try again.',
  refusedReddit: 'Nothing was removed: the request was refused. Keyword changes on Reddit campaigns may not be switched on yet.',
  refused: 'Nothing was removed: the request was refused.',
  forbidden: "Nothing was removed: you don't have access to change this campaign.",
  notFound: 'Nothing was removed: this campaign could not be found.',
  unavailable: 'Nothing was removed: the ad platform could not be reached. Try again.',
  other: 'Nothing was removed. Try again.',
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
