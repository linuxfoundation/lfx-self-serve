// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterOption } from '../interfaces';
import type { OrgEventsTabConfig, OrgEventsTabId } from '../interfaces/org-events.interface';

/** Org Events page tabs in visible order (`upcoming` is the default). */
export const ORG_EVENTS_TABS: readonly OrgEventsTabConfig[] = [
  { id: 'upcoming', label: 'Upcoming', icon: 'fa-light fa-calendar-plus' },
  { id: 'past', label: 'Past', icon: 'fa-light fa-calendar-check' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_ORG_EVENTS_TAB_ID: OrgEventsTabId = 'upcoming';

/** Derived from ORG_EVENTS_TABS; used to validate `?tab=` query-param input. */
export const VALID_ORG_EVENTS_TAB_IDS: ReadonlySet<OrgEventsTabId> = new Set(ORG_EVENTS_TABS.map((t) => t.id));

/** Status filter options for the Org Events filter bar. */
export const ORG_EVENTS_STATUS_OPTIONS: FilterOption[] = [
  { label: 'All Statuses', value: null },
  { label: 'Not Registered', value: 'not-registered' },
  { label: 'Registered', value: 'registered' },
];

/** Valid org event status values for server-side validation. */
export const VALID_ORG_EVENT_STATUS_VALUES: ReadonlySet<string> = new Set(['registered', 'not-registered']);
