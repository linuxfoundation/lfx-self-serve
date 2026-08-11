// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  AttributionModelOption,
  EventsSplitOption,
  EventsSplitView,
  MarketingImpactFocusProgram,
  MarketingImpactTab,
  MarketingImpactTabOption,
} from '../interfaces/marketing-impact.interface';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/**
 * Campaign Type filter options for the Campaign Impact dashboard, in display order. These are
 * DISPLAY labels; the underlying `id`s still map to Snowflake LF_SUB_DOMAIN_CLASSIFICATION values
 * via FOCUS_TO_CLASSIFICATION (do not rename the ids).
 */
export const MARKETING_IMPACT_FOCUS_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All' },
  { id: 'lfEvents', label: 'Events' },
  { id: 'lfTraining', label: 'Education' },
  // Membership has no data wired yet — selectable, but its content area shows a "coming soon" state.
  { id: 'membership', label: 'Membership' },
  // Audience replaces the former "Awareness" pill; still backed by the LF Corporate classification.
  { id: 'lfCorporate', label: 'Audience' },
];

/** Channel Type filter options for the Campaign Impact dashboard, in display order. */
export const MARKETING_IMPACT_TABS: MarketingImpactTabOption[] = [
  { id: 'all', label: 'All' },
  { id: 'social', label: 'Social' },
  { id: 'web', label: 'Web' },
  { id: 'email', label: 'Email' },
  { id: 'paid', label: 'Paid' },
  { id: 'social-listening', label: 'Social Listening' },
];

/**
 * Sub-tabs shown under the Events campaign type, in display order. Attendance covers the
 * registration/attendee story; Sponsorship covers revenue and tiers. Only the Events campaign
 * type has this second level — no other campaign type splits this way.
 */
export const EVENTS_SPLIT_OPTIONS: EventsSplitOption[] = [
  { id: 'attendance', label: 'Event Attendance' },
  { id: 'sponsorship', label: 'Event Sponsorship' },
];

/** Campaign Type that exposes the attendance/sponsorship sub-tabs. */
export const EVENTS_SPLIT_FOCUS: MarketingImpactFocusProgram = 'lfEvents';

/**
 * Maps each Events sub-view onto the detail drawer's focus. The drawer hides its sponsorship
 * blocks for 'b2c', so attendance opens the registration story and sponsorship opens the
 * revenue story — see `showSponsorship` in EventDetailDrawerComponent.
 */
export const EVENTS_SPLIT_TO_DRAWER_FOCUS: Record<EventsSplitView, 'b2c' | 'b2b'> = {
  attendance: 'b2c',
  sponsorship: 'b2b',
};

/** Attribution model options for the model selector dropdown. */
export const ATTRIBUTION_MODEL_OPTIONS: AttributionModelOption[] = [
  { label: 'Linear', value: 'linear' },
  { label: 'First Touch', value: 'firstTouch' },
  { label: 'Last Touch', value: 'lastTouch' },
  { label: 'Time Decay', value: 'timeDecay' },
];

/**
 * Human-readable definitions for each consolidated attribution channel label, keyed by the UI
 * label produced server-side (see mapChannel in project.service.ts). Surfaced as per-channel
 * tooltips in the Marketing attribution table so viewers know what each grouping includes.
 */
export const ATTRIBUTION_CHANNEL_DESCRIPTIONS: Record<string, string> = {
  'Paid Performance': 'Paid search and paid social campaigns.',
  Email: 'Email and HubSpot marketing sends.',
  'Internal & Banner': 'Internal cross-site links and on-site promotional banners.',
  Organic: 'Unpaid organic search traffic.',
  Other: 'Other tracked sources that do not fall into a primary channel.',
  'Direct & Unknown': 'Direct visits plus sessions with no identifiable referring source.',
};

/** Maps MarketingImpactFocusProgram IDs to Snowflake LF_SUB_DOMAIN_CLASSIFICATION values. 'all' maps to undefined (no filter). */
export const FOCUS_TO_CLASSIFICATION: Record<MarketingImpactFocusProgram, string | undefined> = {
  all: undefined,
  lfCorporate: 'LF Corporate',
  lfEvents: 'LF Events',
  lfTraining: 'LF Training',
  // No classification yet — the Membership content area shows a "coming soon" state.
  membership: undefined,
};

export const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set(Object.values(FOCUS_TO_CLASSIFICATION).filter((v): v is string => v !== undefined));

/**
 * Maps MarketingImpactFocusProgram IDs to Snowflake EMAIL_TYPE values.
 *
 * EMAIL_CAMPAIGN_PERFORMANCE has no LF_SUB_DOMAIN_CLASSIFICATION column, so the per-email
 * breakdown cannot be narrowed the way the other email queries are. EMAIL_TYPE is the closest
 * per-row equivalent and is used to scope that one table instead.
 *
 * These are two different columns with two different taxonomies — this is a deliberate mapping,
 * not a join. Only 'lfEvents' reaches the email tab today (the rest are COMING_SOON_FOCUS_PROGRAMS
 * and expose only the "All" channel), so 'EVENT' is the only mapping that currently has an effect.
 * Matching is case-insensitive at the call site, and an unmatched mapping falls back to unfiltered
 * rather than rendering an empty table.
 */
export const FOCUS_TO_EMAIL_TYPES: Record<MarketingImpactFocusProgram, readonly string[] | undefined> = {
  all: undefined,
  lfEvents: ['EVENT'],
  // No verified EMAIL_TYPE mapping yet — these focuses do not expose the email tab.
  lfCorporate: undefined,
  lfTraining: undefined,
  membership: undefined,
};

/**
 * Same mapping as FOCUS_TO_EMAIL_TYPES, keyed by LF_SUB_DOMAIN_CLASSIFICATION instead of focus ID.
 * Server-side callers receive the resolved classification string rather than the focus program.
 */
export const CLASSIFICATION_TO_EMAIL_TYPES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  (Object.keys(FOCUS_TO_CLASSIFICATION) as MarketingImpactFocusProgram[])
    .map((focus) => [FOCUS_TO_CLASSIFICATION[focus], FOCUS_TO_EMAIL_TYPES[focus]] as const)
    .filter((entry): entry is readonly [string, readonly string[]] => entry[0] !== undefined && entry[1] !== undefined)
);

/**
 * Campaign Types with no dashboard content built yet — their content area shows a "coming soon"
 * state regardless of the selected channel. Only Events is built today; remove an entry here once
 * its content is wired up.
 */
export const COMING_SOON_FOCUS_PROGRAMS: ReadonlySet<MarketingImpactFocusProgram> = new Set<MarketingImpactFocusProgram>([
  'lfTraining',
  'membership',
  'lfCorporate',
]);

/** Which tabs are visible for each focus area. Social tabs are hidden for non-"all" focuses (no classification filtering). */
const ALL_CHANNEL_TABS = new Set<MarketingImpactTab>(['all', 'web', 'social', 'email', 'paid', 'social-listening']);

/** Coming-soon focuses expose only the "All" channel — there is no per-channel content to show. */
const COMING_SOON_TABS = new Set<MarketingImpactTab>(['all']);

export const FOCUS_VISIBLE_TABS: Record<MarketingImpactFocusProgram, ReadonlySet<MarketingImpactTab>> = {
  all: ALL_CHANNEL_TABS,
  lfEvents: ALL_CHANNEL_TABS,
  // Education, Membership, and Audience have no content built yet — see COMING_SOON_FOCUS_PROGRAMS.
  lfTraining: COMING_SOON_TABS,
  membership: COMING_SOON_TABS,
  lfCorporate: COMING_SOON_TABS,
};
