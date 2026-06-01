// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OffsetPaginatedResponse } from './api.interface';

/** Tab identifier for the Org Events page tab strip. */
export type OrgEventsTabId = 'upcoming' | 'past';

/** Stat-card filter identifier for the Org Events page. */
export type OrgEventStatFilterId = 'total' | 'past' | 'upcoming';

/** Tab definition for the Org Events page. */
export interface OrgEventsTabConfig {
  readonly id: OrgEventsTabId;
  readonly label: string;
  readonly icon: string;
}

/** A single event in the org events list. */
export interface OrgEvent {
  readonly eventId: string;
  readonly eventName: string;
  readonly foundation: string | null;
  readonly eventStartDate: string | null;
  readonly eventEndDate: string | null;
  readonly eventLocation: string | null;
  readonly eventCity: string | null;
  readonly eventCountry: string | null;
  readonly eventUrl: string | null;
  readonly eventRegistrationUrl: string | null;
  readonly orgAttendeeCount: number;
  readonly isRegistered: boolean;
}

/** Paginated response for org events. */
export type OrgEventsResponse = OffsetPaginatedResponse<OrgEvent>;

/** Frontend query params for GET /api/orgs/:accountId/lens/events. */
export interface GetOrgEventsParams {
  readonly isPast?: boolean;
  readonly searchQuery?: string;
  readonly status?: string | null;
  readonly pageSize?: number;
  readonly offset?: number;
  readonly sortOrder?: 'ASC' | 'DESC';
}

/** Summary counts for the Org Events stat strip. */
export interface OrgEventsSummary {
  readonly totalEvents: number;
  readonly pastEvents: number;
  readonly upcomingEvents: number;
}

/** Backend options for OrgLensEventsService.getOrgEvents. */
export interface GetOrgEventsOptions {
  readonly isPast: boolean;
  readonly searchQuery?: string;
  readonly status?: string | null;
  readonly pageSize: number;
  readonly offset: number;
  readonly sortOrder: 'ASC' | 'DESC';
}

/** Raw row returned by the org upcoming/past events Snowflake query (backend query layer). */
export interface OrgEventRow {
  EVENT_ID: string;
  EVENT_NAME: string;
  FOUNDATION: string | null;
  EVENT_START_DATE: Date | string | null;
  EVENT_END_DATE: Date | string | null;
  EVENT_LOCATION: string | null;
  EVENT_CITY: string | null;
  EVENT_COUNTRY: string | null;
  EVENT_URL: string | null;
  EVENT_REGISTRATION_URL: string | null;
  ORG_ATTENDEE_COUNT: number;
  IS_REGISTERED: boolean;
  TOTAL_RECORDS: number;
}

/** Raw row returned by the org events summary Snowflake query (backend query layer). */
export interface OrgEventsSummaryRow {
  TOTAL_EVENTS: number;
  PAST_EVENTS: number;
  UPCOMING_EVENTS: number;
}
