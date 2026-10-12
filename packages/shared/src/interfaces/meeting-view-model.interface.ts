// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingVisibility } from '../enums';
import type { MeetingRegistrant, RsvpResponse } from './meeting.interface';

/**
 * Where the viewer sits relative to the meeting's schedule.
 *
 * `live` is the join window, which opens `early_join_time_minutes` before the start and closes
 * `MEETING_END_BUFFER_MS` after the scheduled end — the same window `canJoinMeeting` answers, so
 * "the join button is showing" and "the time state is live" can never disagree.
 */
export type MeetingTimeState = 'before' | 'live' | 'ended';

/** A committee chip in the V2 header: its name, and its group page path with the uid encoded. */
export interface MeetingCommitteeLink {
  uid: string;
  name: string;
  href: string;
}

/**
 * The meeting status the V2 page shows in its pill and identity bar (E1-05).
 * @description The time state, except that before the meeting a viewer on the invite list with RSVP
 * tracking on sees their own answer: `awaiting-rsvp`, `going`, `maybe` or `cant-attend`.
 */
export type MeetingStatusKind = 'upcoming' | 'starting-soon' | 'live' | 'ended' | 'awaiting-rsvp' | 'going' | 'maybe' | 'cant-attend';

/** Start and end of the occurrence a V2 section is about, end derived from its duration. */
export interface MeetingTimeWindow {
  start: Date;
  end: Date;
}

/** Inputs to `resolveMeetingStatus`. */
export interface MeetingStatusInput {
  timeState: MeetingTimeState;
  /**
   * Whether the scheduled start has passed. The join window opens before it, so a `live` time state
   * before the start reads as `starting-soon`.
   */
  hasStarted: boolean;
  /** `Meeting.invited`: the viewer is on the invite list (a registrant, or an invited organizer). */
  invited: boolean;
  /** `Meeting.is_invite_responses_enabled`; pre-2024 meetings never collected RSVPs. */
  inviteResponsesEnabled: boolean;
  /**
   * The viewer's own answer for the selected occurrence: `null` when they have not answered,
   * `undefined` while it is not loaded. Unknown never reads as "Awaiting your RSVP".
   */
  myRsvp: RsvpResponse | null | undefined;
}

/**
 * Who the viewer is, as far as this meeting is concerned.
 *
 * - `visitor` — not signed in. No roster, no registration, no RSVP.
 * - `outsider` — signed in but not on the meeting. May be able to self-register, or may not.
 * - `registrant` — on the meeting's registrant list (`Meeting.invited`).
 * - `organizer` — has write access to the meeting (`Meeting.organizer`).
 *
 * The epic's viewer axis also names a `host` tier. It is deliberately absent because host-key
 * entitlement is orthogonal to this role, not a rung on it: the payload already carries it as
 * `Meeting.can_view_host_key` / `Meeting.host_key`, which the BFF sets for whoever holds the FGA
 * `host` relation, including co-hosts who are not organizers. Read those two fields directly;
 * never treat `organizer` as the host-key gate.
 */
export type MeetingViewerRole = 'visitor' | 'outsider' | 'registrant' | 'organizer';

/**
 * The single control the action rail renders. Exactly one kind is in effect at a time, and every
 * combination of inputs maps to a named kind — `none` is a decision ("nothing to offer this
 * viewer"), not a fall-through.
 *
 * - `join` — the join window is open and the viewer is on the meeting, or is a signed-in viewer on
 *   an unrestricted meeting (reaching the page already required the link).
 * - `rsvp` — pre-meeting RSVP controls (only ever returned when RSVP tracking is on).
 * - `register` — self-registration, available on public unrestricted meetings.
 * - `invitation-required` — signed-in outsider on a restricted meeting. V1 renders an empty rail
 *   before the window and a join error inside it; saying so is much of the point of this redesign.
 * - `guest-join` — anonymous visitor inside the join window, whatever the privacy. On a restricted
 *   meeting the server matches the submitted email against the registrants; this is how an invitee
 *   without an LFX session joins from their invite link.
 * - `tools` — post-meeting artifacts (recording, transcript, summary).
 * - `no-access` — the meeting has ended and the viewer cannot see its artifacts.
 * - `rsvp-unavailable` — registrant on a pre-2024 meeting, where `is_invite_responses_enabled` is
 *   not true and no RSVP exists to show or collect. The other V1 silent-empty state.
 * - `none` — nothing actionable, and nothing worth explaining.
 */
export type ActionSlotKind = 'join' | 'rsvp' | 'register' | 'invitation-required' | 'guest-join' | 'tools' | 'no-access' | 'rsvp-unavailable' | 'none';

/**
 * The state of a V2 join link (E2-01 FR-027, E2-06 FR-025): the signed-in Join control's, fetched
 * with the account's email, and the guest form's, fetched with the email typed in. `loading` is
 * also what the server renders, since the fetch is browser-only; `idle` is the guest form's state
 * until its fields are valid, when there is nothing to fetch yet.
 */
export interface MeetingJoinUrlState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /**
   * The join link, once `ready`: bare from `MeetingJoinUrlService`, with the Zoom display-name params
   * once a component adds them (`buildJoinUrlWithParams`).
   */
  url?: string;
  /** The BFF's message, or a generic one, once `error`. */
  error?: string;
  /** The BFF's error code, e.g. `NOT_REGISTERED_FOR_MEETING`. */
  code?: string | null;
}

/**
 * The meeting's privacy, resolved once into the label and icon the header renders plus the raw
 * fields any further branching needs. `openToPublic` — public *and* unrestricted — gates
 * self-registration only. Joining keys on `restricted` alone, because reaching a non-open page
 * already required the meeting password.
 */
export interface MeetingPrivacyState {
  /** `fa-light` class from `getMeetingPrivacyIcon`. */
  icon: string;
  /** Human label from `getMeetingPrivacyLabel`, e.g. `Private (Restricted)`. */
  label: string;
  /** True only when the meeting is public AND unrestricted. */
  openToPublic: boolean;
  restricted: boolean;
  /** Never null: `resolvePrivacy` reads an absent visibility as private, so the state fails closed. */
  visibility: MeetingVisibility;
}

/** Inputs to `resolveViewerRole` — the viewer-context fields the detail payload carries. */
export interface MeetingViewerContext {
  /** Whether a user session exists at all. */
  authenticated: boolean;
  /**
   * `Meeting.invited` — the viewer is on the registrant list. Populated only by the upcoming detail
   * endpoint: the past endpoint folds registrant status into `full_access` and never sets
   * `invited`, so on a past meeting a registrant resolves as `outsider`. Past-meeting sections key
   * on `fullAccess`, not on the role, for that reason.
   */
  invited: boolean;
  /** `Meeting.organizer` — the viewer has write access. */
  organizer: boolean;
}

/**
 * Inputs to `resolveActionSlot`.
 *
 * The viewer's own RSVP answer is deliberately not here: it changes what the RSVP card *shows*,
 * never which kind the rail renders. It belongs to the RSVP card's own input (E2-04 / E2-05), not
 * to this decision or to section visibility.
 */
export interface ActionSlotInput {
  /**
   * Whether the viewer may see a past meeting's artifacts — `full_access` on
   * {@link PublicPastMeetingResponse}, held client-side as `pastMeetingFullAccess`. Only
   * consulted when `timeState` is `ended`.
   */
  fullAccess: boolean;
  /**
   * Normalized `Meeting.is_invite_responses_enabled`, read through
   * `isMeetingInviteResponsesEnabled` — never the raw indexed alias. When false, this resolver can
   * never return `rsvp`.
   */
  inviteResponsesEnabled: boolean;
  privacy: MeetingPrivacyState;
  timeState: MeetingTimeState;
  viewerRole: MeetingViewerRole;
}

/** Inputs to `resolveVisibleSections`. */
export interface MeetingSectionVisibilityInput {
  fullAccess: boolean;
  inviteResponsesEnabled: boolean;
  /** Whether the meeting recurs, i.e. whether there is an occurrence strip to render. */
  recurring: boolean;
  timeState: MeetingTimeState;
  viewerRole: MeetingViewerRole;
}

/**
 * Which regions of the details page render. Every field is a decision, so a section that is
 * missing from the page can always be traced to one boolean rather than to an `@if` buried in a
 * template.
 *
 * `rsvpSummary`, `rsvpRosterFilter` and `rsvpAvatarBadges` are all separately false whenever RSVP
 * tracking is off, because the hard gate is "no RSVP UI anywhere", not "no RSVP card".
 */
export interface MeetingSectionVisibility {
  agenda: boolean;
  /**
   * The join region — visible until the meeting ends, the live window included, and only for
   * people on the meeting. Covers the join link only. The host key is **not** gated by this flag:
   * a co-host who is not an organizer can hold it while resolving as `outsider`, so render it from
   * `Meeting.can_view_host_key` / `Meeting.host_key` directly. Passcodes and dial-in numbers wait for
   * upstream U-04 / U-05 and are not implied here.
   */
  joinDetails: boolean;
  materials: boolean;
  /** The occurrence strip for a recurring meeting. */
  occurrences: boolean;
  /**
   * The participant roster.
   *
   * - **Upcoming or live:** registrants and organizers only. The registrant list comes back empty for
   *   anyone else, and the detail payloads no longer populate `individual_registrants_count` or
   *   `committee_members_count`, so an outsider or visitor has no count source: false for them
   *   rather than an empty list or an invented number.
   * - **Ended:** any signed-in viewer with artifact access, whatever the role, because the past
   *   payload never sets `invited` and a past registrant arrives as `outsider`. The roster is then
   *   the `PastMeetingParticipant` list. Never for an anonymous viewer.
   */
  people: boolean;
  /** Per-avatar RSVP badges on the roster. Upcoming or live only: past rows carry no RSVP. */
  rsvpAvatarBadges: boolean;
  /** The "responded / attending" filter on the roster. Upcoming or live only. */
  rsvpRosterFilter: boolean;
  /**
   * The aggregate RSVP strip, from meeting-level counts. Upcoming or live: registrants and organizers.
   * Ended: the same audience as `people` — any signed-in viewer with artifact access.
   */
  rsvpSummary: boolean;
  /** Recording, transcript and AI summary — post-meeting, gated on artifact access. */
  tools: boolean;
}

/** What the people section's roster is fetched for (E3-04): the meeting and the RSVP occurrence. */
export interface MeetingRosterRequest {
  meetingId: string;
  /** `undefined` for a one-off meeting, whose registrants and RSVPs are not per occurrence. */
  occurrenceId: string | undefined;
}

/** One upcoming roster row of the people section (E3-04), display-ready. */
export interface MeetingPeopleRow {
  uid: string;
  name: string;
  /** "job title · organization", whichever of the two exist; `null` when neither does. */
  role: string | null;
  avatarUrl: string | null;
  /** The registrant's `host` flag: shown as "Organizer" ahead of any RSVP. */
  organizer: boolean;
  /**
   * The RSVP the row shows, as `data-attendance` reads it; `null` when RSVP tracking is off for the
   * meeting, so no RSVP UI renders at all.
   */
  attendance: RsvpResponse | 'pending' | null;
  /** How they came to be invited: directly, or with a committee (`data-invitation`). */
  invitation: 'direct' | 'committee';
}

/** The people section's RSVP tallies; `pending` is everyone on the roster who has not answered. */
export interface MeetingPeopleTallies {
  accepted: number;
  maybe: number;
  declined: number;
  pending: number;
}

/** Options for `buildMeetingPeopleRows` (E3-04). */
export interface MeetingPeopleRowOptions {
  /** `Meeting.is_invite_responses_enabled`: when false, no row carries an RSVP. */
  inviteResponsesEnabled: boolean;
  /** The signed-in viewer, to find their own row. */
  viewer?: { username?: string | null; email?: string | null } | null;
  /**
   * The viewer's own answer as the page knows it (`MeetingDetailsStateService.myRsvp`). An answer the
   * viewer just saved reaches the page before the query service indexes it, so it wins over the
   * roster's copy on the viewer's row; `null` or `undefined` leave the roster's copy alone.
   */
  viewerRsvp?: RsvpResponse | null;
}

/**
 * The people section's roster load (E3-04). `registrants` is what the section shows: the last roster
 * fetched for the same meeting and occurrence while a refresh is in flight or after it fails.
 */
export interface MeetingRosterState {
  status: 'loading' | 'ready' | 'error';
  registrants: MeetingRegistrant[];
}
