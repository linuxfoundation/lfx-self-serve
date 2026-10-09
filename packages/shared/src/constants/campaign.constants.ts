// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  AudienceSignal,
  AudienceSpeakerScope,
  BriefMetricsActionRule,
  CampaignBidType,
  CampaignBudgetType,
  CampaignBudgetTypeOption,
  CampaignCreateRequest,
  CampaignDeliveryTypeOption,
  CampaignEmailSegment,
  CampaignEmailTypeOption,
  CampaignGoalOption,
  CampaignOptimizeControlLever,
  CampaignOptimizeLever,
  CampaignKeyword,
  CampaignNegativeKeywordMatchType,
  CampaignNegativeKeywordMatchTypeOption,
  CampaignNegativeKeywordOutcome,
  CampaignPlatform,
  CampaignPlatformOption,
  CampaignProgramTypeOption,
  CampaignStatus,
  CampaignTabOption,
  CampaignToggleAction,
  CampaignToggleStatus,
  GoogleCreativeEitherOrRule,
  GoogleCreativeFieldSpec,
  KeywordActionOutcome,
  KeywordActionPlatform,
  LinkedInGeoTarget,
  MetaObjective,
  MetaObjectiveParams,
  MetaPlacement,
  MicrosoftKeywordsWindow,
  MicrosoftKeywordsWindowOption,
  ParsedCampaignName,
  RedditObjective,
  RedditObjectiveParams,
  SelectableMetaObjective,
} from '../interfaces/campaign.interface';
import { COUNTRIES } from './countries.constants';

/** Tab definitions for the Campaigns page tab navigation. */
export const CAMPAIGN_TABS: readonly CampaignTabOption[] = [
  { id: 'planning', label: 'Plan', icon: 'fa-light fa-clipboard-list' },
  { id: 'implementation', label: 'Implement', icon: 'fa-light fa-rocket' },
  { id: 'insights', label: 'Monitor', icon: 'fa-light fa-chart-mixed' },
  { id: 'optimization', label: 'Optimize', icon: 'fa-light fa-gauge-high' },
] as const;

export const CAMPAIGN_PLATFORMS: readonly CampaignPlatformOption[] = [
  { id: 'google-ads', label: 'Google Ads', icon: 'fa-brands fa-google' },
  { id: 'microsoft-ads', label: 'Microsoft Ads', icon: 'fa-brands fa-microsoft' },
  { id: 'linkedin-ads', label: 'LinkedIn Ads', icon: 'fa-brands fa-linkedin' },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'fa-brands fa-meta' },
  { id: 'reddit-ads', label: 'Reddit Ads', icon: 'fa-brands fa-reddit' },
  { id: 'twitter-ads', label: 'X / Twitter Ads', icon: 'fa-brands fa-x-twitter', disabled: true },
] as const;

/**
 * Delivery types — the second campaign selector (after the program type). Both are selectable.
 *
 * Email has Plan; its Implement and Monitor panels are pending (LFXV2-3197 for the template
 * picker the staging form needs, and a UI route to the HubSpot metrics read for Monitor). It has
 * no Optimize tab at all — `HubSpotDispatcher` implements no `StatusToggler`, because staging
 * produces a draft a human sends and nothing is left running to pause.
 */
export const CAMPAIGN_DELIVERY_TYPES: readonly CampaignDeliveryTypeOption[] = [
  { id: 'paid-marketing', label: 'Paid Marketing', breadcrumbLabel: 'Paid Marketing' },
  { id: 'email', label: 'Email', breadcrumbLabel: 'Email' },
] as const;

export const CAMPAIGN_PROGRAM_TYPES: readonly CampaignProgramTypeOption[] = [
  {
    id: 'events',
    label: 'Events Campaigns',
    breadcrumbLabel: 'Events Campaigns',
    urlLabel: 'Event Page URL',
    urlPlaceholder: 'https://events.linuxfoundation.org/your-event/',
    urlHelp: 'Paste any LF event page — dates and details are scraped live, not from AI memory.',
    goalLabel: 'Conversions / Registrations',
    audiencePlaceholder: 'e.g., Cloud-native developers, DevOps engineers',
    valuePropPlaceholder: 'e.g., Free registration, 200+ sessions, hands-on labs with industry experts',
  },
  {
    id: 'education',
    label: 'Education Campaigns',
    breadcrumbLabel: 'Education Campaigns',
    urlLabel: 'Course / Training Page URL',
    urlPlaceholder: 'https://training.linuxfoundation.org/training/your-course/',
    urlHelp: 'Paste any LF Training page — course details are scraped live, not from AI memory.',
    goalLabel: 'Conversions / Enrollments',
    audiencePlaceholder: 'e.g., IT professionals seeking certifications, career changers',
    valuePropPlaceholder: 'e.g., Industry-recognized certification, self-paced learning, exam bundle discounts',
  },
] as const;

export const CAMPAIGN_GOALS: readonly CampaignGoalOption[] = [
  { id: 'conversions', label: 'Conversions / Registrations' },
  { id: 'brand-awareness', label: 'Brand Awareness' },
  { id: 'traffic', label: 'Traffic / Clicks' },
  { id: 'lead-generation', label: 'Lead Generation' },
  { id: 'engagement', label: 'Engagement' },
] as const;

/**
 * Reddit's own budget ceiling, mirrored from campaign-service.
 *
 * `internal/platform/reddit/client.go` caps `BudgetUSD` at this value to stay below the int64
 * micro-dollar overflow, rejecting anything larger during dispatch. Creation is async, so an
 * unguarded over-cap budget becomes a dead job rather than a refused request.
 */
export const REDDIT_MAX_BUDGET_USD = 1_000_000_000;

export const CAMPAIGN_JOB_POLL_INTERVAL_MS = 2000;

/**
 * Pacing thresholds (percentage of budget spent).
 *   pacingPct < 50  → underspending
 *   pacingPct <= 90 → normal
 *   pacingPct <= 100 → constrained
 *   pacingPct > 100 → overspending (130 marks severe)
 */
export const CAMPAIGN_PACING_THRESHOLDS = {
  underspending: 50,
  normal: 90,
  constrained: 100,
  overspending: 130,
} as const;

/**
 * Per-platform thresholds for the Optimize tab's action items.
 *
 * These values are EXACTLY what each platform's service used before they were named — this
 * constant changes no behavior. It exists because the same two rules carry three different
 * numbers, and the divergence is accidental: nothing in the code or the tickets states a reason
 * why LinkedIn should flag a click-through rate Meta considers healthy, or why Reddit should
 * tolerate five times as many unconverted clicks as Meta.
 *
 * Naming them here makes the drift greppable and reviewable in one place. Converging them is a
 * separate decision (LFXV2-3314) precisely because it CHANGES which alerts fire on live
 * campaigns, and that is not a change to make silently while extracting constants.
 *
 * Units, since the three fields are not in the same kind of quantity:
 *
 *   lowCtrPct                — PERCENTAGE POINTS, not a ratio. `0.3` means 0.3%, and the rule
 *                              fires when a campaign's `ctr` is below it. Each service builds
 *                              that `ctr` itself as `(clicks / impressions) * 100` — it is not
 *                              read from the platform — so the scale is set locally and a
 *                              builder switching to the raw ratio would silence every one of
 *                              these rules rather than error.
 *   clicksWithoutConversions — a COUNT of clicks. The rule fires above it, with zero
 *                              conversions.
 *   minImpressions           — a COUNT of impressions. Consumers guard with `impressions >
 *                              minImpressions`, so a campaign AT the value is suppressed too —
 *                              the rule needs strictly more. Exists because a click-through rate
 *                              over a handful of impressions is noise.
 *
 * LinkedIn has no impression floor today and instead requires `ctr > 0`; the two are not
 * equivalent, and the difference is visible on any campaign whose CTR is genuinely low on thin
 * volume. One click on 400 impressions is 0.25%: under LinkedIn's rule that clears `ctr > 0` and
 * sits below `lowCtrPct`, so it alerts on a sample of 400; under Meta's it never reaches the
 * predicate, because 400 is not `> 500`. Neither is wrong — they are different bets about when a
 * rate is worth believing — and recording `null` states what LinkedIn actually has rather than
 * inventing a floor for it.
 */
export const CAMPAIGN_ALERT_THRESHOLDS = {
  'linkedin-ads': { lowCtrPct: 0.3, clicksWithoutConversions: 50, minImpressions: null },
  'meta-ads': { lowCtrPct: 0.5, clicksWithoutConversions: 20, minImpressions: 500 },
  'reddit-ads': { lowCtrPct: 0.3, clicksWithoutConversions: 100, minImpressions: 1000 },
} as const;

/** Official vendor brand colors — external to the LFX design system (not in lfxColors). */
export const PLATFORM_BRAND_COLORS: Readonly<Record<CampaignPlatform, string>> = {
  'google-ads': '#4285F4',
  'linkedin-ads': '#0077B5',
  'reddit-ads': '#FF4500',
  'meta-ads': '#1877F2',
  'microsoft-ads': '#00A4EF',
  'twitter-ads': '#000000',
};

export const PLATFORM_DEFAULT_COLOR = '#6B7280';

/**
 * Character bounds for the SEARCH ad's copy and for sitelink extensions.
 *
 * The three Google DISPLAY entries this used to carry — `displayHeadline: 40`,
 * `displayDescription`, `displayBusinessName` — are gone, and not merely because nothing read them.
 * A responsive display ad's headline is bounded at **30** upstream
 * (`internal/platform/googleads/display_creative.go`'s `maxDisplayHeadlineWeight`), so the 40 here
 * was a figure no code enforced and no platform accepts. Google's display, Demand Gen and
 * Performance Max bounds now live per channel in {@link GOOGLE_CREATIVE_FIELD_SPECS}, where the fact
 * that they DIFFER between channels is visible instead of flattened into one shared name.
 */
export const CAMPAIGN_CHAR_LIMITS = {
  searchHeadline: 30,
  searchDescription: 90,
  sitelinkHeadline: 25,
  sitelinkDescription: 35,
} as const;

export const CAMPAIGN_BUDGET_DEFAULTS = {
  searchBudgetPct: 70,
  displayBudgetPct: 30,
} as const;

export const VALID_CAMPAIGN_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(['enabled', 'paused', 'removed', 'limited', 'draft']);

/**
 * The indexed campaign statuses that mean "running upstream", and therefore offer PAUSE.
 *
 * `created_degraded` belongs here even though it reads like a failure: it records that the
 * campaign's wiring was never verified, NOT that the campaign is stopped. Such a campaign is live
 * and spending, campaign-service accepts a pause for it, and it REFUSES a resume with 409. Leaving
 * it out is therefore the expensive mistake in both directions — the UI would offer the one action
 * upstream rejects, on exactly the campaign where an operator most needs the pause lever.
 *
 * `enabled` is deliberately ABSENT. It is a Google Ads platform-level status word, never a value
 * campaign-service writes to `campaigns.status` — the service's status vocabulary is the
 * `CampaignStatus*`/`CampaignRun*` constants in `internal/domain/model/campaign.go`, and the
 * string `"enabled"` does not appear in that package at all. Listing it here mapped a value the
 * index never produces onto Pause, which is the fail-OPEN direction this pair exists to avoid: an
 * unknown status must land on `unavailable`, not on a button. `RESUMABLE_CAMPAIGN_STATUSES` never
 * listed it, so the two sets now agree about which vocabulary they are speaking.
 *
 * Compared case-insensitively against `CampaignIndexDoc.status`, which is a free string sourced
 * from the index rather than a closed enum.
 */
export const RUNNING_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set<string>(['created', 'created_degraded', 'active']);

/**
 * The statuses campaign-service will accept a RESUME (`ACTIVE`) for.
 *
 * Mirrors `model.CampaignStatusToggleable` in lfx-v2-campaign-service, which returns true for
 * exactly `created`, `active` and `paused` — every other status is refused with a 409. This is the
 * ALLOW-list half of the pair, and it is deliberately an allow-list rather than the complement of
 * a deny-list: `campaigns.status` is unconstrained TEXT upstream, so a status this file has never
 * seen (a typo, an addition, upstream drift) must fail CLOSED — rendered as unavailable — rather
 * than fail open into a Resume button that is guaranteed to 409.
 *
 * `created_degraded` is absent on purpose, and that is not the same statement as
 * RUNNING_CAMPAIGN_STATUSES including it. The service's exception for that status is PAUSE-ONLY
 * and lives at its `ToggleCampaignStatus` call site, not in the direction-blind predicate: such a
 * campaign is spending (so it must offer Pause) and cannot be resumed until it is reconciled (so
 * it must never offer Resume). The two sets answer different questions and legitimately differ.
 */
export const RESUMABLE_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set<string>(['created', 'active', 'paused']);

/**
 * The wire `status` reduced to something string methods are safe on.
 *
 * `status` is typed `string`, but that is a compile-time claim about a shape nothing validates:
 * the BFF spreads index docs through untouched (`listBriefCampaigns`), so a missing or non-string
 * status reaches the UI intact. Every consumer that lowercases one needs the same guard, so it
 * lives here once rather than being re-derived per call site — `campaignToggleAction` had it and
 * `unavailableReasonFor` did not, which put the crash back one function over.
 *
 * `''` is the deliberate result for a non-string: it misses every status set and every key in
 * `CAMPAIGN_UNAVAILABLE_REASONS`, so callers land on their existing unknown-status arm instead of
 * gaining a new branch. See [[absence-cannot-carry-new-meaning]] — this is a normalizer, not a
 * signal that something is wrong.
 */
export function normalizeCampaignStatus(status: string): string {
  return typeof status === 'string' ? status.toLowerCase() : '';
}

/**
 * The status each campaign row is in, as the toggle button must present it.
 *
 * Three states rather than a boolean, because a boolean can only ever mean "Pause or Resume" and
 * upstream has a third answer. `pending`, `group_created`, `unconfirmed` and any status not yet
 * known here are all rejected by `model.CampaignStatusToggleable`, so a two-state UI silently
 * files them under Resume and offers an action guaranteed to fail with a 409.
 *
 * Derived from the two status sets rather than hand-listed, so adding a status upstream cannot
 * quietly re-expose the doomed button: anything outside both sets lands on `unavailable`.
 *
 * `platform` is the second, independent reason to refuse: a campaign on a platform this app does
 * not offer is unavailable at ANY status, because the BFF rejects the platform before the status
 * is ever consulted. It is optional so the status-only question remains askable, and an omitted
 * platform is not read as an unsupported one.
 */
export function campaignToggleAction(status: string, platform?: string): CampaignToggleAction {
  // Platform is checked FIRST and independently of status, because it is the stronger refusal:
  // a `created` Microsoft row is pausable upstream but not through this app's BFF, so deciding on
  // status alone would hand it an enabled button whose every click 400s on the platform check.
  //
  // An ABSENT platform is not treated as unsupported. `platform` is optional so the status-only
  // question stays askable, and a row whose platform this UI cannot read must not be silently
  // demoted to `unavailable` — that would fail closed on a campaign that is probably fine. The
  // row-building caller always passes it; the BFF remains the enforcing boundary either way.
  if (platform !== undefined && !TOGGLEABLE_CAMPAIGN_PLATFORMS.has(platform)) {
    return 'unavailable';
  }
  // Total in `status`, matching how the platform check above is already total. `status` is typed
  // `string`, but that is a compile-time claim about a wire shape nothing validates: the BFF
  // spreads index docs through untouched (`listBriefCampaigns`), so a missing or non-string
  // `status` reaches here intact and `.toLowerCase()` would throw a TypeError.
  //
  // The blast radius is what makes this worth a guard rather than a cast. The call sits inside the
  // `campaignRows` computed, so one malformed doc takes out the ENTIRE campaigns section for every
  // row — and Angular re-throws on each change-detection pass. That is a fail-OPEN blank panel on
  // campaigns that are live and spending, which is the direction this pair exists to prevent.
  //
  // `''` already lands on `unavailable` through the two misses below, so no other arm changes.
  const normalized = normalizeCampaignStatus(status);
  if (RUNNING_CAMPAIGN_STATUSES.has(normalized)) {
    return 'pause';
  }
  if (RESUMABLE_CAMPAIGN_STATUSES.has(normalized)) {
    return 'resume';
  }
  return 'unavailable';
}

/**
 * Why a row's toggle is disabled, in words the operator can act on.
 *
 * Named per status rather than a single "cannot be changed": these cases have genuinely different
 * remedies. `pending` resolves itself when the dispatch settles; the partial-orphan statuses need
 * reconciliation before the platform will accept anything; `deleted` is terminal. A generic
 * message would send someone to look for a problem that is about to disappear on its own.
 *
 * Deliberately not enumerated by count here — a doc that says "the three cases" goes stale the
 * moment a key is added, and the keys below are the list.
 */
export const CAMPAIGN_UNAVAILABLE_REASONS: Readonly<Record<string, string>> = {
  pending: 'Still being created. Pause and resume become available once it finishes.',
  group_created: 'Only partly created upstream. It needs to be reconciled before it can be paused or resumed.',
  unconfirmed: 'Its creation outcome is unconfirmed. It needs to be reconciled before it can be paused or resumed.',
  deleted: 'This campaign has been removed.',
};

/** Fallback for a status this UI has never seen — see `campaignToggleAction` on failing closed. */
export const CAMPAIGN_UNAVAILABLE_DEFAULT_REASON = 'This campaign is not in a state that can be paused or resumed.';

/**
 * The platforms whose campaigns this app can actually toggle.
 *
 * DERIVED from `CAMPAIGN_PLATFORMS` rather than hand-listed, and it is the same derivation the
 * BFF performs for `CAMPAIGN_SERVICE_STATUS_PLATFORMS` (`campaign.controller.ts`) — one shared
 * rule, so the control the UI offers and the request the server accepts cannot drift apart. A
 * platform joins by flipping `disabled` in the constant above, which is one edit rather than
 * three.
 *
 * `disabled: true` entries (currently X only, since LFXV2-3312 enabled Microsoft) have working
 * toggle dispatchers upstream,
 * so status alone says a `created`/`active` row of theirs is pausable. It is not pausable HERE:
 * the BFF refuses the platform outright, so the row's Pause button could only ever fail. Status
 * and platform are therefore two independent reasons a toggle is unavailable, and the row must
 * consider both.
 */
export const TOGGLEABLE_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<string>(CAMPAIGN_PLATFORMS.filter((p) => !p.disabled).map((p) => p.id));

/**
 * Why a row's toggle is disabled because of its PLATFORM rather than its status.
 *
 * Separate from `CAMPAIGN_UNAVAILABLE_REASONS` because the remedy is different in kind: a status
 * reason describes something that changes on its own or after reconciliation, whereas this one
 * will not change until the platform ships in this app. Telling an operator to wait would be
 * false.
 */
export const CAMPAIGN_UNAVAILABLE_PLATFORM_REASON = 'Pause and resume are not available for this platform in LFX One yet.';

/**
 * Why the toggle is disabled when the DEPLOYMENT has not enabled status changes.
 *
 * A third kind of reason, and the only one that is about the environment rather than the campaign:
 * `/list` is ungated while the toggle route refuses every UUID with
 * `LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE` unset. Worded as a deployment capability so an
 * operator escalates to whoever owns the flag instead of hunting for a fault in the campaign.
 */
export const CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON = 'Pause and resume are not enabled for this deployment.';

/**
 * What a toggle refused with 412 tells the operator to do: REFRESH, not retry.
 *
 * A 412 means another editor moved this campaign since the list was read, so the validator this
 * row holds is dead. Retrying replays the same dead validator and earns the same 412 — the fresh
 * etag is only written on the success arm, so a failed toggle leaves the row falling back to the
 * one it was read with. "Try again", which is what every failure used to say, therefore names the
 * one action that provably cannot work here.
 *
 * Says nothing about which way the campaign is now pointing, unlike the per-direction copy below.
 * That is the honest answer: after a concurrent edit this view no longer knows the campaign's
 * status, and the direction wording is only true when the toggle failed WITHOUT anything moving.
 */
export const CAMPAIGN_TOGGLE_CONFLICT_MESSAGE =
  'Someone else changed this campaign while you were viewing it. Refresh the campaign list to see its current status before trying again.';

/**
 * Why a toggle failed when the campaign did NOT move — worded per direction.
 *
 * The outcome differs by direction and both are about money. A failed pause leaves the campaign
 * RUNNING; a failed resume leaves it PAUSED. Stating "it has not been paused" after a failed
 * resume is the exact inversion of the truth: it describes a campaign that is spending when the
 * campaign is in fact dark.
 *
 * Only correct for failures where nothing moved — a transport drop, a 5xx, a refusal upstream.
 * The 412 case gets `CAMPAIGN_TOGGLE_CONFLICT_MESSAGE` instead, because there the premise of both
 * sentences ("it is still …") is exactly what stopped being true.
 *
 * Keyed on `CampaignToggleAction` minus `'unavailable'`, not on a re-spelled literal union: this
 * map is only ever read for a DIRECTION that was actually attempted, and `unavailable` never is —
 * `toggleCampaign` returns before dispatching for it. Deriving the key set with `Exclude` keeps
 * that relationship checked, so renaming a direction on the type breaks this map instead of
 * silently leaving it keyed on a word nothing produces.
 */
export const CAMPAIGN_TOGGLE_FAILURE_MESSAGES: Readonly<Record<Exclude<CampaignToggleAction, 'unavailable'>, string>> = {
  pause: 'Could not pause this campaign. It is still running — try again.',
  resume: 'Could not resume this campaign. It is still paused — try again.',
};

/**
 * Why a toggle's outcome is UNKNOWN — worded per direction. Used when nothing the BFF wrote says the
 * toggle was refused: no answer at all, a proxy's or gateway's own response, or campaign-service's
 * "unconfirmed" wording. The change may have reached the ad platform, so this never says the
 * campaign "is still" anything; the operator checks the platform before trying again.
 */
export const CAMPAIGN_TOGGLE_UNCONFIRMED_MESSAGES: Readonly<Record<Exclude<CampaignToggleAction, 'unavailable'>, string>> = {
  pause: 'The pause could not be confirmed. The campaign may already be paused — verify its status in the ad platform before trying again.',
  resume: 'The resume could not be confirmed. The campaign may already be running and spending — verify its status in the ad platform before trying again.',
};

/**
 * The button's visible word per action. `unavailable` still names an action — the button is
 * disabled, not blank.
 *
 * Keyed on `CampaignToggleAction` rather than on a re-spelled literal union so this map cannot
 * drift from the type `campaignToggleAction` returns. A member added to or renamed in the type
 * fails to compile HERE; the hand-written copy would have kept compiling and produced `undefined`
 * on the new action at runtime — a blank button on a campaign that is spending.
 */
export const CAMPAIGN_TOGGLE_LABELS: Readonly<Record<CampaignToggleAction, string>> = {
  pause: 'Pause',
  resume: 'Resume',
  unavailable: 'Unavailable',
};

/**
 * Why a `zero_delivery` finding offers no lever for a campaign that is already paused. The finding
 * only ever offers Pause: resuming a campaign from a "not delivering" finding would restart spend.
 */
export const CAMPAIGN_FINDING_ALREADY_PAUSED_REASON = 'This campaign is already paused.';

/**
 * Shown beside a Microsoft keyword's actions when the previous one is UNCONFIRMED. The actions stay
 * offered — pausing or removing a keyword only reduces spend — but the operator checks first.
 */
export const MICROSOFT_KEYWORD_PREVIOUS_UNCONFIRMED_NOTE = 'Previous attempt not confirmed — verify in Microsoft Advertising before retrying.';

/**
 * campaign-service's exact sentences (lower case) for a Microsoft keyword read that is unavailable
 * rather than failed, by HTTP status. Compared whole, never by pattern; see `isNotConnectedError`
 * in the Microsoft keyword table for where each comes from upstream.
 */
export const MICROSOFT_KEYWORDS_NOT_CONNECTED_MESSAGES: Readonly<Record<404 | 400, readonly string[]>> = {
  404: ['no microsoft ads connection configured for this project'],
  400: ['keyword and audience insights are not supported for this platform', 'keyword insights is not supported for this platform'],
};

/**
 * Visible label of each keyword action outcome state, shared by the Google and Microsoft keyword
 * tables. An UNCONFIRMED action may already have applied, and a retried REMOVE is irreversible, so
 * it is never worded as a failure.
 */
export const KEYWORD_ACTION_OUTCOME_LABELS: Readonly<Record<KeywordActionOutcome['state'], string>> = {
  done: 'Done',
  unconfirmed: 'Unconfirmed',
  failed: 'Failed',
};

/** Text colour of each keyword action outcome state, on the brand scales. */
export const KEYWORD_ACTION_OUTCOME_CLASSES: Readonly<Record<KeywordActionOutcome['state'], string>> = {
  done: 'text-emerald-600',
  unconfirmed: 'text-amber-600',
  failed: 'text-red-600',
};

/**
 * What the toggle is DOING, worded for an assistive-technology announcement, per direction.
 *
 * Present progressive because this is announced while the request is out — "Pausing" is a claim
 * about an attempt in progress, which is exactly what is true at that moment. The completed forms
 * live in `CAMPAIGN_TOGGLE_DONE_VERBS` and are announced only from a CONFIRMED response.
 *
 * Split out of the template because the pending state is now announced from a live region rather
 * than an `aria-label` swap on the button: a native `disabled` button leaves the focus order, and
 * screen readers do not reliably announce attribute changes on an unfocused, disabled element.
 */
export const CAMPAIGN_TOGGLE_PENDING_VERBS: Readonly<Record<Exclude<CampaignToggleAction, 'unavailable'>, string>> = {
  pause: 'Pausing',
  resume: 'Resuming',
};

/**
 * What the toggle DID, for the completion announcement.
 *
 * Only ever used on a confirmed response arm. The service's reported status is what decides the
 * wording at the call site — a `created_degraded` campaign is paused upstream while its row status
 * deliberately does not move, so the announcement must not promise a transition the service
 * declined to record.
 */
export const CAMPAIGN_TOGGLE_DONE_VERBS: Readonly<Record<Exclude<CampaignToggleAction, 'unavailable'>, string>> = {
  pause: 'Paused',
  resume: 'Resumed',
};

export const GADS_STATUS_ENUM: Partial<Record<number, CampaignStatus>> = {
  2: 'enabled',
  3: 'paused',
  4: 'removed',
};

// ---------------------------------------------------------------------------
// Campaign Name Convention
// ---------------------------------------------------------------------------
// Format: "Program | Base Name | Region | Objective | Targeting | Ad Format | Project | Funnel | Date"
// Example: "Events | KubeCon NA 2025 | EMEA | Conversions | Intent | Search | CNCF | MoFU | 2025-06-01"

export const CAMPAIGN_NAME_FIELDS = ['program', 'baseName', 'region', 'objective', 'targeting', 'adFormat', 'project', 'funnelStage', 'dateSuffix'] as const;

export const CAMPAIGN_NAME_DELIMITER = ' | ';

export function parseCampaignName(raw: string): ParsedCampaignName {
  const parts = raw.split(CAMPAIGN_NAME_DELIMITER);
  return {
    program: parts[0] || '',
    baseName: parts[1] || '',
    region: parts[2] || '',
    objective: parts[3] || '',
    targeting: parts[4] || '',
    adFormat: parts[5] || '',
    project: parts[6] || '',
    funnelStage: parts[7] || '',
    dateSuffix: parts[8] || '',
    raw,
  };
}

// ---------------------------------------------------------------------------
// LinkedIn Ads Constants
// ---------------------------------------------------------------------------

export const LINKEDIN_API_VERSION = '202602';

export const LINKEDIN_CHAR_LIMITS = {
  introText: 600,
  headline: 200,
} as const;

export const META_CHAR_LIMITS = {
  primaryText: 125,
  headline: 40,
  description: 30,
} as const;

/** Maps internal objective identifiers to Meta Marketing API campaign objective, optimization goal, and promoted object type. */
export const META_OBJECTIVE_PARAMS: Readonly<Record<MetaObjective, MetaObjectiveParams>> = {
  awareness: { campaignObjective: 'OUTCOME_AWARENESS', optimizationGoal: 'REACH', promotedObjectType: 'none' },
  traffic: { campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', promotedObjectType: 'none' },
  engagement: { campaignObjective: 'OUTCOME_ENGAGEMENT', optimizationGoal: 'POST_ENGAGEMENT', promotedObjectType: 'page_id' },
  // `leads` runs a WEBSITE-TRAFFIC campaign, matching `objectiveParams` in
  // `lfx-v2-campaign-service` (`internal/platform/meta/client.go`) rather than the name.
  //
  // OUTCOME_LEADS + LEAD_GENERATION requires the ad's creative to reference an instant form via
  // `call_to_action.value.lead_gen_form_id`. Neither path builds one — this service creates only
  // a website-click creative (`object_story_spec.link_data` pointing at the registration URL) —
  // so LEAD_GENERATION creates the campaign and then fails at the ad set, orphaning a billable
  // resource. That is the exact create-then-orphan shape the pixel and placement guards exist to
  // prevent, and the objective selector shipped in this branch is what first makes it reachable.
  //
  // OUTCOME_TRAFFIC + LINK_CLICKS with no promoted object is the pairing that always succeeds
  // end-to-end. OUTCOME_LEADS + LINK_CLICKS is deliberately NOT used: Meta requires a pixel and
  // `custom_event_type` for it, which this flow does not supply. Full instant-form parity is
  // tracked as LFXV2-2665.
  leads: { campaignObjective: 'OUTCOME_TRAFFIC', optimizationGoal: 'LINK_CLICKS', promotedObjectType: 'none' },
  conversions: { campaignObjective: 'OUTCOME_SALES', optimizationGoal: 'OFFSITE_CONVERSIONS', promotedObjectType: 'pixel_id' },
} as const;

/** Default Meta ad placement toggles — Facebook and Instagram feeds enabled, all others off. */
export const META_DEFAULT_PLACEMENTS: Readonly<MetaPlacement> = {
  facebookFeed: true,
  instagramFeed: true,
  stories: false,
  reels: false,
  audienceNetwork: false,
  messengerInbox: false,
} as const;

/**
 * Display labels for the Meta campaign objectives.
 *
 * TOTAL over `MetaObjective` — every objective that can reach a display path has a label here,
 * INCLUDING `leads`. This map is no longer what the selector renders; that is
 * `META_SELECTABLE_OBJECTIVES` below. The split exists because the two questions are different:
 * "what may a user choose?" and "what do we call the thing this campaign already is?".
 *
 * Keeping `leads` here is load-bearing, not tidiness. Every display path in `meta-ads.service.ts`
 * — the campaign name, the ad-set name, the progress steps — indexes this map with whatever
 * objective the REQUEST carries, and a brief or draft persisted before `leads` was hidden still
 * carries it. Dropping the key would put the literal string `undefined` into a campaign name Meta
 * then bills against. Described as a shape rather than a list of call sites, which drifts.
 */
export const META_OBJECTIVE_LABELS: Readonly<Record<MetaObjective, string>> = {
  awareness: 'Awareness',
  traffic: 'Traffic',
  engagement: 'Engagement',
  leads: 'Leads',
  conversions: 'Conversions',
} as const;

/**
 * The objectives a user may actually choose, in the order the objective selector renders them.
 *
 * `leads` is DELIBERATELY ABSENT. It dispatches as a website-traffic campaign — see the long
 * comment on `META_OBJECTIVE_PARAMS.leads` for why that mapping is the safe one and must not
 * change — so offering it would label a traffic campaign "Leads" and let a user act on a wrong
 * assumption. Hiding it makes that a question someone asks rather than a mistake they ship.
 * LFXV2-2665 builds instant-form support and restores the option.
 *
 * This is the selector's ONLY source. `leads` stays in `MetaObjective`, in
 * `META_OBJECTIVE_PARAMS` and in `META_OBJECTIVE_LABELS`, so a persisted `leads` brief still
 * dispatches — as traffic — and still renders a name.
 */
export const META_SELECTABLE_OBJECTIVES = ['awareness', 'traffic', 'engagement', 'conversions'] as const satisfies readonly SelectableMetaObjective[];

/**
 * Compile-time exhaustiveness: every `SelectableMetaObjective` must appear in the list above.
 *
 * The element type alone only stops a WRONG entry; it cannot catch a MISSING one. Without this,
 * adding an objective to `MetaObjective` compiles cleanly and passes every test while never
 * appearing in the picker — the two sibling maps are total and hard-fail, so this list would be
 * the only one that drifts silently.
 *
 * Written as an assignment FROM a union of the array's members TO the full union: no cast, no
 * `Object.fromEntries`. Both defeat the check by widening the type back to something assignable.
 * A missing objective makes the target union unsatisfied and TypeScript names it.
 */
const _assertEverySelectableObjectiveIsListed: (typeof META_SELECTABLE_OBJECTIVES)[number] extends SelectableMetaObjective
  ? SelectableMetaObjective extends (typeof META_SELECTABLE_OBJECTIVES)[number]
    ? true
    : { ERROR: 'META_SELECTABLE_OBJECTIVES is missing an objective'; missing: Exclude<SelectableMetaObjective, (typeof META_SELECTABLE_OBJECTIVES)[number]> }
  : { ERROR: 'META_SELECTABLE_OBJECTIVES contains a hidden or unknown objective' } = true;
void _assertEverySelectableObjectiveIsListed;

/**
 * The placements a user may actually toggle.
 *
 * `messengerInbox` is deliberately absent. Meta removed Messenger Inbox as an ad placement in
 * November 2025, and campaign-service's `buildPlacementTargeting` refuses any request that
 * enables it outright rather than letting the ad-set call fail after the campaign — a paid
 * resource — already exists. Excluding the key here means the UI cannot construct that request:
 * the toggle is rendered permanently disabled from this list's complement, never bound to a
 * control that could send `true`.
 *
 * Derived lists (the selector, the "at least one enabled" guard) MUST read this rather than
 * re-listing the members, so a future placement added to `MetaPlacement` is a compile-time
 * decision here instead of a silent omission there.
 */
export const META_SELECTABLE_PLACEMENTS: readonly (keyof MetaPlacement)[] = ['facebookFeed', 'instagramFeed', 'stories', 'reels', 'audienceNetwork'] as const;

/** Display labels for every Meta placement, including the retired one the UI renders disabled. */
export const META_PLACEMENT_LABELS: Readonly<Record<keyof MetaPlacement, string>> = {
  facebookFeed: 'Facebook Feed',
  instagramFeed: 'Instagram Feed',
  stories: 'Stories',
  reels: 'Reels',
  audienceNetwork: 'Audience Network',
  messengerInbox: 'Messenger Inbox',
} as const;

/** Why `messengerInbox` is not selectable — rendered beside the disabled toggle. */
export const META_MESSENGER_INBOX_RETIRED_REASON = 'Removed by Meta in November 2025';

/** Meta object ids (Pixel, Page) are numeric strings; mirrors campaign-service's `numericIDRE`. */
export const META_NUMERIC_ID_PATTERN = /^[0-9]+$/;

/**
 * Input bounds the Microsoft client enforces BEFORE its first create call, mirrored here so the
 * form and the BFF refuse synchronously instead of enqueuing a job that cannot succeed.
 *
 * Verified against `origin/main` of campaign-service:
 * - `maxKeywords = 60` (`internal/platform/microsoft/targeting.go:86`)
 * - `maxKeywordTextRunes = 100` (`targeting.go:75`) — measured in RUNES, matching Microsoft's
 *   character-based limit; a byte count would reject a valid CJK keyword.
 * - `maxGeoTargets = 30` (`internal/platform/microsoft/geo.go:109`)
 *
 * Each is a hard error upstream, and because `CreateCampaigns` is asynchronous that error is a
 * FAILED JOB the operator has to go and read rather than a refusal of the request they made — the
 * same class as the CPC bid range below.
 */
export const MICROSOFT_MAX_KEYWORDS = 60;
export const MICROSOFT_MAX_KEYWORD_TEXT_LENGTH = 100;
export const MICROSOFT_MAX_GEO_TARGETS = 30;

/**
 * Maximum keyword rows one bulk pause/remove request may carry.
 *
 * This bounds SERVER FAN-OUT, not a platform limit. Each distinct campaign in the body costs a
 * resolver call and then a mutation call, made sequentially while the request is held open, so
 * an unbounded array turns one authenticated request into thousands of upstream calls against
 * a live ad account — the shape most likely to trip upstream rate limiting and fail campaigns
 * for a reason that has nothing to do with the request. 50 is the most rows this UI's keyword
 * table exposes at once, so it cannot be reached by the product's own flows.
 */
export const MAX_BULK_KEYWORD_ACTIONS = 50;

/**
 * Google Ads resource ids are the canonical base-10 spelling of a positive int64.
 *
 * Mirrors campaign-service's own declaration on `keyword-action-input` — `Pattern("^[0-9]+$")`
 * with `MaxLength(19)` — and its design states why the digits-only rule is load-bearing rather
 * than cosmetic: these ids are concatenated into a Google Ads resource NAME, so the same
 * injection reasoning that governs the customer id applies. 19 rather than 20 because
 * `math.MaxInt64` ("9223372036854775807") has nineteen digits.
 *
 * Shape only. Kept as the first gate because these ids are concatenated into a Google Ads
 * resource NAME, so the same injection reasoning that governs the customer id applies; the RANGE
 * check lives in `isCanonicalGoogleAdsResourceId` below, because the int64 ceiling is arithmetic
 * a regex states badly — an attempt to spell it as alternation silently rejected
 * `math.MaxInt64` itself.
 */
export const GOOGLE_ADS_RESOURCE_ID_RE = /^[0-9]{1,19}$/;

/**
 * Whether an id is a CANONICAL positive int64, which is what callers' error messages promise.
 *
 * The regex above admits "0", the leading-zero spelling "0305729261", and the out-of-range
 * "9999999999999999999". Those were deferred to campaign-service, so the controller refused
 * malformed ids with a message it did not actually enforce, and these three reached upstream to
 * be rejected there instead.
 *
 * Ruling them out BEFORE any fan-out is what keeps the batch all-or-nothing: the controller
 * validates every row before mutating anything, and a keyword REMOVE is irreversible, so a
 * half-applied batch cannot be undone by retrying.
 *
 * BigInt, not Number: `math.MaxInt64` exceeds `Number.MAX_SAFE_INTEGER`, so a Number comparison
 * cannot distinguish the ceiling from the values just past it.
 */
const MAX_INT64 = 9223372036854775807n;

export function isCanonicalGoogleAdsResourceId(value: unknown): boolean {
  // `unknown`, not `string`: the caller validates req.body, which is CAST rather than parsed, so
  // a JSON number reaches here as a number. RE.test() coerces it and passes, and the
  // startsWith() below then threw a TypeError -- turning malformed input into a 500 instead of
  // the 400 the validation exists to produce.
  if (typeof value !== 'string') {
    return false;
  }
  if (!GOOGLE_ADS_RESOURCE_ID_RE.test(value)) {
    return false;
  }
  // Rejects "0" and every leading-zero spelling: a canonical id never starts with '0'.
  if (value.startsWith('0')) {
    return false;
  }
  return BigInt(value) <= MAX_INT64;
}

/**
 * The match type a newly added keyword starts at.
 *
 * `Phrase` is the middle of Microsoft's three: `Broad` can spend on loosely related queries and
 * `Exact` can starve a new campaign of volume, so the default is wrong in neither direction and
 * the operator can change it on the row afterwards.
 *
 * Named rather than inlined because the add-time duplicate check has to agree with it. Uniqueness
 * is `(matchType, case-folded text)` upstream, so the check can only refuse a new row against
 * EXISTING rows at the match type the new row will actually carry — if the two drift apart, the
 * check either refuses a keyword upstream accepts or admits one it rejects.
 */
export const MICROSOFT_NEW_KEYWORD_MATCH_TYPE = 'Phrase' as const;

/**
 * Upper bound on Microsoft's DAILY budget (`internal/platform/microsoft/campaign.go:59`,
 * `maxBudget`), rejected during dispatch and therefore a dead job rather than a refused request —
 * the same reasoning as `REDDIT_MAX_BUDGET_USD`, which caps the sibling platform for the same
 * class of reason.
 *
 * The LOWER bound is deliberately not a constant. This app's floor is 1 across every paid
 * platform (Meta, LinkedIn and Reddit all gate on `< 1`, and all five budget inputs declare
 * `min="1"`), which is STRICTER than the client's `> 0`. A sub-unit daily budget is not a spend
 * plan any of these channels can execute meaningfully, and diverging from the house floor for
 * Microsoft alone would be a surprise rather than a feature.
 */
export const MICROSOFT_MAX_BUDGET = 1_000_000_000;

/**
 * Control characters Microsoft's `Keyword.Text` rejects, mirroring Go's `unicode.IsControl`
 * (`internal/platform/microsoft/targeting.go` checks every keyword with it, PRE-trim).
 *
 * Covers C0 (U+0000-U+001F), DEL (U+007F) AND C1 (U+0080-U+009F). The C1 half is easy to miss and
 * was: an earlier version stopped at DEL, so U+0085 (NEL) passed this preflight, was queued, and
 * was then rejected upstream — after the campaign hierarchy may already have been created, which
 * is the partial-create this guard exists to prevent.
 *
 * U+00A0 (NBSP) is deliberately OUTSIDE the range: Go reports `IsControl(U+00A0) == false`, so
 * rejecting it here would refuse a keyword Microsoft accepts. Verified by running both.
 */
// eslint-disable-next-line no-control-regex
export const MICROSOFT_CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * The match types Microsoft's `Keyword.MatchType` accepts, in the PascalCase vocabulary the client
 * canonicalises (`canonicalMatchType`) — deliberately not Google's SCREAMING_CASE.
 *
 * DERIVED from a `Record` keyed by the union rather than written as a `Set` literal, and the
 * difference is the whole point: `ReadonlySet<CampaignKeyword['matchType']>` only checks that the
 * values listed BELONG to the union, so adding a member to the union and forgetting it here would
 * compile silently and reject a keyword Microsoft accepts. A `Record<Union, true>` is exhaustive —
 * omitting a member is a compile error — so the union stays the single source of truth.
 */
const MICROSOFT_MATCH_TYPE_MAP: Record<CampaignKeyword['matchType'], true> = { Exact: true, Phrase: true, Broad: true };

const MICROSOFT_MATCH_TYPE_KEYS: ReadonlySet<string> = new Set(Object.keys(MICROSOFT_MATCH_TYPE_MAP).map((k) => k.toLowerCase()));

/**
 * Canonicalise a match type to the PascalCase vocabulary, or null when it is not one.
 *
 * Mirrors the client's `canonicalMatchType`, and exists for the UI rather than the wire: the
 * match-type `<select>` offers only `Exact`/`Phrase`/`Broad`, so a chip seeded with the brief's raw
 * `EXACT` rendered with NO option selected — the operator saw an empty dropdown on a keyword that
 * would nonetheless dispatch fine.
 *
 * The BFF still forwards whatever it receives, since upstream canonicalises anyway. Canonicalising
 * at the SEED is what keeps the rendered control and the stored value in agreement.
 */
export function canonicalMicrosoftMatchType(value: unknown): CampaignKeyword['matchType'] | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  const match = (Object.keys(MICROSOFT_MATCH_TYPE_MAP) as CampaignKeyword['matchType'][]).find((k) => k.toLowerCase() === key);
  return match ?? null;
}

/**
 * Is `value` a match type Microsoft accepts?
 *
 * CASE-INSENSITIVE and trimming, mirroring the client's `canonicalMatchType`, which does
 * `strings.ToLower(strings.TrimSpace(in))`. An exact-case `Set.has` was stricter than upstream and
 * refused `EXACT` or ` exact ` — rejecting a request the service would have accepted, and reporting
 * the platform as unconfigured rather than naming the real problem.
 *
 * The ORIGINAL value is still forwarded on the wire: upstream canonicalises it anyway, so rewriting
 * it there would be a second normalization that could only drift. Use `canonicalMicrosoftMatchType`
 * when the PascalCase form is needed for DISPLAY.
 */
export function isMicrosoftMatchType(value: unknown): boolean {
  return typeof value === 'string' && MICROSOFT_MATCH_TYPE_KEYS.has(value.trim().toLowerCase());
}

/**
 * The inclusive bounds Microsoft's ad-group `CpcBid` must fall within when one is SUPPLIED
 * (`internal/platform/microsoft/targeting.go:116-117`, `minCpcBid`/`maxCpcBid`).
 *
 * In whole units of the ad ACCOUNT's currency — no micros, no FX — the same unit rule as the
 * budget. Out-of-range is a HARD refusal in the client, and because `CreateCampaigns` is
 * asynchronous that refusal surfaces as a dead job rather than an error on the request, which is
 * why both the UI and the BFF check it before dispatch.
 *
 * Note that ZERO is NOT in range and is still valid input: it means UNSET, and unset is a
 * documented serve-capable state (Microsoft applies the account-currency minimum). So the test is
 * "if a bid is supplied, it must be within these bounds", not "the value must be within them".
 *
 * Shared rather than duplicated per layer so the UI guard and `buildMicrosoftConfig` cannot drift.
 */
export const MICROSOFT_MIN_CPC_BID = 0.01;
export const MICROSOFT_MAX_CPC_BID = 1000;

/** ISO 3166-1 alpha-2 shape for a Meta geo target, after normalization. */
export const META_GEO_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Zero-padded `YYYY-MM-DD` shape for a campaign flight date.
 *
 * Shape only — it says nothing about whether the day named actually exists, so a caller that is
 * about to act on the result must still round-trip the parsed date (see
 * `CampaignController.isReversedFlightWindow`, which this pattern exists for).
 */
export const ISO_CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Country code to Google Ads geo target constant id.
 *
 * A curated list, NOT every assigned alpha-2 code: campaign-service ports the same 30 entries in
 * `internal/platform/googleads/geo.go` (`geoTargetConstants`) and refuses anything absent from it —
 * "geo target %q is not a supported country code". A well-formed but unlisted code such as `PT` or
 * `ZA` therefore fails the create upstream, which is why callers gate on this map rather than on
 * `META_GEO_CODE_PATTERN` alone.
 *
 * Shared so the create adapter and the legacy proxy resolve against one list. Keep it in step with
 * `geo.go` — a code present here and absent there becomes an over-refusal at dispatch.
 */
export const GOOGLE_ADS_GEO_TARGET_MAP: Record<string, string> = {
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

/**
 * Upstream's own bound on a Google Ads geo target list (`geo.go`'s `maxGeoTargets`), checked there
 * BEFORE de-duplication — so a list that is only over the cap because it repeats a code is still
 * refused.
 */
export const GOOGLE_ADS_MAX_GEO_TARGETS = 30;

/**
 * Micros per whole currency unit, the denomination google-ads bills budgets in.
 *
 * Shared rather than inlined at the guard because the guard's whole purpose is to compute the
 * SAME integer campaign-service computes and refuse exactly what it refuses. campaign-service
 * scales the budget by this factor, rounds, and rejects a campaign whose rounded budget is zero
 * micros ("campaign budget must be > 0"). A guard that compared the raw float against zero
 * instead would pass a positive-but-sub-micro budget straight into that refusal, where the
 * orchestrator reports it as the opaque "platform campaign creation failed".
 */
export const GOOGLE_ADS_MICROS_PER_UNIT = 1_000_000;

/**
 * LinkedIn's per-campaign budget floors, in USD.
 *
 * Mirrored from `internal/platform/linkedin/config.go` (`minDailyBudgetUSD` / `minLifetimeBudgetUSD`),
 * which the client enforces before any POST. Which floor applies flips with the budget-type toggle,
 * and nothing in the Implementation tab says the floor exists or that it moves tenfold — hence the
 * named refusal that reads these.
 */
export const LINKEDIN_MIN_DAILY_BUDGET_USD = 10;
export const LINKEDIN_MIN_LIFETIME_BUDGET_USD = 100;

/**
 * The officially assigned ISO 3166-1 alpha-2 codes, derived from `COUNTRIES`.
 *
 * A Set rather than a repeated `.some()` scan: `normalizeGeoTargets` runs per code per keystroke
 * on the chip path, and `COUNTRIES` holds 249 entries. Derived rather than re-listed so it cannot
 * fall out of step with the dropdown the user picks from.
 */
export const ASSIGNED_COUNTRY_CODES: ReadonlySet<string> = new Set<string>(COUNTRIES.map((c) => c.value));

/**
 * Assigned countries Meta will not accept as an ad-targeting geo.
 *
 * Mirrors `metaIneligibleCountries` in `lfx-v2-campaign-service`
 * (`internal/platform/meta/client.go`), which is the path this app is cutting over to. Kept in
 * step with it deliberately: while the cutover is dark the legacy TypeScript service handles the
 * create, and without this list it would accept a code the Go path refuses — so the SAME user
 * input would succeed or fail depending only on a flag.
 *
 * These are ASSIGNED codes, so `ASSIGNED_COUNTRY_CODES` passes them; ineligibility is a separate,
 * Meta-specific fact and is checked separately. Two groups, both non-targetable: comprehensively
 * sanctioned or policy-prohibited markets, and ISO territories with no resident population and so
 * no Meta ad market.
 *
 * Best-effort rather than authoritative, exactly as the Go list documents itself. A still-eligible
 * code that slips through is rejected by Meta at the ad-set POST — after the campaign exists — so
 * this list reduces that window rather than closing it.
 */
export const META_INELIGIBLE_COUNTRIES: ReadonlySet<string> = new Set<string>([
  // Comprehensively sanctioned or prohibited by Meta ads policy.
  'CU',
  'IR',
  'KP',
  'RU',
  'SY',
  // Uninhabited / non-targetable ISO territories (no Meta ad market).
  'AQ',
  'BV',
  'HM',
  'TF',
  'GS',
  'UM',
]);

/**
 * Normalize a list of Meta geo targets: trim, uppercase, drop mis-shaped codes, de-dupe.
 *
 * The single owner of geo normalization. Every entry point — the chip add path, the brief seed
 * path, and the server's pre-flight validation — routes through this so the same input can never
 * mean two different things depending on which door it came through. That split is exactly what
 * let a stored `us` and a typed `US` become two chips AND two wire entries: the add path
 * normalized, the seed path did not, and the server uppercased without de-duping, so `["us","US"]`
 * reached Meta as `["US","US"]`.
 *
 * De-duping is FIRST-SEEN order, matching campaign-service.
 *
 * Validation is ASSIGNMENT, not eligibility, and the line between them is deliberate. A code must
 * be an officially assigned ISO 3166-1 alpha-2 value (`COUNTRIES`, which excludes the
 * user-assigned `AA`/`QM-QZ`/`XA-XZ`/`ZZ` ranges and the reserved `EU`/`UK`/... codes and
 * documents itself as safe for exactly this use). A shape-only `/^[A-Z]{2}$/` check accepted `ZZ`,
 * which no ad platform can ever target: `executeMetaCampaignCreation` filters only the regulated
 * markets, so `ZZ` survived to `geo_locations` and Meta rejected it at AD-SET creation — after the
 * campaign POST had already created a billable resource. Assignment is a closed, stable fact, so
 * checking it here cannot drift.
 *
 * Which of the assigned countries Meta will actually accept remains the service's call, since it
 * additionally drops sanctioned and regulated markets; duplicating THAT list here would drift.
 */
export function normalizeGeoTargets(codes: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const code of codes ?? []) {
    if (typeof code !== 'string') continue;
    const upper = code.trim().toUpperCase();
    if (!META_GEO_CODE_PATTERN.test(upper) || !ASSIGNED_COUNTRY_CODES.has(upper) || seen.has(upper)) continue;
    seen.add(upper);
    normalized.push(upper);
  }
  return normalized;
}

/**
 * Normalize geo codes for MICROSOFT: trim, upper-case and de-duplicate, WITHOUT applying Meta's
 * assigned-country allowlist.
 *
 * Separate from `normalizeGeoTargets` because that helper gates on `ASSIGNED_COUNTRY_CODES`, which
 * is derived from this app's own `COUNTRIES` list and does NOT match the table Microsoft validates
 * against (`internal/platform/microsoft/geo_countries.go`). The two genuinely diverge — `AN` is in
 * Microsoft's table and not in ours, so typing it was silently dropped, and with no other chip the
 * request fell back to the event country and targeted a DIFFERENT MARKET than the operator asked
 * for. That silent substitution is the defect; the divergence itself is expected, since the lists
 * have different owners.
 *
 * Membership is deliberately left to campaign-service, which checks Microsoft's own table and
 * FAILS THE CREATE before anything is created when a code is unknown. Duplicating that list here
 * could only drift from it. This helper therefore enforces SHAPE only, matching what
 * `buildMicrosoftConfig` enforces on the same values.
 */
export function normalizeMicrosoftGeoTargets(codes: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const code of codes ?? []) {
    if (typeof code !== 'string') continue;
    const upper = code.trim().toUpperCase();
    if (!META_GEO_CODE_PATTERN.test(upper) || seen.has(upper)) continue;
    seen.add(upper);
    normalized.push(upper);
  }
  return normalized;
}

/** Valid statuses for the campaign status toggle endpoint. */
export const VALID_CAMPAIGN_TOGGLE_STATUSES: ReadonlySet<CampaignToggleStatus> = new Set<CampaignToggleStatus>(['ACTIVE', 'PAUSED']);

/** Valid `budgetType` values for the campaign budget change endpoint (campaign-service's `budget_type` enum). */
export const VALID_CAMPAIGN_BUDGET_TYPES: ReadonlySet<CampaignBudgetType> = new Set<CampaignBudgetType>(['daily', 'lifetime']);

/**
 * An etag the BFF can send as `If-Match`: visible ASCII only, which keeps `"3"` and `W/"3"` valid.
 * Node's fetch rejects a header value holding CR/LF or a character above U+00FF before any network
 * I/O, and that rejection is classified as a transport failure. On a budget write a transport
 * failure is reported as UNCONFIRMED, so such an etag would tell the operator a request that never
 * left the BFF "may already have been applied". It is refused as a 400 instead.
 */
export const CAMPAIGN_ETAG_HEADER_PATTERN = /^[\x21-\x7e]+$/;

/**
 * What a budget change reports when no campaign-service answer came back, such as a timeout, a
 * lost connection or a gateway error page.
 *
 * The write may already have reached the ad platform, so "nothing changed" cannot be claimed.
 * Re-applying the same amount converges and is safe, but the operator is still told to verify
 * first. campaign-service's OWN 503 answers are passed through untouched instead, because their
 * message already says whether the outcome was definite or unconfirmed.
 */
export const CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED =
  'The budget change could not be confirmed and may already have been applied. Verify the campaign budget in the ad platform before retrying.';

/** The platforms a keyword pause/remove may name (campaign-service's `apply-keyword-actions`). */
export const KEYWORD_ACTION_PLATFORMS: ReadonlySet<KeywordActionPlatform> = new Set<KeywordActionPlatform>(['google-ads', 'microsoft-ads']);

/** The platform a keyword action means when it names none: every pre-Microsoft request was Google Ads. */
export const DEFAULT_KEYWORD_ACTION_PLATFORM: KeywordActionPlatform = 'google-ads';

/**
 * What a Microsoft keyword action reports when it may or may not have been applied: the Microsoft
 * twin of the BFF's Google-worded unconfirmed message. A retried REMOVE is irreversible, so the
 * operator is sent to Microsoft Advertising to check first.
 */
export const MICROSOFT_KEYWORD_ACTION_OUTCOME_UNCONFIRMED =
  'The change was sent but could not be confirmed. Check the keyword in Microsoft Advertising before retrying.';

/** Valid `bidType` values for the campaign bid change endpoint (campaign-service's `bid_type` enum). */
export const VALID_CAMPAIGN_BID_TYPES: ReadonlySet<CampaignBidType> = new Set<CampaignBidType>(['cpc']);

/** The `bidType` sent when the caller names none: upstream's own default and only value. */
export const DEFAULT_CAMPAIGN_BID_TYPE: CampaignBidType = 'cpc';

/**
 * What a bid change reports when no campaign-service answer came back. The bid-lever twin of
 * `CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED`: the write may already have reached the ad platform, so the
 * operator is told to verify the bid there first. campaign-service's OWN 503 answers pass through
 * untouched, because their message already says whether the outcome was definite or unconfirmed.
 */
export const CAMPAIGN_BID_OUTCOME_UNCONFIRMED =
  'The bid change could not be confirmed and may already have been applied. Verify the bid in the ad platform before retrying.';

/** Match types a negative keyword may carry (campaign-service's `negativeKeywordMatchTypeEnum`). */
export const VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES: ReadonlySet<CampaignNegativeKeywordMatchType> = new Set<CampaignNegativeKeywordMatchType>([
  'Exact',
  'Phrase',
]);

/** Per-keyword outcomes of the negative-keywords lever (campaign-service's `negativeKeywordOutcomeEnum`). */
export const CAMPAIGN_NEGATIVE_KEYWORD_OUTCOMES: ReadonlySet<CampaignNegativeKeywordOutcome> = new Set<CampaignNegativeKeywordOutcome>([
  'APPLIED',
  'ALREADY_PRESENT',
  'FAILED',
  'UNCONFIRMED',
]);

/** Most negative keywords one request may carry (the upstream payload's `MaxLength(60)`). */
export const MAX_NEGATIVE_KEYWORDS_PER_REQUEST = 60;

/** Microsoft's limit on a negative keyword's text, in characters (code points, not bytes). */
export const MAX_NEGATIVE_KEYWORD_TEXT_LENGTH = 100;

/**
 * The characters a negative keyword's text may hold: letters, combining marks, digits, spaces and
 * `& ' - .`. The same pattern as campaign-service's `NegativeKeywordInput.text`, so a request this
 * admits is not refused upstream on its character set. Upstream additionally refuses adjacent
 * punctuation and duplicate keywords, and names the reason in its 400.
 */
export const NEGATIVE_KEYWORD_TEXT_PATTERN = /^[\p{L}\p{M}\p{N} &'.-]+$/u;

/**
 * What a negative-keywords request reports when campaign-service answered 2xx with a body that
 * cannot be read positionally (no results array, the wrong number of results, or another
 * campaign's id). Negatives may have been added, so nothing is claimed either way.
 */
export const CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED =
  "The negative keywords were sent but the confirmation could not be read. Check the campaign's negative keywords in the ad platform before retrying.";

/**
 * The reporting windows the Microsoft keyword read accepts: `CAMPAIGN_METRICS_WINDOWS` without
 * `yesterday` and `last_14_days`, which the Microsoft client cannot map to a report date range
 * (`microsoftKeywordsWindowEnum`, campaign-service `design/connection.go`).
 */
export const MICROSOFT_KEYWORDS_WINDOWS = ['today', 'last_7_days', 'last_30_days', 'this_month', 'last_month'] as const;

/**
 * The platforms whose campaign budget campaign-service can change (`update-campaign-budget`).
 *
 * Hand-listed rather than derived from `CAMPAIGN_PLATFORMS`, because budget writing is wired per
 * platform upstream and is a narrower capability than pause/resume: X has neither, and a platform
 * can be toggleable long before its budget model is. Upstream refuses any other platform with 400,
 * so the Optimize tab withholds the editor for them rather than offering a doomed form.
 */
export const BUDGET_WRITABLE_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<string>([
  'google-ads',
  'linkedin-ads',
  'meta-ads',
  'microsoft-ads',
  'reddit-ads',
]);

/** The pacing choices the budget editor offers, in display order. Mirrors `VALID_CAMPAIGN_BUDGET_TYPES`. */
export const CAMPAIGN_BUDGET_TYPE_OPTIONS: readonly CampaignBudgetTypeOption[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'lifetime', label: 'Lifetime' },
] as const;

/** Why the budget editor is disabled for a platform campaign-service cannot write budgets on. */
export const CAMPAIGN_BUDGET_UNAVAILABLE_PLATFORM_REASON = 'Budget changes are not available for this platform in LFX One yet.';

/**
 * Why the budget editor is disabled for a campaign with no `platform_campaign_id`: it was never
 * created on its ad platform, so there is no budget there to change. Upstream refuses it with 409.
 */
export const CAMPAIGN_BUDGET_UNAVAILABLE_UNPROVISIONED_REASON = 'This campaign has not been created on its ad platform, so its budget cannot be changed.';

/**
 * What a budget change refused with 412 tells the operator: another write moved this campaign
 * since the list was read, so the validator is dead and only a re-read can produce a live one.
 * Nothing was changed. Retrying without a refresh earns the same 412.
 */
export const CAMPAIGN_BUDGET_CONFLICT_MESSAGE =
  'Someone else changed this campaign while you were viewing it, so the budget was not changed. Refresh the campaign list, then make the change again.';

/** Why the budget editor cannot submit while a 412 has proved the row's validator stale. */
export const CAMPAIGN_BUDGET_BLOCKED_STALE_REASON = 'This campaign changed since the list was read. Refresh the campaign list before changing its budget.';

/** Why the budget editor cannot submit while a pause or resume of the same row is in flight. */
export const CAMPAIGN_BUDGET_BLOCKED_TOGGLE_REASON = 'A pause or resume of this campaign is still in progress. Change the budget once it finishes.';

/** Why the budget editor cannot submit while a bid change of the same row is in flight (both need the row's validator). */
export const CAMPAIGN_BUDGET_BLOCKED_BID_REASON = 'A bid change of this campaign is still in progress. Change the budget once it finishes.';

/**
 * HTTP statuses that, when the response carries no message, mean nobody answered for a budget
 * write: the browser lost the connection (0), something timed out (408, 504), or a gateway in front
 * of the BFF replied instead (502, 503). The request may already have reached the ad platform, so
 * the Optimize tab reports these as unconfirmed rather than failed.
 */
export const CAMPAIGN_BUDGET_UNANSWERED_STATUSES: ReadonlySet<number> = new Set<number>([0, 408, 502, 503, 504]);

/** Shown for a refusal whose response carried no readable message. */
export const CAMPAIGN_BUDGET_FAILURE_FALLBACK = 'The budget could not be changed.';

/**
 * The Optimize-tab lever that resolves each monitor finding, keyed by the brief rule engine's
 * stable `rule` token (`BriefMetricsActionItem.rule`).
 *
 * The ONE place this decision is made. A `Record` over `BriefMetricsActionRule`, so adding a rule
 * to that union without deciding its lever is a compile error rather than a silent fall-through.
 * An unknown token on the wire is not in this map and resolves to `none` (`campaignActionRuleLever`).
 *
 * - `zero_delivery` → pause/resume: an active campaign that is not delivering. No budget change
 *   fixes it (the rule engine suppresses the pacing item for exactly that reason), so the lever is
 *   the run state.
 * - `underspending` / `budget_constrained` → budget: the pacing findings; the engine's own advice
 *   for both is to raise or right-size the budget.
 * - `low_ctr` / `no_conversions` → none: the remedy is creative, targeting, landing page or
 *   tracking work in the ad platform, which LFX One has no control for. The engine emits these per
 *   CAMPAIGN, not per keyword, so the keyword actions are not a resolution of them.
 *
 * Deliberately NOT mapped to the bid or negative-keyword levers. Neither is what the rule engine
 * advises for any of these rules: a bid change does not fix a campaign that delivers nothing (that
 * is the run state, or a bid strategy LFX One never changes), the pacing findings are resolved by
 * the budget, and negatives for `low_ctr` / `no_conversions` would need search-term evidence the
 * finding does not carry. Both levers stay reachable from the campaign row itself.
 */
export const CAMPAIGN_ACTION_RULE_LEVERS: Readonly<Record<BriefMetricsActionRule, CampaignOptimizeLever>> = {
  zero_delivery: 'pause_resume',
  underspending: 'budget',
  budget_constrained: 'budget',
  low_ctr: 'none',
  no_conversions: 'none',
};

/**
 * Platforms with per-keyword pause/remove in LFX One: Google Ads, and Microsoft Advertising through
 * campaign-service's `apply-keyword-actions` (`KEYWORD_ACTION_PLATFORMS`). Kept as its own `string`
 * set because the lever gate is asked about any row's platform, not only a keyword platform.
 */
export const KEYWORD_ACTION_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<string>([...KEYWORD_ACTION_PLATFORMS]);

/**
 * Which platforms each lever works on. The SAME sets the row controls are gated on, so a finding
 * can never offer a lever whose control would refuse the platform: the budget editor's
 * `BUDGET_WRITABLE_CAMPAIGN_PLATFORMS` (X has no budget write) and the toggle's
 * `TOGGLEABLE_CAMPAIGN_PLATFORMS`.
 */
export const CAMPAIGN_OPTIMIZE_LEVER_PLATFORMS: Readonly<Record<CampaignOptimizeControlLever, ReadonlySet<string>>> = {
  budget: BUDGET_WRITABLE_CAMPAIGN_PLATFORMS,
  pause_resume: TOGGLEABLE_CAMPAIGN_PLATFORMS,
  keywords: KEYWORD_ACTION_CAMPAIGN_PLATFORMS,
};

/** Visible label of each lever's button on a finding. The toggle's is the row's own action word. */
export const CAMPAIGN_OPTIMIZE_LEVER_LABELS: Readonly<Record<Exclude<CampaignOptimizeControlLever, 'pause_resume'>, string>> = {
  budget: 'Change budget',
  keywords: 'Review keywords',
};

/**
 * The platforms whose manual max CPC bid campaign-service can change (`update-campaign-bid`):
 * Microsoft Advertising, Reddit, Meta and X. Google Ads and LinkedIn are refused upstream with 400,
 * so the Optimize tab withholds the bid editor for them rather than offering a doomed form.
 *
 * Hand-listed for the reason `BUDGET_WRITABLE_CAMPAIGN_PLATFORMS` is: bid writing is wired per
 * platform upstream, and X has a bid write while it has no budget write or pause/resume here.
 */
export const BID_WRITABLE_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<string>(['microsoft-ads', 'reddit-ads', 'meta-ads', 'twitter-ads']);

/** Why the bid editor is disabled for a platform campaign-service cannot write bids on. */
export const CAMPAIGN_BID_UNAVAILABLE_PLATFORM_REASON = 'Bid changes are available for Microsoft Advertising, Reddit, Meta and X campaigns only.';

/** Why the bid editor is disabled for a campaign never created on its ad platform (upstream 409). */
export const CAMPAIGN_BID_UNAVAILABLE_UNPROVISIONED_REASON = 'This campaign has not been created on its ad platform, so its bid cannot be changed.';

/**
 * What the bid editor says about bidding strategies, always, before anything is sent. Upstream
 * refuses an automated or non-per-click strategy with a neutral 409 rather than switching it.
 */
export const CAMPAIGN_BID_STRATEGY_NOTE =
  'Applies only to campaigns on a manual per-click bid. Campaigns on automated bidding are refused, and LFX One never changes a bid strategy.';

/** What a bid change refused with 412 tells the operator. Nothing was changed. */
export const CAMPAIGN_BID_CONFLICT_MESSAGE =
  'Someone else changed this campaign while you were viewing it, so the bid was not changed. Refresh the campaign list, then make the change again.';

/** Why the bid editor cannot submit while a 412 has proved the row's validator stale. */
export const CAMPAIGN_BID_BLOCKED_STALE_REASON = 'This campaign changed since the list was read. Refresh the campaign list before changing its bid.';

/** Why the bid editor cannot submit while another change (pause/resume or budget) of the row is in flight. */
export const CAMPAIGN_BID_BLOCKED_BUSY_REASON = 'Another change to this campaign is still in progress. Change the bid once it finishes.';

/** Shown for a bid refusal whose response carried no readable message. */
export const CAMPAIGN_BID_FAILURE_FALLBACK = 'The bid could not be changed.';

/**
 * campaign-service's wording for a DEFINITE 503 on a bid change ("... the campaign was not
 * modified"). Every other 503 on the bid route is reported as unconfirmed, because a 503 is also
 * how an unconfirmed outcome and an unanswered gateway arrive.
 */
export const CAMPAIGN_BID_DEFINITE_FAILURE_MARKER = 'was not modified';

/** The platforms a campaign-level negative keyword can be added on (`add-negative-keywords`). */
export const NEGATIVE_KEYWORD_CAMPAIGN_PLATFORMS: ReadonlySet<string> = new Set<string>(['microsoft-ads']);

/** Why the negative-keyword editor is disabled for a campaign never created on its ad platform. */
export const CAMPAIGN_NEGATIVE_KEYWORDS_UNAVAILABLE_UNPROVISIONED_REASON =
  'This campaign has not been created on its ad platform, so negative keywords cannot be added to it.';

/** The match types the negative-keyword editor offers, in display order. Mirrors `VALID_CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPES`. */
export const CAMPAIGN_NEGATIVE_KEYWORD_MATCH_TYPE_OPTIONS: readonly CampaignNegativeKeywordMatchTypeOption[] = [
  { value: 'Exact', label: 'Exact' },
  { value: 'Phrase', label: 'Phrase' },
] as const;

/** Visible label of each per-keyword outcome. UNCONFIRMED is never worded as a failure. */
export const CAMPAIGN_NEGATIVE_KEYWORD_OUTCOME_LABELS: Readonly<Record<CampaignNegativeKeywordOutcome, string>> = {
  APPLIED: 'Added',
  ALREADY_PRESENT: 'Already present',
  FAILED: 'Not added',
  UNCONFIRMED: 'Not confirmed',
};

/** What an UNCONFIRMED negative keyword tells the operator to do before trying it again. */
export const CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE =
  "This keyword may have been added. Check the campaign's negative keywords in Microsoft Advertising before retrying.";

/** Shown for a negative-keywords refusal whose response carried no readable message. */
export const CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK = 'The negative keywords could not be added.';

/** The window selector of the Microsoft keyword table, in display order, over `MICROSOFT_KEYWORDS_WINDOWS`. */
export const MICROSOFT_KEYWORDS_WINDOW_OPTIONS: readonly MicrosoftKeywordsWindowOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: '7d' },
  { value: 'last_30_days', label: '30d' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
] as const;

/** The window the Microsoft keyword table opens on: upstream's own default. */
export const DEFAULT_MICROSOFT_KEYWORDS_WINDOW: MicrosoftKeywordsWindow = 'last_30_days';

// NOTE: LinkedIn ad accounts, default account/org IDs, employer exclusions, and
// targeting profile URN lists are loaded at runtime from a mounted ConfigMap
// (see apps/lfx-one/src/server/services/linkedin-ads.service.ts → loadLinkedInConfig).
// They are kept out of source control entirely so vendor IDs never ship in the
// client bundle or the public chart repo.

export const LINKEDIN_GEO_RESOLVE_MAP: Readonly<Record<string, LinkedInGeoTarget>> = {
  japan: { label: 'Japan', urn: 'urn:li:geo:101355337' },
  india: { label: 'India', urn: 'urn:li:geo:102713980' },
  singapore: { label: 'Singapore', urn: 'urn:li:geo:102454443' },
  'south korea': { label: 'South Korea', urn: 'urn:li:geo:105149562' },
  australia: { label: 'Australia', urn: 'urn:li:geo:101452733' },
  taiwan: { label: 'Taiwan', urn: 'urn:li:geo:104441761' },
  'hong kong': { label: 'Hong Kong', urn: 'urn:li:geo:103291313' },
  'united states': { label: 'United States', urn: 'urn:li:geo:103644278' },
  usa: { label: 'United States', urn: 'urn:li:geo:103644278' },
  germany: { label: 'Germany', urn: 'urn:li:geo:101165590' },
  'united kingdom': { label: 'United Kingdom', urn: 'urn:li:geo:106693272' },
} as const;

// ---------------------------------------------------------------------------
// Reddit Ads — Objective Parameters
// ---------------------------------------------------------------------------

export const REDDIT_OBJECTIVE_PARAMS: Readonly<Record<RedditObjective, RedditObjectiveParams>> = {
  awareness: { redditObjective: 'IMPRESSIONS', bidType: 'CPM', bidValue: 3_000_000, optimizationGoal: 'IMPRESSIONS' },
  traffic: { redditObjective: 'CLICKS', bidType: 'CPC', bidValue: 500_000, optimizationGoal: 'CLICKS' },
  conversions: {
    redditObjective: 'CONVERSIONS',
    bidType: 'CPM',
    bidValue: 3_000_000,
    optimizationGoal: 'PURCHASE',
    viewThroughConversionType: 'SEVEN_DAY_CLICKS_ONE_DAY_VIEW',
  },
  video_views: { redditObjective: 'VIDEO_VIEWABLE_IMPRESSIONS', bidType: 'CPM', bidValue: 3_000_000, optimizationGoal: 'VIDEO_VIEWS' },
} as const;

export const REDDIT_OBJECTIVE_LABELS: Readonly<Record<RedditObjective, string>> = {
  awareness: 'Awareness',
  traffic: 'Traffic',
  conversions: 'Conversions',
  video_views: 'Video Views',
} as const;

/**
 * The objective both creators fall back to when a request omits one.
 *
 * Stated here because it has to be what the picker starts on. Nothing has ever sent `objective`,
 * so every Reddit campaign created to date was built from this default on whichever arm served it
 * — `defaultRedditObjective` upstream (`client.go:135`) and `config.objective ?? 'conversions'` in
 * the legacy creator (`reddit-ads.service.ts`), which agree. Seeding the control with anything
 * else would quietly change what an operator who touches nothing gets.
 */
export const DEFAULT_REDDIT_OBJECTIVE: RedditObjective = 'conversions';

/**
 * The objectives the picker offers, as distinct from the four `RedditObjective` admits.
 *
 * `video_views` is withheld because it cannot currently succeed. Reddit has no bare `VIDEO_VIEWS`
 * optimization goal, so a video-view campaign must name a concrete one; upstream requires a
 * `videoGoal` from `REDDIT_VIDEO_GOALS` for that objective and refuses the create without it, and
 * no control collects one yet. (The legacy creator does not refuse — it sends its own
 * `optimizationGoal: 'VIDEO_VIEWS'`, which is the value Reddit has no such goal for, so that arm
 * fails at Reddit instead of locally.) Offer it once a goal control exists on both roads.
 *
 * `REDDIT_OBJECTIVE_LABELS` stays total over `RedditObjective` rather than being narrowed to this
 * list, so a draft holding a withheld objective still renders a name instead of `undefined` — the
 * same split, for the same reason, as `META_SELECTABLE_OBJECTIVES` and `META_OBJECTIVE_LABELS`.
 */
export const REDDIT_SELECTABLE_OBJECTIVES = ['awareness', 'traffic', 'conversions'] as const;

/**
 * The call-to-action button labels Reddit accepts on a promoted post.
 *
 * Mirrors `redditCTAs` in lfx-v2-campaign-service `internal/platform/reddit/client.go:552`, which
 * captured them live from the Reddit Ads API v3 post-create validation on 2026-08-20. The values
 * are Reddit's exact title-case labels — that casing is what must be sent — and the order here is
 * upstream's textual order so the two lists diff against each other directly.
 *
 * Upstream matches case-insensitively and rejects anything outside the set, so this list is what
 * bounds the choice offered here: a label absent from it cannot be sent at all, whether or not
 * Reddit would accept it. Re-capture both sides together if upstream's set changes.
 *
 * Only consulted on the author-a-post path (an `imageUrl` with no `postUrl`); upstream ignores the
 * CTA entirely when the campaign points at an existing post.
 */
export const REDDIT_CALL_TO_ACTIONS = [
  'Apply Now',
  'Contact Us',
  'Download',
  'Get a Quote',
  'Get Showtimes',
  'Install',
  'Learn More',
  'Order Now',
  'Play Now',
  'Pre-order Now',
  'See Menu',
  'Shop Now',
  'Sign Up',
  'View More',
  'Watch Now',
  'Book Now',
  'Buy Tickets',
  'Get Directions',
  'Listen Now',
  'Read More',
  'Subscribe',
  'Visit Store',
  'Donate Now',
  'Remind Me',
] as const;

/**
 * The CTA upstream falls back to when none is sent — `defaultRedditCTA` in the same upstream file
 * (`client.go:139`). Stated here so the control can pre-select what an empty field would produce
 * rather than presenting a blank that silently resolves to something else.
 *
 * Must stay a member of `REDDIT_CALL_TO_ACTIONS`, exactly as upstream requires of its own default;
 * `campaign.constants.spec.ts` pins that.
 */
export const DEFAULT_REDDIT_CALL_TO_ACTION = 'Learn More';

/**
 * The concrete video optimization goals Reddit accepts — `validVideoGoals` in the same upstream
 * file (`client.go:539`).
 *
 * Required for, and only for, the `video_views` objective: Reddit has no bare `VIDEO_VIEWS` goal,
 * so a video-view campaign must name one of these, and upstream validates it before any mutating
 * call. Sending one with any other objective is pointless, not fatal.
 */
export const REDDIT_VIDEO_GOALS = ['VIDEO_VIEW_6S', 'VIDEO_VIEW_15S'] as const;

/**
 * Shown when a creation job can no longer be found on either polling source.
 *
 * Lives in shared constants rather than in `campaign-proxy.service.ts` because both tiers
 * render it: the Express `not_found` outcome and the Angular poller's `not_found` arm. Keeping
 * it beside the vendor-direct service would also point the campaign-service client at the very
 * module the cutover exists to retire.
 */
export const JOB_LOST_MESSAGE = 'Lost connection to the campaign creation process. Please try again.';

/**
 * How many HubSpot template rows the picker will RENDER at once.
 *
 * The upstream 500-row cap does not bound this list. `HubSpotEmailSearchResult` documents that a
 * FILTERED search is exempt from that cap — truncating one would report an email that exists as
 * absent — so a broad query ("a") walks up to 200 pages and can answer with thousands of rows,
 * each of which the template renders as a button.
 *
 * This caps the RENDER, not the result: `emailTemplates` keeps every row it was given, so the
 * count the picker reports is the true total. The list is not silently shortened — the template
 * states "Showing N of M" whenever this bites, because a list that is quietly cut off
 * reads as a complete answer and sends someone hunting for a template that was fetched but never
 * drawn.
 *
 * A cap rather than virtual scrolling: nothing in this repo virtualises a list today (no
 * `cdk-virtual-scroll-viewport` anywhere in `apps/lfx-one`), and introducing the first one here
 * would be a new pattern rather than a followed one. Narrowing the search is also the action the
 * user actually wants — scrolling 4,000 rows is not.
 */
export const HUBSPOT_TEMPLATE_RENDER_LIMIT = 100;

/**
 * Every reporting window campaign-service accepts, as a runtime list.
 *
 * `CampaignMetricsWindow` is a compile-time type and cannot check a query string, so a BFF route
 * taking `?window=` needs this to reject a value before it reaches the wire. Kept beside the type
 * and derived from the same source (`metricsWindowEnum`, `design/brief.go`) so the two cannot
 * drift: a value accepted here but absent from the type — or the reverse — would be a 400 the
 * caller cannot predict from the published contract.
 *
 * Order is the enum's, widening then calendar-relative; nothing depends on it.
 */
export const CAMPAIGN_METRICS_WINDOWS = ['today', 'yesterday', 'last_7_days', 'last_14_days', 'last_30_days', 'this_month', 'last_month'] as const;

/**
 * Told to an operator wherever an email action needs a brief that does not exist yet.
 *
 * Shared because it appears at three points in the email flow (copy generation, audience build,
 * staging) and it is the copy that tells someone how to unblock themselves -- three literals drift
 * apart, and the one that drifts is the one nobody re-reads.
 */
export const EMAIL_BRIEF_REQUIRED_HINT = 'Generate a brief on the Plan tab first.';

/**
 * How much harder an EVENT term counts than an email-type keyword when ranking clone templates.
 *
 * Within one portal that runs several events, "which event is this" discriminates far harder than
 * "which stage of the sequence": a KubeCon registration push and an MCP Dev Summit registration
 * push score identically on type keywords, and only the event term tells them apart.
 *
 * It does NOT guarantee an event hit outranks every type-only match, and an earlier version of this
 * comment wrongly claimed it did on the grounds that "types carry at most three keywords" -- they
 * carry four to seven (`final-countdown` has seven), so a type-only match can reach 7 and outrank a
 * single short event hit at 3. What the weight buys is that a template matching BOTH sorts above one
 * matching only the type, which is the ordering that matters. The suggestion does not rely on rank
 * at all: it scores the event alone and is spliced into the rendered list if ranking cuts it.
 */
export const EVENT_TERM_WEIGHT = 3;

/**
 * The lowest event score that may PRE-SELECT a template rather than merely rank it.
 *
 * Two independent event hits, or one weighted hit. Below this the suggestion is withheld entirely
 * and the operator picks by hand, which is the honest outcome: a confidently wrong pre-selection
 * clones another event's branding into a real HubSpot draft, and because it looks decided nobody
 * re-reads it. Ranking still applies -- a weak signal is worth ordering by, just not deciding by.
 */
export const EVENT_TEMPLATE_SUGGESTION_MIN_SCORE = 6;

/**
 * Length at which a matched event term is treated as evidence on its own.
 *
 * Corroboration by a second term is the usual bar, but it is the wrong bar for a distinctive brand
 * token. Verified against the live portal: "KubeCon North America" reduces to
 * `kubecon | salt | lake | city`, and "KubeCon NA 2026 - Registration" matches only `kubecon` --
 * one hit, withheld, despite naming the event unambiguously. Meanwhile a short token like `dev`
 * or `mcp` really does need corroboration, because it occurs in unrelated template names.
 *
 * Six characters is where the two groups separate in practice (`kubecon`, `nairobi`, `pytorch`,
 * `zephyr` above it; `dev`, `mcp`, `city`, `salt`, `lake` below), so a single long-token hit is
 * scored double and clears the threshold alone while a short one still cannot.
 */
export const EVENT_TERM_DISTINCTIVE_LENGTH = 6;

/**
 * Words that are long enough to look distinctive but carry no event identity.
 *
 * `EVENT_TERM_DISTINCTIVE_LENGTH` uses length as a proxy for distinctiveness, and the proxy is
 * wrong for a whole class of words: `register`, `webinar`, `keynote`, `session`, `speaker`,
 * `reminder` are all six-plus characters and all generic, so each cleared the suggestion threshold
 * on a SINGLE hit and pre-selected an unrelated template.
 *
 * These are excluded from the distinctive DOUBLE weight rather than dropped from matching
 * entirely: they still order templates that already name the event, they just cannot be the reason
 * one is suggested. Distinct from EVENT_TERM_STOPWORDS, which removes a token from matching
 * altogether.
 *
 * A vocabulary is still a list and still needs appending, and an UN-LISTED generic word still
 * produces a confidently wrong suggestion -- it takes the double weight and clears the threshold
 * alone, exactly as before. An earlier version of this note claimed the opposite (a missed
 * suggestion rather than a wrong one), which inverted the actual failure mode.
 *
 * What listing a word changes is that word: it drops to single weight, so it can rank but cannot
 * justify a suggestion by itself. The remaining limit is pinned by the spec test
 * "still pre-selects on an un-enumerated generic long word (known limit)", so it is measured
 * rather than assumed away.
 */
export const EVENT_TERM_GENERIC: ReadonlySet<string> = new Set([
  'register',
  'registration',
  'webinar',
  'keynote',
  'session',
  'sessions',
  'speaker',
  'speakers',
  'reminder',
  'newsletter',
  'announcement',
  'invitation',
  'schedule',
  'agenda',
  'program',
  'update',
  'updates',
  'welcome',
  'community',
  'training',
  'workshop',
]);

/**
 * Words dropped from an event name before it is used to match template names.
 *
 * Every one of these appears in ordinary event titles AND in unrelated template names, so keeping
 * them manufactures hits that mean nothing -- "2026" matches every template written this year, and
 * "summit" matches every summit in the portal. Short tokens are dropped separately by length.
 */
export const EVENT_TERM_STOPWORDS: readonly string[] = [
  'the',
  'and',
  'for',
  'con',
  'conference',
  'summit',
  'event',
  'events',
  'day',
  'days',
  'annual',
  'north',
  'south',
  'america',
  'europe',
  'asia',
  // GENERIC, whatever their length. Length was standing in for distinctiveness, and the six-plus
  // character ones broke that proxy outright: a single hit scored double and cleared the
  // threshold alone, so "Open Source Summit" reduced to `open` + `source` and `source`
  // pre-selected an unrelated "Source newsletter". A confident wrong pick is the one outcome the
  // suggestion must never produce.
  //
  // `forum` (5) and `expo` (4) are shorter than that and do NOT clear the threshold alone. They
  // are here because they are just as generic and still inflate a score toward it -- the list is
  // about the words carrying no event identity, not about their length. An earlier version of
  // this note said they were all six-plus characters, which two of them are not.
  'source',
  'global',
  'online',
  'virtual',
  'storage',
  'meetup',
  'forum',
  'expo',
];

/**
 * Matches a year-shaped token, which is dropped from event terms whatever the year.
 *
 * Years were originally enumerated in the stopword list, which made the protection EXPIRE: in 2028
 * an `Open Source Summit 2028` brief and an unrelated `Open newsletter 2028` template would match
 * `open` plus `2028`, reach the threshold, and be pre-selected. A pattern cannot go stale.
 *
 * Deliberately narrow — four digits beginning 19 or 20. A bare `\d{4}` would also drop conference
 * numbers and venue codes that really do identify an event.
 */
export const EVENT_TERM_YEAR_PATTERN = /^(19|20)\d{2}$/;

/**
 * The twelve email types an event programme sends, in lifecycle order, each mapped to the stage
 * campaign-service generates from.
 *
 * Ported from the LF-Marketing-Ops reference (prasad/skills, 3bca85c2). Several types share a
 * stage on purpose: a CFP launch and a co-located CFP reminder differ in when they are sent, not
 * in how the copy is written.
 *
 * `Thank You + Survey` is where a post-event survey ask lives. It is an email type, not a separate
 * campaign or audience -- the survey is a CTA inside a post-event email to the same registrants.
 *
 * `keywords` rank clone templates (#1942) and are the reference's own matchers.
 */
export const CAMPAIGN_EMAIL_TYPES: readonly CampaignEmailTypeOption[] = [
  { id: 'cfp-launch', label: 'CFP Launch', stage: 'CFP Launch', keywords: ['cfp', 'call for proposals', 'call for speakers', 'speak'] },
  {
    id: 'registration-launch',
    label: 'Registration Launch',
    stage: 'Registration Push',
    keywords: ['registration', 'register', 'cfp open', 'registration live'],
  },
  { id: 'colocated-cfp-reminder', label: 'Co-Located Events + CFP Reminder', stage: 'CFP Launch', keywords: ['cfp', 'co-located', 'colocated', 'reminder'] },
  { id: 'dei-travel-fund', label: 'DEI & Travel Fund', stage: 'Discount Offer', keywords: ['dei', 'travel fund', 'scholarship', 'diversity'] },
  { id: 'schedule-announcement', label: 'Schedule Announcement', stage: 'Schedule Announcement', keywords: ['schedule', 'keynote', 'sessions', 'agenda'] },
  { id: 'main-registration-push', label: 'Main Registration Push', stage: 'Registration Push', keywords: ['register', 'reminder', 'registration', 'push'] },
  {
    id: 'final-countdown',
    label: 'Final Countdown',
    stage: 'Final Countdown',
    keywords: ['last chance', 'last call', 'final', 'countdown', 'closing', 'closes', 'deadline'],
  },
  { id: 'event-week', label: 'Event Week', stage: 'Final Countdown', keywords: ['reminder', 'event week', 'logistics', 'venue', 'join us'] },
  { id: 'thank-you-survey', label: 'Thank You + Survey', stage: 'Post-Event', keywords: ['thank you', 'thanks', 'survey', 'feedback', 'post-event'] },
  { id: 'content-recordings', label: 'Content & Recordings Release', stage: 'Post-Event', keywords: ['recording', 'content', 'recap', 'slides', 'session'] },
  { id: 'next-event-teaser', label: 'Next Event CFP Teaser', stage: 'CFP Launch', keywords: ['cfp', 'upcoming', 'next event', 'teaser', 'save the date'] },
  { id: 'community-nurture', label: 'Community Nurture', stage: 'Post-Event', keywords: ['community', 'newsletter', 'update', 'nurture'] },
];

/**
 * The type selected when the operator has not chosen one.
 *
 * Main Registration Push, because its stage is what the generator produced before stages existed
 * -- so an operator who ignores the selector gets exactly the copy they get today.
 */
export const DEFAULT_CAMPAIGN_EMAIL_TYPE_ID = 'main-registration-push';

/**
 * Every stage an email campaign can occupy, in the order a series runs.
 *
 * A runtime list rather than only a type, because the values are validated at the wire boundary:
 * campaign-service keys a brief on its stage, so a stage the UI does not recognise must be
 * rejected there rather than silently addressing a different brief.
 */
export const CAMPAIGN_EMAIL_STAGES = ['CFP Launch', 'Schedule Announcement', 'Registration Push', 'Discount Offer', 'Final Countdown', 'Post-Event'] as const;

// ---------------------------------------------------------------------------
// Audience Builder
// ---------------------------------------------------------------------------

/**
 * How long the BFF waits on an audience-builder call to the campaign service.
 *
 * Far above the 30s default (`api-client.service.ts`) because these endpoints are not
 * database reads — each one walks the HubSpot Marketing API. `last-sent` alone pages up to
 * 2000 emails (20 sequential requests) to rule out a false absence, then fans out one GET per
 * shortlisted send plus one per referenced list. Measured against the live TLF portal on
 * 2026-09-24: 32s at `limit=3` (what the panel asks for) and 58s at the design's `limit=10`.
 *
 * At 30s the call was aborted mid-flight and "Recent sends for this event" rendered as a
 * failure on every load, even though upstream went on to answer 200. The ceiling is a
 * giving-up point, not a budget: raising it costs nothing on the calls that return quickly.
 */
export const AUDIENCE_BUILDER_REQUEST_TIMEOUT_MS = 120_000;

/**
 * The Audience Builder tab.
 *
 * Declared on its own rather than added to `CAMPAIGN_TABS` because it is email-only: the paid
 * flow's four phases are unchanged, and pushing this into the shared list would render an
 * Audience tab beside Optimize where nothing behind it exists.
 */
export const CAMPAIGN_AUDIENCE_TAB: CampaignTabOption = { id: 'audience', label: 'Audience', icon: 'fa-light fa-users-viewfinder' };

/**
 * The email flow's tabs: Plan -> Audience -> Implement -> Monitor.
 *
 * Audience sits second because it is a precondition for Implement, not a follow-up to it — you
 * assemble who the email goes to before you write and stage it.
 *
 * The three shared entries are looked up from `CAMPAIGN_TABS` rather than restated, so a label
 * or icon change there reaches both flows. A missing id would silently drop a tab, so the lookup
 * hard-fails instead of filtering: this list is built once at module load, and a thrown error at
 * startup is a far cheaper failure than a tab that is quietly absent in production.
 */
export const CAMPAIGN_EMAIL_TABS: readonly CampaignTabOption[] = ['planning', 'audience', 'implementation', 'insights'].map((id) => {
  if (id === CAMPAIGN_AUDIENCE_TAB.id) {
    return CAMPAIGN_AUDIENCE_TAB;
  }
  const tab = CAMPAIGN_TABS.find((t) => t.id === id);
  if (!tab) {
    throw new Error(`CAMPAIGN_EMAIL_TABS references unknown tab id "${id}"`);
  }
  return tab;
});

/**
 * Bucket render order for the discovery review grid.
 *
 * Ordered by how much an operator trusts the bucket, not alphabetically: what was actually sent
 * before comes first, then the strongest first-party engagement signals (registration,
 * speakers), then opt-ins, then the weaker inferred signals, and finally the two buckets that
 * demand a human decision.
 */
export const AUDIENCE_SIGNAL_ORDER = [
  'last_sent',
  'event_registration',
  'event_speakers',
  'project_opt_in',
  'lf_newsletter_opt_in',
  'education_enrollment',
  'page_view',
  'uncertain',
  'added',
] as const satisfies readonly AudienceSignal[];

/**
 * Bucket heading, caption, and accent per signal.
 *
 * `accentClass` is a Tailwind border utility, not a hex value: the accent has to invert with the
 * theme, and a literal color baked in here would be the one thing on the page that does not.
 *
 * Typed as a total `Record` so adding a member to `AudienceSignal` is a compile error here rather
 * than a bucket that renders with a blank heading.
 */
export const AUDIENCE_SIGNAL_INFO: Record<AudienceSignal, { label: string; description: string; accentClass: string }> = {
  last_sent: {
    label: 'Used In Past Sends',
    description: 'Used in a past send for this event but not classified under the signals below',
    accentClass: 'border-l-blue-700',
  },
  event_registration: {
    label: 'Event Registration',
    description: 'All-time registrants for this event',
    accentClass: 'border-l-green-700',
  },
  event_speakers: {
    label: 'Event Speakers',
    description: 'Speakers for this event specifically',
    accentClass: 'border-l-orange-600',
  },
  project_opt_in: {
    label: 'Project Opt-In',
    description: "Opted into this project's own subscription type",
    accentClass: 'border-l-blue-500',
  },
  lf_newsletter_opt_in: {
    label: 'LF Newsletter Opt-In',
    description: 'Opted into the Linux Foundation newsletter',
    accentClass: 'border-l-violet-700',
  },
  education_enrollment: {
    label: 'Education Enrollment',
    description: 'Enrolled in related education content',
    accentClass: 'border-l-amber-500',
  },
  page_view: {
    label: 'Page View',
    description: "Viewed this event's page",
    accentClass: 'border-l-pink-700',
  },
  uncertain: {
    label: 'Uncertain',
    description: 'Needs manual review before including',
    accentClass: 'border-l-gray-400',
  },
  added: {
    label: 'Manually Added',
    description: 'Manually added via search',
    accentClass: 'border-l-gray-500',
  },
};

/**
 * Compile-time exhaustiveness: every `AudienceSignal` must appear in `AUDIENCE_SIGNAL_ORDER`.
 *
 * The element type alone only rejects a WRONG entry; it cannot catch a MISSING one. Without this,
 * adding a signal compiles cleanly, `AUDIENCE_SIGNAL_INFO` hard-fails and names it, but the order
 * list would silently drop the bucket from the grid — lists classified into it would be
 * discovered, held in state, and never rendered.
 *
 * Written as an assignment FROM the array's member union TO the full union: no cast, no
 * `Object.fromEntries`. Both defeat the check by widening the type back to something assignable.
 */
const _assertEveryAudienceSignalIsOrdered: (typeof AUDIENCE_SIGNAL_ORDER)[number] extends AudienceSignal
  ? AudienceSignal extends (typeof AUDIENCE_SIGNAL_ORDER)[number]
    ? true
    : { ERROR: 'AUDIENCE_SIGNAL_ORDER is missing a signal'; missing: Exclude<AudienceSignal, (typeof AUDIENCE_SIGNAL_ORDER)[number]> }
  : { ERROR: 'AUDIENCE_SIGNAL_ORDER contains a hidden or unknown signal' } = true;
void _assertEveryAudienceSignalIsOrdered;

/**
 * Speaker-list scopes, as three independently selectable rows.
 *
 * Speakers are split by edition rather than pooled because the three groups get different email:
 * a call-for-papers reminder is for prospective speakers, a logistics email for confirmed
 * current-edition ones, and a "speak again" email for past ones.
 */
export const AUDIENCE_SPEAKER_SCOPES: readonly { key: AudienceSpeakerScope; label: string }[] = [
  { key: 'current', label: 'Current event speakers' },
  { key: 'past', label: 'Past event speakers' },
  { key: 'current_past', label: 'Current + Past event speakers' },
] as const;

/**
 * Above this combined estimated size, an exact union count is refused.
 *
 * HubSpot exposes no way to count an arbitrary OR-of-lists, so the only exact answer comes from
 * paginating every selected list's membership and unioning the ids in memory. The cap bounds that
 * sweep: without it, one click on "Get exact count" over a few large lists is an unbounded
 * pagination run against a rate-limited API.
 *
 * Enforced by lfx-v2-campaign-service, which owns the sweep. Kept here because the client renders
 * the refusal as `25,000+`, and that label must name the same number the service capped at.
 */
export const AUDIENCE_UNION_EXACT_CAP = 25_000;

/** Debounce on the list typeahead, so a keystroke is not a HubSpot search. */
export const AUDIENCE_LIST_TYPEAHEAD_DEBOUNCE_MS = 300;

/**
 * Recognised `variant` values for `generate-email-copy`. Currently just the one: a differently
 * styled draft of the same stage's copy (urgency/FOMO-forward structure) instead of the stage's
 * normal copy. Like `stage`, campaign-service treats an unrecognised or absent value as "no
 * variant requested" rather than an error, so this list is for the UI's own selector rather than
 * wire validation.
 */
export const CAMPAIGN_EMAIL_VARIANTS = ['urgency-fomo'] as const;

/**
 * Recognised `segment` values for `generate-email-copy`: narrows which content blocks appear for a
 * named audience within the same stage's copy, orthogonal to `variant` (which restyles the whole
 * draft). Both may be set together, either alone, or neither. Like `stage` and `variant`,
 * campaign-service treats an unrecognised or absent value as "no segment requested" rather than an
 * error, so this list is for the UI's own selector rather than wire validation.
 */
export const CAMPAIGN_EMAIL_SEGMENTS = ['developer', 'business-decision-maker', 'alumni', 'prospect'] as const;

/**
 * The selector's visible label per segment.
 *
 * Keyed on `CampaignEmailSegment` rather than on a re-spelled literal union so this map cannot
 * drift from the type `CAMPAIGN_EMAIL_SEGMENTS` derives -- a member added to or renamed in the
 * list fails to compile HERE.
 */
export const CAMPAIGN_EMAIL_SEGMENT_LABELS: Readonly<Record<CampaignEmailSegment, string>> = {
  developer: 'Developer',
  'business-decision-maker': 'Business Decision-Maker',
  alumni: 'Alumni (Past Attendee)',
  prospect: 'Prospect (First-Time)',
};

/**
 * Most sponsor logos carried on a brief.
 *
 * Shared rather than helper-local because THREE sites enforce it — the scrape path, the
 * controller's allow-list, and the client preview — and each entry is a server-side image fetch
 * downstream. A cap that lives in one of them can silently diverge from the others, and the
 * preview would then promise a logo the draft drops.
 */
export const MAX_SPONSORS = 10;

/**
 * Longest sponsor name forwarded, in CODE POINTS.
 *
 * Shared for the same reason as MAX_SPONSORS: the controller truncates and the preview must show
 * the truncated form, or the preview promises a name the sent email does not carry. The name
 * reaches a sent email as alt text and is caller-supplied display text with no upstream cap.
 */
export const MAX_SPONSOR_NAME_LENGTH = 100;

/**
 * Longest HubSpot email body (`bodyHtml` / `bodyHtmlB`) the campaign create route will sanitise,
 * in UTF-16 code units.
 *
 * The route has no body validator, so without this the only bound on what reaches
 * `stripResourceLoadingHtml` is express.json's 15 MB limit, and any super-linear step in the
 * sanitiser or its HTML parser is reachable at that size before any upstream or ownership check.
 * The ceiling (131,072 code units) is a resource bound, not a content rule: it sits above the
 * ~102 KB message size at which Gmail starts clipping, so typical campaign bodies fit with room
 * to spare.
 */
export const MAX_HUBSPOT_BODY_HTML_LENGTH = 128 * 1024;

/**
 * The exact hosts whose hero image the email preview may LOAD in the operator's browser. Every
 * other host is named, never loaded. Exact hosts, not the `linuxfoundation.org` zone: LFX One and
 * the SSO host sit under that zone, so a zone-wide rule let a scraped page point the preview at a
 * same-site, cookie-carrying GET such as the app's own `/logout`.
 */
export const EMAIL_HERO_PREVIEW_HOSTS: ReadonlySet<string> = new Set(['linuxfoundation.org', 'www.linuxfoundation.org', 'events.linuxfoundation.org']);

/** The image file extensions the hero preview may load; matched on the URL path, case-insensitively. */
export const EMAIL_HERO_PREVIEW_IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|svg)$/i;

/** HubSpot's app hosts (`app.hubspot.com`, regional `app-eu1.hubspot.com`): where a staged draft link may point. */
export const HUBSPOT_APP_HOST_PATTERN = /^app(?:-[a-z0-9]+)?\.hubspot\.com$/;

/**
 * The most list ids one audience-builder request may carry per array (include, suppression,
 * exclude). The BFF refuses more; the Audience tab checks the same bound before offering an action.
 */
export const AUDIENCE_ATTACH_MAX_LIST_IDS = 50;

/** The longest `inclusionSummary` the BFF accepts on an attach; it is stored on the audience row. */
export const AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH = 2_000;

/**
 * Resource bounds on the Google creative and bidding strings the create route normalises.
 *
 * The same hazard `MAX_HUBSPOT_BODY_HTML_LENGTH` answers, reached through the other half of the same
 * handler: the route has no body validator, so a 15 MB body of two hundred thousand headline strings
 * is filtered, trimmed and re-allocated before any upstream or ownership check runs.
 *
 * Deliberately FAR above anything legitimate, because these are resource bounds and not content
 * rules — every width and count in `GOOGLE_CREATIVE_FIELD_SPECS` is the upstream client's preflight
 * to enforce, and this layer stays shape-only. The widest catalogue list holds 20 entries and the
 * widest text field 256 characters (`assetGroupName`), so nothing a real operator can produce comes
 * near either ceiling; refusing here can therefore never refuse a create upstream would have
 * accepted.
 */
export const MAX_GOOGLE_CREATIVE_LIST_ENTRIES = 100;
export const MAX_GOOGLE_CREATIVE_FIELD_LENGTH = 2048;

/**
 * The Google channels this application can ask campaign-service to create, in the order the
 * Implementation tab offers them. Each maps one-to-one onto `googleAdsConfig.channel` upstream
 * (`internal/dispatch/googleads.go`).
 *
 * Exactly ONE may be selected per create today. The BFF emits a single `googleAdsConfig`
 * carrying a single `channel`, so a second selection would be dispatched as one campaign with
 * the other silently dropped — along with its share of the budget. `createCampaigns` refuses the
 * pair rather than letting that look like success.
 */
export const GOOGLE_CAMPAIGN_CHANNELS = ['search', 'demand-gen', 'performance-max', 'video', 'display'] as const;

/**
 * Display names for the Google channels, for error messages and form controls.
 *
 * Google's own product names, not the wire values: a user who reads "performance-max cannot be
 * created together with video" has to work out that those are the two boxes they ticked. The
 * refusal in `createCampaigns` and the Implementation tab's labels both read from here so the
 * two never drift apart.
 */
export const GOOGLE_CAMPAIGN_CHANNEL_LABELS = {
  search: 'Search',
  'demand-gen': 'Demand Gen',
  'performance-max': 'Performance Max',
  video: 'Video',
  display: 'Display',
} as const;

/**
 * The `campaign.advertising_channel_type` enum value Google Ads reports for each of our channels.
 *
 * GAQL names the channel with Google's own enum, not our wire value, so a monitoring query cannot
 * reuse {@link GOOGLE_CAMPAIGN_CHANNELS} directly. Every value here is mirrored from the
 * `advertisingChannel*` constants in campaign-service's `internal/platform/googleads` package
 * (`campaign.go`, `demandgen.go`, `pmax.go`, `video.go`, `display.go`) — the same literals it
 * sends on create — so a campaign this application created is guaranteed to match the filter that
 * reads it back.
 *
 * Keyed by channel rather than written inline so the create side and the read side cannot drift:
 * a channel added to `GOOGLE_CAMPAIGN_CHANNELS` without an entry here fails to compile.
 */
export const GOOGLE_ADS_CHANNEL_TYPE_ENUMS = {
  search: 'SEARCH',
  'demand-gen': 'DEMAND_GEN',
  'performance-max': 'PERFORMANCE_MAX',
  video: 'VIDEO',
  display: 'DISPLAY',
} as const satisfies Record<(typeof GOOGLE_CAMPAIGN_CHANNELS)[number], string>;

/**
 * The Google channels gated behind `LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_CHANNELS`.
 *
 * `search` needs no flag — it is the dispatcher's default. `demand-gen` has carried its own flag
 * since LFXV2-3257 and keeps it, so enabling the three newer channels cannot silently enable
 * Demand Gen on a deployment that was not ready for it.
 */
export const GOOGLE_CAMPAIGN_CHANNELS_REQUIRING_FLAG = ['performance-max', 'video', 'display'] as const;

/**
 * Whether this application offers Video as a CREATABLE channel.
 *
 * `false` — and not because of a deployment flag or a gap on our side. The Google Ads API has no
 * call that creates a Video campaign at all: campaign-service's `CreateVideoCampaign` returns the
 * `ErrVideoCreateUnsupported` sentinel in its FIRST statement, before any request is sent, so a
 * `video` create can only ever come back as a refusal. No flag anywhere can make it succeed.
 *
 * The rest of the channel exists upstream in campaign-service — fetching, adoption of a campaign
 * built by hand in Google Ads, the activation gate — which is why `video` keeps its place in
 * {@link GOOGLE_CAMPAIGN_CHANNELS}, its label, its name token and its form control. None of that
 * is reachable from LFX One today: there is no adoption route or screen here, so a Video campaign
 * built by hand cannot be brought under management from this product. The monitoring GAQL in
 * `campaign-metrics.service.ts` does now ask for every channel type including VIDEO, so such a
 * campaign is at least reported on — but being listed in Monitoring is not adoption, and a user
 * must be told nothing about those upstream capabilities until this application exposes them.
 *
 * Flipping this to `true` is the whole change on the day Google ships the API.
 */
export const GOOGLE_VIDEO_CREATE_SUPPORTED = false;

/**
 * What the Implementation tab tells a user who finds the Video box greyed out.
 *
 * Named rather than hidden: the three capability-gated channels above DISAPPEAR when a deployment
 * cannot serve them, because a disabled box there would advertise something the deployment might
 * genuinely gain later and invites a support question nobody can answer. This one is the opposite
 * case — the limitation is Google's, it is permanent until Google changes it, and a user who sees
 * Search, Performance Max and Display but no Video has no way to learn why. Saying so costs one
 * line and closes the question.
 *
 * It states the limitation and points at the system that can do the thing. It deliberately does
 * NOT promise that a Video campaign built in Google Ads can then be adopted, reported on or
 * optimized here — see {@link GOOGLE_VIDEO_CREATE_SUPPORTED} for why none of that is reachable
 * from this application. A refusal message is a claim about what this product will do; extend it
 * only when the code behind each clause exists at this surface.
 */
export const GOOGLE_VIDEO_CREATE_UNSUPPORTED_REASON = 'The Google Ads API cannot create Video campaigns. Build the campaign directly in Google Ads.';

/**
 * The channel token the generated campaign NAME carries, per Google channel.
 *
 * Deliberately not `GOOGLE_CAMPAIGN_CHANNEL_LABELS`. These strings go into the pipe-delimited
 * campaign name the marketing team reads and filters on in Google Ads, where `demand-gen` has
 * always appeared as `DG Display` — a convention that predates this map and must not drift just
 * because a nicer product name exists. A name is also written once and then lives in reporting
 * for the life of the campaign, so renaming a token later splits a campaign's history in two.
 *
 * A selection of two or more channels is named `Multi` by the caller and has no entry here.
 */
export const GOOGLE_CAMPAIGN_NAME_TOKENS = {
  search: 'Search',
  'demand-gen': 'DG Display',
  'performance-max': 'PMax',
  video: 'Video',
  display: 'Display',
} as const;

/**
 * The Google channels whose creative this application can COLLECT and send.
 *
 * `search` is absent because its creative is not a creative object at all — it is the
 * `headlines`/`descriptions`/`keywords` the Implementation tab has always collected, which the BFF
 * sends as top-level `googleAdsConfig` fields rather than under a creative key.
 *
 * `video` is absent for the harder reason: {@link GOOGLE_VIDEO_CREATE_SUPPORTED} is `false`, so no
 * Video campaign is ever created here and there is nothing for a `videoCreative` to attach to.
 * campaign-service declares `videoCreative` and maps it, which is why it is easy to assume the
 * field is reachable — it is not, from this application, and collecting it would build a form whose
 * only possible outcome is `ErrVideoCreateUnsupported`.
 */
export const GOOGLE_CHANNELS_WITH_CREATIVE = ['demand-gen', 'performance-max', 'display'] as const;

/**
 * What each Google channel's creative is made of — one ordered catalogue, read by the form that
 * collects a creative and by the BFF normalizer that puts one on the wire.
 *
 * Every field and every number has a named counterpart in `internal/platform/googleads/` —
 * `demandgen_creative.go`, `pmax_creative.go` and `display_creative.go` — and the whole point of
 * three separate channel entries is that they DO NOT travel together. The traps the upstream
 * comments call out, repeated here because this is what a form reads:
 *
 * - Headline COUNTS differ sharply. Demand Gen and Display need one; Performance Max needs
 *   **three**, and allows fifteen. Nothing about the shared field name says so.
 * - Performance Max requires **two** descriptions, and at least one of them must fit a SHORT slot
 *   the other channels do not have at all.
 * - `longHeadline` is a LIST on Performance Max and a SINGLE STRING on Display. Same name, two
 *   shapes — which is why {@link GoogleCreativeFieldSpec} carries `kind` rather than letting a
 *   caller infer the shape from the name.
 * - The marketing-image arrays are reciprocal on Demand Gen and on Display (either one satisfies
 *   the requirement, so neither carries a `min`) and BOTH required on Performance Max (so both do).
 * - `max` on a marketing-image field is that channel's COMBINED cap across its marketing arrays,
 *   not a per-array allowance; logos are capped per array and never count toward the marketing
 *   total. Stating the combined cap on each field is the permissive direction — the upstream
 *   preflight still enforces the real sum.
 *
 * Ordering is the order a section renders in: the ad's words first, then its images, because the
 * copy is what an operator writes and the images are what they paste links to.
 *
 * One catalogue rather than a table per consumer is deliberate. The same numbers previously existed
 * as a limits object here and a field list in `campaign.controller.ts`, and a third copy was about
 * to appear in the Implementation tab; three copies of a bound is three chances for the form to ask
 * for something the wire will not carry.
 */
export const GOOGLE_CREATIVE_FIELD_SPECS = {
  'demand-gen': [
    { control: 'headlines', label: 'Headlines', kind: 'list', min: 1, max: 5, width: 30 },
    { control: 'descriptions', label: 'Descriptions', kind: 'list', min: 1, max: 5, width: 90 },
    { control: 'businessName', label: 'Business name', kind: 'text', width: 25, requiredOnce: true, hint: 'Required by Google once a creative is supplied.' },
    { control: 'callToActionText', label: 'Call to action', kind: 'text', width: 30 },
    {
      control: 'marketingImages',
      label: 'Marketing images (1.91:1)',
      kind: 'list',
      max: 20,
      hint: 'One image URL per line. At least one marketing or square marketing image is required. The cap of 20 is shared across all four marketing shapes.',
    },
    { control: 'squareMarketingImages', label: 'Square marketing images (1:1)', kind: 'list', max: 20 },
    { control: 'portraitImages', label: 'Portrait images (4:5)', kind: 'list', max: 20 },
    { control: 'tallPortraitImages', label: 'Tall portrait images (9:16)', kind: 'list', max: 20 },
    { control: 'logoImages', label: 'Logo images (1:1)', kind: 'list', min: 1, max: 5, hint: 'Required. A Demand Gen ad with no logo is refused.' },
  ],
  'performance-max': [
    { control: 'headlines', label: 'Headlines', kind: 'list', min: 3, max: 15, width: 30 },
    {
      control: 'longHeadlines',
      label: 'Long headlines',
      kind: 'list',
      min: 1,
      max: 5,
      width: 90,
      hint: 'A separate Google asset type, not a headline that happens to be long.',
    },
    {
      control: 'descriptions',
      label: 'Descriptions',
      kind: 'list',
      min: 2,
      max: 5,
      width: 90,
      hint: 'At least one must be 60 characters or fewer — Google renders it in a short slot the other channels do not have.',
    },
    {
      control: 'businessName',
      label: 'Business name',
      kind: 'text',
      width: 25,
      requiredOnce: true,
      hint: 'Required by Google once an asset group is supplied.',
    },
    {
      control: 'assetGroupName',
      label: 'Asset group name',
      kind: 'text',
      // 256 is campaign-service's `maxAssetGroupNameRunes`, which is `maxCampaignNameRunes`
      // (`internal/platform/googleads/campaign.go`) — Google documents no separate asset-group
      // limit. Counted in RUNES on the trimmed value there, which is why this entry could not be
      // stated until the validators measured code points rather than UTF-16 units.
      width: 256,
      hint: 'Defaults to the event name plus " - Asset Group" when blank.',
    },
    { control: 'path1', label: 'Display path 1', kind: 'text', width: 15 },
    { control: 'path2', label: 'Display path 2', kind: 'text', width: 15, hint: 'Renders only when display path 1 is also set.' },
    {
      control: 'marketingImages',
      label: 'Marketing images (1.91:1)',
      kind: 'list',
      min: 1,
      max: 20,
      hint: 'One image URL per line. Required here, unlike on Demand Gen. The cap of 20 is shared across all three marketing shapes.',
    },
    { control: 'squareMarketingImages', label: 'Square marketing images (1:1)', kind: 'list', min: 1, max: 20, hint: 'Also required.' },
    { control: 'portraitImages', label: 'Portrait images (4:5)', kind: 'list', max: 20 },
    { control: 'logoImages', label: 'Logo images (1:1)', kind: 'list', min: 1, max: 5, hint: 'Required.' },
    { control: 'landscapeLogoImages', label: 'Landscape logo images (4:1)', kind: 'list', max: 5 },
    {
      control: 'youtubeVideoIds',
      label: 'YouTube video IDs',
      kind: 'list',
      max: 5,
      hint: 'Bare video IDs, one per line — a watch URL is refused upstream rather than parsed.',
    },
  ],
  display: [
    { control: 'headlines', label: 'Headlines', kind: 'list', min: 1, max: 5, width: 30 },
    {
      control: 'longHeadline',
      label: 'Long headline',
      kind: 'text',
      width: 90,
      requiredOnce: true,
      hint: 'Required. A responsive display ad carries exactly one.',
    },
    { control: 'descriptions', label: 'Descriptions', kind: 'list', min: 1, max: 5, width: 90 },
    { control: 'businessName', label: 'Business name', kind: 'text', width: 25, requiredOnce: true, hint: 'Required by Google once a creative is supplied.' },
    { control: 'callToActionText', label: 'Call to action', kind: 'text', width: 30 },
    {
      control: 'marketingImages',
      label: 'Marketing images (1.91:1)',
      kind: 'list',
      max: 15,
      hint: 'One image URL per line. Google requires each marketing array when the other is absent. The cap of 15 is shared across both.',
    },
    { control: 'squareMarketingImages', label: 'Square marketing images (1:1)', kind: 'list', max: 15 },
    { control: 'logoImages', label: 'Logo images (4:1)', kind: 'list', max: 5 },
    { control: 'squareLogoImages', label: 'Square logo images (1:1)', kind: 'list', max: 5 },
  ],
} as const satisfies Record<(typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number], readonly GoogleCreativeFieldSpec[]>;

/**
 * The "at least one of" rules a channel's creative carries, which no per-field bound can state.
 *
 * Demand Gen and Display each require a marketing image OR a square marketing image, refusing a
 * creative that has neither and accepting one that has either (`demandgen_creative.go`,
 * `display_creative.go`). Putting `min: 1` on both members would refuse the half upstream takes,
 * and putting it on one would name the wrong field — so the rule lives here, over the pair.
 *
 * Performance Max is deliberately empty: it requires both marketing arrays SEPARATELY
 * (`pmax_creative.go`), which its two `min: 1` catalogue entries already express. An empty list is
 * the honest statement of that, and it keeps every creative-bearing channel indexable here.
 *
 * The messages are clauses, completed by the channel's section title at the point of use, so one
 * sentence names both the channel and what it is missing.
 */
export const GOOGLE_CREATIVE_EITHER_OR_RULES = {
  'demand-gen': [
    {
      controls: ['marketingImages', 'squareMarketingImages'],
      message: 'needs at least one marketing image or one square marketing image.',
    },
  ],
  'performance-max': [],
  display: [
    {
      controls: ['marketingImages', 'squareMarketingImages'],
      message: 'needs at least one marketing image or one square marketing image.',
    },
  ],
} as const satisfies Record<(typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number], readonly GoogleCreativeEitherOrRule[]>;

/**
 * The `CampaignCreateRequest` key each channel's creative is sent under.
 *
 * Separate from {@link GOOGLE_CREATIVE_FIELD_SPECS} because it is about the envelope, not the
 * fields: campaign-service names the three creative objects `demandGenCreative`,
 * `performanceMaxCreative` and `displayCreative`, and that spelling has nothing to do with the
 * channel's wire value. A missing entry is a compile error, so a fourth channel with a creative
 * cannot be half-wired.
 */
export const GOOGLE_CREATIVE_REQUEST_KEYS = {
  'demand-gen': 'demandGenCreative',
  'performance-max': 'performanceMaxCreative',
  display: 'displayCreative',
} as const satisfies Record<(typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number], keyof CampaignCreateRequest>;

/**
 * The heading each creative section carries in the Implementation tab.
 *
 * Deliberately NOT {@link GOOGLE_CAMPAIGN_CHANNEL_LABELS}, which is Google Ads' own reporting
 * shorthand (`DG Display`, `PMax`) and belongs on a metrics row, not above a form an operator is
 * filling in. These spell the channel the way its own checkbox does, so the section a user opens
 * is named the same as the box they ticked to open it.
 */
export const GOOGLE_CREATIVE_SECTION_TITLES = {
  'demand-gen': 'Demand Gen',
  'performance-max': 'Performance Max',
  display: 'Display',
} as const satisfies Record<(typeof GOOGLE_CHANNELS_WITH_CREATIVE)[number], string>;

/**
 * Why a Google channel's creative is worth filling in, stated per channel.
 *
 * Not decoration. campaign-service ACCEPTS a create with no creative on all three of these
 * channels — the campaign and its budget are made, and the call returns success — so nothing
 * UPSTREAM tells an operator at create time that what they just made cannot serve. On all three
 * the refusal arrives later and elsewhere, at activation: an empty creative leaves `AdID` blank
 * (`demandgen.go:326`, `display.go:298`), the toggle finds no targets, and the activation gate
 * returns `ErrCampaignNotProvisioned` (`internal/dispatch/googleads.go:2561`, `:2687`). Performance
 * Max gets there by its own route, the asset-group check in `ToggleStatus`
 * (`internal/platform/googleads/pmax.go`). Either way it is discovered at launch.
 *
 * And the refusal is PERMANENT, which is why this sentence does not offer "add the ad" as the
 * remedy. Both inputs to the gate come from the persisted `Result` blob — `googleAdsToggleTargets`
 * (`internal/dispatch/googleads.go:2687`) and `googleAdsToggleAssetGroup` (`:2614`) each return
 * early on an empty `Result` and unmarshal nothing else, and the call site says so outright
 * (`:2083-2089`). Nothing re-reads Google. So an ad an operator adds by hand in the Ads UI is
 * never discovered, and activation from LFX stays refused for the life of the campaign. The
 * service's own gate message says the same of an adopted row: un-pausing "happens in Google Ads"
 * (`:2559-2560`).
 *
 * This is the standing line, shown on a section before anything is typed. The form also says it
 * about the current state, naming the channels that are actually empty, in the Implementation
 * tab's `googleCreativeEmptyWarning` — which is a warning and not a refusal, precisely because
 * upstream accepts this shape.
 */
export const GOOGLE_CREATIVE_REQUIRED_NOTICE =
  'Without creative this campaign is created as an empty shell: it has no ad and it cannot serve. Activating it from LFX is then refused permanently — adding the ad in Google Ads afterwards does not lift the refusal — so it has to be finished and launched in Google Ads, or recreated here with creative.';

/**
 * The bidding strategies campaign-service accepts, in the caller vocabulary it accepts them in.
 *
 * These are the Google Ads UI's own labels, lower-cased and hyphenated — not Google's proto names
 * — because that is the vocabulary `googleAdsConfig.biddingStrategy` is defined in
 * (`internal/dispatch/googleads.go`) and the one an operator reading the Ads UI already has.
 *
 * `target-cpa` and `target-roas` are not separate strategies upstream: Google folded them into
 * `maximize-conversions` and `maximize-conversion-value` with a target attached, and the client
 * keeps both spellings because the target-bearing one REQUIRES its number while the maximize- one
 * treats it as optional (`internal/platform/googleads/bidding.go`).
 */
export const GOOGLE_BIDDING_STRATEGIES = [
  'manual-cpc',
  'maximize-clicks',
  'maximize-conversions',
  'target-cpa',
  'maximize-conversion-value',
  'target-roas',
] as const;

/**
 * How each strategy is named in the picker — the Google Ads UI's own capitalisation.
 */
export const GOOGLE_BIDDING_STRATEGY_LABELS = {
  'manual-cpc': 'Manual CPC',
  'maximize-clicks': 'Maximize Clicks',
  'maximize-conversions': 'Maximize Conversions',
  'target-cpa': 'Target CPA',
  'maximize-conversion-value': 'Maximize Conversion Value',
  'target-roas': 'Target ROAS',
} as const satisfies Record<(typeof GOOGLE_BIDDING_STRATEGIES)[number], string>;

/**
 * Which strategies each channel will accept, copied set-for-set from campaign-service.
 *
 * Reproduced rather than widened, and the five sets genuinely disagree:
 * `searchBiddingStrategies` is every name; `demandGenBiddingStrategies` is Maximize Clicks ALONE
 * (a live `validateOnly` mutate returned `BIDDING_STRATEGY_TYPE_INCOMPATIBLE_WITH_SHARED_BUDGET`
 * for the others); `performanceMaxBiddingStrategies` is the four conversion-oriented ones, since
 * Performance Max has no manual bidding at all; `videoBiddingStrategies` is the two Google's
 * VIDEO_ACTION documentation names; and `displayBiddingStrategies` is the five automated ones —
 * manual CPC is omitted there because the client's Display ad-group payload carries no bid field,
 * not because Google refuses it.
 *
 * This is a picker's option list, so it cannot over-refuse: every entry is a value the dispatcher
 * accepts on that channel, and the refusals upstream still owns stay upstream's to make.
 */
export const GOOGLE_BIDDING_STRATEGIES_BY_CHANNEL = {
  search: GOOGLE_BIDDING_STRATEGIES,
  'demand-gen': ['maximize-clicks'],
  'performance-max': ['maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'],
  video: ['maximize-conversions', 'target-cpa'],
  display: ['maximize-clicks', 'maximize-conversions', 'target-cpa', 'maximize-conversion-value', 'target-roas'],
} as const satisfies Record<(typeof GOOGLE_CAMPAIGN_CHANNELS)[number], readonly (typeof GOOGLE_BIDDING_STRATEGIES)[number][]>;

/**
 * The strategy a channel bids with when the request names none.
 *
 * Shown as guidance only — the request still omits `biddingStrategy`, so the DISPATCHER picks the
 * default and these labels can never be the thing that chose it. They exist because "leave it to
 * the channel default" is a real answer an operator should be able to give knowingly, and
 * `defaultBiddingStrategy` (`internal/platform/googleads/bidding.go`) is where the answer lives.
 */
export const GOOGLE_BIDDING_DEFAULT_BY_CHANNEL = {
  search: 'manual-cpc',
  'demand-gen': 'maximize-clicks',
  'performance-max': 'maximize-conversions',
  video: 'maximize-conversions',
  display: 'maximize-conversions',
} as const satisfies Record<(typeof GOOGLE_CAMPAIGN_CHANNELS)[number], (typeof GOOGLE_BIDDING_STRATEGIES)[number]>;

/**
 * The strategies that carry a target CPA, and the ones that carry a target ROAS.
 *
 * Upstream REFUSES a target on a strategy that cannot carry it rather than dropping it, so these
 * two sets decide which field is even offered: a target CPA typed under Manual CPC would fail the
 * create, and one left behind after switching strategies would fail it just as surely.
 */
export const GOOGLE_BIDDING_CPA_STRATEGIES = ['maximize-conversions', 'target-cpa'] as const;
export const GOOGLE_BIDDING_ROAS_STRATEGIES = ['maximize-conversion-value', 'target-roas'] as const;

/**
 * The two spellings whose target is REQUIRED rather than optional.
 *
 * `target-cpa` with no CPA is not the same request as `maximize-conversions` — the operator named
 * the label whose whole content is the number — and upstream refuses it by name.
 */
export const GOOGLE_BIDDING_TARGET_REQUIRED_STRATEGIES = ['target-cpa', 'target-roas'] as const;

/**
 * The channels that accept a conversion-action list at create time.
 *
 * Not a Search-versus-the-rest split: `campaign.selective_optimization` is defined for SEARCH,
 * DISPLAY and VIDEO, and campaign-service admits all three. Demand Gen has no such field, and
 * Performance Max selects conversions through a campaign-conversion-goal resource that cannot be
 * addressed until the campaign exists — so both REFUSE the list rather than dropping it, and the
 * section is withheld there rather than offered and discarded.
 */
export const GOOGLE_CONVERSION_ACTION_CHANNELS = ['search', 'video', 'display'] as const;

/** `maxConversionActions` in `internal/platform/googleads/bidding.go`. */
export const GOOGLE_ADS_MAX_CONVERSION_ACTIONS = 100;

/**
 * The two spellings a conversion action may be given in: a bare numeric id as read off the Google
 * Ads UI, or the full `customers/<id>/conversionActions/<id>` resource name a GAQL read returns.
 *
 * Mirrors `conversionActionIDRE` and `conversionActionResourceRE`. The CUSTOMER in a resource name
 * is deliberately not checked here — this application does not know the campaign's ad account, and
 * upstream refuses a foreign one by name before any mutate.
 */
export const GOOGLE_ADS_CONVERSION_ACTION_PATTERN = /^(?:\d+|customers\/\d+\/conversionActions\/\d+)$/;

/**
 * The numeric bounds campaign-service applies to the three money/ratio fields, in whole units of
 * the ad ACCOUNT's currency (no FX anywhere in this path) except `targetRoas`, which is a RATIO:
 * 4 means four units of conversion value per unit spent, not 400%.
 *
 * Reproduced from `minCPCBid`/`maxCPCBid` (`adgroup_ad.go`) and `minTargetCPA`/`maxTargetCPA` /
 * `minTargetROAS`/`maxTargetROAS` (`bidding.go`). Equal, never tighter: a bound narrower than
 * upstream's would refuse a create Google would have accepted.
 */
export const GOOGLE_ADS_BIDDING_BOUNDS = {
  cpcBid: { min: 0.01, max: 100_000 },
  targetCpa: { min: 0.01, max: 1_000_000 },
  targetRoas: { min: 0.01, max: 1000 },
} as const;
