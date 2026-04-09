// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FilterOption, MyEventsResponse, EventsResponse, MyEventOrganizationsResponse } from '../interfaces';

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

export const VALID_EVENT_SORT_FIELDS: ReadonlySet<string> = new Set(['EVENT_NAME', 'PROJECT_NAME', 'EVENT_START_DATE', 'EVENT_CITY']);
export const DEFAULT_EVENT_SORT_FIELD = 'EVENT_START_DATE';
export const VALID_EVENT_SORT_ORDERS: readonly string[] = ['ASC', 'DESC'];
export const DEFAULT_EVENTS_PAGE_SIZE = 10;
export const MAX_EVENTS_PAGE_SIZE = 100;

export const EMPTY_MY_EVENTS_RESPONSE: MyEventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_EVENTS_RESPONSE: EventsResponse = { data: [], total: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE, offset: 0 };
export const EMPTY_ORGANIZATIONS_RESPONSE: MyEventOrganizationsResponse = { data: [] };
