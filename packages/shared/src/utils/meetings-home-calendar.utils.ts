// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MEETINGS_HOME_CALENDAR_EVENT_MIN_HEIGHT_PX,
  MEETINGS_HOME_CALENDAR_HOUR_PX,
  MEETINGS_HOME_CALENDAR_TYPE_COLORS,
  MEETINGS_HOME_MINI_CALENDAR_MAX_DOTS,
} from '../constants/meeting-list.constants';
import type {
  MeetingCalendarChip,
  MeetingCalendarDialogDay,
  MeetingCalendarEntry,
  MeetingCalendarGridEntry,
  MeetingCalendarWeekEvent,
  MeetingHomeRow,
  MeetingMiniCalendarWeek,
} from '../interfaces';
import { getMeetingSeriesUid } from './meeting.utils';

/** Local calendar day of a date, as `YYYY-MM-DD`. */
export function getLocalDayKey(date: Date | string): string {
  const value = new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/** "Thu, Oct 1" in the viewer's local time. */
export function formatMeetingCalendarDay(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "10:00 AM" in the viewer's local time. */
export function formatMeetingCalendarTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "October 2026". */
export function formatMeetingCalendarMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Upcoming and past rows by local day, each day's soonest first.
 * @description A date just ended can be in both lists (upcoming keeps it for a while after its end), so it is kept once, as past.
 */
export function groupMeetingCalendarEntries(upcoming: readonly MeetingHomeRow[], past: readonly MeetingHomeRow[]): Map<string, MeetingCalendarEntry[]> {
  const dateKey = (row: MeetingHomeRow): string => `${getMeetingSeriesUid(row.meeting)}|${Date.parse(row.startTime)}`;
  const pastKeys = new Set(past.map(dateKey));
  const entries: MeetingCalendarEntry[] = [
    ...upcoming.filter((row) => !pastKeys.has(dateKey(row))).map((row) => ({ row, past: false })),
    ...past.map((row) => ({ row, past: true })),
  ];
  entries.sort((a, b) => Date.parse(a.row.startTime) - Date.parse(b.row.startTime));

  const days = new Map<string, MeetingCalendarEntry[]>();
  for (const entry of entries) {
    const key = getLocalDayKey(entry.row.startTime);
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  return days;
}

/** A home calendar entry as a calendar grid entry. */
export function toMeetingCalendarGridEntry({ row, past }: MeetingCalendarEntry): MeetingCalendarGridEntry {
  return { key: row.key, title: row.title, type: row.meeting.meeting_type ?? null, startTime: row.startTime, durationMinutes: row.durationMinutes, past };
}

/** Calendar grid entries by local day, each day's soonest first. */
export function groupMeetingCalendarGridEntries(entries: readonly MeetingCalendarGridEntry[]): Map<string, MeetingCalendarGridEntry[]> {
  const days = new Map<string, MeetingCalendarGridEntry[]>();
  for (const entry of [...entries].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))) {
    const key = getLocalDayKey(entry.startTime);
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  return days;
}

/** Every date of the full Sunday-first weeks covering the month of `month`. */
export function getMeetingCalendarMonthDates(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
  return Array.from({ length: cells }, (_, index) => new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay() + index));
}

/** Local midnight of the Sunday that starts the week of `date`. */
export function getMeetingCalendarWeekStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
}

/** "Sep 27 – Oct 3, 2026", naming the second month only when it differs, and the first year when the week crosses one. */
export function formatMeetingCalendarWeekRange(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const month = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.getMonth() === start.getMonth() ? '' : `${month(end)} `;
  const startYear = end.getFullYear() === start.getFullYear() ? '' : `, ${start.getFullYear()}`;
  return `${month(start)} ${start.getDate()}${startYear} – ${endMonth}${end.getDate()}, ${end.getFullYear()}`;
}

/** Chip colour of a meeting type; types outside the legend take the last (Other) colour. */
export function getMeetingCalendarTypeColor(type: string | null | undefined): string {
  const colors = MEETINGS_HOME_CALENDAR_TYPE_COLORS;
  return (colors.find((color) => color.type.toLowerCase() === type?.trim().toLowerCase()) ?? colors[colors.length - 1]).color;
}

/** A calendar dialog chip: strong type tints for an upcoming meeting, faded ones for a past meeting. */
export function toMeetingCalendarChip(entry: MeetingCalendarGridEntry): MeetingCalendarChip {
  const color = getMeetingCalendarTypeColor(entry.type);
  const mix = (share: number, base: string): string => `color-mix(in srgb, ${color} ${share}%, ${base})`;
  const time = formatMeetingCalendarTime(entry.startTime);
  const type = entry.type?.trim() || 'Other';
  return {
    key: entry.key,
    entry,
    time,
    title: entry.title,
    background: entry.past ? mix(7, 'var(--ui-white)') : mix(16, 'var(--ui-white)'),
    ink: entry.past ? mix(75, 'var(--ui-white)') : mix(75, 'var(--ui-black)'),
    bar: entry.past ? mix(35, 'var(--ui-white)') : color,
    detail: `${formatMeetingCalendarDay(entry.startTime)} · ${time} · ${type}${entry.past ? ' · Past' : ''}`,
  };
}

/** Week view hour gutter label: none at midnight, then "1 AM" to "11 PM". */
export function formatMeetingCalendarHourLabel(hour: number): string {
  if (hour === 0) return '';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Wall-clock minutes of `instant` from `dayMidnight`, which can be negative or past a day. */
function getWallMinutesFrom(instant: Date, dayMidnight: number): number {
  const midnight = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate()).getTime();
  // Rounded, so a day with a clock change still counts as one.
  return Math.round((midnight - dayMidnight) / 86_400_000) * 1440 + instant.getHours() * 60 + instant.getMinutes();
}

/**
 * Wall-clock start and end minutes of a meeting from the local midnight of `day`; the end is read at the real end instant,
 * so a clock change inside the meeting moves it, and is at least `minimum` minutes after the start.
 */
function getMeetingCalendarDayMinutes(entry: MeetingCalendarGridEntry, day: Date, minimum = 30): { start: number; end: number } {
  const start = new Date(entry.startTime);
  const dayMidnight = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const startMinutes = getWallMinutesFrom(start, dayMidnight);
  const end = new Date(start.getTime() + (entry.durationMinutes || 60) * 60_000);
  return { start: startMinutes, end: Math.max(getWallMinutesFrom(end, dayMidnight), startMinutes + minimum) };
}

/**
 * Places a day's meetings in the week view: top and height from start and duration (30 minutes at least), clipped to the
 * day, and greedy lanes so overlapping meetings sit side by side. Meetings that overlap, directly or through others, form a
 * cluster that shares one lane count, so every one of them is as wide as the cluster's narrowest lane.
 * @param day Day of the column; a meeting running into it from the day before shows from midnight. Defaults to each start's day.
 */
export function layoutMeetingCalendarWeekDay(entries: readonly MeetingCalendarGridEntry[], day?: Date): MeetingCalendarWeekEvent[] {
  const placed = entries
    .map((entry) => {
      const minutes = getMeetingCalendarDayMinutes(entry, day ?? new Date(entry.startTime), 0);
      const start = Math.max(0, minutes.start);
      // The 30-minute floor is for meetings that start this day; a carry-over keeps its real end.
      const end = minutes.start < 0 ? minutes.end : Math.max(minutes.end, start + 30);
      return { entry, start, duration: Math.min(1440, end) - start, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start);

  // Lanes follow the drawn boxes: a short event is drawn taller than it lasts, and must not sit under the next one in its lane.
  const drawnMinutes = ((MEETINGS_HOME_CALENDAR_EVENT_MIN_HEIGHT_PX + 2) / MEETINGS_HOME_CALENDAR_HOUR_PX) * 60;
  const drawnEnd = (item: (typeof placed)[number]): number => item.start + Math.max(item.duration, drawnMinutes);
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const closeCluster = (): void => {
    for (const item of cluster) item.lanes = laneEnds.length;
  };
  for (const item of placed) {
    if (item.start >= clusterEnd) {
      closeCluster();
      cluster = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = drawnEnd(item);
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, drawnEnd(item));
  }
  closeCluster();

  return placed.map((item) => ({
    ...toMeetingCalendarChip(item.entry),
    top: (item.start / 60) * MEETINGS_HOME_CALENDAR_HOUR_PX,
    height: Math.max(MEETINGS_HOME_CALENDAR_EVENT_MIN_HEIGHT_PX, (item.duration / 60) * MEETINGS_HOME_CALENDAR_HOUR_PX - 2),
    lane: item.lane,
    lanes: item.lanes,
  }));
}

/** Calendar dialog days for `dates`: month cells keep `chipLimit` chips and count the rest; week columns also place every meeting. */
export function buildMeetingCalendarDialogDays(
  dates: readonly Date[],
  days: ReadonlyMap<string, MeetingCalendarGridEntry[]>,
  now: Date,
  shownMonth: number | null,
  chipLimit: number
): MeetingCalendarDialogDay[] {
  const todayKey = getLocalDayKey(now);
  return dates.map((date) => {
    const key = getLocalDayKey(date);
    const entries = days.get(key) ?? [];
    const previous = days.get(getLocalDayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))) ?? [];
    // Week columns also show the part after midnight of a meeting that started the day before.
    const running = previous.filter((entry) => getMeetingCalendarDayMinutes(entry, date, 0).end > 0);
    return {
      key,
      date,
      label: formatMeetingCalendarDay(date),
      day: date.getDate(),
      inMonth: shownMonth === null || date.getMonth() === shownMonth,
      today: key === todayKey,
      chips: entries.slice(0, chipLimit).map(toMeetingCalendarChip),
      more: Math.max(0, entries.length - chipLimit),
      events: shownMonth === null ? layoutMeetingCalendarWeekDay([...running, ...entries], date) : [],
    };
  });
}

/**
 * Full Sunday-first weeks covering the month of `month`, with each in-month day's meetings.
 * @description Days of the neighbouring months carry no meetings, so they never show dots or take clicks.
 */
export function buildMeetingMiniCalendarWeeks(month: Date, days: ReadonlyMap<string, MeetingCalendarEntry[]>, now: Date): MeetingMiniCalendarWeek[] {
  const todayKey = getLocalDayKey(now);
  const weeks: MeetingMiniCalendarWeek[] = [];

  getMeetingCalendarMonthDates(month).forEach((date, index) => {
    const key = getLocalDayKey(date);
    const inMonth = date.getMonth() === month.getMonth();
    const entries = inMonth ? (days.get(key) ?? []) : [];
    const beforeToday = key < todayKey;
    const hasUpcoming = entries.some((entry) => !entry.past);
    if (index % 7 === 0) weeks.push({ key, days: [] });
    weeks[weeks.length - 1].days.push({
      key,
      day: date.getDate(),
      inMonth,
      today: key === todayKey,
      entries,
      dots: entries.slice(0, MEETINGS_HOME_MINI_CALENDAR_MAX_DOTS).map((entry) => entry.row.key),
      label: formatMeetingCalendarDay(date),
      tab: !hasUpcoming && (beforeToday || key === todayKey) ? 'past' : 'upcoming',
    });
  });
  return weeks;
}
