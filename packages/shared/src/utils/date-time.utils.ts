// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { fromZonedTime, getTimezoneOffset, toZonedTime } from 'date-fns-tz';

// Direct file imports (not the '../constants' barrel): unlike activity-feed.utils.ts (see its
// comment, and constants/index.spec.ts for the invariant), this isn't just defensive — a live path
// already reaches this file from constants (constants/index.ts -> committees.constants.ts ->
// '../utils/committee.utils' -> './date-time.utils'), so importing the constants barrel here would
// close an actual cycle today. The two underlying constant files sidestep that entirely.
import { DAYS_IN_WEEK, DEFAULT_REPEAT_INTERVAL, MINUTES_IN_HOUR, MS_IN_DAY, TIME_ROUNDING_MINUTES, WEEKDAY_CODES } from '../constants/meeting.constants';
import { TIMEZONES } from '../constants/timezones.constants';
import { RecurrenceType } from '../enums';
import { MeetingRecurrence, TimezoneOption } from '../interfaces';

// ============================================================================
// Date Formatting and Parsing Utilities
// ============================================================================

/**
 * Converts a Date object to ISO date string (YYYY-MM-DD format)
 */
export const formatDateToISOString = (date: Date | null | undefined): string | undefined => {
  if (!date) {
    return undefined;
  }

  return new Date(date).toISOString().split('T')[0];
};

/**
 * Formats a UTC ISO datetime range as a short human-readable label, e.g.
 * "May 17 – May 23, 2026". Pins `timeZone: 'UTC'` so callers in negative
 * offsets don't see the start shift to the prior day — used for windows that
 * are already UTC day boundaries (e.g. the WG Weekly Brief's Sunday–Saturday
 * window), not for user-local display.
 */
export const formatUtcDateRangeLabel = (startIso: string, endIso: string): string => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${startLabel} – ${endLabel}`;
};

/**
 * Converts a Date object or parseable date string to a full ISO 8601 UTC datetime string
 * (e.g. "2019-02-28T11:49:27.000Z").
 * Use this when an API requires a complete datetime string rather than a date-only string.
 */
export const formatDateToUTC = (date: Date | string | null | undefined): string | null => {
  if (!date) return null;
  const parsedDate = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate.toISOString();
};

/**
 * Converts a date string to Date object, handling null/undefined values
 */
export const parseISODateString = (dateString: string | null | undefined): Date | null => {
  if (!dateString) {
    return null;
  }

  return new Date(dateString);
};

/**
 * Parse a date string in YYYY-MM-DD format as a local date (not UTC)
 * This avoids timezone shifting issues when displaying dates from analytics data
 * @param dateString Date string in YYYY-MM-DD format
 * @returns Date object representing the local date
 * @throws Error if the date string is not in the expected format or is invalid
 */
export const parseLocalDateString = (dateString: string): Date => {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Invalid date string format. Expected YYYY-MM-DD, got: ${dateString}`);
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateString}`);
  }

  return date;
};

/**
 * Combines a date and time string into an ISO string in the specified timezone
 * @param date The date object
 * @param time The time string in 12-hour format (e.g., "12:45 AM")
 * @param timezone The IANA timezone identifier (e.g., "America/New_York")
 * @returns ISO string representing the datetime in UTC
 */
export function combineDateTime(date: Date, time: string, timezone?: string): string {
  if (!date || !time) return '';

  // Parse the 12-hour format time (e.g., "12:45 AM" or "1:30 PM")
  const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    console.error('Invalid time format:', time);
    return '';
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  // Convert to 24-hour format
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  // Create a date object with the selected date and time
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Create the datetime in local time first
  const localDateTime = new Date(year, month, day, hours, minutes, 0, 0);

  // If timezone is provided, convert to UTC for that timezone
  // Otherwise, treat as local timezone (backward compatibility)
  if (timezone) {
    try {
      // Convert the local datetime to UTC as if it were in the specified timezone
      const utcDateTime = fromZonedTime(localDateTime, timezone);
      return utcDateTime.toISOString();
    } catch (error) {
      console.error('Invalid timezone:', timezone, error);
      // Fallback to local timezone
      return localDateTime.toISOString();
    }
  }

  // Backward compatibility: return local timezone ISO string
  return localDateTime.toISOString();
}

/**
 * Adds minutes to an ISO date string and returns a new Date.
 * Defaults to 60 minutes when the value is null or undefined.
 */
export const addMinutesToDate = (isoDate: string, minutes: number | null | undefined): Date => {
  const d = new Date(isoDate);
  d.setMinutes(d.getMinutes() + (minutes ?? 60));
  return d;
};

// ============================================================================
// Time Formatting and Default Values
// ============================================================================

/**
 * Gets default start date and time (1 week from now, rounded to next 15 minutes)
 */
export function getDefaultStartDateTime(): { date: Date; time: string } {
  const now = new Date();
  // Add 1 hour to current time
  now.setDate(now.getDate() + 7);

  // Round up to next 15 minutes
  const minutes = now.getMinutes();
  const roundedMinutes = Math.ceil(minutes / TIME_ROUNDING_MINUTES) * TIME_ROUNDING_MINUTES;
  now.setMinutes(roundedMinutes);
  now.setSeconds(0);
  now.setMilliseconds(0);

  // If rounding pushed us to next hour, adjust accordingly
  if (roundedMinutes === MINUTES_IN_HOUR) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  }

  // Format time to 12-hour format (HH:MM AM/PM)
  const timeString = formatTo12Hour(now);

  return {
    date: new Date(now),
    time: timeString,
  };
}

/**
 * Formats a Date object to 12-hour time format
 */
export function formatTo12Hour(date: Date): string {
  const hours = date.getHours();
  const mins = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  let displayHours = hours > 12 ? hours - 12 : hours;
  if (displayHours === 0) {
    displayHours = 12;
  }
  return `${displayHours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${period}`;
}

/**
 * Formats a Date object to 12-hour time format in a specific timezone
 * @param date The date to format (typically a UTC date)
 * @param timezone The IANA timezone identifier (e.g., "America/Chicago")
 * @returns Time string in 12-hour format (e.g., "11:30 AM")
 */
export function formatTo12HourInTimezone(date: Date, timezone: string): string {
  try {
    // Convert the UTC date to the specified timezone
    const zonedDate = toZonedTime(date, timezone);
    return formatTo12Hour(zonedDate);
  } catch (error) {
    console.error('Error formatting time in timezone:', timezone, error);
    // Fallback to local timezone formatting
    return formatTo12Hour(date);
  }
}

/**
 * Formats a Date object to a short month/day format ("Aug 17") in a specific timezone.
 * `toZonedTime` shifts the instant so the JS Date's *local-machine* getters read as the
 * target zone's wall-clock values (same trick `formatTo12HourInTimezone` relies on) — so
 * this reads the shifted date's local month/day rather than reformatting in UTC, which
 * `formatShortDate` does and would reintroduce the timezone mismatch this function exists to fix.
 * @param date The date to format (typically a UTC date)
 * @param timezone The IANA timezone identifier (e.g., "America/Chicago")
 * @returns Date string in short format (e.g., "Aug 17")
 */
export function formatShortDateInTimezone(date: Date, timezone: string): string {
  try {
    const zonedDate = toZonedTime(date, timezone);
    return zonedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (error) {
    console.error('Error formatting date in timezone:', timezone, error);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Parses a 12-hour time string and returns hours and minutes
 */
export function parseTime12Hour(time: string): { hours: number; minutes: number } | null {
  const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) {
    return null;
  }

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  // Convert to 24-hour format
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  return { hours, minutes };
}

// ============================================================================
// Timezone Utilities
// ============================================================================

/**
 * Returns the UTC offset string for a timezone at a given date, reflecting DST.
 * e.g. 'America/Los_Angeles' on a July date → '-07:00'; on a January date → '-08:00'
 */
export function getTimezoneUtcOffsetString(timezone: string, date: Date): string {
  try {
    const offsetMs = getTimezoneOffset(timezone, date);
    if (!Number.isFinite(offsetMs)) return '';
    const sign = offsetMs >= 0 ? '+' : '-';
    const absMs = Math.abs(offsetMs);
    const hours = Math.floor(absMs / 3_600_000);
    const minutes = Math.floor((absMs % 3_600_000) / 60_000);
    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * Helper function to get timezone by value
 */
export function getTimezoneByValue(value: string): TimezoneOption | undefined {
  return TIMEZONES.find((tz) => tz.value === value);
}

/**
 * Helper function to get user's current timezone
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Helper function to format timezone display with current time
 */
export function formatTimezoneWithCurrentTime(timezone: string): string {
  try {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `(${timeString})`;
  } catch {
    return '';
  }
}

/**
 * Compares two datetimes in the context of a specific timezone
 * @param dateTime1 First datetime (ISO string or Date)
 * @param dateTime2 Second datetime (ISO string or Date)
 * @param timezone IANA timezone identifier
 * @returns Comparison result: negative if dateTime1 < dateTime2, positive if dateTime1 > dateTime2, 0 if equal
 */
export function compareDateTimesInTimezone(dateTime1: string | Date, dateTime2: string | Date, timezone: string): number {
  try {
    const date1 = typeof dateTime1 === 'string' ? new Date(dateTime1) : dateTime1;
    const date2 = typeof dateTime2 === 'string' ? new Date(dateTime2) : dateTime2;

    // Convert both dates to the specified timezone for comparison
    const zonedDate1 = toZonedTime(date1, timezone);
    const zonedDate2 = toZonedTime(date2, timezone);

    return zonedDate1.getTime() - zonedDate2.getTime();
  } catch (error) {
    console.error('Error comparing dates in timezone:', timezone, error);
    // Fallback to direct comparison
    const date1 = typeof dateTime1 === 'string' ? new Date(dateTime1) : dateTime1;
    const date2 = typeof dateTime2 === 'string' ? new Date(dateTime2) : dateTime2;
    return date1.getTime() - date2.getTime();
  }
}

/**
 * Gets the current date and time in a specific timezone
 * @param timezone IANA timezone identifier
 * @returns Date object representing current time in the specified timezone
 */
export function getCurrentTimeInTimezone(timezone: string): Date {
  try {
    return toZonedTime(new Date(), timezone);
  } catch (error) {
    console.error('Error getting current time in timezone:', timezone, error);
    return new Date();
  }
}

/**
 * Checks if a datetime is in the future relative to the current time in a specific timezone
 * @param dateTime The datetime to check (ISO string or Date)
 * @param timezone IANA timezone identifier
 * @returns true if the datetime is in the future in the specified timezone
 */
export function isDateTimeInFutureForTimezone(dateTime: string | Date, timezone: string): boolean {
  try {
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    const now = new Date();

    // Convert both to the specified timezone for comparison
    const zonedDateTime = toZonedTime(date, timezone);
    const zonedNow = toZonedTime(now, timezone);

    return zonedDateTime.getTime() > zonedNow.getTime();
  } catch (error) {
    console.error('Error checking future date in timezone:', timezone, error);
    // Fallback to direct comparison
    const date = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
    return date.getTime() > Date.now();
  }
}

// ============================================================================
// Month/Year Conversion Utilities
// ============================================================================

/**
 * Converts month and year dropdown values to an ISO date string (YYYY-MM-01)
 * @param month Two-digit month string ('01' through '12')
 * @param year Four-digit year string (e.g., '2024')
 * @returns ISO date string in format 'YYYY-MM-01'
 */
export function monthYearToIsoDate(month: string, year: string): string {
  return `${year}-${month.padStart(2, '0')}-01`;
}

/**
 * Converts an ISO date string to abbreviated month-year format (e.g., "Mar 2023")
 * @param isoDate ISO date string (e.g., "2023-03-15T00:00:00Z")
 * @returns Formatted string like "Mar 2023"
 */
export function isoDateToMonthYear(isoDate: string): string {
  const date = new Date(isoDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Converts an abbreviated month-year string (e.g., "Mar 2023") to ISO date (YYYY-MM-01)
 * @param monthYear Abbreviated month-year string like "Mar 2023"
 * @returns ISO date string like "2023-03-01", or the original string if parsing fails
 */
export function abbreviatedMonthYearToIsoDate(monthYear: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [monthAbbr, year] = monthYear.split(' ');
  const monthIndex = months.indexOf(monthAbbr);
  if (monthIndex === -1) return monthYear;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

// ============================================================================
// Date Calculation Utilities
// ============================================================================

/**
 * Gets the week of month for a given date
 */
export function getWeekOfMonth(date: Date): { weekOfMonth: number; isLastWeek: boolean } {
  // Find the first occurrence of this day of week in the month
  const targetDayOfWeek = date.getDay();
  let firstOccurrence = 1;
  while (new Date(date.getFullYear(), date.getMonth(), firstOccurrence).getDay() !== targetDayOfWeek) {
    firstOccurrence++;
  }

  // Calculate which week this date is in
  const weekOfMonth = Math.floor((date.getDate() - firstOccurrence) / DAYS_IN_WEEK) + 1;

  // Check if this is the last occurrence of this day in the month
  const nextWeekDate = new Date(date.getTime() + DAYS_IN_WEEK * MS_IN_DAY);
  const isLastWeek = nextWeekDate.getMonth() !== date.getMonth();

  return { weekOfMonth, isLastWeek };
}

// ============================================================================
// Meeting Recurrence Utilities
// ============================================================================

/**
 * Generates a recurrence object based on type and start date
 */
export function generateRecurrenceObject(recurrenceType: string, startDate: Date): MeetingRecurrence | undefined {
  if (recurrenceType === 'none') {
    return undefined;
  }

  const dayOfWeek = startDate.getDay() + 1; // Zoom API uses 1-7 (Sunday=1)
  const { weekOfMonth } = getWeekOfMonth(startDate);

  switch (recurrenceType) {
    case 'daily':
      return {
        type: RecurrenceType.DAILY,
        repeat_interval: DEFAULT_REPEAT_INTERVAL,
      };

    case 'weekly':
      return {
        type: RecurrenceType.WEEKLY,
        repeat_interval: DEFAULT_REPEAT_INTERVAL,
        weekly_days: dayOfWeek.toString(),
      };

    case 'monthly_nth':
      return {
        type: RecurrenceType.MONTHLY,
        repeat_interval: DEFAULT_REPEAT_INTERVAL,
        monthly_week: weekOfMonth,
        monthly_week_day: dayOfWeek,
      };

    case 'monthly_last':
      return {
        type: RecurrenceType.MONTHLY,
        repeat_interval: DEFAULT_REPEAT_INTERVAL,
        monthly_week: -1,
        monthly_week_day: dayOfWeek,
      };

    case 'weekdays':
      return {
        type: RecurrenceType.WEEKLY,
        repeat_interval: DEFAULT_REPEAT_INTERVAL,
        weekly_days: WEEKDAY_CODES, // Monday through Friday
      };

    default:
      return undefined;
  }
}

/**
 * Maps a meeting recurrence object back to form value
 */
export function mapRecurrenceToFormValue(recurrence: MeetingRecurrence | null | undefined): string {
  if (!recurrence) {
    return 'none';
  }

  switch (recurrence.type) {
    case RecurrenceType.DAILY:
      return 'daily';
    case RecurrenceType.WEEKLY:
      return recurrence.weekly_days === WEEKDAY_CODES ? 'weekdays' : 'weekly';
    case RecurrenceType.MONTHLY:
      return recurrence.monthly_week === -1 ? 'monthly_last' : 'monthly_nth';
    default:
      return 'none';
  }
}

/**
 * Formats a duration in seconds into a human-readable string.
 * Examples: 90s → "1m", 3720s → "1h 2m", 30s → "< 1m"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return '< 1m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Short relative-time label suitable for inline status text ("just now",
 * "12s ago", "5 min ago", "2 hr ago", "3 days ago"). Coarser than a full
 * `formatDistanceToNow` — meant for autosave indicators and similar UI.
 */
export function formatRelativeTime(date: Date): string {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    return 'unknown';
  }
  // Derive each unit from diffMs with floor so 59m 31s reads "59 min ago", not "1 hr ago".
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.floor(diffMs / 86_400_000);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

/** Short date label for range previews, e.g. "Apr 18, 2026". */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Short relative-time label for a future instant ("in 5 min", "in 2 hr", "in
 * 3 days") — the forward-looking counterpart to `formatRelativeTime`, which
 * only reads correctly for past instants (negative diffs there collapse to
 * "just now"). Meant for scheduling summaries, not live countdowns.
 */
export function formatFutureRelativeTime(date: Date): string {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) {
    return 'unknown';
  }
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return 'now';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'in less than a minute';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `in ${diffMin} min`;
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffHr < 24) return `in ${diffHr} hr`;
  const diffDay = Math.floor(diffMs / 86_400_000);
  return `in ${diffDay} day${diffDay === 1 ? '' : 's'}`;
}

/**
 * Formats a date-only `YYYY-MM-DD` string as "Jul 14, 2026", or returns the input unchanged when
 * it is not a real date.
 *
 * Parts are parsed explicitly rather than handed to `new Date(iso)`, which would interpret the
 * string as UTC midnight and then render it in local time — a day early for anyone west of
 * Greenwich. The range and round-trip checks matter because `Date.UTC` silently rolls invalid
 * parts over: month 13 becomes January of the next year, and Feb 31 becomes March 3rd. Returning
 * the raw string makes bad warehouse data visible instead of plausible.
 */
export function formatIsoDateLabel(iso: string): string {
  // Shape-checked first: splitting alone accepts trailing junk, so "2026-07-14-extra" would parse
  // to a valid-looking date and pass every check below.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // The year is round-tripped alongside month and day because Date.UTC remaps years 0–99 into the
  // 1900s: 0001-01-01 would otherwise render as "Jan 1, 1901".
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return iso;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Render a HubSpot `updatedAt` for a marketing-email row.
 *
 * Two templates routinely share a name, so without a date two same-name rows are visually
 * identical and an operator cannot tell which one they are cloning.
 *
 * Returns '' rather than a placeholder when the field is absent: `updatedAt` is optional on the
 * interface, and a dash in the metadata line would read as a value the portal reported. HubSpot
 * also sends a date-only form, which `new Date` would parse as UTC midnight and render as the
 * previous day in western timezones — normalising to local midnight avoids the off-by-one.
 */
export function formatHubSpotUpdatedAt(value: string | undefined): string {
  if (!value) return '';

  // A date-only value goes through formatIsoDateLabel, which ROUND-TRIPS year/month/day.
  // Shape-checking alone is not enough: `2026-02-31` matches the pattern, and JS silently
  // rolls the excess day into the next month, so `isNaN` never fires and the picker renders
  // a confident "Mar 3, 2026" for a date that does not exist. An operator uses this value to
  // tell two same-named templates apart, so a fabricated date is worse than none.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const label = formatIsoDateLabel(value);
    // formatIsoDateLabel returns its input unchanged when it rejects; render nothing rather
    // than echoing a raw ISO string into a metadata line that reads as a portal value.
    return label === value ? '' : label;
  }

  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
