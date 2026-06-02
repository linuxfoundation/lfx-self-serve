// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Role badge — once-a-speaker-always-Speaker on the per-person row (Item 4 R4.1); per-event truth on the expanded row. */
export type OrgEventAttendeeRole = 'Speaker' | 'Attendee';

/** Sortable column on the Event Attendees main table — mirrors the prototype's four-column sort surface. */
export type OrgEventAttendeeSortColumn = 'name' | 'role' | 'events' | 'lastAttended';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgEventAttendeeSortDirection = 1 | -1;

/** Time-window filter buckets — anchored on `EVENT_END_DATE`; `all` collapses to `IS_PAST_EVENT = TRUE` per Item 2 R2.4 lock. */
export type OrgEventAttendeeTimeWindow = '3m' | '6m' | '12m' | '2y' | 'all';

/** One detail row from `PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS` — finest grain the BFF returns; client groups by `(personKey, eventId)` for the expanded row. */
export interface OrgEventAttendeeDetailRow {
  personKey: string;
  eventId: string;
  eventName: string;
  /** Freeform venue/location string from upstream (e.g. `Alte Kongresshalle, Munich`). NULL on ~7% of Red Hat rows; client falls back through `eventCity`/`eventCountry` to `foundationName`. */
  eventLocation: string | null;
  eventCity: string | null;
  eventCountry: string | null;
  /** Event marketing URL — stored for forward use (clickable event name in a future iteration); V1 expanded row renders the event name as plain text (Q4 lock 2026-06-02). */
  eventUrl: string | null;
  foundationId: string | null;
  foundationName: string | null;
  /** ISO date `YYYY-MM-DD`. Anchors the per-event "Date" column in the expanded sub-table (R5.2). */
  eventStartDate: string | null;
  /** ISO date `YYYY-MM-DD`. Drives the time-window filter, the parent row's "Last Attended" column, and the Most Recent tiebreaker. */
  eventEndDate: string | null;
  /** Per-event speaker flag — drives the per-event Role pill in the expanded sub-table. */
  isSpeaker: boolean;
  /** `TRUE` when the event has already happened — Item 2 R2.4 collapses "All time" to this predicate. */
  isPastEvent: boolean;
}

/** Per-(account, person) main row source — joined client-side with `details` for filter-aware derivations. */
export interface OrgEventAttendeeRow {
  personKey: string;
  lfid: string | null;
  cdpMemberId: string | null;
  name: string;
  title: string | null;
  email: string | null;
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

/** Stats baseline — recomputed client-side from filtered details so all four cards stay in lockstep with the table (Item 3 lock). */
export interface OrgEventAttendeeStatsBaseline {
  /** `COUNT(DISTINCT CASE WHEN isSpeaker THEN personKey END)` over the filtered set. */
  speakers: number;
  /** `COUNT(DISTINCT personKey)` over the filtered set — includes speakers; mirrors the table row count. */
  attendees: number;
  /** `COUNT(DISTINCT eventId)` over the filtered set. */
  events: number;
  /** `COUNT(DISTINCT foundationId)` over the filtered set. */
  foundations: number;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/event-attendees`. */
export interface OrgEventAttendeesResponse {
  accountId: string;
  attendees: OrgEventAttendeeRow[];
  details: OrgEventAttendeeDetailRow[];
  stats: OrgEventAttendeeStatsBaseline;
  foundationOptions: OrgEventAttendeeFoundationOption[];
  eventOptions: OrgEventAttendeeEventOption[];
}

// Client-only view types (NOT on the wire).

/** Pre-decorated event-attendee main row VM — initials, avatar colour, filter-aware role/events/last-attended/most-recent. */
export interface OrgEventAttendeeRowVm {
  personKey: string;
  name: string;
  title: string | null;
  email: string | null;
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

/** One collapsed row in the expanded "Events" sub-table — one per `(personKey, eventId)`. */
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

/** Event Attendees time-window dropdown option — label rendered as-is in `<lfx-select>`. */
export interface OrgEventAttendeeTimeWindowOption {
  label: string;
  value: OrgEventAttendeeTimeWindow;
}
