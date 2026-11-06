// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Role badge — once-a-speaker-always-Speaker on the per-person row (Item 4 R4.1); per-event truth on the expanded row. */
export type OrgEventAttendeeRole = 'Speaker' | 'Attendee';

/** Sortable column on the Event Attendees main table — mirrors the prototype's four-column sort surface. */
export type OrgEventAttendeeSortColumn = 'name' | 'role' | 'events' | 'lastAttended';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgEventAttendeeSortDirection = 1 | -1;

/**
 * One person × event row from `PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION` — the only grain the BFF returns. The client groups
 * rows by `participantRef` for the main table and expands to the rows themselves; `participantRef` is an opaque number, stable
 * only within one response. Everyone the selection credits to the organization is sent by name, with a job title only for
 * roster employees (lfx-self-serve#5158),
 * and no field can hold an email address.
 */
export interface OrgEventAttendeeDetailRow {
  /** Opaque per-person id within this account (dense rank over a normalized identity key). Group key for the main row. */
  participantRef: number;
  /** Roster person key; `null` for a person without a roster match — render the row non-clickable. */
  personKey: string | null;
  /** The person's name, or the neutral registrant label when the warehouse has none. Never an address. */
  displayName: string;
  jobTitle: string | null;
  eventId: string;
  eventName: string;
  /** Freeform venue/location string from upstream; client falls back through `eventCity`/`eventCountry` to `foundationName`. */
  eventLocation: string | null;
  eventCity: string | null;
  eventCountry: string | null;
  /** Event marketing URL — stored for forward use; the expanded row renders the event name as plain text. */
  eventUrl: string | null;
  foundationId: string | null;
  foundationName: string | null;
  /** ISO date `YYYY-MM-DD`. */
  eventStartDate: string | null;
  /** ISO date `YYYY-MM-DD`. Drives the parent row's "Last Attended" column. */
  eventEndDate: string | null;
  /** Per-event accepted-speaker flag — drives the per-event Role pill in the expanded sub-table. */
  isSpeaker: boolean;
}

/** Summary-row numbers for the picked (range, attribution, participation): the tiles until the rows are narrowed. */
export interface OrgEventAttendeesSummary {
  /** Distinct people counted. */
  attendeesCount: number;
  speakersCount: number;
  eventsCount: number;
  foundationsCount: number;
}

/** Foundation dropdown option — only foundations the org has event-attendee rows for (R2.2 tab-scoped narrowing). */
export interface OrgEventAttendeeFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Event dropdown option — keyed on `EVENT_ID`; label is event name. Ordered by `EVENT_END_DATE DESC NULLS LAST` to match the prototype (most-recent first). */
export interface OrgEventAttendeeEventOption {
  eventId: string;
  eventName: string;
}

/** Stats-card shape for the Event Attendees tab — client-derived from the rows (not on the wire). */
export interface OrgEventAttendeeStatsBaseline {
  speakers: number;
  attendees: number;
  events: number;
  foundations: number;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/event-attendees?range=&attribution=&participation=`. */
export interface OrgEventAttendeesResponse {
  accountId: string;
  /** Person × event rows, newest event first; the browser applies no range or ended-only filter of its own. */
  details: OrgEventAttendeeDetailRow[];
  summary: OrgEventAttendeesSummary;
  foundationOptions: OrgEventAttendeeFoundationOption[];
  eventOptions: OrgEventAttendeeEventOption[];
}

// Client-only view types (NOT on the wire).

/** Pre-decorated event-attendee main row VM — initials, avatar colour, filter-aware role/events/last-attended/most-recent. */
export interface OrgEventAttendeeRowVm {
  /** Group key — one main row per `participantRef`. */
  participantRef: number;
  /** `null` renders the row non-clickable (a person without a roster match). */
  personKey: string | null;
  name: string;
  title: string | null;
  initials: string;
  avatarColorClass: string;
  role: OrgEventAttendeeRole;
  eventsCount: number;
  /** ISO date — drives `lastAttendedLabel` and the sort comparator on the Last Attended column. */
  lastAttendedTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` (e.g. `May 22, 2026`) or em-dash. */
  lastAttendedLabel: string;
  mostRecentEventName: string | null;
  mostRecentFoundationName: string | null;
}

/** One collapsed row in the expanded "Events" sub-table — one per `(participantRef, eventId)`. */
export interface OrgEventAttendeeExpandedRowVm {
  eventId: string;
  eventName: string;
  /** Already-resolved subtext: `eventLocation ?? eventCity+eventCountry ?? foundationName ?? null`. */
  locationLabel: string | null;
  /** Per-event role — distinct from the row's once-a-speaker-always-Speaker badge. */
  role: OrgEventAttendeeRole;
  startTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `eventStartDate`, or em-dash when missing. */
  startLabel: string;
  /** ISO timestamp used as the primary sort key inside the sub-table — `eventEndDate` (matches the parent row's Last Attended semantic). */
  sortTs: string | null;
}
