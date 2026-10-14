// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignAdoptPlatform,
  CampaignAudiencePlatform,
  CampaignLeverUnconfirmedOutcome,
  CampaignRefPlatform,
  MetaAdSetStatus,
  PlatformAudienceErrorKind,
  PlatformAudiencePanelPlatform,
  PlatformAudiencePlatformOption,
  PlatformAudienceWindowOption,
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
export const CAMPAIGN_AUDIENCE_ACCOUNT_MISMATCH_CODE = 'CAMPAIGN_AUDIENCE_ACCOUNT_MISMATCH';
export const CAMPAIGN_AUDIENCE_ACCOUNT_MISMATCH_MESSAGE =
  "This ad platform connection cannot be used for the project's campaigns: its ad account is not the one every campaign was created under, or a campaign does not record which account it was created under. Reconnect the account the campaigns run in, or re-dispatch the campaigns that do not record one.";
export const CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE = 'CAMPAIGN_AUDIENCE_UNAVAILABLE';
export const CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE =
  'The ad platform did not confirm the audience read (it may be rate-limited or unreachable), so nothing is shown rather than a partial picture. Try again in a few minutes.';
export const CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE = 'CAMPAIGN_AUDIENCE_NOT_ENABLED';
export const CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE =
  "Audience insights for this ad platform are not available: they are not enabled in this environment, or the project's connection is inactive or has no ad account selected.";
/**
 * The most characters of campaign-service's own sentence the BFF logs (at DEBUG) when it answers an
 * upstream 400 on an audience read as `CAMPAIGN_AUDIENCE_NOT_ENABLED`. Bounded like the other
 * upstream-text log lines; the logger's field scrubber still applies to it.
 */
export const CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH = 300;

/** Every other failure (an auth refusal, a server error, a read nobody answered); the code stays the status's. */
export const CAMPAIGN_AUDIENCE_FAILED_MESSAGE = 'The audience read failed. Try again.';

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
 * The `code` the BFF answers when an ad-set status change is CONFIRMED on Meta but campaign-service
 * could not confirm whether it recorded (or cleared) the deliberate pause on the campaign row: its
 * answered 503 says the record "could not be confirmed" and asks for `deliberately_paused` to be
 * re-read. A campaign resume reads that record, so the operator must check it before resuming.
 */
export const META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE = 'META_AD_SET_PAUSE_RECORD_UNCONFIRMED';

/** What the BFF says alongside `META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE`. */
export const META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED =
  "The ad set's status was changed on Meta, but whether its deliberate pause is recorded on the campaign could not be confirmed. Reload the ad sets and check Deliberately paused before resuming the campaign.";

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
  'account-mismatch':
    "The {platform} connection can't be used for these campaigns: its ad account isn't the one every campaign was created under, or a campaign doesn't record which account it was created under. Reconnect the account the campaigns run in, or re-dispatch the campaigns that don't record one, then retry.",
  unavailable:
    "{platform} didn't confirm the audience read — it may be rate-limited or temporarily unreachable. Nothing is shown rather than a partial picture. Try again in a few minutes.",
  'not-enabled':
    "{platform} audience insights aren't available: they aren't enabled in this environment, or the project's {platform} connection is inactive or has no ad account selected.",
  failed: "{platform} audience insights couldn't be loaded. Try again.",
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

/** The visible word of the action that re-sends PAUSED to record a deliberate pause (see `MetaAdSetDisplayRow.recordPause`). */
export const META_AD_SET_RECORD_PAUSE_LABEL = 'Pause again (record)';

/** Why an ad set Meta reports deleted or archived, or no longer lists, offers no action. */
export const META_AD_SET_NO_ACTION_REASON = 'This ad set cannot be paused or resumed.';
