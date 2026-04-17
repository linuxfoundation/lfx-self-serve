// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FoundationEventStatus } from '../enums';
import {
  AttendeeAccommodationPaidBy,
  AttendeeType,
  FilterOption,
  MyEventsResponse,
  EventsResponse,
  MyEventOrganizationsResponse,
  TagSeverity,
  TravelFundRequestsResponse,
  VisaRequestsResponse,
  TravelFundStep,
  VisaRequestStep,
} from '../interfaces';

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

export const VISA_REQUEST_STATUS_OPTIONS: FilterOption[] = [
  { label: 'All Statuses', value: null },
  { label: 'Submitted', value: 'Submitted' },
  { label: 'Approved', value: 'Approved' },
  { label: 'Denied', value: 'Denied' },
  { label: 'Expired', value: 'Expired' },
];

export const EVENT_REQUEST_STATUS_SEVERITY_MAP: Partial<Record<string, TagSeverity>> = {
  Submitted: 'info',
  Approved: 'success',
  Denied: 'danger',
  Expired: 'secondary',
};

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
export const VALID_VISA_REQUEST_SORT_FIELDS: ReadonlySet<string> = new Set(['EVENT_NAME', 'EVENT_CITY', 'APPLICATION_DATE']);
export const DEFAULT_VISA_REQUEST_SORT_FIELD = 'APPLICATION_DATE';
export const DEFAULT_EVENT_SORT_FIELD = 'EVENT_START_DATE';
export const VALID_EVENT_SORT_ORDERS: readonly string[] = ['ASC', 'DESC'];
export const DEFAULT_EVENTS_PAGE_SIZE = 10;
export const MAX_EVENTS_PAGE_SIZE = 100;

export const EMPTY_MY_EVENTS_RESPONSE: MyEventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_EVENTS_RESPONSE: EventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_ORGANIZATIONS_RESPONSE: MyEventOrganizationsResponse = { data: [] };
export const EMPTY_VISA_REQUESTS_RESPONSE: VisaRequestsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_TRAVEL_FUND_REQUESTS_RESPONSE: TravelFundRequestsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const YES_NO_OPTIONS: FilterOption[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

export const ATTENDEE_TYPE_OPTIONS: { label: string; value: AttendeeType }[] = [
  { label: 'Attendee', value: 'attendee' },
  { label: 'Speaker', value: 'speaker' },
];

export const ACCOMMODATION_PAID_BY_OPTIONS: { label: string; value: AttendeeAccommodationPaidBy }[] = [
  { label: 'Delegate (self-paid)', value: 'delegate' },
  { label: "Delegate's Company", value: 'delegates_company' },
  { label: 'The Linux Foundation', value: 'the_linux_foundation' },
  { label: 'CNCF', value: 'cncf' },
];

export const TRAVEL_FUND_STEP_ORDER: TravelFundStep[] = ['select-event', 'terms', 'about-me', 'expenses'];
export const VIS_REQUEST_STEP_ORDER: VisaRequestStep[] = ['select-event', 'terms', 'apply'];

export const EVENT_SELECTION_PAGE_SIZE = 12;
