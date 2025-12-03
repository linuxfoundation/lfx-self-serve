// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import { RECURRENCE_DAYS_OF_WEEK, RECURRENCE_WEEKLY_ORDINALS } from '../constants';
import { CustomRecurrencePattern, Meeting, MeetingOccurrence, RecurrenceSummary, User } from '../interfaces';

/**
 * Get the early join time in minutes from a meeting, handling both v1 and v2 formats
 * @param meeting The meeting object
 * @returns Early join time in minutes (default: 10 minutes)
 * @description
 * V1 meetings use `early_join_time` as a string (e.g., "60")
 * V2 meetings use `early_join_time_minutes` as a number
 */
export function getEarlyJoinTimeMinutes(meeting: Meeting): number {
  // Handle null/undefined meeting
  if (!meeting) {
    return 10;
  }

  // V2 format: early_join_time_minutes as number
  if (meeting.early_join_time_minutes !== undefined && meeting.early_join_time_minutes !== null) {
    return meeting.early_join_time_minutes;
  }

  // TODO(v1-migration): Remove V1 format handling once all meetings are migrated to V2
  // V1 format: early_join_time as string
  if (meeting.early_join_time !== undefined && meeting.early_join_time !== null) {
    const parsed = parseInt(meeting.early_join_time, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  // Default to 10 minutes
  return 10;
}

/**
 * Build a human-readable recurrence summary from custom recurrence pattern
 * @param pattern The custom recurrence pattern
 * @returns RecurrenceSummary with description, endDescription, and fullSummary
 */
export function buildRecurrenceSummary(pattern: CustomRecurrencePattern): RecurrenceSummary {
  if (!pattern) {
    return {
      description: 'Invalid pattern',
      endDescription: '',
      fullSummary: 'Invalid pattern',
    };
  }

  // A meeting with end_times of 1 is essentially a one-time meeting
  if (pattern.end_times === 1) {
    return {
      description: 'One-time meeting',
      endDescription: '',
      fullSummary: 'One-time meeting',
    };
  }

  let description = '';
  let endDescription = '';

  // Build main description
  const interval = pattern.repeat_interval || 1;

  switch (pattern.patternType) {
    case 'daily': {
      description = interval === 1 ? 'Daily' : `Every ${interval} days`;
      break;
    }

    case 'weekly': {
      let selectedDays: string[] = [];

      if (pattern.weeklyDaysArray) {
        selectedDays = pattern.weeklyDaysArray
          .map((dayIndex: number) => RECURRENCE_DAYS_OF_WEEK[dayIndex]?.fullLabel)
          .filter((day: string | undefined) => day !== undefined);
      } else if (pattern.weekly_days) {
        // Parse from comma-separated string and convert from 1-based to 0-based
        const days = pattern.weekly_days.split(',').map((d) => parseInt(d.trim()) - 1);
        selectedDays = days.map((dayIndex: number) => RECURRENCE_DAYS_OF_WEEK[dayIndex]?.fullLabel).filter((day: string | undefined) => day !== undefined);
      }

      if (selectedDays.length === 0) {
        description = 'No days selected';
      } else {
        const weekText = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
        description = `${weekText} on ${selectedDays.join(', ')}`;
      }
      break;
    }

    case 'monthly': {
      const monthText = interval === 1 ? 'Monthly' : `Every ${interval} months`;
      if (pattern.monthlyType === 'dayOfMonth' && pattern.monthly_day) {
        description = `${monthText} on day ${pattern.monthly_day}`;
      } else if (pattern.monthlyType === 'dayOfWeek' && pattern.monthly_week && pattern.monthly_week_day) {
        const ordinal = RECURRENCE_WEEKLY_ORDINALS.find((o) => o.value === pattern.monthly_week)?.label || 'Unknown';
        const dayName = RECURRENCE_DAYS_OF_WEEK[pattern.monthly_week_day - 1]?.fullLabel || 'Unknown';
        description = `${monthText} on the ${ordinal} ${dayName}`;
      }
      break;
    }

    default: {
      description = 'Custom pattern';
      break;
    }
  }

  // Build end description
  switch (pattern.endType) {
    case 'never': {
      endDescription = '';
      break;
    }

    case 'date': {
      if (pattern.end_date_time) {
        const endDate = new Date(pattern.end_date_time);
        endDescription = `until ${endDate.toLocaleDateString()}`;
      }
      break;
    }

    case 'occurrences': {
      if (pattern.end_times) {
        const count = pattern.end_times;
        endDescription = `for ${count} occurrence${count === 1 ? '' : 's'}`;
      }
      break;
    }
  }

  const fullSummary = endDescription ? `${description}, ${endDescription}` : description;

  return {
    description,
    endDescription,
    fullSummary,
  };
}

/**
 * Filter out cancelled occurrences from a list
 * @param occurrences Array of meeting occurrences
 * @returns Array of active (non-cancelled) occurrences
 */
export function getActiveOccurrences(occurrences: MeetingOccurrence[]): MeetingOccurrence[] {
  return occurrences.filter((occurrence) => !occurrence.is_cancelled);
}

/**
 * Get the current joinable occurrence or next upcoming occurrence for a meeting
 * @param meeting The meeting object with occurrences
 * @returns The current/next occurrence or null if none available
 */
export function getCurrentOrNextOccurrence(meeting: Meeting): MeetingOccurrence | null {
  if (!meeting?.occurrences || meeting.occurrences.length === 0) {
    return null;
  }

  const now = new Date();
  const earlyJoinMinutes = getEarlyJoinTimeMinutes(meeting);

  // Filter out cancelled occurrences
  const activeOccurrences = getActiveOccurrences(meeting.occurrences);

  if (activeOccurrences.length === 0) {
    return null;
  }

  // Find the first occurrence that is currently joinable (within the join window)
  const joinableOccurrence = activeOccurrences.find((occurrence) => {
    const startTime = new Date(occurrence.start_time);
    const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);
    const latestJoinTime = new Date(startTime.getTime() + occurrence.duration * 60000 + 40 * 60000); // 40 minutes after end

    return now >= earliestJoinTime && now <= latestJoinTime;
  });

  if (joinableOccurrence) {
    return joinableOccurrence;
  }

  // If no joinable occurrence, find the next future occurrence
  const futureOccurrences = activeOccurrences
    .filter((occurrence) => new Date(occurrence.start_time) > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  return futureOccurrences.length > 0 ? futureOccurrences[0] : null;
}

/**
 * Check if a meeting can be joined based on current time
 * @param meeting The meeting object
 * @param occurrence Optional specific occurrence (for recurring meetings)
 * @returns True if the meeting can be joined, false otherwise
 * @description
 * A meeting can be joined when:
 * - Current time is after (start time - early join time)
 * - Current time is before (start time + duration + 40 minute buffer)
 */
export function canJoinMeeting(meeting: Meeting, occurrence?: MeetingOccurrence | null): boolean {
  const earlyJoinMinutes = getEarlyJoinTimeMinutes(meeting);

  // If we have an occurrence, use its timing
  if (occurrence) {
    const now = new Date();
    const startTime = new Date(occurrence.start_time);
    const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);
    const latestJoinTime = new Date(startTime.getTime() + occurrence.duration * 60000 + 40 * 60000); // 40 minutes after end

    return now >= earliestJoinTime && now <= latestJoinTime;
  }

  // Fallback to original meeting logic if no occurrences
  if (!meeting?.start_time) {
    return false;
  }

  const now = new Date();
  const startTime = new Date(meeting.start_time);
  const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);
  const latestJoinTime = new Date(startTime.getTime() + meeting.duration * 60000 + 40 * 60000); // 40 minutes after end

  return now >= earliestJoinTime && now <= latestJoinTime;
}

/**
 * Check if a meeting has ended (including 40-minute buffer)
 * @param meeting The meeting object
 * @param occurrence Optional occurrence for recurring meetings
 * @returns True if meeting has ended (current time > start time + duration + 40 minutes)
 * @description
 * Determines if a meeting should be filtered from upcoming meetings list.
 * For recurring meetings, checks the specific occurrence.
 * For one-time meetings, checks the meeting start time.
 */
export function hasMeetingEnded(meeting: Meeting, occurrence?: MeetingOccurrence): boolean {
  const now = new Date();
  const buffer = 40 * 60000; // 40 minutes in milliseconds

  // For recurring meetings with occurrence
  if (occurrence) {
    const startTime = new Date(occurrence.start_time);
    const endTime = new Date(startTime.getTime() + occurrence.duration * 60000 + buffer);
    return now > endTime;
  }

  // For one-time meetings
  if (!meeting?.start_time) {
    return false;
  }

  const startTime = new Date(meeting.start_time);
  const endTime = new Date(startTime.getTime() + meeting.duration * 60000 + buffer);
  return now > endTime;
}

/**
 * Options for building join URL with user parameters
 */
export interface BuildJoinUrlOptions {
  /** User's name (takes precedence over user object) */
  name?: string;
  /** User's organization (optional, appended to display name) */
  organization?: string;
}

/**
 * Build join URL with user parameters for meeting join link
 * @param joinUrl - Base join URL from API
 * @param user - Authenticated user (optional if name is provided in options)
 * @param options - Optional parameters for name and organization
 * @returns Join URL with encoded user parameters (uname and un), or original URL if no name available
 * @description
 * Adds user display name and encoded name as query parameters to the join URL.
 * The display name is built from: options.name > user.name > user.email
 * If organization is provided, it's appended as "Name (Organization)"
 */
export function buildJoinUrlWithParams(joinUrl: string, user?: User | null, options?: BuildJoinUrlOptions): string {
  if (!joinUrl) {
    return joinUrl;
  }

  // Determine display name: options.name > user.name > user.email
  const userName = options?.name || user?.name || user?.email;

  if (!userName) {
    return joinUrl;
  }

  // Build display name with optional organization
  const displayName = options?.organization ? `${userName} (${options.organization})` : userName;

  // Create base64 encoded version (handles UTF-8 characters)
  const encodedName = btoa(encodeURIComponent(displayName).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));

  // Build query parameters
  const queryParams = new HttpParams().set('uname', displayName).set('un', encodedName);

  const separator = joinUrl.includes('?') ? '&' : '?';
  return `${joinUrl}${separator}${queryParams.toString()}`;
}
