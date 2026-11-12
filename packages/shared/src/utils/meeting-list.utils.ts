// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_MEETING_TYPE_CONFIG,
  MEETING_TYPE_CONFIGS,
  MEETING_VISIBILITY_INFO,
  MEETINGS_HOME_FILTER_CHIP_LABELS,
  MEETINGS_HOME_RSVP_CHOICES,
  MEETINGS_HOME_RSVP_FILTER_OPTIONS,
  RECURRENCE_DAYS_OF_WEEK,
} from '../constants';
import { MeetingType, MeetingVisibility, MeetingVisibilityKind } from '../enums';
import type {
  Meeting,
  MeetingDashboardView,
  MeetingDayGroup,
  MeetingFilterChip,
  MeetingHomeRow,
  MeetingHomeRowLink,
  MeetingHomeRowOrganizer,
  MeetingHomeRowProject,
  MeetingHomeRowType,
  MeetingOccurrence,
  MeetingResponseFilter,
  MeetingRsvp,
  MeetingsHomeFilters,
  MeetingVisibilityInfo,
  PastMeeting,
} from '../interfaces';
import { getEntityCommands } from './entity-route.utils';
import {
  buildMeetingOccurrenceRoute,
  buildRecurrenceSummary,
  collectMeetingOrganizers,
  convertRecurrenceToPattern,
  getActiveOccurrences,
  getApplicableMeetingRsvp,
  getMeetingOrganizerDisplayName,
  getUpcomingMeetingStartTime,
  isMeetingInviteResponsesEnabled,
  isMeetingOrganizedByViewer,
  MEETING_END_BUFFER_MS,
  normalizeUsername,
  resolveOccurrenceRecurrence,
  resolveShownOccurrenceId,
  resolveUpcomingMeetingDurationMinutes,
} from './meeting.utils';
import { getPastMeetingResourceId, getPastMeetingStartTimeMs } from './past-meeting.utils';
import { getRsvpTimestampMs, isSameOccurrenceId, selectApplicableRsvp } from './rsvp-calculator.util';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * True when the viewer still has to answer the meeting's current/next date.
 * @description An empty registration list leaves nothing to answer (the RSVP write cannot resolve a registrant);
 * absent ids mean the lookup was unavailable. An undefined `my_rsvp` means RSVPs were not loaded.
 */
export function isMeetingPendingRsvp(meeting: Meeting): boolean {
  return isRsvpPending(meeting, meeting.my_rsvp === undefined ? undefined : getApplicableMeetingRsvp(meeting));
}

/** {@link isMeetingPendingRsvp} for one date of a meetings home list. */
export function isMeetingHomeRowPendingRsvp(row: MeetingHomeRow): boolean {
  return isRsvpPending(row.meeting, row.myRsvp);
}

/**
 * Expands the viewer's upcoming meetings into one row per date, soonest first.
 * @description A recurring series contributes every active date in its occurrence list that has not ended
 * (end + {@link MEETING_END_BUFFER_MS}); a series whose list holds no date that has not ended falls back to one row
 * for its next start. Each row's RSVP is resolved for that date from `my_rsvps` plus `my_rsvp`, so a confirmed answer
 * overlaid on `my_rsvp` still wins by recency. Without `my_rsvps`, dates `my_rsvp` does not cover are unknown
 * (undefined), except the next date, which `my_rsvp` is resolved for.
 */
export function expandMeetingOccurrences(meetings: readonly Meeting[], now: Date = new Date()): MeetingHomeRow[] {
  const nowMs = now.getTime();
  const rows: MeetingHomeRow[] = [];

  for (const meeting of meetings) {
    const listed = meeting.recurrence ? (meeting.occurrences ?? []).filter((occurrence) => isOccurrenceOpen(meeting, occurrence, nowMs)) : [];
    const active = getActiveOccurrences(listed, meeting.cancelled_occurrences).sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
    // A list whose open dates are all cancelled has nothing left; only a list with no open date falls back.
    const dates = listed.length > 0 ? active : [null];

    dates.forEach((occurrence, index) => {
      const row = buildUpcomingRow(meeting, occurrence, index === 0);
      if (row && Date.parse(row.startTime) + row.durationMinutes * MINUTE_MS + MEETING_END_BUFFER_MS >= nowMs) {
        rows.push(row);
      }
    });
  }

  return rows.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
}

/** One date of an upcoming meeting as a home row, as the list builds it; null when it has no valid start or is cancelled. */
export function toUpcomingMeetingHomeRow(meeting: Meeting, occurrence: MeetingOccurrence | null): MeetingHomeRow | null {
  return buildUpcomingRow(meeting, occurrence, true);
}

/** A past meeting as a home row, or null when it has no valid start. */
export function toPastMeetingHomeRow(meeting: PastMeeting): MeetingHomeRow | null {
  const startMs = getPastMeetingStartTimeMs(meeting);
  if (startMs === null) return null;
  return {
    key: getPastMeetingResourceId(meeting),
    meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: meeting.occurrence_id || null,
    startTime: new Date(startMs).toISOString(),
    durationMinutes: meeting.duration,
  };
}

/**
 * Calendar bucket label for a row's date, relative to `now` in the viewer's local time.
 * @description Upcoming: Today, Tomorrow, This week (through Sunday), This month, then the month name.
 * Past: Today, Yesterday, This week (since Monday), This month, then the month name. A month in
 * another year carries the year ("January 2027").
 */
export function getMeetingDayBucket(start: string | Date, now: Date, view: MeetingDashboardView): string {
  const date = new Date(start);
  const diff = Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / DAY_MS);
  const weekday = (now.getDay() + 6) % 7; // 0 = Monday

  if (view === 'upcoming') {
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff <= 6 - weekday) return 'This week';
  } else {
    if (diff >= 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (-diff <= weekday) return 'This week';
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.getMonth() === now.getMonth() ? 'This month' : date.toLocaleDateString('en-US', { month: 'long' });
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Groups sorted rows under day buckets: only the first `limit` rows (the loaded page) go in, counts cover all rows. */
export function groupMeetingsByDayBucket(
  rows: readonly MeetingHomeRow[],
  view: MeetingDashboardView,
  now: Date = new Date(),
  limit: number = rows.length
): MeetingDayGroup[] {
  const labels = rows.map((row) => getMeetingDayBucket(row.startTime, now, view));
  const totals = new Map<string, number>();
  labels.forEach((label) => totals.set(label, (totals.get(label) ?? 0) + 1));

  const groups = new Map<string, MeetingDayGroup>();
  rows.slice(0, limit).forEach((row, index) => {
    const label = labels[index];
    const group = groups.get(label) ?? { label, count: totals.get(label) ?? 0, rows: [] };
    group.rows.push(row);
    groups.set(label, group);
  });

  return [...groups.values()];
}

/**
 * Applies search and filters to a tab's rows (AND).
 * @description Search is a case-insensitive substring over the title and committee names. Hide declined
 * drops a series when every one of its rows in `rows` is declined, so pass the tab's unfiltered rows. It never hides a
 * meeting the viewer organizes ({@link isMeetingHomeOrganizer}) and is ignored while the RSVP filter is "Not going".
 */
export function filterMeetingsHome(
  rows: readonly MeetingHomeRow[],
  filters: MeetingsHomeFilters,
  search: string,
  viewerUsername: string | null
): MeetingHomeRow[] {
  const query = search.trim().toLowerCase();
  const declinedSeries = filters.hideDeclined && filters.rsvp !== 'declined' ? findDeclinedSeries(rows) : null;

  return rows.filter((row) => {
    const meeting = row.meeting;
    if (query && !matchesMeetingSearch(row, query)) return false;
    if (!matchesEntityFilters(meeting, filters)) return false;
    if (filters.meetingType && meeting.meeting_type?.trim().toLowerCase() !== filters.meetingType.toLowerCase()) return false;
    if (!matchesRsvpFilter(row, filters.rsvp)) return false;
    if (filters.organizedByMe && !isMeetingHomeOrganizer(meeting, viewerUsername)) return false;
    return !declinedSeries?.has(meeting.id) || isMeetingHomeOrganizer(meeting, viewerUsername);
  });
}

/**
 * Whether the viewer organizes the meeting on the home: owner/creator, the `organizer` flag, or listed in `organizers`.
 * @description Wider than the row's Edit/Delete gate (the flag alone), so it must not gate actions.
 */
export function isMeetingHomeOrganizer(meeting: Meeting, viewerUsername: string | null): boolean {
  if (meeting.organizer === true || isMeetingOrganizedByViewer(meeting, viewerUsername)) return true;
  const viewer = normalizeUsername(viewerUsername);
  return !!viewer && (meeting.organizers ?? []).some((entry) => normalizeUsername(entry) === viewer);
}

/** Number of applied filters, for the Filters button badge. Search does not count. */
export function countAppliedMeetingFilters(filters: MeetingsHomeFilters): number {
  return [filters.foundation, filters.project, filters.meetingType, filters.rsvp !== 'all', filters.organizedByMe, filters.hideDeclined].filter(Boolean).length;
}

/**
 * One chip per applied filter, in popover order, keyed like "Project:"; foundation and project chips take the name from `rows`, else the UID.
 * The Foundation/Project chip reads "Foundation:" when its pick is a foundation.
 */
export function buildMeetingFilterChips(filters: MeetingsHomeFilters, rows: readonly MeetingHomeRow[]): MeetingFilterChip[] {
  const chips: MeetingFilterChip[] = [];
  const meetingOf = (uid: string) => rows.find((row) => row.meeting.project_uid === uid)?.meeting;
  const nameOf = (uid: string): string => meetingOf(uid)?.project_name || uid;

  if (filters.foundation) {
    chips.push({ key: 'foundation', prefix: `${MEETINGS_HOME_FILTER_CHIP_LABELS.foundation}:`, label: nameOf(filters.foundation) });
  }
  if (filters.project) {
    const kind = meetingOf(filters.project)?.is_foundation ? 'foundation' : 'project';
    chips.push({ key: 'project', prefix: `${MEETINGS_HOME_FILTER_CHIP_LABELS[kind]}:`, label: nameOf(filters.project) });
  }
  if (filters.meetingType) {
    chips.push({ key: 'meetingType', prefix: `${MEETINGS_HOME_FILTER_CHIP_LABELS.meetingType}:`, label: filters.meetingType });
  }
  if (filters.rsvp !== 'all') {
    const option = MEETINGS_HOME_RSVP_FILTER_OPTIONS.find((item) => item.value === filters.rsvp);
    chips.push({ key: 'rsvp', prefix: `${MEETINGS_HOME_FILTER_CHIP_LABELS.rsvp}:`, label: option?.label ?? filters.rsvp });
  }
  if (filters.organizedByMe) {
    chips.push({ key: 'organizedByMe', label: MEETINGS_HOME_FILTER_CHIP_LABELS.organizedByMe });
  }
  if (filters.hideDeclined) {
    chips.push({ key: 'hideDeclined', label: MEETINGS_HOME_FILTER_CHIP_LABELS.hideDeclined });
  }

  return chips;
}

/**
 * Recurrence label, e.g. "Weekly on Thursday" or "Every 2 weeks on Wednesday".
 * @description A weekly rule without days falls back to the start's weekday in the meeting's time zone.
 * Returns null for one-time meetings and rules with no describable cadence.
 */
export function getMeetingRecurrenceLabel(
  meeting: Pick<Meeting, 'recurrence' | 'start_time' | 'timezone'>,
  occurrence?: MeetingOccurrence | null
): string | null {
  const recurrence = resolveOccurrenceRecurrence(meeting, occurrence);
  if (!recurrence || recurrence.end_times === 1) return null;

  const pattern = convertRecurrenceToPattern(recurrence);
  if (pattern.patternType === 'weekly' && !pattern.weeklyDaysArray?.length) {
    pattern.weeklyDaysArray = [getWeekdayIndex(occurrence?.start_time ?? meeting.start_time, meeting.timezone)];
  }

  return buildRecurrenceSummary(pattern).description || null;
}

/** Recurring tooltip copy, e.g. "Repeats weekly on Thursday" or "Repeats every 2 weeks on Wednesday"; null like the label. */
export function getMeetingRecurrenceTooltip(
  meeting: Pick<Meeting, 'recurrence' | 'start_time' | 'timezone'>,
  occurrence?: MeetingOccurrence | null
): string | null {
  const label = getMeetingRecurrenceLabel(meeting, occurrence);
  return label ? `Repeats ${label.charAt(0).toLowerCase()}${label.slice(1)}` : null;
}

/**
 * Time range in the viewer's zone, e.g. "6:30 – 7:30 AM PDT" or "11:30 AM – 12:30 PM PDT".
 * @description The start drops its AM/PM when it matches the end's; across a DST change each end names its own zone.
 * `timeZone` defaults to the viewer's own.
 */
export function formatMeetingTimeRange(start: string | Date, durationMinutes: number, timeZone?: string): string {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone, timeZoneName: 'short' });
  const partsOf = (date: Date): Record<string, string> =>
    Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value.toUpperCase()]));

  const from = partsOf(startDate);
  const to = partsOf(new Date(startDate.getTime() + durationMinutes * MINUTE_MS));
  const sameZone = from['timeZoneName'] === to['timeZoneName'];
  const fromLabel = sameZone && from['dayPeriod'] === to['dayPeriod'] ? '' : ` ${from['dayPeriod']}${sameZone ? '' : ` ${from['timeZoneName']}`}`;

  return `${from['hour']}:${from['minute']}${fromLabel} – ${to['hour']}:${to['minute']} ${to['dayPeriod']} ${to['timeZoneName']}`;
}

/**
 * Date line of a meeting dialog or popover row in the viewer's zone, e.g. "Thu, Oct 1 · 6:30 – 7:30 AM PDT".
 * @description Without a duration it shows only the start time: "Thu, Oct 1 · 6:30 AM PDT". `timeZone` defaults to the viewer's own.
 */
export function formatMeetingDateTime(start: string | Date, durationMinutes?: number, timeZone?: string): string {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return '';

  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(startDate);
  const time =
    durationMinutes === undefined
      ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(startDate)
      : formatMeetingTimeRange(startDate, durationMinutes, timeZone);
  return `${day} · ${time}`;
}

/** Parts of the meetings home date line: day, start time, minutes; empty for an invalid start. `timeZone` defaults to the viewer's own. */
export function getMeetingWhenParts(start: string | Date, durationMinutes: number, timeZone?: string): string[] {
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return [];

  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(startDate);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(startDate);
  return [day, time, `${durationMinutes} min`];
}

/** Date line of the meetings home, e.g. "Thu, Nov 5 · 9:00 AM · 60 min"; `timeZone` defaults to the viewer's own. */
export function formatMeetingWhen(start: string | Date, durationMinutes: number, timeZone?: string): string {
  return getMeetingWhenParts(start, durationMinutes, timeZone).join(' · ');
}

/** The date line of a row's date plus its recurrence, e.g. "Thu, Nov 5 · 9:00 AM · 60 min · Weekly on Thursday". */
export function formatMeetingWhenFull(row: Pick<MeetingHomeRow, 'meeting' | 'occurrence' | 'startTime' | 'durationMinutes'>): string {
  const when = formatMeetingWhen(row.startTime, row.durationMinutes);
  const recurrence = getMeetingRecurrenceLabel(row.meeting, row.occurrence);
  return when && recurrence ? `${when} · ${recurrence}` : when;
}

/** Countdown copy: "Meeting starts in N min" under an hour, "Meeting starts in N h" under a day, otherwise null. */
export function getMeetingStartsInLabel(start: string | Date, now: Date = new Date()): string | null {
  const diffMs = new Date(start).getTime() - now.getTime();
  if (!(diffMs > 0) || diffMs >= DAY_MS) return null;

  const minutes = Math.ceil(diffMs / MINUTE_MS);
  if (minutes < 60) return `Meeting starts in ${minutes} min`;
  return `Meeting starts in ${Math.max(1, Math.floor(diffMs / HOUR_MS))} h`;
}

/** Visibility badges for a row: Restricted then Private can both show, Public only when neither applies. */
export function getMeetingVisibilityBadges(meeting: Pick<Meeting, 'visibility' | 'restricted'>): MeetingVisibilityInfo[] {
  const badges: MeetingVisibilityInfo[] = [];
  if (meeting.restricted) badges.push(MEETING_VISIBILITY_INFO[MeetingVisibilityKind.RESTRICTED]);
  if (meeting.visibility === MeetingVisibility.PRIVATE) badges.push(MEETING_VISIBILITY_INFO[MeetingVisibilityKind.PRIVATE]);
  return badges.length > 0 ? badges : [MEETING_VISIBILITY_INFO[MeetingVisibilityKind.PUBLIC]];
}

/**
 * Where a meetings home row opens.
 * @description Upcoming dates open the meeting page in a new tab with the password and the date. Past meetings open in place:
 * organizers on the admin details page with `?project=` so the project context follows, everyone else on the meeting page.
 */
export function getMeetingHomeRowLink(row: MeetingHomeRow, view: MeetingDashboardView): MeetingHomeRowLink {
  const { meeting } = row;
  if (view === 'past') {
    const resourceId = getPastMeetingResourceId(meeting);
    if (!meeting.organizer) return { url: toAppUrl(['/meetings', resourceId]), newTab: false };
    const path = getEntityCommands('meetings', resourceId, meeting.is_foundation, 'details') ?? ['/meetings', resourceId, 'details'];
    return { url: toAppUrl(path, meeting.project_slug ? { project: meeting.project_slug } : undefined), newTab: false };
  }

  const route = buildMeetingOccurrenceRoute(meeting.id, row.startTime, row.durationMinutes, { password: meeting.password ?? undefined });
  return { url: toAppUrl(route.path, route.queryParams), newTab: true };
}

/** RSVP toast copy, e.g. "Meeting RSVP set to “Going” for this occurrence"; a one-time meeting names no dates. */
export function getMeetingRsvpToastMessage(rsvp: Pick<MeetingRsvp, 'response_type' | 'scope'>, recurring: boolean): string {
  const label = MEETINGS_HOME_RSVP_CHOICES.find((choice) => choice.response === rsvp.response_type)?.label ?? '';
  const dates = { single: ' for this occurrence', this_and_following: ' for this and following occurrences', all: ' for all occurrences' };
  return `Meeting RSVP set to “${label}”${recurring ? dates[rsvp.scope] : ''}`;
}

/** The meeting's project or foundation overview, or null without a project slug. */
export function getMeetingProjectUrl(meeting: Pick<Meeting, 'project_slug' | 'is_foundation'>): string | null {
  if (!meeting.project_slug) return null;
  return toAppUrl([meeting.is_foundation ? 'foundation' : 'project', 'overview'], { project: meeting.project_slug });
}

/** Project eyebrow of a meetings home row or card, or null when the meeting names no project. */
export function getMeetingHomeRowProject(
  meeting: Pick<Meeting, 'project_name' | 'project_logo_url' | 'project_slug' | 'is_foundation'>
): MeetingHomeRowProject | null {
  const name = meeting.project_name?.trim();
  if (!name) return null;
  return {
    name,
    logo: meeting.project_logo_url ?? '',
    url: getMeetingProjectUrl(meeting),
    label: `${meeting.is_foundation ? 'Jump to foundation' : 'Jump to project'}: ${name}`,
  };
}

/** Meeting type label and icon, or null when the meeting has no type. */
export function getMeetingHomeRowType(meeting: Pick<Meeting, 'meeting_type'>): MeetingHomeRowType | null {
  const type = meeting.meeting_type?.trim();
  if (!type || type === MeetingType.NONE) return null;
  const config = MEETING_TYPE_CONFIGS[type.toLowerCase()];
  return { label: config?.label ?? type, icon: (config ?? DEFAULT_MEETING_TYPE_CONFIG).icon };
}

/** Names of the groups a meeting belongs to, in order, without blanks or repeats. */
export function getMeetingGroupNames(meeting: Pick<Meeting, 'committees'>): string[] {
  const names = (meeting.committees ?? []).map((committee) => committee.name?.trim() ?? '').filter(Boolean);
  return [...new Set(names)];
}

/** "Organized by" avatars: owner or creator first ("You" for the viewer), then the other `organizers` by username. */
export function getMeetingHomeRowOrganizers(
  meeting: Pick<Meeting, 'created_by' | 'owner' | 'organizers'>,
  viewerUsername?: string | null
): MeetingHomeRowOrganizer[] {
  const [primary] = collectMeetingOrganizers(meeting);
  if (!primary) return [];
  const name = getMeetingOrganizerDisplayName(primary);
  const viewer = normalizeUsername(viewerUsername);
  const organizers: MeetingHomeRowOrganizer[] = [
    {
      key: normalizeUsername(primary.username) || normalizeUsername(primary.email) || name,
      label: isMeetingOrganizedByViewer(meeting, viewerUsername) ? 'You' : name,
      name,
      photo: primary.profile_picture ?? '',
    },
  ];
  // Entries are usernames on read but emails on create, so the primary is skipped in either form.
  const seen = new Set([normalizeUsername(primary.username), normalizeUsername(primary.email)]);
  for (const entry of meeting.organizers ?? []) {
    const key = normalizeUsername(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // An email entry shows only its local part, never the full address.
    const username = (entry.trim().split('|').pop() ?? key).split('@')[0];
    organizers.push({ key, label: key === viewer ? 'You' : username, name: username, photo: '' });
  }
  return organizers;
}

function isRsvpPending(meeting: Meeting, rsvp: MeetingRsvp | null | undefined): boolean {
  const registrationIds = meeting.my_registrant_ids;
  return isMeetingInviteResponsesEnabled(meeting) && rsvp === null && (registrationIds === undefined || registrationIds.length > 0);
}

function isOccurrenceOpen(meeting: Meeting, occurrence: MeetingOccurrence, nowMs: number): boolean {
  const startMs = Date.parse(occurrence.start_time);
  return !Number.isNaN(startMs) && startMs + (occurrence.duration || meeting.duration || 0) * MINUTE_MS + MEETING_END_BUFFER_MS >= nowMs;
}

function buildUpcomingRow(meeting: Meeting, occurrence: MeetingOccurrence | null, isNextDate: boolean): MeetingHomeRow | null {
  const startTime = getUpcomingMeetingStartTime(meeting, occurrence);
  if (!startTime || Number.isNaN(Date.parse(startTime))) return null;

  const occurrenceId = meeting.recurrence ? resolveShownOccurrenceId(meeting, occurrence) : null;
  // The fallback start comes from `next_occurrence_start_time`, which can name a cancelled date.
  if (!occurrence && occurrenceId && meeting.cancelled_occurrences?.some((id) => isSameOccurrenceId(id, occurrenceId))) return null;
  return {
    key: occurrenceId ? `${meeting.id}:${occurrenceId}` : meeting.id,
    meeting,
    occurrence,
    title: occurrence?.title || meeting.title,
    occurrenceId,
    startTime,
    durationMinutes: occurrence ? occurrence.duration || meeting.duration : resolveUpcomingMeetingDurationMinutes(meeting),
    myRsvp: resolveRowRsvp(meeting, occurrenceId, isNextDate),
  };
}

function resolveRowRsvp(meeting: Meeting, occurrenceId: string | null, isNextDate: boolean): MeetingRsvp | null | undefined {
  if (meeting.my_rsvps === undefined) {
    if (!meeting.my_rsvp) return meeting.my_rsvp;
    return selectApplicableRsvp(occurrenceId, [meeting.my_rsvp]) ?? (isNextDate ? null : undefined);
  }

  // A confirmed rewrite can keep its row id: keep the newer copy, the overlay on ties.
  const overlay = meeting.my_rsvp;
  const candidates = meeting.my_rsvps.filter((rsvp) => !overlay || rsvp.id !== overlay.id || getRsvpTimestampMs(rsvp) > getRsvpTimestampMs(overlay));
  if (overlay && !candidates.some((rsvp) => rsvp.id === overlay.id)) candidates.push(overlay);
  return selectApplicableRsvp(occurrenceId, candidates);
}

function matchesMeetingSearch(row: MeetingHomeRow, query: string): boolean {
  if (row.title.toLowerCase().includes(query)) return true;
  return (row.meeting.committees ?? []).some((committee) => committee.name?.toLowerCase().includes(query));
}

/** Project wins; a foundation matches its own meetings and its non-foundation child projects'. */
function matchesEntityFilters(meeting: Meeting, filters: MeetingsHomeFilters): boolean {
  if (filters.project) return meeting.project_uid === filters.project;
  if (!filters.foundation) return true;
  return meeting.project_uid === filters.foundation || (meeting.parent_project_uid === filters.foundation && !meeting.is_foundation);
}

function matchesRsvpFilter(row: MeetingHomeRow, filter: MeetingResponseFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'pending') return isMeetingHomeRowPendingRsvp(row);
  return isMeetingInviteResponsesEnabled(row.meeting) && row.myRsvp?.response_type === filter;
}

function findDeclinedSeries(rows: readonly MeetingHomeRow[]): Set<string> {
  const declined = new Map<string, boolean>();
  for (const row of rows) {
    const isDeclined = isMeetingInviteResponsesEnabled(row.meeting) && row.myRsvp?.response_type === 'declined';
    declined.set(row.meeting.id, (declined.get(row.meeting.id) ?? true) && isDeclined);
  }
  return new Set([...declined].filter(([, allDeclined]) => allDeclined).map(([id]) => id));
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getWeekdayIndex(start: string, timeZone: string | null | undefined): number {
  const date = new Date(start);
  try {
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timeZone || undefined }).format(date);
    return RECURRENCE_DAYS_OF_WEEK.findIndex((day) => day.label === label);
  } catch {
    return date.getDay();
  }
}

/** Joins router-style segments (with or without slashes) into one app URL. */
function toAppUrl(segments: readonly string[], queryParams?: Record<string, string>): string {
  const path = segments
    .flatMap((segment) => segment.split('/'))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  const query = new URLSearchParams(queryParams).toString();
  return `/${path}${query ? `?${query}` : ''}`;
}
