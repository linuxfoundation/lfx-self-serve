// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_ATTENDANCE_BATCH_SIZE, MEETING_ATTENDANCE_CONCURRENCY, QUERY_SERVICE_MAX_PAGE_SIZE, VALKEY_CACHE } from '@lfx-one/shared/constants';
import {
  CachedMeetingAttendance,
  Meeting,
  MeetingRegistrant,
  MeetingRsvp,
  MeetingRsvpSummaries,
  MeetingRsvpSummaryRow,
  PastMeeting,
  PastMeetingAttendanceSummary,
  PastMeetingParticipant,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { countMeetingRsvpSummary, expandMeetingOccurrences, isMeetingHomeOrganizer, isMeetingInviteResponsesEnabled } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { MeetingService } from '../services/meeting.service';
import { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { buildUserCacheKey, valkeyService } from '../services/valkey.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { attachRsvpsToRegistrants, filterRsvpsToActiveRegistrants } from './meeting-rsvp.helper';
import { fetchAllQueryResources } from './query-service.helper';
import { settleInBatches } from './settle-in-batches.helper';

const meetingService = new MeetingService();
const microserviceProxy = new MicroserviceProxyService();

/**
 * Adds `rsvp_summary` to every home row date of the upcoming meetings the viewer organizes.
 * @description Rows come from the same expansion the meetings home uses, and each date resolves RSVP
 * scopes the way the meeting page does. Meetings whose lookup fails, and every other meeting, are returned unchanged.
 */
export async function attachMeetingRsvpSummaries(req: Request, meetings: Meeting[], now: Date = new Date()): Promise<Meeting[]> {
  const viewer = getEffectiveUsername(req);
  const organized = meetings.filter((meeting) => isMeetingInviteResponsesEnabled(meeting) && isMeetingHomeOrganizer(meeting, viewer));
  const rowsByMeeting = new Map<string, MeetingRsvpSummaryRow[]>();
  for (const row of expandMeetingOccurrences(organized, now)) {
    const rows = rowsByMeeting.get(row.meeting.id) ?? [];
    rows.push({ key: row.occurrenceId ?? '', onOccurrence: !!row.occurrence });
    rowsByMeeting.set(row.meeting.id, rows);
  }
  if (rowsByMeeting.size === 0) return meetings;

  const meetingsById = new Map(organized.map((meeting) => [meeting.id, meeting]));
  const summaries = await loadSummaries<MeetingRsvpSummaries>(
    req,
    'upcoming',
    viewer,
    [...rowsByMeeting.keys()],
    (cached, id) => (rowsByMeeting.get(id) ?? []).every((row) => row.key in cached),
    (ids) => fetchRsvpSummaries(req, ids, meetingsById, rowsByMeeting)
  );

  return meetings.map((meeting) => {
    const byKey = summaries.get(meeting.id);
    if (!byKey) return meeting;
    const fallbackRow = rowsByMeeting.get(meeting.id)?.find((row) => !row.onOccurrence);
    return {
      ...meeting,
      ...(fallbackRow && byKey[fallbackRow.key] && { rsvp_summary: byKey[fallbackRow.key] }),
      occurrences: (meeting.occurrences ?? []).map((occurrence) =>
        byKey[occurrence.occurrence_id] ? { ...occurrence, rsvp_summary: byKey[occurrence.occurrence_id] } : occurrence
      ),
    };
  });
}

/** Adds `attendance_summary` to the past meetings the viewer organizes; meetings whose lookup fails are returned unchanged. */
export async function attachPastMeetingAttendanceSummaries(req: Request, meetings: PastMeeting[]): Promise<PastMeeting[]> {
  const viewer = getEffectiveUsername(req);
  const ids = [...new Set(meetings.filter((meeting) => isMeetingHomeOrganizer(meeting, viewer)).map((meeting) => meeting.id))];
  if (ids.length === 0) return meetings;

  const summaries = await loadSummaries<PastMeetingAttendanceSummary>(
    req,
    'past',
    viewer,
    ids,
    () => true,
    (batch) => fetchAttendanceSummaries(req, batch)
  );

  return meetings.map((meeting) => (summaries.has(meeting.id) ? { ...meeting, attendance_summary: summaries.get(meeting.id) } : meeting));
}

/**
 * Serves fresh per-viewer cache entries, fetches the rest in bounded concurrent batches, then rewrites the entry map.
 * @description A failed batch is logged and its meetings are left out, so the feed still loads without their counts.
 */
async function loadSummaries<T>(
  req: Request,
  kind: 'upcoming' | 'past',
  viewer: string | null,
  ids: string[],
  isComplete: (cached: T, id: string) => boolean,
  fetchBatch: (ids: string[]) => Promise<Map<string, T>>
): Promise<Map<string, T>> {
  const cacheKey = viewer ? buildUserCacheKey(`${VALKEY_CACHE.MEETING_ATTENDANCE_NAMESPACE}:${kind}`, viewer) : null;
  const cached = cacheKey ? await valkeyService.getJson<CachedMeetingAttendance<T>>(cacheKey, isPlainObject) : null;
  const nowMs = Date.now();
  const isFresh = (entry: { at: number } | undefined): boolean => !!entry && nowMs - entry.at < VALKEY_CACHE.MEETING_ATTENDANCE_TTL_SECONDS * 1000;
  // Keep other feeds' fresh entries (e.g. a project-scoped load) so one scope does not evict another.
  const entries: CachedMeetingAttendance<T> = Object.fromEntries(Object.entries(cached ?? {}).filter(([, entry]) => isFresh(entry)));
  const summaries = new Map<string, T>();
  const missing: string[] = [];

  for (const id of ids) {
    const entry = entries[id];
    if (entry && isComplete(entry.value, id)) {
      summaries.set(id, entry.value);
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return summaries;

  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += MEETING_ATTENDANCE_BATCH_SIZE) {
    batches.push(missing.slice(i, i + MEETING_ATTENDANCE_BATCH_SIZE));
  }
  const settled = await settleInBatches(batches, MEETING_ATTENDANCE_CONCURRENCY, fetchBatch);

  let fetched = 0;
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') {
      logger.warning(req, 'meeting_attendance_summaries', 'Attendance lookup failed, leaving these meetings without counts', {
        kind,
        batch_size: batches[index].length,
        err: outcome.reason,
      });
      return;
    }
    for (const [id, value] of outcome.value) {
      entries[id] = { at: nowMs, value };
      summaries.set(id, value);
      fetched++;
    }
  });

  if (cacheKey && fetched > 0) {
    await valkeyService.setJson(cacheKey, entries, VALKEY_CACHE.MEETING_ATTENDANCE_TTL_SECONDS);
  }
  return summaries;
}

/** Tallies each listed date of a batch of meetings from one registrant walk and one RSVP walk. */
async function fetchRsvpSummaries(
  req: Request,
  ids: string[],
  meetingsById: Map<string, Meeting>,
  rowsByMeeting: Map<string, MeetingRsvpSummaryRow[]>
): Promise<Map<string, MeetingRsvpSummaries>> {
  // Registrants carry meeting_id as a data field, not a tag; RSVPs carry a meeting_id tag.
  const [registrants, rsvps] = await Promise.all([
    queryAll<MeetingRegistrant>(req, { type: 'v1_meeting_registrant', parent: '', filters_or: ids.map((id) => `meeting_id:${id}`) }),
    queryAll<MeetingRsvp>(req, { type: 'v1_meeting_rsvp', tags: ids.map((id) => `meeting_id:${id}`) }),
  ]);
  const registrantsByMeeting = groupBy(registrants, (registrant) => registrant.meeting_id);
  const rsvpsByMeeting = groupBy(rsvps, (rsvp) => rsvp.meeting_id);

  return new Map(
    ids.map((id) => {
      const roster = registrantsByMeeting.get(id) ?? [];
      const active = filterRsvpsToActiveRegistrants(rsvpsByMeeting.get(id) ?? [], roster);
      const recurring = !!meetingsById.get(id)?.recurrence;
      const byKey: MeetingRsvpSummaries = {};
      for (const { key } of rowsByMeeting.get(id) ?? []) {
        // A series row without an occurrence id counts only answers for all dates, as the meeting page does.
        byKey[key] = countMeetingRsvpSummary(attachRsvpsToRegistrants(roster, active, key || undefined, !key && recurring));
      }
      return [id, byKey];
    })
  );
}

/** Tallies a batch of past meetings from one participant walk, merging duplicate records per person. */
async function fetchAttendanceSummaries(req: Request, ids: string[]): Promise<Map<string, PastMeetingAttendanceSummary>> {
  const participants = await queryAll<PastMeetingParticipant>(req, {
    type: 'v1_past_meeting_participant',
    tags: ids.map((id) => `meeting_and_occurrence_id:${id}`),
  });
  const byMeeting = groupBy(participants, (participant) => participant.meeting_and_occurrence_id);

  return new Map(
    ids.map((id) => {
      const people = meetingService.dedupePastMeetingParticipants(byMeeting.get(id) ?? []);
      return [id, { invited: people.length, attended: people.filter((person) => person.is_attended).length }];
    })
  );
}

/** Walks every page with the viewer's token; a partial walk throws so its batch is skipped rather than undercounted. */
function queryAll<T>(req: Request, params: Record<string, unknown>): Promise<T[]> {
  return fetchAllQueryResources<T>(
    req,
    (pageToken) =>
      microserviceProxy.proxyRequest<QueryServiceResponse<T>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        page_size: QUERY_SERVICE_MAX_PAGE_SIZE,
        ...(pageToken && { page_token: pageToken }),
      }),
    { failOnPartial: true }
  );
}

function groupBy<T>(items: T[], keyOf: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
