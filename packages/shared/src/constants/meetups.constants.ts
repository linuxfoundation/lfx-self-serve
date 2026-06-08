// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FilterOption, MeetupFilterOptionsResponse, MyMeetupsResponse } from '../interfaces';

export const DEFAULT_MEETUPS_PAGE_SIZE = 10;
export const MAX_MEETUPS_PAGE_SIZE = 100;

export const DEFAULT_MEETUP_SORT_FIELD = 'STARTS_AT';
export const VALID_MEETUP_SORT_FIELDS: ReadonlySet<string> = new Set(['EVENT_NAME', 'COMMUNITY', 'STARTS_AT', 'LOCATION']);
export const VALID_MEETUP_SORT_ORDERS: readonly string[] = ['ASC', 'DESC'];
export const VALID_MEETUP_STATUS_VALUES: ReadonlySet<string> = new Set(['registered', 'not-registered']);

/** Default Snowflake schema for OCG meetup views. */
export const MEETUPS_DEFAULT_SNOWFLAKE_SCHEMA = 'ANALYTICS.PLATINUM_LFX_ONE';
/** Accepts a dot-separated Snowflake identifier path such as DATABASE.SCHEMA. */
export const MEETUPS_SNOWFLAKE_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)+$/;
/** Base URL used to build external OCG meetup links from group/event slugs. */
export const OCG_MEETUP_BASE_URL = 'https://ocgroups.dev';

export const MEETUP_STATUS_OPTIONS: FilterOption[] = [
  { label: 'All Statuses', value: null },
  { label: 'Registered', value: 'registered' },
  { label: 'Not Registered', value: 'not-registered' },
];

export const EMPTY_MY_MEETUPS_RESPONSE: MyMeetupsResponse = { data: [], total: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE, offset: 0 };
export const EMPTY_MEETUP_FILTER_OPTIONS: MeetupFilterOptionsResponse = { communities: [], roles: [] };
