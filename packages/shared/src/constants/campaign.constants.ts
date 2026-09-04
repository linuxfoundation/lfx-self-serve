// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignDeliveryTypeOption,
  CampaignEmailTypeOption,
  CampaignGoalOption,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformOption,
  CampaignProgramTypeOption,
  CampaignStatus,
  CampaignTabOption,
  CampaignToggleAction,
  CampaignToggleStatus,
  LinkedInGeoTarget,
  MetaObjective,
  MetaObjectiveParams,
  MetaPlacement,
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
 * constant changes no behaviour. It exists because the same two rules carry three different
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

export const CAMPAIGN_CHAR_LIMITS = {
  searchHeadline: 30,
  searchDescription: 90,
  displayHeadline: 40,
  displayDescription: 90,
  displayBusinessName: 25,
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
 * it there would be a second normalisation that could only drift. Use `canonicalMicrosoftMatchType`
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

/** ISO 3166-1 alpha-2 shape for a Meta geo target, after normalisation. */
export const META_GEO_CODE_PATTERN = /^[A-Z]{2}$/;

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
 * Normalise a list of Meta geo targets: trim, uppercase, drop mis-shaped codes, de-dupe.
 *
 * The single owner of geo normalisation. Every entry point — the chip add path, the brief seed
 * path, and the server's pre-flight validation — routes through this so the same input can never
 * mean two different things depending on which door it came through. That split is exactly what
 * let a stored `us` and a typed `US` become two chips AND two wire entries: the add path
 * normalised, the seed path did not, and the server uppercased without de-duping, so `["us","US"]`
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
 * Normalise geo codes for MICROSOFT: trim, upper-case and de-duplicate, WITHOUT applying Meta's
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
