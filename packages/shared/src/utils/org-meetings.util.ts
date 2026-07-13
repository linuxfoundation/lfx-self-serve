// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEMO_UPCOMING_MEETING_ID_PREFIX, ORG_MEETING_DETAILS_BASE_URL, ORG_MEETING_TYPE_LABELS } from '../constants';
import type { OrgMeetingBase, OrgMeetingPrivacy, OrgMeetingType, OrgMeetingsPrivacySplit, OrgPrivateMeetingsRollupTypeBadgeVm } from '../interfaces';

/**
 * Deterministic UI-only placeholder for "is the viewer invited to this private meeting".
 * LFXV2-1901 is scoped to UI only — the real invite-membership check lands in a follow-up
 * ticket. Deterministic (hashed off the meeting id) so the same meeting always renders the
 * same way across re-fetches instead of flickering between states.
 */
export function deriveDemoViewerInvited(meetingId: string): boolean {
  let hash = 0;
  for (const char of meetingId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 3 !== 0;
}

/** Deterministic UI-only placeholder for a private meeting's join password (see `deriveDemoViewerInvited`). */
export function deriveDemoPassword(meetingId: string, privacy: OrgMeetingPrivacy): string | null {
  return privacy === 'private' ? `demo-${meetingId}` : null;
}

/**
 * App-relative "See Details" path for an *upcoming* meeting — routes to the existing meeting-join
 * view (`/meetings/:id`), which resolves an `OrgMeeting` id via `getPublicMeeting`. The `/details`
 * route resolves past-meeting ids instead (see `derivePastMeetingDetailsUrl`) and 404s on an
 * upcoming id, so upcoming and past meetings must never share the same details path. The `password`
 * param is omitted for public meetings (see `deriveDemoPassword`). Callers wrap the result in
 * `toAbsoluteUrl` before binding it to `[href]`.
 */
export function deriveUpcomingMeetingDetailsUrl(meetingId: string, password: string | null): string {
  const base = `${ORG_MEETING_DETAILS_BASE_URL}/${meetingId}`;
  return password ? `${base}?password=${encodeURIComponent(password)}` : base;
}

/**
 * App-relative "See Meeting Details" path for a *past* meeting — routes to `PastMeetingDetailsComponent`,
 * which resolves the id via `getPastMeetingById`. Only valid for a real (non-demo-fixture) past-meeting
 * id; see `OrgPastMeetingVm.hasResolvableDetails` for why demo rows must not render this link. The
 * `password` param is omitted for public meetings (see `deriveDemoPassword`).
 */
export function derivePastMeetingDetailsUrl(meetingId: string, password: string | null): string {
  const base = `${ORG_MEETING_DETAILS_BASE_URL}/${meetingId}/details`;
  return password ? `${base}?password=${encodeURIComponent(password)}` : base;
}

/**
 * Whether an upcoming meeting's `deriveUpcomingMeetingDetailsUrl` link is safe to render — false for
 * `DEMO_UPCOMING_MEETINGS` rows (id prefix `um-`), since those ids have no backing meeting record and
 * `MeetingJoinComponent` would redirect to `meetings/not-found`. Real fetched rows can be interleaved
 * with demo-fallback rows in the same list, so this checks the individual id rather than the list source.
 */
export function deriveUpcomingHasResolvableDetails(meetingId: string): boolean {
  return !meetingId.startsWith(DEMO_UPCOMING_MEETING_ID_PREFIX);
}

/**
 * Partitions a meeting list into what the viewer may see as its own card (all public meetings, plus
 * private meetings the viewer is invited to) versus what collapses into a single private-meetings
 * rollup card. Shared by the upcoming/past tabs, which differ only in how each meeting's org-invitee
 * names are read (`orgInvitees` vs `orgPastInvitees`).
 *
 * For the upcoming tab, `meetings` is only the currently-fetched page — the rollup reflects what has
 * loaded so far, not the viewer's org-wide private-meeting count. A real aggregate would need a
 * dedicated backend endpoint, out of scope for this UI-only ticket (see `deriveDemoViewerInvited`).
 */
export function splitOrgMeetingsByPrivacy<T extends OrgMeetingBase>(
  meetings: readonly T[],
  getInviteeNames: (meeting: T) => readonly string[]
): OrgMeetingsPrivacySplit<T> {
  const visible: T[] = [];
  const hidden: T[] = [];

  for (const meeting of meetings) {
    if (meeting.privacy !== 'private' || deriveDemoViewerInvited(meeting.id)) {
      visible.push(meeting);
    } else {
      hidden.push(meeting);
    }
  }

  if (hidden.length === 0) {
    return { visible, rollup: null };
  }

  const typeCounts = new Map<OrgMeetingType, number>();
  const projects = new Set<string>();
  const foundations = new Set<string>();
  const employees = new Set<string>();

  for (const meeting of hidden) {
    typeCounts.set(meeting.type, (typeCounts.get(meeting.type) ?? 0) + 1);
    projects.add(meeting.project);
    foundations.add(meeting.foundation);
    for (const name of getInviteeNames(meeting)) {
      employees.add(name);
    }
  }

  const typeBadges: OrgPrivateMeetingsRollupTypeBadgeVm[] = (Object.keys(ORG_MEETING_TYPE_LABELS) as OrgMeetingType[])
    .filter((type) => typeCounts.has(type))
    .map((type) => ({ type, count: typeCounts.get(type) as number, typeBadge: ORG_MEETING_TYPE_LABELS[type] }));

  return {
    visible,
    rollup: {
      totalCount: hidden.length,
      typeBadges,
      projectCount: projects.size,
      foundationCount: foundations.size,
      employeeCount: employees.size,
    },
  };
}
