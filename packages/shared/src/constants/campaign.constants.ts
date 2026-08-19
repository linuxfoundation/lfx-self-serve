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
 * Keeping `leads` here is load-bearing, not tidiness. `buildMetaCampaignName` and the ad-set name
 * in `meta-ads.service.ts` index this map with whatever objective the request carries, and a
 * brief or draft persisted before `leads` was hidden still carries it. Dropping the key would put
 * the literal string `undefined` into a campaign name Meta then bills against.
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
export const META_SELECTABLE_OBJECTIVES: readonly MetaObjective[] = ['awareness', 'traffic', 'engagement', 'conversions'] as const;

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
