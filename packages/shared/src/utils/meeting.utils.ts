// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import { RECURRENCE_DAYS_OF_WEEK, RECURRENCE_WEEKLY_ORDINALS } from '../constants';
import {
  CustomRecurrencePattern,
  Meeting,
  MeetingCommittee,
  MeetingOccurrence,
  MeetingRecurrence,
  PastMeetingSummary,
  RecurrenceSummary,
  SummaryData,
  User,
  V1Meeting,
  V1MeetingCommittee,
  V1MeetingOccurrence,
  V1MeetingRecurrence,
  V1PastMeetingSummary,
  V1SummaryDetail,
  ZoomConfig,
} from '../interfaces';
import { parseToInt } from './string.utils';

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
 * Transform v1 recurrence object to v2 format (string values to numbers)
 * @param recurrence - V1 recurrence object with string values
 * @returns V2 recurrence object with number values
 */
function transformV1RecurrenceToV2(recurrence: V1MeetingRecurrence | null | undefined): MeetingRecurrence | null {
  if (!recurrence) {
    return null;
  }

  return {
    type: parseToInt(recurrence.type) ?? 2,
    repeat_interval: parseToInt(recurrence.repeat_interval) ?? 1,
    end_times: parseToInt(recurrence.end_times),
    end_date_time: recurrence.end_date_time,
    monthly_day: parseToInt(recurrence.monthly_day),
    monthly_week: parseToInt(recurrence.monthly_week),
    monthly_week_day: parseToInt(recurrence.monthly_week_day),
    weekly_days: recurrence.weekly_days,
  };
}

/**
 * Transform v1 occurrence to v2 format
 * @param occurrence - V1 occurrence object
 * @returns V2 occurrence object
 */
function transformV1OccurrenceToV2(occurrence: V1MeetingOccurrence): MeetingOccurrence {
  return {
    occurrence_id: occurrence.occurrence_id,
    title: occurrence.topic || '',
    description: occurrence.agenda || '',
    start_time: occurrence.start_time,
    duration: parseToInt(occurrence.duration) ?? 0,
    is_cancelled: occurrence.is_cancelled,
  };
}

/**
 * Transform v1 committees to v2 format
 * @param v1Meeting - V1 meeting object with committee/committees fields
 * @returns V2 committees array
 */
function transformV1CommitteesToV2(v1Meeting: V1Meeting): MeetingCommittee[] {
  // If committees array already exists, normalize it
  if (Array.isArray(v1Meeting.committees) && v1Meeting.committees.length > 0) {
    return v1Meeting.committees.map((committee: V1MeetingCommittee) => ({
      uid: committee.uid,
      // V1 uses 'filters', V2 uses 'allowed_voting_statuses'
      allowed_voting_statuses: committee.allowed_voting_statuses || committee.filters,
      name: committee.name,
    }));
  }

  // If single committee field exists, convert to array
  if (v1Meeting.committee && v1Meeting.committee !== 'NONE') {
    return [
      {
        uid: v1Meeting.committee,
        allowed_voting_statuses: v1Meeting.committee_filters || undefined,
      },
    ];
  }

  return [];
}

/**
 * Transform v1 zoom config fields to v2 zoom_config object
 * @param v1Meeting - V1 meeting object
 * @returns V2 zoom_config object or null
 */
function transformV1ZoomConfigToV2(v1Meeting: V1Meeting): ZoomConfig | null {
  // Build from v1 fields
  const hasZoomFields =
    v1Meeting.zoom_ai_enabled !== undefined ||
    v1Meeting.require_ai_summary_approval !== undefined ||
    v1Meeting.passcode !== undefined ||
    v1Meeting.meeting_id !== undefined;

  if (!hasZoomFields) {
    return null;
  }

  return {
    ai_companion_enabled: v1Meeting.zoom_ai_enabled,
    ai_summary_require_approval: v1Meeting.require_ai_summary_approval,
    passcode: v1Meeting.passcode,
    meeting_id: v1Meeting.meeting_id,
  };
}

/**
 * Transform v1 meeting data to v2 format
 * @param meeting - V1 meeting object from API
 * @returns Meeting object normalized to v2 format
 * @description
 * Transforms v1 meeting fields to v2 equivalents:
 * - topic → title
 * - agenda → description
 * - id → uid
 * - project_id → project_uid
 * - duration (string) → duration (number)
 * - early_join_time (string) → early_join_time_minutes (number)
 * - modified_at → updated_at
 * - zoom_ai_enabled → zoom_config.ai_companion_enabled
 * - recurrence fields (string → number)
 * - occurrences fields transformation
 * - committee → committees array
 */
export function transformV1MeetingToV2(meeting: Meeting): Meeting {
  // If not v1, return as-is
  if (meeting.version !== 'v1') {
    return meeting;
  }

  // Cast to V1Meeting for accessing v1-specific fields with type safety
  const v1Meeting = meeting as unknown as V1Meeting;

  // Transform occurrences if present
  const occurrences = Array.isArray(v1Meeting.occurrences) ? v1Meeting.occurrences.map(transformV1OccurrenceToV2) : [];

  // Build transformed meeting
  const transformed: Meeting = {
    // V2 required fields - use v2 field or fall back to v1 equivalent
    uid: meeting.uid || v1Meeting.id || '',
    project_uid: meeting.project_uid || v1Meeting.project_id || '',
    title: meeting.title || v1Meeting.topic || '',
    description: meeting.description || v1Meeting.agenda || '',
    start_time: meeting.start_time,
    duration: parseToInt(v1Meeting.duration) ?? meeting.duration ?? 0,
    timezone: meeting.timezone || v1Meeting.timezone || '',
    created_at: meeting.created_at || v1Meeting.created_at || '',
    updated_at: meeting.updated_at || v1Meeting.modified_at || meeting.created_at || '',

    // Transform early join time
    early_join_time_minutes: parseToInt(v1Meeting.early_join_time) ?? meeting.early_join_time_minutes ?? 10,

    // Transform recurrence
    recurrence: transformV1RecurrenceToV2(v1Meeting.recurrence),

    // Transform occurrences
    occurrences,

    // Transform committees
    committees: transformV1CommitteesToV2(v1Meeting),

    // Transform zoom config
    zoom_config: transformV1ZoomConfigToV2(v1Meeting),

    // Pass through other fields
    platform: meeting.platform,
    meeting_type: meeting.meeting_type || v1Meeting.meeting_type || null,
    visibility: meeting.visibility,
    restricted: meeting.restricted,
    recording_enabled: meeting.recording_enabled,
    transcript_enabled: meeting.transcript_enabled,
    youtube_upload_enabled: meeting.youtube_upload_enabled,
    artifact_visibility: meeting.artifact_visibility,
    organizers: meeting.organizers || [],
    password: meeting.password || v1Meeting.password || null,
    invited: meeting.invited,
    join_url: meeting.join_url || v1Meeting.join_url,
    individual_registrants_count: meeting.individual_registrants_count || 0,
    committee_members_count: meeting.committee_members_count || 0,
    registrants_accepted_count: meeting.registrants_accepted_count || 0,
    registrants_declined_count: meeting.registrants_declined_count || 0,
    registrants_pending_count: meeting.registrants_pending_count || 0,
    participant_count: meeting.participant_count,
    attended_count: meeting.attended_count,
    project_name: meeting.project_name || '',
    project_slug: meeting.project_slug || v1Meeting.project_slug || '',
    organizer: meeting.organizer,

    // Keep version for reference
    version: 'v1',
  };

  return transformed;
}

/**
 * Build v2 summary_data from v1 summary fields
 * @param v1Summary - V1 summary object
 * @returns V2 SummaryData object
 */
function buildV2SummaryDataFromV1(v1Summary: V1PastMeetingSummary): SummaryData {
  // Build markdown content from v1 fields
  const parts: string[] = [];

  // Use edited content if available, otherwise use original
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
  // If already has v2 format (uid and summary_data.content), return as-is
  if (summary.uid && summary.summary_data?.content) {
    return summary;
  }

  // Cast to V1PastMeetingSummary for accessing v1-specific fields with type safety
  const v1Summary = summary as unknown as V1PastMeetingSummary;

  return {
    // V2 fields - use v2 field or fall back to v1 equivalent
    uid: summary.uid || v1Summary.id || '',
    meeting_uid: summary.meeting_uid || v1Summary.meeting_id || '',
    past_meeting_uid: summary.past_meeting_uid || '',
    platform: summary.platform || 'Zoom',
    approved: summary.approved ?? v1Summary.approved ?? false,
    requires_approval: summary.requires_approval ?? v1Summary.requires_approval ?? false,
    email_sent: summary.email_sent ?? v1Summary.email_sent ?? false,
    password: summary.password || v1Summary.password || '',

    // Transform summary_data from v1 fields
    summary_data: buildV2SummaryDataFromV1(v1Summary),

    // Build zoom_config from v1 fields if not present
    zoom_config: summary.zoom_config || {
      meeting_id: v1Summary.meeting_id || '',
      meeting_uuid: v1Summary.zoom_meeting_uuid || '',
    },

    // Timestamps
    created_at: summary.created_at || v1Summary.summary_created_time || '',
    updated_at: summary.updated_at || v1Summary.summary_last_modified_time || v1Summary.modified_at || '',
  };
}
