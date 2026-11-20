// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETINGS_HOME_CALENDAR_HOUR_PX, MEETINGS_HOME_CALENDAR_TYPE_COLORS, MEETINGS_HOME_MINI_CALENDAR_MAX_DOTS } from '../constants/meeting-list.constants';
import type {
  MeetingCalendarChip,
  MeetingCalendarDialogDay,
  MeetingCalendarEntry,
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

/** "Sep 27 – Oct 3, 2026", naming the second month only when it differs. */
export function formatMeetingCalendarWeekRange(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const month = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = end.getMonth() === start.getMonth() ? '' : `${month(end)} `;
  return `${month(start)} ${start.getDate()} – ${endMonth}${end.getDate()}, ${end.getFullYear()}`;
}

/** Chip colour of a meeting type; types outside the legend take the last (Other) colour. */
export function getMeetingCalendarTypeColor(type: string | null | undefined): string {
  const colors = MEETINGS_HOME_CALENDAR_TYPE_COLORS;
  return (colors.find((color) => color.type.toLowerCase() === type?.trim().toLowerCase()) ?? colors[colors.length - 1]).color;
}

/** A calendar dialog chip: strong type tints for an upcoming meeting, faded ones for a past meeting. */
export function toMeetingCalendarChip(entry: MeetingCalendarEntry): MeetingCalendarChip {
  const color = getMeetingCalendarTypeColor(entry.row.meeting.meeting_type);
  const mix = (share: number, base: string): string => `color-mix(in srgb, ${color} ${share}%, ${base})`;
  const time = formatMeetingCalendarTime(entry.row.startTime);
  const type = entry.row.meeting.meeting_type?.trim() || 'Other';
  return {
    key: entry.row.key,
    entry,
    time,
    title: entry.row.title,
    background: entry.past ? mix(7, 'var(--ui-white)') : mix(16, 'var(--ui-white)'),
    ink: entry.past ? mix(50, 'var(--ui-white)') : mix(75, 'var(--ui-black)'),
    bar: entry.past ? mix(35, 'var(--ui-white)') : color,
    detail: `${formatMeetingCalendarDay(entry.row.startTime)} · ${time} · ${type}${entry.past ? ' · Past' : ''}`,
  };
}

/** Week view hour gutter label: none at midnight, then "1 AM" to "11 PM". */
export function formatMeetingCalendarHourLabel(hour: number): string {
  if (hour === 0) return '';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/**
 * Places a day's meetings in the week view: top and height from start and duration (30 minutes at least), and greedy lanes
 * so overlapping meetings sit side by side. Meetings that overlap, directly or through others, form a cluster that shares
 * one lane count, so every one of them is as wide as the cluster's narrowest lane.
 */
export function layoutMeetingCalendarWeekDay(entries: readonly MeetingCalendarEntry[]): MeetingCalendarWeekEvent[] {
  const placed = entries
    .map((entry) => {
      const start = new Date(entry.row.startTime);
      return { entry, start: start.getHours() * 60 + start.getMinutes(), duration: Math.max(30, entry.row.durationMinutes || 60), lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start);

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
    laneEnds[lane] = item.start + item.duration;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.start + item.duration);
  }
  closeCluster();

  return placed.map((item) => ({
    ...toMeetingCalendarChip(item.entry),
    top: (item.start / 60) * MEETINGS_HOME_CALENDAR_HOUR_PX,
    height: Math.max(22, (item.duration / 60) * MEETINGS_HOME_CALENDAR_HOUR_PX - 2),
    lane: item.lane,
    lanes: item.lanes,
  }));
}

/** Calendar dialog days for `dates`: month cells keep `chipLimit` chips and count the rest; week columns also place every meeting. */
export function buildMeetingCalendarDialogDays(
  dates: readonly Date[],
  days: ReadonlyMap<string, MeetingCalendarEntry[]>,
  now: Date,
  shownMonth: number | null,
  chipLimit: number
): MeetingCalendarDialogDay[] {
  const todayKey = getLocalDayKey(now);
  return dates.map((date) => {
    const key = getLocalDayKey(date);
    const entries = days.get(key) ?? [];
    return {
      key,
      date,
      label: formatMeetingCalendarDay(date),
      day: date.getDate(),
      inMonth: shownMonth === null || date.getMonth() === shownMonth,
      today: key === todayKey,
      chips: entries.slice(0, chipLimit).map(toMeetingCalendarChip),
      more: Math.max(0, entries.length - chipLimit),
      events: shownMonth === null ? layoutMeetingCalendarWeekDay(entries) : [],
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
