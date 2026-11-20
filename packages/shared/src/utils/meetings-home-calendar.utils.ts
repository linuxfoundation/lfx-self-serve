// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETINGS_HOME_MINI_CALENDAR_MAX_DOTS } from '../constants/meeting-list.constants';
import type { MeetingCalendarEntry, MeetingHomeRow, MeetingMiniCalendarWeek } from '../interfaces';
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

/**
 * Full Sunday-first weeks covering the month of `month`, with each in-month day's meetings.
 * @description Days of the neighbouring months carry no meetings, so they never show dots or take clicks.
 */
export function buildMeetingMiniCalendarWeeks(month: Date, days: ReadonlyMap<string, MeetingCalendarEntry[]>, now: Date): MeetingMiniCalendarWeek[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
  const todayKey = getLocalDayKey(now);
  const weeks: MeetingMiniCalendarWeek[] = [];

  for (let index = 0; index < cells; index++) {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay() + index);
    const key = getLocalDayKey(date);
    const inMonth = date.getMonth() === first.getMonth();
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
  }
  return weeks;
}
