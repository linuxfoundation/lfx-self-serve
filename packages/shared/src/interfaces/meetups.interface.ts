// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OffsetPaginatedResponse } from './api.interface';

/**
 * Tab identifier for the meetups list component
 */
export type MeetupTabId = 'upcoming' | 'past';

/**
 * The set of valid status filter values for My Meetups.
 * Upcoming meetups map these values to whether the authenticated user has a role on the meetup.
 */
export type MeetupStatusFilter = 'registered' | 'not-registered';

/**
 * Valid sort order values for meetup queries
 */
export type MeetupSortOrder = 'ASC' | 'DESC';

/**
 * Valid sort fields for meetup queries
 */
export type MeetupSortField = 'EVENT_NAME' | 'COMMUNITY' | 'STARTS_AT' | 'LOCATION';

/**
 * Sort change event emitted by the meetups table
 */
export interface MeetupSortChangeEvent {
  field: MeetupSortField;
}

/**
 * Meetup item for the My Meetups dashboard
 */
export interface MyMeetup {
  /** Unique meetup event identifier */
  id: string;
  /** Meetup display name */
  name: string;
  /** Community display name */
  community: string;
  /** ISO 8601 meetup start date string */
  startDate: string;
  /** Human-readable date string */
  date: string;
  /** Human-readable location string */
  location: string;
  /** User's role at the meetup; empty string when not registered */
  role: string;
  /** Registration status derived from whether the user has a meetup role */
  status: 'Registered' | 'Not Registered';
  /** OCG group slug used to build the external meetup URL */
  groupSlug: string;
  /** OCG event slug used to build the external meetup URL */
  eventSlug: string;
  /** External OCG meetup URL */
  url: string;
}

/**
 * Paginated API response for my meetups
 */
export type MyMeetupsResponse = OffsetPaginatedResponse<MyMeetup>;

/**
 * Response for distinct global meetup filter options
 */
export interface MeetupFilterOptionsResponse {
  /** Community names available in the global meetup filter catalog */
  communities: string[];
  /** Meetup roles available in the global meetup filter catalog */
  roles: string[];
}

/**
 * Parameters for fetching my meetups from the API
 */
export interface GetMyMeetupsParams {
  isPast?: boolean;
  searchQuery?: string;
  community?: string;
  role?: string;
  status?: MeetupStatusFilter;
  sortField?: MeetupSortField;
  pageSize?: number;
  offset?: number;
  sortOrder?: MeetupSortOrder;
}

/**
 * Server-side options for fetching user meetups (required pagination/sort fields)
 */
export interface GetMyMeetupsOptions {
  isPast?: boolean;
  searchQuery?: string;
  community?: string;
  role?: string;
  status?: MeetupStatusFilter;
  sortField?: MeetupSortField;
  pageSize: number;
  offset: number;
  sortOrder: MeetupSortOrder;
}

/**
 * Raw row returned from the meetups Snowflake views
 */
export interface MeetupRow {
  EVENT_ID: string;
  STARTS_AT: Date | string;
  EVENT_NAME: string;
  COMMUNITY: string;
  DATE: string;
  LOCATION: string;
  ROLES: string | null;
  GROUP_SLUG: string;
  EVENT_SLUG: string;
  TOTAL_RECORDS: number;
}

/**
 * Raw row returned from the meetups filter options Snowflake view
 */
export interface MeetupFilterRow {
  FILTER_NAME: 'community' | 'role';
  FILTER_VALUE: string;
}
