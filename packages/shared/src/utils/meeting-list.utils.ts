// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_VISIBILITY_INFO, MEETINGS_HOME_FILTER_CHIP_LABELS, MEETINGS_HOME_RSVP_FILTER_OPTIONS, RECURRENCE_DAYS_OF_WEEK } from '../constants';
import { MeetingVisibility, MeetingVisibilityKind } from '../enums';
import type {
  Meeting,
  MeetingDashboardView,
  MeetingDayGroup,
  MeetingFilterChip,
  MeetingHomeRow,
  MeetingOccurrence,
  MeetingResponseFilter,
  MeetingRsvp,
  MeetingsHomeFilters,
  MeetingVisibilityInfo,
} from '../interfaces';
import {
  buildRecurrenceSummary,
  convertRecurrenceToPattern,
  getActiveOccurrences,
  getApplicableMeetingRsvp,
  getUpcomingMeetingStartTime,
  isMeetingInviteResponsesEnabled,
  isMeetingOrganizedByViewer,
  MEETING_END_BUFFER_MS,
  resolveOccurrenceRecurrence,
  resolveShownOccurrenceId,
  resolveUpcomingMeetingDurationMinutes,
} from './meeting.utils';
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
 * meeting the viewer organizes ({@link isMeetingOrganizedByViewer}) and is ignored while the RSVP filter is "Not going".
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
    if (filters.project && meeting.project_uid !== filters.project) return false;
    if (filters.meetingType && meeting.meeting_type !== filters.meetingType) return false;
    if (!matchesRsvpFilter(row, filters.rsvp)) return false;
    if (filters.organizedByMe && !isMeetingOrganizedByViewer(meeting, viewerUsername)) return false;
    return !declinedSeries?.has(meeting.id) || isMeetingOrganizedByViewer(meeting, viewerUsername);
  });
}

/** Number of applied filters, for the Filters button badge. Search does not count. */
export function countAppliedMeetingFilters(filters: MeetingsHomeFilters): number {
  return [!!filters.project, !!filters.meetingType, filters.rsvp !== 'all', filters.organizedByMe, filters.hideDeclined].filter(Boolean).length;
}

/** One chip per applied filter, in popover order; the project chip names the project from `rows`, else its UID. */
export function buildMeetingFilterChips(filters: MeetingsHomeFilters, rows: readonly MeetingHomeRow[]): MeetingFilterChip[] {
  const chips: MeetingFilterChip[] = [];

  if (filters.project) {
    const name = rows.find((row) => row.meeting.project_uid === filters.project)?.meeting.project_name;
    chips.push({ key: 'project', label: `${MEETINGS_HOME_FILTER_CHIP_LABELS.project}: ${name || filters.project}` });
  }
  if (filters.meetingType) {
    chips.push({ key: 'meetingType', label: `${MEETINGS_HOME_FILTER_CHIP_LABELS.meetingType}: ${filters.meetingType}` });
  }
  if (filters.rsvp !== 'all') {
    const option = MEETINGS_HOME_RSVP_FILTER_OPTIONS.find((item) => item.value === filters.rsvp);
    chips.push({ key: 'rsvp', label: `${MEETINGS_HOME_FILTER_CHIP_LABELS.rsvp}: ${option?.label ?? filters.rsvp}` });
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
 * Recurring tooltip copy, e.g. "Repeats weekly on Thursday" or "Repeats every 2 weeks on Wednesday".
 * @description A weekly rule without days falls back to the start's weekday in the meeting's time zone.
 * Returns null for one-time meetings and rules with no describable cadence.
 */
export function getMeetingRecurrenceTooltip(
  meeting: Pick<Meeting, 'recurrence' | 'start_time' | 'timezone'>,
  occurrence?: MeetingOccurrence | null
): string | null {
  const recurrence = resolveOccurrenceRecurrence(meeting, occurrence);
  if (!recurrence || recurrence.end_times === 1) return null;

  const pattern = convertRecurrenceToPattern(recurrence);
  if (pattern.patternType === 'weekly' && !pattern.weeklyDaysArray?.length) {
    pattern.weeklyDaysArray = [getWeekdayIndex(occurrence?.start_time ?? meeting.start_time, meeting.timezone)];
  }

  const { description } = buildRecurrenceSummary(pattern);
  if (!description) return null;
  return `Repeats ${description.charAt(0).toLowerCase()}${description.slice(1)}`;
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

/** Countdown copy: "Meeting starts in N min" under an hour, "Meeting starts in N h" under a day, otherwise null. */
export function getMeetingStartsInLabel(start: string | Date, now: Date = new Date()): string | null {
  const diffMs = new Date(start).getTime() - now.getTime();
  if (!(diffMs > 0) || diffMs >= DAY_MS) return null;

  const minutes = Math.ceil(diffMs / MINUTE_MS);
  if (minutes < 60) return `Meeting starts in ${minutes} min`;
  return `Meeting starts in ${Math.max(1, Math.floor(diffMs / HOUR_MS))} h`;
}

/** Visibility badge for a row: restricted wins over private, otherwise public. */
export function getMeetingVisibilityInfo(meeting: Pick<Meeting, 'visibility' | 'restricted'>): MeetingVisibilityInfo {
  if (meeting.restricted) return MEETING_VISIBILITY_INFO[MeetingVisibilityKind.RESTRICTED];
  if (meeting.visibility === MeetingVisibility.PRIVATE) return MEETING_VISIBILITY_INFO[MeetingVisibilityKind.PRIVATE];
  return MEETING_VISIBILITY_INFO[MeetingVisibilityKind.PUBLIC];
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
