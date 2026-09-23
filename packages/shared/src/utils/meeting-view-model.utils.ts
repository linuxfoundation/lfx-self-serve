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
  const rsvpVisible = input.inviteResponsesEnabled && onTheMeeting;

  return {
    agenda: contentVisible,
    joinDetails: !ended && onTheMeeting,
    materials: contentVisible,
    // Deliberately not gated on artifact access: the occurrence strip is navigation, not content,
    // and a viewer locked out of one past occurrence may still open the upcoming ones.
    occurrences: input.recurring,
    // Gated with the rest of the past-meeting content, not only on membership: a registrant who
    // cannot see the agenda or the recording has no business seeing who attended either.
    people: onTheMeeting && contentVisible,
    rsvpAvatarBadges: rsvpVisible,
    rsvpRosterFilter: rsvpVisible,
    rsvpSummary: rsvpVisible,
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
 * Inside the join window. People on the meeting join; an anonymous visitor on a public
 * unrestricted meeting gets the guest form; everyone else gets the same answer they would have got
 * before the meeting started, because joining is not what they are missing.
 */
function resolveLiveActionSlot(input: ActionSlotInput): ActionSlotKind {
  if (input.viewerRole === 'organizer' || input.viewerRole === 'registrant') {
    return 'join';
  }

  if (input.viewerRole === 'visitor') {
    return input.privacy.openToPublic ? 'guest-join' : 'none';
  }

  return input.privacy.openToPublic ? 'register' : 'invitation-required';
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

  return input.privacy.openToPublic ? 'register' : 'invitation-required';
}
