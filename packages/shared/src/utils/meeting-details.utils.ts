// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_EARLY_JOIN_TIME, MEETING_DETAILS_FEATURES } from '../constants';
import { MeetingVisibility } from '../enums';
import type {
  Meeting,
  MeetingDetailsArtifacts,
  MeetingDetailsFeature,
  MeetingDetailsOrganizer,
  MeetingDetailsState,
  MeetingHostCandidate,
  MeetingUserInfo,
} from '../interfaces';
import { getTimezoneAbbreviation } from './date-time.utils';
import { isMeetingAttendeeListShared } from './meeting-attendee-lock.utils';
import {
  buildMeetingOrganizerMailto,
  collectMeetingOrganizers,
  getMeetingOrganizerDisplayName,
  MEETING_END_BUFFER_MS,
  normalizeUsername,
} from './meeting.utils';

const MINUTE_MS = 60_000;

/**
 * Where a date stands for the meeting details drawer: before its join window (`far`), inside it before the start (`soon`),
 * under way until the end-of-meeting buffer runs out (`live`), or over (`ended`). A past meeting is always `ended`.
 */
export function getMeetingDetailsState(
  start: string,
  durationMinutes: number,
  now: Date,
  options: { past?: boolean; earlyJoinMinutes?: number } = {}
): MeetingDetailsState {
  const startMs = Date.parse(start);
  if (options.past || Number.isNaN(startMs)) return options.past ? 'ended' : 'far';
  const nowMs = now.getTime();
  if (nowMs < startMs - (options.earlyJoinMinutes ?? DEFAULT_EARLY_JOIN_TIME) * MINUTE_MS) return 'far';
  if (nowMs < startMs) return 'soon';
  // Live through the post-meeting buffer, as long as the list keeps the date and Join stays open.
  return nowMs <= startMs + durationMinutes * MINUTE_MS + MEETING_END_BUFFER_MS ? 'live' : 'ended';
}

/**
 * Whether the viewer may see the meeting's guests, or its participants once it ended.
 * @description Organizers always can; an invitee only when the guest list is shared, which Board and restricted meetings never
 * are. The same rule `GET /api/meetings/:uid/my-meeting-registrants` applies, and the meeting page uses it for past meetings too.
 */
export function canViewMeetingGuests(
  meeting: Pick<Meeting, 'meeting_type' | 'restricted' | 'show_meeting_attendees'>,
  options: { organizer: boolean; invited: boolean }
): boolean {
  return options.organizer || (options.invited && isMeetingAttendeeListShared(meeting));
}

/**
 * Whether the viewer may see the meeting's agenda and materials: a public meeting that is not restricted, or a viewer
 * who organizes it or is a member of it. The meeting page reads the same rule from the `full_access` flag of its response.
 */
export function hasMeetingFullAccess(meeting: Pick<Meeting, 'visibility' | 'restricted'>, options: { organizer: boolean; member: boolean }): boolean {
  return (meeting.visibility === MeetingVisibility.PUBLIC && !meeting.restricted) || options.organizer || options.member;
}

/**
 * Feature badges in display order. Before the meeting they follow its settings, and AI Summary never shows. Once it has
 * ended, Recording, Transcripts and AI Summary show only when that artifact exists.
 */
export function getMeetingDetailsFeatures(
  meeting: Pick<Meeting, 'recording_enabled' | 'transcript_enabled' | 'youtube_upload_enabled'>,
  artifacts: MeetingDetailsArtifacts | null
): MeetingDetailsFeature[] {
  return MEETING_DETAILS_FEATURES.filter((feature) => {
    switch (feature.setting) {
      case 'recording_enabled':
        return artifacts ? artifacts.recording : meeting.recording_enabled === true;
      case 'transcript_enabled':
        return artifacts ? artifacts.transcript : meeting.transcript_enabled === true;
      case 'ai_summary_enabled':
        return !!artifacts && artifacts.summary;
      default:
        return meeting.youtube_upload_enabled === true;
    }
  });
}

/**
 * "Scheduled in America/New_York (EST)" when the meeting's own zone differs from the viewer's, else null.
 * @description The abbreviation is the meeting zone's at `start`, so it follows daylight saving time.
 */
export function getMeetingScheduledZoneLabel(timeZone: string | null | undefined, start: string, viewerTimeZone: string): string | null {
  const zone = timeZone?.trim();
  if (!zone || zone === viewerTimeZone) return null;
  const abbreviation = getTimezoneAbbreviation(start, zone);
  return abbreviation ? `Scheduled in ${zone} (${abbreviation})` : `Scheduled in ${zone}`;
}

/**
 * "Organized by" people: the owner (else the creator), then the hosts among `hosts` by name, then the other `organizers`
 * entries. The viewer is "You"; everyone else with a valid email gets a pre-filled `mailto:` about the meeting.
 */
export function getMeetingDetailsOrganizers(
  meeting: Pick<Meeting, 'created_by' | 'owner' | 'organizers'>,
  hosts: readonly MeetingHostCandidate[],
  viewerUsername: string | null,
  mailto: { meetingTitle: string; meetingDate: string; detailUrl: string | null }
): MeetingDetailsOrganizer[] {
  const viewer = normalizeUsername(viewerUsername);
  const people: MeetingUserInfo[] = [...collectMeetingOrganizers(meeting, hosts)];
  const seen = new Set(people.flatMap((person) => [normalizeUsername(person.username), normalizeUsername(person.email)]).filter(Boolean));
  for (const entry of meeting.organizers ?? []) {
    const key = normalizeUsername(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Entries are usernames on read but emails on create; an email shows only its local part.
    const isEmail = key.includes('@');
    people.push({ name: '', username: isEmail ? key.split('@')[0] : key, email: isEmail ? key : '' });
  }
  return people.map((person, index) => {
    const name = getMeetingOrganizerDisplayName(person);
    const isViewer = !!viewer && normalizeUsername(person.username) === viewer;
    return {
      key: `${normalizeUsername(person.username) || normalizeUsername(person.email) || name}#${index}`,
      label: isViewer ? 'You' : name,
      name,
      photo: person.profile_picture ?? '',
      mailto: isViewer ? null : buildMeetingOrganizerMailto({ email: person.email, ...mailto }),
    };
  });
}

/**
 * Shareable link to a meeting page, or null when `baseUrl` is not a valid URL.
 * @description Pass the past meeting record id and no passcode for a date that has ended; that page does not take one.
 */
export function getMeetingShareUrl(baseUrl: string, id: string, password?: string | null): string | null {
  let url: URL;
  try {
    url = new URL(`${baseUrl}/meetings/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
  if (password) url.searchParams.set('password', password);
  return url.toString();
}
