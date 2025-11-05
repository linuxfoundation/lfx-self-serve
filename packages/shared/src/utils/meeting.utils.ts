// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import { RECURRENCE_DAYS_OF_WEEK, RECURRENCE_WEEKLY_ORDINALS } from '../constants';
import { CustomRecurrencePattern, Meeting, MeetingOccurrence, RecurrenceSummary, User } from '../interfaces';

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
  const earlyJoinMinutes = meeting.early_join_time_minutes || 10;

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
  // If we have an occurrence, use its timing
  if (occurrence) {
    const now = new Date();
    const startTime = new Date(occurrence.start_time);
    const earlyJoinMinutes = meeting.early_join_time_minutes || 10;
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
  const earlyJoinMinutes = meeting.early_join_time_minutes || 10; // Default to 10 minutes
  const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);
  const latestJoinTime = new Date(startTime.getTime() + meeting.duration * 60000 + 40 * 60000); // 40 minutes after end

  return now >= earliestJoinTime && now <= latestJoinTime;
}

/**
 * Build join URL with user parameters for meeting join link
 * @param joinUrl - Base join URL from API
 * @param user - Authenticated user
 * @returns Join URL with encoded user parameters (uname and un)
 * @description
 * Adds user display name and encoded name as query parameters to the join URL.
 * The display name is either the user's name or email, and is encoded for the meeting platform.
 */
export function buildJoinUrlWithParams(joinUrl: string, user: User): string {
  const displayName = user.name || user.email;
  const encodedName = btoa(unescape(encodeURIComponent(displayName)));

  const queryParams = new HttpParams().set('uname', displayName).set('un', encodedName);

  const separator = joinUrl.includes('?') ? '&' : '?';
  return `${joinUrl}${separator}${queryParams.toString()}`;
}
