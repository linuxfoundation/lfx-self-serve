// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  CampaignDeliveryTypeOption,
  CampaignGoalOption,
  CampaignPlatform,
  CampaignPlatformOption,
  CampaignProgramTypeOption,
  CampaignStatus,
  CampaignTabOption,
  CampaignToggleStatus,
  LinkedInGeoTarget,
  MetaObjective,
  MetaObjectiveParams,
  MetaPlacement,
  ParsedCampaignName,
  RedditObjective,
  RedditObjectiveParams,
} from '../interfaces/campaign.interface';

/** Tab definitions for the Campaigns page tab navigation. */
export const CAMPAIGN_TABS: readonly CampaignTabOption[] = [
  { id: 'planning', label: 'Plan', icon: 'fa-light fa-clipboard-list' },
  { id: 'implementation', label: 'Implement', icon: 'fa-light fa-rocket' },
  { id: 'insights', label: 'Monitor', icon: 'fa-light fa-chart-mixed' },
  { id: 'optimization', label: 'Optimize', icon: 'fa-light fa-gauge-high' },
] as const;

export const CAMPAIGN_PLATFORMS: readonly CampaignPlatformOption[] = [
  { id: 'google-ads', label: 'Google Ads', icon: 'fa-brands fa-google' },
  { id: 'microsoft-ads', label: 'Microsoft Ads', icon: 'fa-brands fa-microsoft', disabled: true },
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
export function campaignToggleAction(status: string, platform?: string): 'pause' | 'resume' | 'unavailable' {
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
  const normalized = status.toLowerCase();
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
 * Named per status rather than a single "cannot be changed": the three reachable cases have
 * genuinely different remedies. `pending` resolves itself when the dispatch settles; the two
 * partial-orphan statuses need reconciliation before the platform will accept anything. A generic
 * message would send someone to look for a problem that is about to disappear on its own.
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
 * `disabled: true` entries (currently Microsoft and X) have working toggle dispatchers upstream,
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

/** The button's visible word per action. `unavailable` still names an action — the button is disabled, not blank. */
export const CAMPAIGN_TOGGLE_LABELS: Readonly<Record<'pause' | 'resume' | 'unavailable', string>> = {
  pause: 'Pause',
  resume: 'Resume',
  unavailable: 'Unavailable',
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
  leads: { campaignObjective: 'OUTCOME_LEADS', optimizationGoal: 'LEAD_GENERATION', promotedObjectType: 'page_id' },
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
 * states "Showing the first N of M" whenever this bites, because a list that is quietly cut off
 * reads as a complete answer and sends someone hunting for a template that was fetched but never
 * drawn.
 *
 * A cap rather than virtual scrolling: nothing in this repo virtualises a list today (no
 * `cdk-virtual-scroll-viewport` anywhere in `apps/lfx-one`), and introducing the first one here
 * would be a new pattern rather than a followed one. Narrowing the search is also the action the
 * user actually wants — scrolling 4,000 rows is not.
 */
export const HUBSPOT_TEMPLATE_RENDER_LIMIT = 100;
