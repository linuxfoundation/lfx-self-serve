// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpParams } from '@angular/common/http';

import {
  CANCELLED_COLOR,
  COMMITTEE_TO_MEETING_VOTING_STATUS,
  MEETING_ORGANIZER_SKIP_IDENTIFIERS,
  MEETING_TO_COMMITTEE_VOTING_STATUS,
  MEETING_TYPE_COLORS,
  PAST_MEETING_CALENDAR_COLOR,
  PAST_SURVEY_CALENDAR_COLOR,
  PAST_VOTE_CALENDAR_COLOR,
  RECURRENCE_DAYS_OF_WEEK,
  RECURRENCE_WEEKLY_ORDINALS,
  SURVEY_COLOR,
  VOTE_COLOR,
} from '../constants';
import { lfxColors } from '../constants/colors.constants';
import { CommitteeMemberVotingStatus, RecurrenceType } from '../enums';
import { PollStatus } from '../enums/poll.enum';
import type {
  BuildMeetingOccurrenceRouteOptions,
  CalendarColor,
  CustomRecurrencePattern,
  Meeting,
  MeetingAllowedVotingStatus,
  MeetingCommittee,
  MeetingHostCandidate,
  MeetingOccurrence,
  MeetingOccurrenceRoute,
  MeetingOrganizerChipModel,
  MeetingOrganizerLink,
  MeetingRecurrence,
  MeetingRegistrant,
  MeetingUserInfo,
  OccurrenceNavItem,
  PastMeeting,
  PastMeetingSummary,
  PastMeetingTranscript,
  PublicMeetingOccurrencesResponse,
  QueryServiceItem,
  RecurrenceSummary,
  RegistrantEmailExtraction,
  SummaryData,
  TranscriptCue,
  User,
  V1PastMeetingSummary,
  V1SummaryDetail,
  Vote,
} from '../interfaces';
import { normalizePollStatus } from './poll.utils';

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
 * Pulls invite-ready emails off a meeting's registrant list (LFXV2-2607).
 * Trims each email, drops blanks (counting them as skipped so the UI can report
 * "N registrants had no email"), and de-duplicates case-insensitively while
 * preserving the first-seen casing. The caller feeds `emails` into the existing
 * invite dedupe/fan-out, so this deliberately does no member/invite matching.
 */
export function extractRegistrantEmails(registrants: MeetingRegistrant[] | null | undefined): RegistrantEmailExtraction {
  const emails: string[] = [];
  const seen = new Set<string>();
  let skippedNoEmail = 0;

  for (const registrant of registrants ?? []) {
    const email = (registrant?.email ?? '').trim();
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    emails.push(email);
  }

  return { emails, skippedNoEmail };
}

/** Filters `emails` down to those not already present (case-insensitively) in `alreadyListed`. */
export function filterUnlistedEmails(emails: string[], alreadyListed: string[]): string[] {
  const listed = new Set(alreadyListed.map((email) => email.toLowerCase()));
  return emails.filter((email) => !listed.has(email.toLowerCase()));
}

/** Compose the import result line: how many were added, already listed, and skipped for no email. */
export function buildImportSummary(meetingTitle: string, added: number, alreadyListed: number, skippedNoEmail: number): string {
  const parts: string[] = [added === 1 ? `Added 1 address from "${meetingTitle}"` : `Added ${added} addresses from "${meetingTitle}"`];
  if (alreadyListed > 0) {
    parts.push(`${alreadyListed} already listed`);
  }
  if (skippedNoEmail > 0) {
    parts.push(skippedNoEmail === 1 ? '1 registrant had no email and was skipped' : `${skippedNoEmail} registrants had no email and were skipped`);
  }
  return `${parts.join(' — ')}.`;
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
        endDescription = `until ${endDate.toLocaleDateString('en-US')}`;
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
 * Convert a raw API `MeetingRecurrence` (numeric `type`, 1-based `weekly_days` string) into the
 * `CustomRecurrencePattern` shape `buildRecurrenceSummary` expects, for read-only display contexts
 * (as opposed to the create/edit form, which builds `CustomRecurrencePattern` from form state directly).
 */
export function convertRecurrenceToPattern(recurrence: MeetingRecurrence): CustomRecurrencePattern {
  const type = recurrence.type ?? RecurrenceType.WEEKLY;
  const monthlyDay = recurrence.monthly_day;
  const monthlyWeek = recurrence.monthly_week;
  const monthlyWeekDay = recurrence.monthly_week_day;
  const endTimes = recurrence.end_times;
  const repeatInterval = recurrence.repeat_interval ?? 1;

  let patternType: 'daily' | 'weekly' | 'monthly' = 'weekly';
  if (type === RecurrenceType.DAILY) patternType = 'daily';
  else if (type === RecurrenceType.WEEKLY) patternType = 'weekly';
  else if (type === RecurrenceType.MONTHLY) patternType = 'monthly';

  let monthlyType: 'dayOfMonth' | 'dayOfWeek' = 'dayOfMonth';
  if (monthlyDay !== undefined) monthlyType = 'dayOfMonth';
  else if (monthlyWeek !== undefined && monthlyWeekDay !== undefined) monthlyType = 'dayOfWeek';

  let endType: 'never' | 'date' | 'occurrences' = 'never';
  if (recurrence.end_date_time && !isRecurrenceNeverEndSentinel(recurrence.end_date_time)) endType = 'date';
  else if ((endTimes ?? 0) > 0) endType = 'occurrences';

  let weeklyDaysArray: number[] = [];
  if (recurrence.weekly_days) {
    weeklyDaysArray = recurrence.weekly_days.split(',').map((d) => parseInt(d.trim()) - 1);
  }

  return {
    ...recurrence,
    type,
    monthly_day: monthlyDay,
    monthly_week: monthlyWeek,
    monthly_week_day: monthlyWeekDay,
    end_times: endTimes,
    repeat_interval: repeatInterval,
    patternType,
    monthlyType,
    endType,
    weeklyDaysArray,
  };
}

/**
 * Picks the meeting that represents a committee's "meeting cadence" from its upcoming meetings:
 * the first meeting with a truthy `recurrence` (an actually-recurring series), falling back to
 * the first upcoming meeting of any kind (e.g. a genuine one-off), and to `null` when empty.
 */
export function selectCommitteeCadenceMeeting(meetings: Meeting[]): Meeting | null {
  if (meetings.length === 0) return null;
  return meetings.find((m) => !!m.recurrence) ?? meetings[0];
}

/**
 * Builds the About-tab "Meeting Cadence" display string, e.g. "Every 2 weeks on Thursday · 60 min · Zoom".
 */
export function buildCommitteeCadenceSummary(meetings: Meeting[]): string {
  const meeting = selectCommitteeCadenceMeeting(meetings);
  if (!meeting) {
    return 'No recurring meetings scheduled';
  }
  const recurrenceLabel = meeting.recurrence ? buildRecurrenceSummary(convertRecurrenceToPattern(meeting.recurrence)).fullSummary : 'One-time meeting';
  const durationLabel = meeting.duration ? `${meeting.duration} min` : null;
  return [recurrenceLabel, durationLabel, meeting.platform].filter(Boolean).join(' · ');
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
export function isMeetingOccurrenceCancelled(occurrence: MeetingOccurrence, cancelledOccurrences?: string[] | null): boolean {
  if (occurrence.status === 'cancel') {
    return true;
  }
  const cancelledIds = cancelledOccurrences ?? [];
  return cancelledIds.length > 0 && cancelledIds.includes(occurrence.occurrence_id);
}

export function getActiveOccurrences(occurrences: MeetingOccurrence[], cancelledOccurrences?: string[] | null): MeetingOccurrence[] {
  return occurrences.filter((occurrence) => !isMeetingOccurrenceCancelled(occurrence, cancelledOccurrences));
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
 * Resolves the series UID for a meeting payload without casting: past-meeting
 * payloads carry the originating series UID in `meeting_id` while their `id` is
 * the composite occurrence id (`{uid}-{ms-timestamp}`); live payloads use `id`.
 */
export function getMeetingSeriesUid(meeting: Meeting): string {
  if ('meeting_id' in meeting && typeof meeting.meeting_id === 'string' && meeting.meeting_id) {
    return meeting.meeting_id;
  }
  return meeting.id;
}

/**
 * Merges a meeting's live occurrences with the series timeline from the public
 * occurrences endpoint into one ascending navigation list.
 *
 * Entries are deduped by their Unix-millisecond start instant with priority
 * live > endpoint future > past record, so an in-progress occurrence whose
 * v1_past_meeting record is already forming keeps its joinable live entry.
 * `cancelled_occurrences` filtering applies to future entries only — a cancelled
 * occurrence never runs, so no v1_past_meeting record exists to filter.
 * Past entries derive their canonical instant from the composite
 * `meeting_and_occurrence_id` suffix (authoritative for past-meeting URLs),
 * not from `scheduled_start_time`.
 *
 * @param liveOccurrences Active (non-cancelled) occurrences from the live meeting payload
 * @param series Timeline from the public occurrences endpoint
 * @param fallbackDuration Duration (minutes) for past entries lacking an end time
 * @returns Merged occurrence list sorted ascending by start instant
 */
export function buildOccurrenceNavTimeline(
  liveOccurrences: MeetingOccurrence[],
  series: PublicMeetingOccurrencesResponse,
  fallbackDuration?: number
): OccurrenceNavItem[] {
  const byInstant = new Map<number, OccurrenceNavItem>();

  const addIfAbsent = (instant: number, item: OccurrenceNavItem): void => {
    if (!Number.isFinite(instant) || byInstant.has(instant)) {
      return;
    }
    byInstant.set(instant, item);
  };

  for (const occurrence of liveOccurrences) {
    addIfAbsent(new Date(occurrence.start_time).getTime(), occurrence);
  }

  for (const occurrence of getActiveOccurrences(series.future, series.cancelled_occurrences)) {
    addIfAbsent(new Date(occurrence.start_time).getTime(), occurrence);
  }

  for (const past of series.past) {
    const suffix = past.meeting_and_occurrence_id.split('-').pop() ?? '';
    const instant = /^\d{13}$/.test(suffix) ? parseInt(suffix, 10) : NaN;
    if (!Number.isFinite(instant)) {
      continue;
    }
    const scheduledDuration =
      past.scheduled_end_time && past.scheduled_start_time
        ? Math.round((new Date(past.scheduled_end_time).getTime() - new Date(past.scheduled_start_time).getTime()) / 60000)
        : 0;
    addIfAbsent(instant, {
      meeting_and_occurrence_id: past.meeting_and_occurrence_id,
      occurrence_id: String(Math.floor(instant / 1000)),
      start_time: new Date(instant).toISOString(),
      duration: scheduledDuration > 0 ? scheduledDuration : (fallbackDuration ?? 0),
    });
  }

  return [...byInstant.values()].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
}

/**
 * Occurrence id to pass to RSVP BFF endpoints (`getMeetingRegistrants`,
 * `getMyMeetingRegistrants`, `getMeetingRsvpForCurrentUser`).
 *
 * Non-recurring meetings return `undefined` (newest / aggregate RSVP semantics).
 * Recurring meetings prefer an explicit occurrence or id; when neither is supplied,
 * fall back to {@link getCurrentOrNextOccurrence} so list/card surfaces that only
 * hold the meeting payload still resolve against the current/next slot.
 */
export function resolveRsvpOccurrenceId(
  meeting: Meeting,
  options?: { occurrence?: MeetingOccurrence | null; occurrenceId?: string | null }
): string | undefined {
  if (!meeting.recurrence) return undefined;
  const explicitId = options?.occurrenceId || options?.occurrence?.occurrence_id;
  if (explicitId) return explicitId;
  return getCurrentOrNextOccurrence(meeting)?.occurrence_id;
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

/** Post-meeting buffer before an occurrence is treated as past (matches {@link hasMeetingEnded}). */
export const MEETING_END_BUFFER_MS = 40 * 60_000;

/**
 * Returns true when an occurrence's end time plus buffer has passed.
 * Used for calendar click routing without relying on a partial Meeting cast.
 */
export function isOccurrencePast(startTime: string, durationMinutes: number, now = new Date()): boolean {
  const endTime = new Date(new Date(startTime).getTime() + durationMinutes * 60_000 + MEETING_END_BUFFER_MS);
  return now.getTime() > endTime.getTime();
}

/**
 * Resolves FullCalendar hex colors for a meeting occurrence.
 * Active meetings use the default blue; past use a lighter blue; cancelled use cancelled grey.
 */
export function resolveMeetingCalendarColors(isCancelled: boolean, isPast = false): CalendarColor {
  if (isCancelled) {
    return CANCELLED_COLOR;
  }
  if (isPast) {
    return PAST_MEETING_CALENDAR_COLOR;
  }
  return { ...MEETING_TYPE_COLORS['default'], text: lfxColors.white };
}

/** Returns true when a calendar deadline timestamp is invalid or already passed. */
export function isCalendarDeadlinePast(deadlineIso: string | null | undefined, now = new Date()): boolean {
  if (!deadlineIso) {
    return false;
  }
  const ms = new Date(deadlineIso).getTime();
  if (Number.isNaN(ms)) {
    return true;
  }
  return now.getTime() >= ms;
}

/** Resolves FullCalendar hex colors for a vote deadline event. */
export function resolveVoteCalendarColors(isPast = false): CalendarColor {
  return isPast ? PAST_VOTE_CALENDAR_COLOR : VOTE_COLOR;
}

/** Resolves FullCalendar hex colors for a survey cutoff event. */
export function resolveSurveyCalendarColors(isPast = false): CalendarColor {
  return isPast ? PAST_SURVEY_CALENDAR_COLOR : SURVEY_COLOR;
}

/** Returns true when a vote deadline event should render with past calendar styling. */
export function isVoteCalendarEventPast(vote: Pick<Vote, 'end_time' | 'status' | 'early_end_time'>, now = new Date()): boolean {
  if (normalizePollStatus(vote.status) === PollStatus.ENDED) {
    return true;
  }
  return isCalendarDeadlinePast(vote.early_end_time ?? vote.end_time, now);
}

/** Composite past-meeting route id: `{meetingId}-{13-digit-ms}`. */
export const PAST_MEETING_COMPOSITE_ID = /^\d+-\d{13}$/;

/** Returns true when the id matches the past-meeting composite URL shape. */
export function isPastMeetingCompositeId(id: string): boolean {
  return PAST_MEETING_COMPOSITE_ID.test(id);
}

/**
 * Builds an Angular router command for a specific meeting occurrence, mirroring the join page URL
 * contract (`?occurrence=` for upcoming, `/meetings/{id}-{timestamp}` for past).
 */
export function buildMeetingOccurrenceRoute(
  meetingId: string,
  startTime: string,
  durationMinutes: number,
  options?: BuildMeetingOccurrenceRouteOptions
): MeetingOccurrenceRoute {
  const queryParams: Record<string, string> = {};
  if (options?.password) {
    queryParams['password'] = options.password;
  }

  const pastResourceId = options?.pastMeetingResourceId ?? (isPastMeetingCompositeId(meetingId) ? meetingId : undefined);
  if (pastResourceId) {
    return {
      path: ['/meetings', pastResourceId],
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    };
  }

  const timestamp = new Date(startTime).getTime();
  const isPast = isOccurrencePast(startTime, durationMinutes);

  if (isPast) {
    return {
      path: ['/meetings', `${meetingId}-${timestamp}`],
      queryParams: Object.keys(queryParams).length > 0 ? queryParams : undefined,
    };
  }

  queryParams['occurrence'] = timestamp.toString();
  return {
    path: ['/meetings', meetingId],
    queryParams,
  };
}

/**
 * Builds the canonical Angular router commands for a meeting's edit page, prefixing the path with
 * the MEETING's own project tier (`is_foundation`) rather than the viewer's transient active lens:
 * foundation-owned meetings edit under `/foundation/meetings/{id}/edit`, all other projects under
 * `/project/meetings/{id}/edit`. Returns null when `is_foundation` is absent (unenriched payload)
 * so callers can fall back to the flat `/meetings/{id}/edit` path handled by `lensRedirectGuard`.
 */
export function getMeetingEditCommands(meeting: Pick<Meeting, 'id' | 'is_foundation'>): string[] | null {
  if (meeting.is_foundation === undefined) {
    return null;
  }

  return ['/', meeting.is_foundation ? 'foundation' : 'project', 'meetings', meeting.id, 'edit'];
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

  // SAFETY: cast only widens to indexer-flat fields (content/edited_content) absent from both summary types;
  // presence is guarded by optional chaining semantics (?? / ||) below, so a missing field degrades to a default.
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
 * Returns true when a user identity (`created_by` or `owner`) is a service account
 * (e.g. `zoom.webhooks`) or carries no identifying information at all — either way it
 * must not be shown as the meeting organizer. Zero-valued owners (all fields empty —
 * meetings that predate the field) land here too.
 */
function isServiceOrEmptyIdentity(identity: { name?: string; username?: string; email?: string }): boolean {
  const name = identity.name?.trim();
  const username = identity.username?.trim().toLowerCase();
  const email = identity.email?.trim().toLowerCase();

  if (!name && !username && !email) {
    return true;
  }

  // `split('@')[0]` takes the local part; safe here because this only runs on trusted upstream
  // identity data (a malformed multi-`@` address would just not match a skip identifier).
  const emailLocalPart = email ? email.split('@')[0] : undefined;
  return MEETING_ORGANIZER_SKIP_IDENTIFIERS.some((skip) => username === skip || email === skip || emailLocalPart === skip || name?.toLowerCase() === skip);
}

/**
 * Resolves a meeting's `owner` to the organizer display shape, or `null` when the owner
 * is absent, zero-valued (all fields empty — meetings that predate the field), or a
 * service account (ITX defaults owner to the creator, so webhook-created meetings carry
 * `zoom.webhooks`). Callers fall back to the `created_by` display on `null`.
 */
export function resolveMeetingOwner(meeting: Pick<Meeting, 'owner'> | null | undefined): MeetingUserInfo | null {
  const owner = meeting?.owner;
  if (!owner || isServiceOrEmptyIdentity(owner)) {
    return null;
  }
  return {
    name: owner.name?.trim() ?? '',
    username: owner.username?.trim() ?? '',
    email: owner.email?.trim() ?? '',
    ...(owner.profile_picture ? { profile_picture: owner.profile_picture } : {}),
  };
}

/**
 * Resolves the person to display as a meeting's organizer, in priority order:
 *   1. `meeting.owner` when set to a real human (see {@link resolveMeetingOwner}).
 *   2. `meeting.created_by` when it's a real human (not a service account, not empty).
 *   3. The first host among the supplied candidates (rare, but authoritative when present).
 *   4. `null` — nothing resolvable, so the caller omits the organizer display entirely.
 *
 * @param meeting - Any object carrying optional `owner` / `created_by` (Meeting / PastMeeting).
 * @param hosts - Optional registrant/participant candidates for the host fallback.
 */
export function resolveMeetingOrganizer(
  meeting: Pick<Meeting, 'created_by' | 'owner'> | null | undefined,
  hosts?: ReadonlyArray<MeetingHostCandidate>
): MeetingUserInfo | null {
  const owner = resolveMeetingOwner(meeting);
  if (owner) {
    return owner;
  }

  const createdBy = meeting?.created_by;
  if (createdBy && !isServiceOrEmptyIdentity(createdBy)) {
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
 *   - The primary organizer is the human `owner` when set, replacing the `created_by` slot;
 *     otherwise the human `created_by` (see {@link resolveMeetingOrganizer}).
 *   - When host-flagged candidates are present, they ARE the organizer set (exactly what the
 *     modal badges), sorted by name — except the primary organizer always sits at index 0
 *     (prepended when not among the hosts; its matching host entry moved to the front when it
 *     is, never duplicated), because {@link buildMeetingOrganizerChip} renders element 0 as
 *     the primary.
 *   - When no hosts are supplied (e.g. summary cards that don't load the registrant list), the
 *     primary organizer is the sole entry.
 *   - Otherwise an empty array (nothing to display).
 *
 * Surfaces that show BOTH the chip and the modal must pass the same host list to each.
 */
export function collectMeetingOrganizers(
  meeting: Pick<Meeting, 'created_by' | 'owner'> | null | undefined,
  hosts?: ReadonlyArray<MeetingHostCandidate>
): MeetingUserInfo[] {
  // Owner-first, created_by fallback; deliberately no host fallback here — hosts are
  // collected separately below so the primary never duplicates the host derivation.
  const primary = resolveMeetingOwner(meeting) ?? resolveMeetingOrganizer({ created_by: meeting?.created_by });

  const hostOrganizers = (hosts ?? [])
    .filter((candidate) => candidate?.host)
    .map((host) => hostToOrganizer(host))
    .filter((organizer) => organizer.name || organizer.username || organizer.email)
    .sort((a, b) => getMeetingOrganizerDisplayName(a).localeCompare(getMeetingOrganizerDisplayName(b)));

  if (hostOrganizers.length === 0) {
    return primary ? [primary] : [];
  }

  if (!primary) {
    return hostOrganizers;
  }

  const primaryHostIndex = hostOrganizers.findIndex((organizer) => sameOrganizer(organizer, primary));
  if (primaryHostIndex === -1) {
    return [primary, ...hostOrganizers];
  }

  // The primary is also a host: move that host entry to the front (it can carry richer
  // registrant-derived data than the owner/created_by record) so the alphabetical sort can't
  // demote the owner out of the chip's primary slot.
  return [hostOrganizers[primaryHostIndex], ...hostOrganizers.filter((_, index) => index !== primaryHostIndex)];
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
  // Only emit a mailto for a conservative single-recipient address. The positive allowlist rejects
  // whitespace, separators (`,`/`;`), extra `@`, and — critically — percent escapes, so a record
  // like `victim@x.com%0D%0ABcc:attacker@x.com` can't decode into a CRLF + injected mail header.
  if (!email || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
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
 * Whether a resolved organizer IS the current viewer — the single comparison behind both the
 * chip's "you" variant and the "Organized by me" list filter, so the two can never disagree.
 * An absent/empty viewer never matches (a logged-out or unresolved viewer must not match every
 * meeting).
 */
function isViewerOrganizer(organizer: MeetingUserInfo, viewerUsername?: string | null): boolean {
  const viewer = normalizeUsername(viewerUsername);
  return !!viewer && normalizeUsername(organizer.username) === viewer;
}

/**
 * Whether the viewer is one of the meeting's organizers — the predicate behind the "Organized by
 * me" filter on My Meetings (LFXV2-2824). Deliberately derived from `owner`/`created_by` (via
 * {@link collectMeetingOrganizers}) and NOT from `meeting.organizer`: that flag is a per-viewer FGA
 * access check ("can I manage this") that includes inherited grants, so staff would match meetings
 * they never created — contradicting the "Organized by you" chip on the same card.
 *
 * Callers without a `hosts` list (e.g. the My Meetings list filter, which filters ahead of any
 * per-card registrants fetch) only ever match on `owner`/`created_by`. A real Zoom co-host who
 * isn't the creator therefore won't match here even though the chip on their own card would
 * recognize them as "you" once that card's registrants drawer resolves hosts — an accepted gap,
 * since matching it at list-filter time would mean fetching registrants for every meeting up front.
 *
 * @param meeting - Any object carrying optional `owner` / `created_by` (Meeting / PastMeeting).
 * @param viewerUsername - The current user's username/LFID (prefix-tolerant, case-insensitive).
 * @param hosts - Optional host candidates, when the surface has them (see collectMeetingOrganizers).
 */
export function isMeetingOrganizedByViewer(
  meeting: Pick<Meeting, 'created_by' | 'owner'> | null | undefined,
  viewerUsername?: string | null,
  hosts?: ReadonlyArray<MeetingHostCandidate>
): boolean {
  return collectMeetingOrganizers(meeting, hosts).some((organizer) => isViewerOrganizer(organizer, viewerUsername));
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

  const toLink = (organizer: MeetingUserInfo, index: number): MeetingOrganizerLink => {
    const isYou = isViewerOrganizer(organizer, viewerUsername);
    const name = getMeetingOrganizerDisplayName(organizer);
    return {
      // Suffix the identity with its position so two name-only organizers sharing a display name
      // still get distinct @for track keys (avoids Angular's duplicate-key diagnostic / DOM reuse).
      key: `${organizer.username?.trim() || organizer.email?.trim() || name}#${index}`,
      name,
      isYou,
      // "you" is never a mailto link (emailing yourself makes no sense); others link when they have an email.
      mailto: isYou ? null : buildMeetingOrganizerMailto({ email: organizer.email, ...mailtoContext }),
    };
  };

  return {
    count: organizers.length,
    primary: toLink(organizers[0], 0),
    overflow: organizers.slice(1).map((organizer, index) => toLink(organizer, index + 1)),
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

/**
 * Orders a people list into three tiers so organizers stay at the top and broken rows at the bottom:
 * hosts (organizers) first, then normally-named people, then unresolvable "[unknown]" records.
 * Within a tier, orders by first name. Shared by the registrants/participants modal and the
 * past-meeting details table so the ordering rule lives in one place.
 */
export function compareMeetingPeopleByHostThenName<T extends { host?: boolean; first_name?: string | null; last_name?: string | null }>(a: T, b: T): number {
  const rank = (person: T): number => {
    // Hosts always float to the top, even when their upstream name is empty/[unknown];
    // only non-host unresolvable rows sink to the bottom.
    if (person.host) {
      return 0;
    }
    return isUnresolvableParticipantName(person.first_name, person.last_name) ? 2 : 1;
  };
  const rankDelta = rank(a) - rank(b);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return a.first_name?.localeCompare(b.first_name ?? '') ?? 0;
}

/**
 * Drops null/blank committee entries from a meeting payload.
 *
 * PrimeNG MultiSelect builds its trigger label with `label += getLabelByValue(...)`.
 * Unmatched values return JS `null`, and `'' + null === 'null'`, so a committees
 * array of `[null]` / `{ uid: null }` renders the literal label "null" instead of
 * the empty placeholder (GH-1430).
 */
export function sanitizeMeetingCommittees(committees: ReadonlyArray<MeetingCommittee | null | undefined> | null | undefined): MeetingCommittee[] {
  if (!Array.isArray(committees) || committees.length === 0) {
    return [];
  }

  return committees.filter((committee): committee is MeetingCommittee => Boolean(committee?.uid?.trim()));
}

/**
 * Drops null/blank committee UIDs from a MultiSelect form value so the control
 * stays `[]` rather than `[null]` / `[undefined]`.
 */
export function sanitizeMeetingCommitteeUids(uids: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  if (!Array.isArray(uids) || uids.length === 0) {
    return [];
  }

  return uids.filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0);
}

/** Maps display voting statuses (committee domain) to the meeting API's snake_case vocabulary, dropping unknowns. */
export function toMeetingApiVotingStatuses(statuses: ReadonlyArray<string | null | undefined> | null | undefined): MeetingAllowedVotingStatus[] {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return [];
  }

  const mapped = statuses.map((status) => (status ? COMMITTEE_TO_MEETING_VOTING_STATUS[status as CommitteeMemberVotingStatus] : undefined));
  return [...new Set(mapped.filter((status): status is MeetingAllowedVotingStatus => Boolean(status)))];
}

/** Maps meeting API voting statuses back to display values ('none' collapses to Observer), dropping unknowns. */
export function fromMeetingApiVotingStatuses(statuses: ReadonlyArray<string | null | undefined> | null | undefined): CommitteeMemberVotingStatus[] {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return [];
  }

  // Fall back to a direct display-value match so rows stored pre-migration still hydrate.
  const mapped = statuses.map((status) => {
    if (!status) return undefined;
    const mappedStatus = MEETING_TO_COMMITTEE_VOTING_STATUS[status as MeetingAllowedVotingStatus];
    if (mappedStatus) return mappedStatus;
    if (!Object.values(CommitteeMemberVotingStatus).includes(status as CommitteeMemberVotingStatus)) return undefined;
    // Legacy 'None' collapses to Observer like 'none' does — None is not selectable in meeting forms.
    return status === CommitteeMemberVotingStatus.NONE ? CommitteeMemberVotingStatus.OBSERVER : (status as CommitteeMemberVotingStatus);
  });
  return [...new Set(mapped.filter((status): status is CommitteeMemberVotingStatus => Boolean(status)))];
}

/** Canonicalizes a stored status list to the deduped meeting-API vocabulary, mapping pre-migration display values. */
export function normalizeMeetingApiVotingStatuses(statuses: ReadonlyArray<string | null | undefined> | null | undefined): MeetingAllowedVotingStatus[] {
  return toMeetingApiVotingStatuses(fromMeetingApiVotingStatuses(statuses));
}
