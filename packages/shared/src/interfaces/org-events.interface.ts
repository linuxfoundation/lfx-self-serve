// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OffsetPaginatedResponse } from './api.interface';
import type { OrgEventsAttribution, OrgEventsParticipation, OrgEventsScope } from './org-events-filters.interface';
import type { OrgLensTimeRange } from './org-lens-time-range.interface';

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
  /** Distinct people for the served `attribution` and `participation` (Upcoming events always count registrations). */
  readonly orgAttendeeCount: number;
  /**
   * Event-wide registration goal; `null` when the event has none, or when its goal is 0.
   *
   * OPTIONAL as well as nullable, and the two mean different things: ABSENT means the caller may not
   * see it — not LF staff, or LF staff impersonating another user, since "view as" shows the member's
   * view and that view has no goal in it. #4432 requires the figure to be missing from the payload
   * rather than merely unrendered for external admins. `null` means the caller may see it and there is
   * none to see.
   */
  readonly eventRegistrationsGoal?: number | null;
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
  /** "Counted by"; omitted means the default. */
  readonly attribution?: OrgEventsAttribution;
  /** "Count"; omitted means the default. Ignored on the Upcoming tab. */
  readonly participation?: OrgEventsParticipation;
  /** "Show"; omitted means the default. */
  readonly eventScope?: OrgEventsScope;
  /** Foundation id; omitted or `''` is All Foundations. */
  readonly foundation?: string;
  /** Applies to the Past tab only; omitted means the default. */
  readonly range?: OrgLensTimeRange;
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
  readonly attribution: OrgEventsAttribution;
  readonly participation: OrgEventsParticipation;
  readonly eventScope: OrgEventsScope;
  readonly foundation: string;
  readonly range: OrgLensTimeRange;
}

/** A single person in the per-event attendees drawer: everyone the picked option credits to the organization, by name (title only for roster employees). */
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
  /** People in `data`: everyone the picked option counts for the event, narrowed by any name search. */
  readonly total: number;
  readonly data: readonly OrgEventAttendee[];
}

/** Foundation dropdown option on the Events page. */
export interface OrgEventFoundationOption {
  readonly id: string;
  readonly name: string;
}

/** Response for GET /api/orgs/:accountId/lens/events/foundations — foundations that have events under the picked `eventScope` and `attribution`. */
export interface OrgEventFoundationsResponse {
  readonly data: readonly OrgEventFoundationOption[];
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
