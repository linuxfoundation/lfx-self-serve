// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import { MEETING_ORGANIZER_SKIP_IDENTIFIERS, RECURRENCE_DAYS_OF_WEEK, RECURRENCE_WEEKLY_ORDINALS } from '../constants';
import {
  CustomRecurrencePattern,
  Meeting,
  MeetingHostCandidate,
  MeetingOccurrence,
  MeetingOrganizerChipModel,
  MeetingOrganizerLink,
  MeetingRecurrence,
  MeetingUserInfo,
  PastMeeting,
  PastMeetingSummary,
  PastMeetingTranscript,
  QueryServiceItem,
  RecurrenceSummary,
  SummaryData,
  TranscriptCue,
  User,
  V1PastMeetingSummary,
  V1SummaryDetail,
} from '../interfaces';

const RECURRENCE_NEVER_ENDS_YEARS_OFFSET = 100;
const FIFTY_YEARS_MS = 50 * 365.25 * 24 * 60 * 60 * 1000;

/**
 * Produces an ISO string ~100 years from `now`, used as the "never ends"
 * placeholder on outgoing recurrence payloads. Stays well below year 2286
 * (where Unix-timestamp strings grow a digit and break lexicographic sorts
 * in the upstream meeting-service — see LFXV2-1855).
 */
export function buildRecurrenceNeverEndDate(now: Date = new Date()): string {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() + RECURRENCE_NEVER_ENDS_YEARS_OFFSET);
  return d.toISOString();
}

/**
 * Whether `endDateTime` is one of our "never ends" placeholders.
 * Returns true for any date ≥ 50 years from now — covers both new records
 * stamped by `buildRecurrenceNeverEndDate` (~100 years out) and legacy
 * records persisted with `2999-12-31` before LFXV2-1855. Real user-selected
 * end dates never reach this far out.
 */
export function isRecurrenceNeverEndSentinel(endDateTime: string | null | undefined): boolean {
  if (!endDateTime) return false;
  const end = new Date(endDateTime).getTime();
  if (!Number.isFinite(end)) return false;
  return end - Date.now() >= FIFTY_YEARS_MS;
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
      // Quarterly is represented upstream as MONTHLY (type=3) with repeat_interval=3
      // (the meeting-service has no distinct QUARTERLY type), so surface that cadence
      // by name rather than the literal "Every 3 months".
      //
      // NOTE (LFXV2-2066/LFXV2-2112): the cadence label is derived from whichever recurrence
      // RULE the caller feeds in. When a meeting's cadence changes from a given occurrence
      // onwards, the meeting's top-level `recurrence` is intentionally left as the original
      // rule and the new cadence (e.g. repeat_interval=3 for quarterly) is carried on the
      // affected occurrence's own `recurrence`. Callers must therefore resolve the
      // occurrence-level override first (see `resolveOccurrenceRecurrence`); a quarterly
      // meeting still showing "Monthly" is a UI lookup bug, not an upstream sync problem.
      let monthText: string;
      if (interval === 1) {
        monthText = 'Monthly';
      } else if (interval === 3) {
        monthText = 'Quarterly';
      } else {
        monthText = `Every ${interval} months`;
      }
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
 * Filter out cancelled occurrences from a list.
 *
 * Cancellation is signalled two different ways depending on the endpoint (LFXV2-2057):
 * the single-meeting endpoint sets `occurrence.status === 'cancel'`, while the meetings
 * LIST endpoint leaves `status` unset and instead lists the cancelled occurrence IDs in
 * `Meeting.cancelled_occurrences`. Pass that array so a cancelled occurrence is dropped
 * consistently regardless of which endpoint produced the data — otherwise the card (list)
 * and detail (single) views select different "next" occurrences for the same meeting.
 *
 * Both arrays key off the canonical `occurrence_id` (the occurrence start as a Unix-second
 * timestamp — a 10-digit value per the upstream meeting-service contract), so we compare IDs
 * directly rather than re-deriving seconds from `start_time`; that also sidesteps the list
 * endpoint returning `start_time` with a timezone offset vs the detail endpoint's UTC form.
 * Note this is distinct from the 13-digit Unix-*millisecond* timestamps the UI constructs via
 * `new Date(start_time).getTime()` elsewhere (past-meeting URLs, `meeting_and_occurrence_id`) —
 * those are never compared against `occurrence_id` / `cancelled_occurrences`.
 *
 * @param occurrences Array of meeting occurrences
 * @param cancelledOccurrences Cancelled occurrence IDs (10-digit Unix-second timestamp keys)
 * @returns Array of active (non-cancelled) occurrences
 */
export function getActiveOccurrences(occurrences: MeetingOccurrence[], cancelledOccurrences?: string[] | null): MeetingOccurrence[] {
  const cancelledIds = new Set(cancelledOccurrences ?? []);
  return occurrences.filter((occurrence) => {
    if (occurrence.status === 'cancel') {
      return false;
    }
    if (cancelledIds.size > 0 && cancelledIds.has(occurrence.occurrence_id)) {
      return false;
    }
    return true;
  });
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

  // Filter out cancelled occurrences (honouring both the per-occurrence status and the
  // list endpoint's cancelled_occurrences IDs — see getActiveOccurrences).
  const activeOccurrences = getActiveOccurrences(meeting.occurrences, meeting.cancelled_occurrences);

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
 * Returns the recurrence that should drive the displayed cadence label for a given occurrence:
 * the occurrence's own recurrence override when present (the cadence changed at/after this
 * occurrence — LFXV2-2112), otherwise the meeting's top-level recurrence.
 *
 * Background: when a recurring meeting's cadence changes from a specific occurrence onwards,
 * Zoom records it as an `all_following` update and the meeting-service's occurrence calculator
 * stamps the new pattern onto that occurrence's `recurrence` (LFXV2-2066). The meeting's
 * top-level `recurrence` is intentionally left as the original rule, so the occurrence-level
 * override — when present — is the source of truth for the cadence label. Centralised here so
 * every surface that renders a recurrence label shares one priority rule.
 *
 * @param meeting The meeting (only its top-level `recurrence` is read)
 * @param occurrence The occurrence being displayed (its `recurrence` override wins when set)
 * @returns The recurrence to feed the label formatter, or null when neither is available
 */
export function resolveOccurrenceRecurrence(meeting: Pick<Meeting, 'recurrence'>, occurrence?: MeetingOccurrence | null): MeetingRecurrence | null {
  return occurrence?.recurrence ?? meeting.recurrence ?? null;
}

/**
 * Resolves the start time a card/list should display for an upcoming meeting — the next
 * scheduled occurrence, not the recurring series origin.
 *
 * Order of preference:
 * 1. `occurrence.start_time` — an already-resolved occurrence (an explicit selection, or the
 *    current/next occurrence from {@link getCurrentOrNextOccurrence} when the `occurrences`
 *    array is present and usable, e.g. on the ITX-backed detail view).
 * 2. `meeting.next_occurrence_start_time` — the upstream-computed next-occurrence start. Present
 *    on both the query-service list payload and the ITX detail payload; empty when no future
 *    occurrence exists. This is what keeps a recurring card from falling back to the series
 *    origin when the list payload's `occurrences` array isn't usable (it carries `is_cancelled`
 *    rather than `status`, and isn't guaranteed to be projected on every list response).
 * 3. `meeting.start_time` — one-time meetings and the final fallback.
 *
 * @param meeting The meeting object
 * @param occurrence Optional already-resolved occurrence (explicit or current/next)
 * @returns The start time to display, or null when none is available
 */
export function getUpcomingMeetingStartTime(meeting: Meeting, occurrence?: MeetingOccurrence | null): string | null {
  if (occurrence?.start_time) {
    return occurrence.start_time;
  }
  if (meeting?.next_occurrence_start_time) {
    return meeting.next_occurrence_start_time;
  }
  return meeting?.start_time ?? null;
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
 * Sorts past meetings most-recent-first (descending by `scheduled_start_time`, falling back to
 * `start_time` when absent).
 *
 * The upstream query-service only supports name/updated sorts — there is no `start_time` sort — so
 * past-meeting date ordering must be applied client-side (see LFXV2-2053). Returns a new array; the
 * input is not mutated.
 */
export function sortPastMeetingsDescending<T extends PastMeeting>(meetings: T[]): T[] {
  return [...meetings].sort((a, b) => {
    const timeA = new Date(a.scheduled_start_time ?? a.start_time).getTime();
    const timeB = new Date(b.scheduled_start_time ?? b.start_time).getTime();
    return timeB - timeA;
  });
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

function summaryRecency(summary: PastMeetingSummary): number {
  // Try updated_at first, but fall back to created_at when it's missing or unparsable
  const updated = summary.updated_at ? Date.parse(summary.updated_at) : NaN;
  if (!Number.isNaN(updated)) {
    return updated;
  }
  const created = summary.created_at ? Date.parse(summary.created_at) : NaN;
  return Number.isNaN(created) ? 0 : created;
}

function summaryHasContent(summary: PastMeetingSummary): boolean {
  const editedContent = summary.summary_data?.edited_content?.trim();
  const content = summary.summary_data?.content?.trim();
  return Boolean(editedContent || content);
}

/** Picks the best summary when multiple v1_past_meeting_summary records share one occurrence (LFXV2-2222). */
export function selectPrimaryPastMeetingSummary(resources: QueryServiceItem<PastMeetingSummary>[] | undefined | null): PastMeetingSummary | null {
  if (!resources || resources.length === 0) {
    return null;
  }

  const transformed = resources.map((resource) => transformV1SummaryToV2(resource.data));
  const withContent = transformed.filter(summaryHasContent);

  // No content-bearing record: preserve input (query-service UID) order — legacy resources[0] behavior.
  if (withContent.length === 0) {
    return transformed[0];
  }

  return withContent.reduce((best, current) => (summaryRecency(current) > summaryRecency(best) ? current : best));
}

/**
 * Resolves the viewable download URL for a past meeting transcript.
 *
 * Only an actual transcript file counts — Zoom's audio transcript (`TRANSCRIPT`)
 * or closed captions (`CC`), matched case-insensitively. The session `share_url`
 * is deliberately NOT used (it points to the recording, so falling back to it
 * makes "View Transcript" open the recording), and a `TIMELINE` file is a speaker
 * timeline, not a transcript, so it's excluded too.
 *
 * @param transcript - The past meeting transcript resource (may be null/undefined).
 * @returns The transcript file's `download_url`, or `null` when no transcript file
 *   exists (which the UI renders as "Transcript Unavailable").
 */
export function getPastMeetingTranscriptUrl(transcript: PastMeetingTranscript | null | undefined): string | null {
  const file = transcript?.recording_files?.find((f) => {
    const type = f.file_type?.toUpperCase();
    return type === 'TRANSCRIPT' || type === 'CC';
  });
  return file?.download_url || null;
}

/**
 * Parses a WebVTT transcript into ordered cues so it can be rendered inline.
 *
 * Each VTT block is `index / start --> end / "Speaker: text"`. The `WEBVTT` header
 * and any NOTE/metadata blocks (no `-->` line) are skipped; the cue timestamp is
 * trimmed to `HH:MM:SS` and a short prefix before the first `": "` is treated as
 * the speaker (otherwise `speaker` is `''`).
 *
 * @param vtt - The raw WebVTT transcript string (may be null/undefined).
 * @returns The parsed {@link TranscriptCue} list in document order, or `[]` for
 *   empty or unparseable input.
 */
export function parseTranscriptVtt(vtt: string | null | undefined): TranscriptCue[] {
  if (!vtt) {
    return [];
  }

  const cues: TranscriptCue[] = [];
  const blocks = vtt.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const tsIndex = lines.findIndex((line) => line.includes('-->'));
    if (tsIndex === -1) {
      continue;
    }

    const timestamp = lines[tsIndex].split('-->')[0].trim().split('.')[0];
    const body = lines
      .slice(tsIndex + 1)
      .join(' ')
      .trim();
    if (!body) {
      continue;
    }

    // Split "Speaker: text" without a regex — a backtracking pattern over the
    // external transcript content is a ReDoS risk (flagged by CodeQL). A short
    // prefix before the first ": " is treated as the speaker.
    const separatorIndex = body.indexOf(': ');
    if (separatorIndex > 0 && separatorIndex <= 60) {
      cues.push({ timestamp, speaker: body.slice(0, separatorIndex).trim(), text: body.slice(separatorIndex + 2).trim() });
    } else {
      cues.push({ timestamp, speaker: '', text: body });
    }
  }

  return cues;
}

/**
 * Derives top-level AI-summary fields from indexed `zoom_config` when the query-service projection omits them.
 * Explicit top-level values win (`??`); returns the input unchanged when `zoom_config` is absent.
 */
export function normalizeIndexedMeetingAiSummary<T extends Pick<Meeting, 'ai_summary_enabled' | 'require_ai_summary_approval' | 'zoom_config'>>(meeting: T): T {
  const zoom = meeting.zoom_config;
  if (!zoom) {
    return meeting;
  }

  return {
    ...meeting,
    ai_summary_enabled: meeting.ai_summary_enabled ?? zoom.ai_companion_enabled,
    require_ai_summary_approval: meeting.require_ai_summary_approval ?? zoom.ai_summary_require_approval,
  };
}

/**
 * Returns true when a `created_by` value is a service account (e.g. `zoom.webhooks`)
 * or carries no identifying information at all — either way it must not be shown as
 * the meeting organizer.
 */
function isServiceOrEmptyCreatedBy(createdBy: MeetingUserInfo): boolean {
  const name = createdBy.name?.trim();
  const username = createdBy.username?.trim().toLowerCase();
  const email = createdBy.email?.trim().toLowerCase();

  if (!name && !username && !email) {
    return true;
  }

  const emailLocalPart = email ? email.split('@')[0] : undefined;
  return MEETING_ORGANIZER_SKIP_IDENTIFIERS.some((skip) => username === skip || email === skip || emailLocalPart === skip || name?.toLowerCase() === skip);
}

/**
 * Resolves the person to display as a meeting's organizer, in priority order:
 *   1. `meeting.created_by` when it's a real human (not a service account, not empty).
 *   2. The first host among the supplied candidates (rare, but authoritative when present).
 *   3. `null` — nothing resolvable, so the caller omits the organizer display entirely.
 *
 * @param meeting - Any object carrying an optional `created_by` (Meeting / PastMeeting).
 * @param hosts - Optional registrant/participant candidates for the host fallback.
 */
export function resolveMeetingOrganizer(
  meeting: Pick<Meeting, 'created_by'> | null | undefined,
  hosts?: ReadonlyArray<MeetingHostCandidate>
): MeetingUserInfo | null {
  const createdBy = meeting?.created_by;
  if (createdBy && !isServiceOrEmptyCreatedBy(createdBy)) {
    return {
      name: createdBy.name,
      username: createdBy.username,
      email: createdBy.email,
      ...(createdBy.profile_picture ? { profile_picture: createdBy.profile_picture } : {}),
    };
  }

  const host = hosts?.find((candidate) => candidate?.host);
  if (host) {
    const name = `${host.first_name ?? ''} ${host.last_name ?? ''}`.trim();
    const username = host.username?.trim() ?? '';
    const email = host.email?.trim() ?? '';
    if (name || username || email) {
      return {
        name,
        username,
        email,
        ...(host.avatar_url ? { profile_picture: host.avatar_url } : {}),
      };
    }
  }

  return null;
}

/**
 * Display label for a resolved organizer: the full name, falling back to username,
 * then email. Returns an empty string only when none are present.
 */
export function getMeetingOrganizerDisplayName(organizer: MeetingUserInfo | null | undefined): string {
  if (!organizer) {
    return '';
  }
  return organizer.name?.trim() || organizer.username?.trim() || organizer.email?.trim() || '';
}

/** Maps a host registrant/participant candidate to the organizer display shape. */
function hostToOrganizer(host: MeetingHostCandidate): MeetingUserInfo {
  const name = `${host.first_name ?? ''} ${host.last_name ?? ''}`.trim();
  return {
    name,
    username: host.username?.trim() ?? '',
    email: host.email?.trim() ?? '',
    ...(host.avatar_url ? { profile_picture: host.avatar_url } : {}),
  };
}

/** Whether two organizers refer to the same person (by username, then email, then name). */
function sameOrganizer(a: MeetingUserInfo, b: MeetingUserInfo): boolean {
  const usernameA = normalizeUsername(a.username);
  const usernameB = normalizeUsername(b.username);
  if (usernameA && usernameB) {
    return usernameA === usernameB;
  }
  const emailA = a.email?.trim().toLowerCase();
  const emailB = b.email?.trim().toLowerCase();
  if (emailA && emailB) {
    return emailA === emailB;
  }
  const nameA = a.name?.trim().toLowerCase();
  const nameB = b.name?.trim().toLowerCase();
  return !!nameA && nameA === nameB;
}

/**
 * Collects every person to attribute a meeting to, from a single unified source so the
 * "Organized by" chip and the participants/registrants modal never disagree:
 *   - When host-flagged candidates are present, they ARE the organizer set (exactly what the
 *     modal badges), sorted by name; the human `created_by` is folded in only if it isn't
 *     already one of the hosts.
 *   - When no hosts are supplied (e.g. summary cards that don't load the registrant list), the
 *     human `created_by` is the sole organizer.
 *   - Otherwise an empty array (nothing to display).
 *
 * Surfaces that show BOTH the chip and the modal must pass the same host list to each.
 */
export function collectMeetingOrganizers(
  meeting: Pick<Meeting, 'created_by'> | null | undefined,
  hosts?: ReadonlyArray<MeetingHostCandidate>
): MeetingUserInfo[] {
  const createdBy = meeting?.created_by;
  const humanCreatedBy = createdBy ? resolveMeetingOrganizer({ created_by: createdBy }) : null;

  const hostOrganizers = (hosts ?? [])
    .filter((candidate) => candidate?.host)
    .map((host) => hostToOrganizer(host))
    .filter((organizer) => organizer.name || organizer.username || organizer.email)
    .sort((a, b) => getMeetingOrganizerDisplayName(a).localeCompare(getMeetingOrganizerDisplayName(b)));

  if (hostOrganizers.length === 0) {
    return humanCreatedBy ? [humanCreatedBy] : [];
  }

  if (humanCreatedBy && !hostOrganizers.some((organizer) => sameOrganizer(organizer, humanCreatedBy))) {
    return [humanCreatedBy, ...hostOrganizers];
  }
  return hostOrganizers;
}

/**
 * Builds a `mailto:` URL that pre-fills an email to a meeting organizer. Returns `null` when the
 * organizer has no email (caller renders the name as plain text). Subject and body are
 * percent-encoded; the address is left as a bare addr-spec.
 *
 * @param params.email - Organizer email (the mailto target).
 * @param params.meetingTitle - Meeting title (subject prefix).
 * @param params.meetingDate - Pre-formatted meeting date (subject suffix).
 * @param params.detailUrl - Meeting details page URL (body).
 */
export function buildMeetingOrganizerMailto(params: {
  email?: string | null;
  meetingTitle?: string | null;
  meetingDate?: string | null;
  detailUrl?: string | null;
}): string | null {
  const email = params.email?.trim();
  if (!email) {
    return null;
  }

  const subject = [params.meetingTitle?.trim(), params.meetingDate?.trim()].filter(Boolean).join(' — ');
  const body = params.detailUrl?.trim() ?? '';

  const query: string[] = [];
  if (subject) {
    query.push(`subject=${encodeURIComponent(subject)}`);
  }
  if (body) {
    query.push(`body=${encodeURIComponent(body)}`);
  }

  return `mailto:${email}${query.length ? `?${query.join('&')}` : ''}`;
}

/**
 * Normalizes a username for viewer-identity comparison — lowercased and stripped of any
 * auth-provider prefix (e.g. `auth0|`), so an OIDC `sub` still matches a plain LFID.
 */
function normalizeUsername(username: string | null | undefined): string {
  return (username ?? '').trim().toLowerCase().split('|').pop() ?? '';
}

/**
 * Builds the "Organized by" chip view model from resolved organizers, the viewer's username, and
 * the meeting context needed to pre-fill a `mailto:` per organizer. Returns `null` when there are
 * no organizers so the caller omits the chip entirely.
 *
 * @param organizers - Resolved organizers (see {@link collectMeetingOrganizers}).
 * @param viewerUsername - The current user's username, for the "you" variant (never linked).
 * @param mailtoContext - Meeting title / formatted date / details URL for the mailto subject+body.
 */
export function buildMeetingOrganizerChip(
  organizers: ReadonlyArray<MeetingUserInfo>,
  viewerUsername?: string | null,
  mailtoContext: { meetingTitle?: string | null; meetingDate?: string | null; detailUrl?: string | null } = {}
): MeetingOrganizerChipModel | null {
  if (!organizers.length) {
    return null;
  }

  const viewer = normalizeUsername(viewerUsername);
  const toLink = (organizer: MeetingUserInfo): MeetingOrganizerLink => {
    const isYou = !!viewer && normalizeUsername(organizer.username) === viewer;
    return {
      name: getMeetingOrganizerDisplayName(organizer),
      isYou,
      // "you" is never a mailto link (emailing yourself makes no sense); others link when they have an email.
      mailto: isYou ? null : buildMeetingOrganizerMailto({ email: organizer.email, ...mailtoContext }),
    };
  };

  return {
    count: organizers.length,
    primary: toLink(organizers[0]),
    overflow: organizers.slice(1).map(toLink),
  };
}

/**
 * Whether a participant/registrant has no meaningful name — empty or a placeholder like
 * "unknown" / "[unknown]". Used to sink such rows to the BOTTOM of people lists (organizers
 * float to top; broken records must not sit directly beneath them).
 */
export function isUnresolvableParticipantName(first?: string | null, last?: string | null): boolean {
  const tokens = [first, last].map((token) => (token ?? '').trim().toLowerCase());
  const meaningful = tokens.filter((token) => token && token !== 'unknown' && token !== '[unknown]');
  return meaningful.length === 0;
}
