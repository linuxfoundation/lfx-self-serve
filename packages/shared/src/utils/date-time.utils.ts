// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import {
  DAYS_IN_WEEK,
  DEFAULT_REPEAT_INTERVAL,
  MINUTES_IN_HOUR,
  MS_IN_DAY,
  TIME_ROUNDING_MINUTES,
  TimezoneOption,
  TIMEZONES,
  WEEKDAY_CODES,
} from '../constants';
import { RecurrenceType } from '../enums';
import { MeetingRecurrence } from '../interfaces';

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
