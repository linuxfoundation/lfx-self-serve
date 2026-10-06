// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FilterPillOption,
  MeetupFilterOptionsResponse,
  MeetupSortField,
  MeetupSortOrder,
  MeetupStatusFilter,
  MyMeetup,
  MyMeetupsResponse,
  MyMeetupsUpcomingView,
} from '../interfaces';

export const DEFAULT_MEETUPS_PAGE_SIZE = 10;
export const MAX_MEETUPS_PAGE_SIZE = 100;

export const DEFAULT_MEETUP_SORT_FIELD: MeetupSortField = 'STARTS_AT';
export const MEETUPS_DISCOVERABLE_UPCOMING_LIMIT = 50;
export const VALID_MEETUP_SORT_FIELDS: ReadonlySet<MeetupSortField> = new Set<MeetupSortField>(['EVENT_NAME', 'COMMUNITY', 'STARTS_AT', 'LOCATION']);
export const VALID_MEETUP_SORT_ORDERS: readonly MeetupSortOrder[] = ['ASC', 'DESC'];
export const VALID_MEETUP_STATUS_VALUES: ReadonlySet<MeetupStatusFilter> = new Set<MeetupStatusFilter>(['registered', 'not-registered']);

/** Default Snowflake schema for OCG meetup views. */
export const MEETUPS_DEFAULT_SNOWFLAKE_SCHEMA = 'ANALYTICS.PLATINUM_LFX_ONE';
/** Accepts a Snowflake database and schema identifier path, such as DATABASE.SCHEMA. */
export const MEETUPS_SNOWFLAKE_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z_][A-Za-z0-9_$]*$/;
/** Base URL used to build external OCG meetup links from group/event slugs. */
export const OCG_MEETUP_BASE_URL = 'https://ocgroups.dev';

/** Upcoming-tab registration view pills in visible order. */
export const MY_MEETUPS_UPCOMING_VIEWS: (FilterPillOption & { id: MyMeetupsUpcomingView })[] = [
  { id: 'registered', label: 'My Registrations' },
  { id: 'all', label: 'All Meetups' },
];

/** Font Awesome icon shown on the meetup registration status tag. */
export const MEETUP_STATUS_ICON_MAP: Partial<Record<MyMeetup['status'], string>> = {
  Registered: 'fa-light fa-circle-check',
};

export const EMPTY_MY_MEETUPS_RESPONSE: MyMeetupsResponse = { data: [], total: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE, offset: 0 };
export const EMPTY_MEETUP_FILTER_OPTIONS: MeetupFilterOptionsResponse = { communities: [], roles: [] };
