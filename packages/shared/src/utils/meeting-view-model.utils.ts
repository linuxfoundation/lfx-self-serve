// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingVisibility } from '../enums';
import type {
  ActionSlotInput,
  ActionSlotKind,
  Meeting,
  MeetingOccurrence,
  MeetingPrivacyState,
  MeetingSectionVisibility,
  MeetingSectionVisibilityInput,
  MeetingStatusInput,
  MeetingStatusKind,
  MeetingTimeState,
  MeetingViewerContext,
  MeetingViewerRole,
} from '../interfaces';
import { getMeetingPrivacyIcon, getMeetingPrivacyLabel } from './meeting-privacy.utils';
import { canJoinMeeting, hasMeetingEnded } from './meeting.utils';

/**
 * Pure resolvers behind the meeting details V2 view model.
 *
 * Every function here is total and deterministic: each returns a named member of its result type
 * for every input combination, and none reads the clock — `now` is always a parameter. That is
 * what lets the whole cross product of (time x viewer x privacy x access x RSVP tracking) be
 * asserted in a table rather than discovered in a template.
 *
 * Nothing consumes these yet; the V2 components land on top of them.
 */

/**
 * Places the viewer on the meeting's timeline.
 *
 * Delegates to {@link canJoinMeeting} and {@link hasMeetingEnded} rather than recomputing the
 * window, so `live` is exactly "the join button would work" and `ended` is exactly the boundary
 * the dashboard already filters on. `ended` is tested first because the two windows share their
 * upper bound and `ended` is the strict side of it.
 *
 * `occurrence` is not optional in practice for a recurring meeting. Both delegates fall back to
 * `meeting.start_time` — the *series'* start — when it is nullish, so a long-running series whose
 * first occurrence is months past resolves to `ended` even while future occurrences exist. The
 * caller owns occurrence selection (the V2 page has an occurrence strip and knows which one it is
 * showing), so this resolver describes the occurrence it is handed rather than picking one itself.
 * Pass `null` only for a one-time meeting.
 */
export function resolveTimeState(meeting: Meeting, occurrence: MeetingOccurrence | null | undefined, now: Date): MeetingTimeState {
  if (hasMeetingEnded(meeting, occurrence ?? undefined, now)) {
    return 'ended';
  }

  if (canJoinMeeting(meeting, occurrence, now)) {
    return 'live';
  }

  return 'before';
}

/**
 * Collapses the viewer-context flags into one role.
 *
 * Order matters: an organizer is usually also invited, and the organizer tier wins. An
 * unauthenticated viewer is a `visitor` regardless of what the payload claims, because anonymous
 * responses carry no per-user fields to trust.
 */
export function resolveViewerRole(context: MeetingViewerContext): MeetingViewerRole {
  if (!context.authenticated) {
    return 'visitor';
  }

  if (context.organizer) {
    return 'organizer';
  }

  if (context.invited) {
    return 'registrant';
  }

  return 'outsider';
}

/**
 * Resolves the meeting status shown in the V2 status pill and identity bar (E1-05, FR-011).
 *
 * Ended and live are time states for everyone. Before the meeting, a viewer on the invite list with
 * RSVP tracking on sees their own answer; with tracking off (pre-2024 meetings) or the answer not
 * loaded yet, the pill falls back to the time state rather than claiming the viewer has not answered.
 */
export function resolveMeetingStatus(input: MeetingStatusInput): MeetingStatusKind {
  if (input.timeState === 'ended') {
    return 'ended';
  }
  if (input.timeState === 'live') {
    return 'live';
  }
  if (!input.invited || !input.inviteResponsesEnabled || input.myRsvp === undefined) {
    return 'upcoming';
  }

  switch (input.myRsvp) {
    case 'accepted':
      return 'going';
    case 'maybe':
      return 'maybe';
    case 'declined':
      return 'cant-attend';
    default:
      return 'awaiting-rsvp';
  }
}

/**
 * Resolves the header's privacy chip from the meeting's two privacy fields.
 *
 * Reuses the existing label and icon helpers rather than re-deriving the four-way copy — they
 * branch in different orders on purpose (label is visibility-first, icon is restricted-first), and
 * duplicating either here would eventually drift from the admin surfaces that already call them.
 *
 * An absent `visibility` reads as private. `Meeting.visibility` is nullable, and both helpers fall
 * through to the public label and the globe icon when it is null — which would put "Public" and a
 * globe in the header while `openToPublic` stayed false and the rail told the same viewer they
 * need an invitation. Resolving the unknown case closed here is what makes this object's promise
 * true: every field describes one privacy reading, so the header and the rail cannot disagree.
 */
export function resolvePrivacy(visibility: MeetingVisibility | null | undefined, restricted: boolean | null | undefined): MeetingPrivacyState {
  const resolvedVisibility = visibility ?? MeetingVisibility.PRIVATE;
  const resolvedRestricted = restricted === true;

  return {
    icon: getMeetingPrivacyIcon(resolvedVisibility, resolvedRestricted),
    label: getMeetingPrivacyLabel(resolvedVisibility, resolvedRestricted),
    openToPublic: resolvedVisibility === MeetingVisibility.PUBLIC && !resolvedRestricted,
    restricted: resolvedRestricted,
    visibility: resolvedVisibility,
  };
}

/**
 * The action rail's decision table. Switches on time state first, then on the viewer, so every
 * branch terminates in an explicit kind.
 *
 * Two of the returns exist purely to name what V1 renders as an empty rail:
 * `invitation-required` for a signed-in outsider on a restricted meeting, and `rsvp-unavailable`
 * for a registrant on a pre-2024 meeting that never had invite responses.
 *
 * The executable source of truth for every cell is the `MATRIX` table in
 * `meeting-view-model.utils.spec.ts`. The written state matrix, which adds what V1 renders for each
 * cell, is `specs/011-meeting-details-redesign/state-matrix.md`.
 */
export function resolveActionSlot(input: ActionSlotInput): ActionSlotKind {
  if (input.timeState === 'ended') {
    return resolveEndedActionSlot(input);
  }

  if (input.timeState === 'live') {
    return resolveLiveActionSlot(input);
  }

  return resolveUpcomingActionSlot(input);
}

/**
 * Which regions render, for one viewer on one meeting.
 *
 * The RSVP hard gate lives here as well as in {@link resolveActionSlot}: when
 * `inviteResponsesEnabled` is false, every RSVP-bearing section is false — summary strip, roster
 * filter and per-avatar badges alike — leaving the invitee count as the only attendance signal.
 */
export function resolveVisibleSections(input: MeetingSectionVisibilityInput): MeetingSectionVisibility {
  const onTheMeeting = input.viewerRole === 'organizer' || input.viewerRole === 'registrant';
  const ended = input.timeState === 'ended';
  // Past content is gated on artifact access; upcoming content is not gated at all, because the
  // detail payload only returns a meeting the viewer was allowed to fetch in the first place.
  // `hasArtifactAccess` is the same rule {@link resolveEndedActionSlot} applies, shared rather
  // than restated: if the rail resolves to `tools`, the sections it points at must be visible.
  const contentVisible = !ended || hasArtifactAccess(input.viewerRole, input.fullAccess);
  // Ended: the past roster's audience — any signed-in viewer with artifact access, whatever the
  // role, because the past payload never sets `invited` and a past registrant arrives as `outsider`.
  const pastRosterVisible = input.viewerRole !== 'visitor' && hasArtifactAccess(input.viewerRole, input.fullAccess);
  // The aggregate strip reads meeting-level counts, not roster rows, so on an ended meeting it goes
  // wherever the past roster goes; v1 shows it on a clock-ended meeting whenever the counts exist.
  const rsvpSummaryVisible = input.inviteResponsesEnabled && (ended ? pastRosterVisible : onTheMeeting);
  // The roster filter and per-avatar badges read roster rows. A past roster is built from
  // `PastMeetingParticipant` records, which carry attendance and invitation but no RSVP answer, so
  // on an ended meeting there is nothing for them to show.
  const rsvpRosterVisible = input.inviteResponsesEnabled && onTheMeeting && !ended;

  return {
    agenda: contentVisible,
    joinDetails: !ended && onTheMeeting,
    materials: contentVisible,
    // Deliberately not gated on artifact access: the occurrence strip is navigation, not content,
    // and a viewer locked out of one past occurrence may still open the upcoming ones.
    occurrences: input.recurring,
    // Upcoming: registrants and organizers only — nobody else has a roster or count source.
    // Ended: any signed-in viewer with artifact access, not keyed on the role. The past payload never
    // carries `invited` (the BFF folds registrant status into `full_access` instead), so a past
    // registrant resolves as `outsider`; keying on the role would hide the roster from exactly the
    // people it is for. This matches v1, which loads past participants for any authenticated viewer
    // with access, and still withholds it from anonymous viewers, who get no participant list.
    people: ended ? pastRosterVisible : onTheMeeting,
    rsvpAvatarBadges: rsvpRosterVisible,
    rsvpRosterFilter: rsvpRosterVisible,
    rsvpSummary: rsvpSummaryVisible,
    tools: ended && hasArtifactAccess(input.viewerRole, input.fullAccess),
  };
}

/**
 * Past meeting. Organizers keep their tools unconditionally; everyone else sees artifacts only
 * with `PublicPastMeetingResponse.full_access`, and is told so rather than shown an empty page.
 */
function resolveEndedActionSlot(input: ActionSlotInput): ActionSlotKind {
  return hasArtifactAccess(input.viewerRole, input.fullAccess) ? 'tools' : 'no-access';
}

/**
 * Whether a viewer may see a past meeting's agenda, materials, roster and recording.
 *
 * `PublicPastMeetingResponse.full_access` is the general gate, but an organizer is never locked
 * out of their own meeting's artifacts — the flag describes what the meeting exposes to its
 * attendees, not what its owner is allowed to open.
 *
 * Shared by {@link resolveEndedActionSlot} and {@link resolveVisibleSections} on purpose. When
 * they each carried their own rule, an organizer without `fullAccess` resolved to a `tools` rail
 * pointing at sections the same view model had just hidden.
 */
function hasArtifactAccess(viewerRole: MeetingViewerRole, fullAccess: boolean): boolean {
  return viewerRole === 'organizer' || fullAccess;
}

/**
 * Inside the join window.
 *
 * Joining keys on `restricted`, not on `openToPublic`. Reaching a non-open page already required the
 * meeting password (the BFF 400s otherwise), so a loaded page means the viewer holds the link, and
 * an unrestricted meeting lets anyone with the link join. Only registration needs public *and*
 * unrestricted.
 *
 * Every anonymous visitor gets the guest form, whatever the privacy. On a restricted meeting the
 * join-url endpoint matches the submitted email against the registrants, so the server enforces the
 * restriction — and that form is how an invitee without an LFX session joins from their invite
 * link. A signed-in outsider joins an unrestricted meeting directly, as V1 lets them, and is told an
 * invitation is required on a restricted one. (State matrix D-1 to D-3.)
 */
function resolveLiveActionSlot(input: ActionSlotInput): ActionSlotKind {
  if (input.viewerRole === 'organizer' || input.viewerRole === 'registrant') {
    return 'join';
  }

  if (input.viewerRole === 'visitor') {
    return 'guest-join';
  }

  return input.privacy.restricted ? 'invitation-required' : 'join';
}

/**
 * Before the join window opens.
 *
 * A registrant on a meeting without invite responses is the `rsvp-unavailable` case: there is
 * genuinely nothing to collect, and V1's empty rail is why that state is being named.
 * An anonymous visitor gets `register` on an open meeting — the control prompts sign-in, since
 * registration needs a session — and `none` on anything else, because "you need an invitation" is
 * not actionable advice for someone we cannot identify.
 */
function resolveUpcomingActionSlot(input: ActionSlotInput): ActionSlotKind {
  if (input.viewerRole === 'organizer' || input.viewerRole === 'registrant') {
    if (input.inviteResponsesEnabled) {
      return 'rsvp';
    }

    return input.viewerRole === 'registrant' ? 'rsvp-unavailable' : 'none';
  }

  if (input.viewerRole === 'visitor') {
    return input.privacy.openToPublic ? 'register' : 'none';
  }

  if (input.privacy.openToPublic) {
    return 'register';
  }

  // A private but unrestricted meeting: the outsider holds the link and will be able to join when
  // the window opens, and the time banner already says when. They cannot register (the BFF only
  // registers for public meetings), and they need no invitation, so there is nothing to offer yet.
  return input.privacy.restricted ? 'invitation-required' : 'none';
}
