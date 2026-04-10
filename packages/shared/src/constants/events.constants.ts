// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FoundationEventStatus } from '../enums';
import { FilterOption, MyEventsResponse, EventsResponse, MyEventOrganizationsResponse, TagSeverity } from '../interfaces';

export const EVENT_ROLE_OPTIONS: FilterOption[] = [
  { label: 'All Roles', value: null },
  { label: 'Attendee', value: 'attendee' },
  { label: 'Registered', value: 'registered' },
  { label: 'Speaker', value: 'speaker' },
  { label: 'Sponsor', value: 'sponsor' },
];

export const MY_EVENT_STATUS_OPTIONS: FilterOption[] = [
  { label: 'All Statuses', value: null },
  { label: 'Registered', value: 'registered' },
  { label: 'Attended', value: 'attended' },
  { label: 'Not Registered', value: 'not-registered' },
];

/**
 * Status filter options for Foundation Lens events.
 * Values are raw EVENT_STATUS DB values except 'coming-soon', which is a sentinel
 * that the server maps to `IN ('Pending', 'Planned')` rather than a parameterized bind.
 */
export const FOUNDATION_EVENT_STATUS_OPTIONS: FilterOption[] = [
  { label: 'All Statuses', value: null },
  { label: 'Coming Soon', value: 'coming-soon' }, // sentinel — maps to Pending + Planned in SQL
  { label: 'Completed', value: 'Completed' },
  { label: 'Registration Open', value: 'Active' }, // raw DB value; displayed as 'Registration Open'
];

/** Sentinel status value that maps server-side to `EVENT_STATUS IN ('Pending', 'Planned')`. */
export const COMING_SOON_SENTINEL = 'coming-soon';

export const VALID_EVENT_STATUS_VALUES: ReadonlySet<string> = new Set(['Active', 'Planned', 'Pending', 'Completed', COMING_SOON_SENTINEL]);
export const VALID_MY_EVENT_STATUS_VALUES: ReadonlySet<string> = new Set(['registered', 'attended', 'not-registered']);
/** Severity map for foundation event display statuses, used by the events table tag component. */
export const FOUNDATION_EVENT_STATUS_SEVERITY_MAP: Partial<Record<string, TagSeverity>> = {
  [FoundationEventStatus.REGISTRATION_OPEN]: 'warn',
  [FoundationEventStatus.COMING_SOON]: 'secondary',
  [FoundationEventStatus.COMPLETED]: 'success',
};

export const VALID_EVENT_SORT_FIELDS: ReadonlySet<string> = new Set(['EVENT_NAME', 'PROJECT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']);
export const DEFAULT_EVENT_SORT_FIELD = 'EVENT_START_DATE';
export const VALID_EVENT_SORT_ORDERS: readonly string[] = ['ASC', 'DESC'];
export const DEFAULT_EVENTS_PAGE_SIZE = 10;
export const MAX_EVENTS_PAGE_SIZE = 100;

export const EMPTY_MY_EVENTS_RESPONSE: MyEventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_EVENTS_RESPONSE: EventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_ORGANIZATIONS_RESPONSE: MyEventOrganizationsResponse = { data: [] };
