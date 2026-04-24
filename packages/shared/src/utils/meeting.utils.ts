// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import { RECURRENCE_DAYS_OF_WEEK, RECURRENCE_NO_END_SENTINEL_DATE, RECURRENCE_WEEKLY_ORDINALS } from '../constants';
import {
  CustomRecurrencePattern,
  Meeting,
  MeetingOccurrence,
  PastMeetingSummary,
  RecurrenceSummary,
  SummaryData,
  User,
  V1PastMeetingSummary,
  V1SummaryDetail,
} from '../interfaces';

/**
 * Whether the recurrence end_date_time matches the "never ends" sentinel.
 * Compares via Date.getTime() so equivalent ISO variants (e.g. '...59Z' vs '...59.000Z')
 * are treated as equal.
 */
export function isRecurrenceNeverEndSentinel(endDateTime: string | null | undefined): boolean {
  if (!endDateTime) return false;
  const end = new Date(endDateTime).getTime();
  const sentinel = new Date(RECURRENCE_NO_END_SENTINEL_DATE).getTime();
  return Number.isFinite(end) && Number.isFinite(sentinel) && end === sentinel;
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

  const fullSummary = [description, endDescription].filter(Boolean).join(', ');

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
  return occurrences.filter((occurrence) => occurrence.status !== 'cancel');
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
  const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;

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
  const earlyJoinMinutes = meeting?.early_join_time_minutes ?? 10;

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

/**
 * Returns the meeting's base guest count, preferring split counts
 * (individual + committee) when either field is enriched, falling back to
 * `registrant_count`. Uses `??` so legitimate `0` values are preserved.
 * Returns `undefined` when neither split counts nor `registrant_count` are present,
 * allowing callers to distinguish "no counts provided" from "counts are truly 0".
 */
export function resolveMeetingBaseCount(
  meeting: Pick<Meeting, 'individual_registrants_count' | 'committee_members_count' | 'registrant_count'>
): number | undefined {
  const hasSplitCounts = meeting.individual_registrants_count != null || meeting.committee_members_count != null;

  if (hasSplitCounts) {
    return (meeting.individual_registrants_count ?? 0) + (meeting.committee_members_count ?? 0);
  }

  return meeting.registrant_count ?? undefined;
}

/**
 * Build v2 summary_data from v1 summary fields
 * @param v1Summary - V1 summary object
 * @returns V2 SummaryData object
 */
function buildV2SummaryDataFromV1(v1Summary: V1PastMeetingSummary & { content?: string; edited_content?: string }): SummaryData {
  // Indexer contract shape: flat content/edited_content fields — use directly.
  // Use property presence ('in') not truthiness to correctly handle empty strings.
  if ('content' in v1Summary || 'edited_content' in v1Summary) {
    return {
      title: v1Summary.summary_title ?? '',
      content: v1Summary.content ?? '',
      edited_content: v1Summary.edited_content ?? '',
      doc_url: '',
      start_time: v1Summary.summary_start_time || '',
      end_time: v1Summary.summary_end_time || '',
    };
  }

  // Legacy V1 shape: build markdown content from structured fields
  const parts: string[] = [];
  const overview = v1Summary.edited_summary_overview || v1Summary.summary_overview;
  const details = v1Summary.edited_summary_details || v1Summary.summary_details;
  const nextSteps = v1Summary.edited_next_steps || v1Summary.next_steps;

  if (overview) {
    parts.push(`## Overview\n${overview}`);
  }

  if (details && details.length > 0) {
    parts.push('## Key Topics');
    details.forEach((detail: V1SummaryDetail) => {
      parts.push(`### ${detail.label}\n${detail.summary}`);
    });
  }

  if (nextSteps && nextSteps.length > 0) {
    parts.push('## Next Steps');
    nextSteps.forEach((step: string) => {
      parts.push(`- ${step}`);
    });
  }

  return {
    title: v1Summary.summary_title || '',
    content: parts.join('\n\n'),
    edited_content: '',
    doc_url: '',
    start_time: v1Summary.summary_start_time || '',
    end_time: v1Summary.summary_end_time || '',
  };
}

/**
 * Transform v1 summary data to v2 format
 * @param summary - V1 summary object from API
 * @returns PastMeetingSummary object normalized to v2 format
 * @description
 * Transforms v1 summary fields to v2 equivalents:
 * - id → uid
 * - summary_overview, summary_details, next_steps → summary_data.content
 * - summary_title → summary_data.title
 * - summary_start_time → summary_data.start_time
 * - summary_end_time → summary_data.end_time
 */
export function transformV1SummaryToV2(summary: PastMeetingSummary): PastMeetingSummary {
  // If already has v2 format (uid and summary_data present), return as-is.
  // Check presence of summary_data, not value of content (which can be an empty string).
  if (summary.uid && summary.summary_data) {
    return summary;
  }

  // Cast to raw shape to access both V1 fields and indexer-contract flat fields
  // (content and edited_content are indexer-flat fields not present in PastMeetingSummary or V1PastMeetingSummary)
  const raw = summary as unknown as V1PastMeetingSummary & { content?: string; edited_content?: string };

  return {
    uid: summary.uid || raw.id || '',
    meeting_id: summary.meeting_id || raw.meeting_id || '',
    past_meeting_id: summary.past_meeting_id || '',
    platform: summary.platform || 'Zoom',
    approved: summary.approved ?? raw.approved ?? false,
    requires_approval: summary.requires_approval ?? raw.requires_approval ?? false,
    email_sent: summary.email_sent ?? raw.email_sent ?? false,
    password: summary.password || raw.password || '',

    summary_data: summary.summary_data ?? buildV2SummaryDataFromV1(raw),

    zoom_config: summary.zoom_config || {
      meeting_id: raw.meeting_id || '',
      meeting_uuid: raw.zoom_meeting_uuid || '',
    },

    created_at: summary.created_at || raw.summary_created_time || '',
    updated_at: summary.updated_at || raw.summary_last_modified_time || raw.modified_at || '',
  };
}
