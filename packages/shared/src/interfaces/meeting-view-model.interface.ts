// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MeetingVisibility } from '../enums';

/**
 * Where the viewer sits relative to the meeting's schedule.
 *
 * `live` is the join window, which opens `early_join_time_minutes` before the start and closes
 * `MEETING_END_BUFFER_MS` after the scheduled end — the same window `canJoinMeeting` answers, so
 * "the join button is showing" and "the time state is live" can never disagree.
 */
export type MeetingTimeState = 'before' | 'live' | 'ended';

/**
 * Who the viewer is, as far as this meeting is concerned.
 *
 * - `visitor` — not signed in. No roster, no registration, no RSVP.
 * - `outsider` — signed in but not on the meeting. May be able to self-register, or may not.
 * - `registrant` — on the meeting's registrant list (`Meeting.invited`).
 * - `organizer` — has write access to the meeting (`Meeting.organizer`).
 *
 * The epic's viewer axis also names a `host` tier. It is deliberately absent: nothing on the
 * meeting payload distinguishes a host from an organizer today, and inventing the distinction here
 * would put a state in the view model that no resolver can ever return. Add it when the payload
 * can answer it.
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
  visibility: MeetingVisibility | null;
}

/** Inputs to `resolveViewerRole` — the viewer-context fields the detail payload carries. */
export interface MeetingViewerContext {
  /** Whether a user session exists at all. */
  authenticated: boolean;
  /** `Meeting.invited` — the viewer is on the registrant list. */
  invited: boolean;
  /** `Meeting.organizer` — the viewer has write access. */
  organizer: boolean;
}

/**
 * Inputs to `resolveActionSlot`.
 *
 * The viewer's own RSVP answer is deliberately not here: it changes what the RSVP card *shows*,
 * never which kind the rail renders. It belongs to the card, and to
 * {@link MeetingSectionVisibilityInput}, not to this decision.
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
   * people on the meeting. Scoped to what the product already has (the join link and the host
   * key); passcodes and dial-in numbers exist nowhere in LFX One and are not implied here.
   */
  joinDetails: boolean;
  materials: boolean;
  /** The occurrence strip for a recurring meeting. */
  occurrences: boolean;
  /**
   * The participant roster. The roster comes back empty for anyone who is neither a registrant nor
   * an organizer, and the detail payloads no longer populate `individual_registrants_count` or
   * `committee_members_count`, so an outsider or visitor has no count source at all — this is
   * false for them rather than rendering an empty list or an invented number.
   */
  people: boolean;
  /** Per-avatar RSVP badges on the roster. */
  rsvpAvatarBadges: boolean;
  /** The "responded / attending" filter on the roster. */
  rsvpRosterFilter: boolean;
  /** The aggregate RSVP strip. */
  rsvpSummary: boolean;
  /** Recording, transcript and AI summary — post-meeting, gated on artifact access. */
  tools: boolean;
}
