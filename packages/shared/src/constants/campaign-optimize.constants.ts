// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignAdoptPlatform,
  CampaignAudiencePlatform,
  CampaignLeverUnconfirmedOutcome,
  CampaignRefPlatform,
  MetaAdSetStatus,
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
 * The reporting windows the Reddit keyword read accepts. campaign-service has no
 * `GET /projects/{p}/reddit-ads/keywords` yet; the Microsoft keyword read's set is used until it
 * publishes one, and the route is behind `LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS`.
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
