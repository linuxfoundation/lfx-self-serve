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
  /** Event-wide registration goal/target (EVENT_REGISTRATIONS_GOAL); null when no goal is set. */
  readonly eventRegistrationsGoal: number | null;
  readonly orgSpeakerAcceptedCount: number;
  readonly orgSpeakerSubmittedCount: number;
  readonly isOrgSponsor: boolean;
}

/** Paginated response for org events. */
export type OrgEventsResponse = OffsetPaginatedResponse<OrgEvent>;

/** Org event row with presentation fields pre-baked for template rendering (avoids method calls in template). */
export interface OrgEventRowVm extends OrgEvent {
  readonly dateRange: string;
}

/** Frontend query params for GET /api/orgs/:accountId/lens/events. */
export interface GetOrgEventsParams {
  readonly isPast?: boolean;
  readonly searchQuery?: string;
  readonly status?: string | null;
  readonly pageSize?: number;
  readonly offset?: number;
  readonly sortField?: string;
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
  readonly sortField: string;
  readonly sortOrder: 'ASC' | 'DESC';
}

/** A single org employee in the per-event attendees drawer. */
export interface OrgEventAttendee {
  readonly contactId: string;
  readonly name: string;
  readonly jobTitle: string | null;
}

/** Attendee row with presentation fields pre-baked for template rendering (avoids method calls in template). */
export interface OrgEventAttendeeVm extends OrgEventAttendee {
  readonly initials: string;
  readonly avatarColorClass: string;
}

/** Response for GET /api/orgs/:accountId/lens/events/:eventId/attendees */
export interface OrgEventAttendeesDrawerResponse {
  readonly eventId: string;
  readonly eventName: string;
  readonly total: number;
  readonly data: readonly OrgEventAttendee[];
}

/** A single org employee in the per-event speakers drawer. */
export interface OrgEventSpeaker {
  readonly contactId: string;
  readonly name: string;
  readonly jobTitle: string | null;
  readonly status: 'ACCEPTED' | 'SUBMITTED';
}

/** Speaker row with presentation fields pre-baked for template rendering (avoids method calls in template). */
export interface OrgEventSpeakerVm extends OrgEventSpeaker {
  readonly initials: string;
  readonly avatarColorClass: string;
}

/** Response for GET /api/orgs/:accountId/lens/events/:eventId/speakers */
export interface OrgEventSpeakersResponse {
  readonly eventId: string;
  readonly eventName: string;
  readonly acceptedCount: number;
  readonly submittedCount: number;
  readonly data: readonly OrgEventSpeaker[];
}
