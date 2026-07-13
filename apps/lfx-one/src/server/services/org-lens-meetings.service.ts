// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  GetOrgUpcomingMeetingsOptions,
  OrgMeeting,
  OrgMeetingInvitee,
  OrgMeetingPrivacy,
  OrgMeetingRsvpStatus,
  OrgMeetingsProjectsResponse,
  OrgMeetingsSummary,
  OrgMeetingsSummaryRow,
  OrgMeetingType,
  OrgMeetingProjectRow,
  OrgUpcomingMeetingInviteeRow,
  OrgUpcomingMeetingRow,
  OrgUpcomingMeetingsResponse,
} from '@lfx-one/shared/interfaces';
import { formatDateToUTC, isObjectRow, isObjectRowArray } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Service for org-lens meeting endpoints — reads the org upcoming-meeting footprint from platinum ORG_UPCOMING_MEETINGS. */
export class OrgLensMeetingsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** GET /api/orgs/:accountId/lens/meetings/summary — org upcoming + recurring counts (+ foundation breadth, next date); surfaces errors so the client renders its "couldn't load" state instead of a fabricated zero-valued summary. */
  public async getOrgMeetingsSummary(req: Request, accountId: string): Promise<OrgMeetingsSummary> {
    logger.debug(req, 'get_org_lens_meetings_summary', 'Building org meetings summary query', { account_id: accountId });

    const sql = `
      SELECT
        COUNT(DISTINCT meeting_id)                                     AS UPCOMING_MEETINGS,
        COUNT(DISTINCT CASE WHEN is_recurring THEN meeting_id END)     AS RECURRING_SERIES,
        COUNT(DISTINCT CASE WHEN is_recurring THEN foundation_id END)  AS RECURRING_FOUNDATIONS,
        MIN(next_occurrence_utc_ts)                                    AS NEXT_MEETING
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETINGS
      WHERE account_id = ?
    `;

    // Let a Snowflake failure propagate to the controller's error handler instead of degrading to a
    // fake zero-valued summary — the frontend's `accountUnseeded` check treats an all-zero summary as
    // proof the account has no real data, so masking an outage as zeros would wrongly trigger the demo
    // fallback instead of the error/retry state.
    const rows: OrgMeetingsSummaryRow[] = await withOrgCache(
      accountId,
      'meetings-summary',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchSummaryRows(accountId, sql),
      isObjectRowArray
    );

    const row = rows[0];
    // Degrade an unparseable (e.g. corrupt-cache) NEXT_MEETING to null instead of throwing.
    const nextRaw = row?.NEXT_MEETING;
    const nextDate = nextRaw != null ? new Date(nextRaw as string | number | Date) : null;
    const summary: OrgMeetingsSummary = {
      upcomingMeetings: row?.UPCOMING_MEETINGS ?? 0,
      recurringSeries: row?.RECURRING_SERIES ?? 0,
      recurringFoundations: row?.RECURRING_FOUNDATIONS ?? 0,
      nextMeeting: nextDate && !Number.isNaN(nextDate.getTime()) ? nextDate.toISOString() : null,
    };

    logger.debug(req, 'get_org_lens_meetings_summary', 'Fetched org meetings summary', { ...summary, account_id: accountId });

    return summary;
  }

  /** GET /api/orgs/:accountId/lens/meetings — paginated upcoming-meeting list (search/project/type filters); surfaces errors so the client renders its "couldn't load" state. */
  public async getOrgUpcomingMeetings(req: Request, accountId: string, options: GetOrgUpcomingMeetingsOptions): Promise<OrgUpcomingMeetingsResponse> {
    const { searchQuery, project, type, pageSize, offset } = options;

    logger.debug(req, 'get_org_lens_meetings', 'Building org meetings list query', {
      account_id: accountId,
      has_search: !!searchQuery,
      project,
      type,
      page_size: pageSize,
      offset,
    });

    const searchFilter = searchQuery ? 'AND (m.TOPIC ILIKE ? OR m.AGENDA ILIKE ?)' : '';
    const projectFilter = project ? 'AND m.FOUNDATION_NAME = ?' : '';
    // 'other' is a UI catch-all (see mapMeetingType) with no matching literal bucket in Snowflake —
    // filter it by exclusion instead of an equality bind that would never match a real row. NULL
    // buckets also map to 'other' in mapMeetingType, but SQL's NOT IN treats NULL as UNKNOWN rather
    // than TRUE, so the IS NULL branch must be included explicitly or those rows would be dropped.
    let typeFilter = '';
    if (type === 'other') {
      typeFilter = "AND (m.MEETING_TYPE_BUCKET NOT IN ('board','marketing','working-group') OR m.MEETING_TYPE_BUCKET IS NULL)";
    } else if (type) {
      typeFilter = 'AND m.MEETING_TYPE_BUCKET = ?';
    }

    const sql = `
      SELECT
        m.MEETING_ID,
        m.TOPIC,
        m.AGENDA,
        m.VISIBILITY,
        m.MEETING_TYPE_BUCKET,
        m.RECURRENCE_LABEL,
        m.NEXT_OCCURRENCE_UTC_TS,
        m.MEETING_DURATION,
        m.FOUNDATION_NAME,
        m.RECORDING_ENABLED,
        m.TRANSCRIPT_ENABLED,
        m.AI_SUMMARY_ENABLED,
        m.ATTENDING_COUNT,
        m.MAYBE_COUNT,
        m.NO_COUNT,
        m.NO_RESPONSE_COUNT,
        m.GUEST_COUNT,
        COUNT(*) OVER() AS TOTAL_RECORDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETINGS m
      WHERE m.ACCOUNT_ID = ?
        ${searchFilter}
        ${projectFilter}
        ${typeFilter}
      ORDER BY m.NEXT_OCCURRENCE_UTC_TS ASC NULLS LAST
      LIMIT ? OFFSET ?
    `;

    const binds: (string | number)[] = [accountId];
    if (searchQuery) binds.push(`%${searchQuery}%`, `%${searchQuery}%`);
    if (project) binds.push(project);
    if (type && type !== 'other') binds.push(mapMeetingTypeToBucket(type));
    binds.push(pageSize, offset);

    // Surface list errors (no fail-soft) so the client renders its distinct "couldn't load" state instead of an empty list.
    const rows = await withOrgCache(
      accountId,
      `meetings:${paramSignature([searchQuery ?? null, project ?? null, type ?? null, pageSize, offset])}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchMeetingRows(sql, binds),
      isMeetingRowArray
    );

    const total = rows.length > 0 ? rows[0].TOTAL_RECORDS : 0;
    const meetingIds = rows.map((row) => row.MEETING_ID);
    const inviteesByMeeting = await this.fetchInviteesByMeeting(req, accountId, meetingIds);
    const data = rows.map((row) => this.mapRowToOrgMeeting(row, inviteesByMeeting.get(row.MEETING_ID) ?? []));

    logger.debug(req, 'get_org_lens_meetings', 'Fetched org meetings', { count: data.length, total });

    return { data, total, pageSize, offset };
  }

  /** GET /api/orgs/:accountId/lens/meetings/projects — distinct foundation/project names for the meetings filter dropdown; fail-soft to empty. */
  public async getOrgMeetingProjects(req: Request, accountId: string): Promise<OrgMeetingsProjectsResponse> {
    logger.debug(req, 'get_org_lens_meeting_projects', 'Building org meeting projects query', { account_id: accountId });

    const sql = `
      SELECT DISTINCT m.FOUNDATION_NAME AS PROJECT_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETINGS m
      WHERE m.ACCOUNT_ID = ?
        AND m.FOUNDATION_NAME IS NOT NULL
      ORDER BY PROJECT_NAME ASC
    `;

    let rows: OrgMeetingProjectRow[];
    try {
      rows = await withOrgCache(
        accountId,
        'meetings-projects',
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchProjectRows(accountId, sql),
        isProjectRowArray
      );
    } catch (error) {
      logger.warning(req, 'get_org_lens_meeting_projects', 'Snowflake query failed, returning empty projects', {
        err: error,
        account_id: accountId,
      });
      return { projects: [] };
    }

    const projects = rows.map((row) => row.PROJECT_NAME);

    logger.debug(req, 'get_org_lens_meeting_projects', 'Fetched org meeting projects', { count: projects.length });

    return { projects };
  }

  private async fetchSummaryRows(accountId: string, sql: string): Promise<OrgMeetingsSummaryRow[]> {
    const result = await this.snowflakeService.execute<OrgMeetingsSummaryRow>(sql, [accountId]);
    return result.rows;
  }

  private async fetchMeetingRows(sql: string, binds: (string | number)[]): Promise<OrgUpcomingMeetingRow[]> {
    const result = await this.snowflakeService.execute<OrgUpcomingMeetingRow>(sql, binds);
    return result.rows;
  }

  private async fetchProjectRows(accountId: string, sql: string): Promise<OrgMeetingProjectRow[]> {
    const result = await this.snowflakeService.execute<OrgMeetingProjectRow>(sql, [accountId]);
    return result.rows;
  }

  private async fetchInviteesByMeeting(req: Request, accountId: string, meetingIds: readonly string[]): Promise<Map<string, OrgMeetingInvitee[]>> {
    const byMeeting = new Map<string, OrgMeetingInvitee[]>();
    if (meetingIds.length === 0) return byMeeting;

    const placeholders = meetingIds.map(() => '?').join(', ');
    const sql = `
      SELECT
        i.MEETING_ID,
        i.FULL_NAME,
        i.JOB_TITLE,
        i.AVATAR_URL,
        i.RSVP_STATUS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_UPCOMING_MEETING_INVITEES i
      WHERE i.ACCOUNT_ID = ?
        AND i.MEETING_ID IN (${placeholders})
    `;
    const binds: string[] = [accountId, ...meetingIds];

    let rows: OrgUpcomingMeetingInviteeRow[];
    try {
      rows = await withOrgCache(
        accountId,
        `meeting-invitees:${paramSignature([...meetingIds])}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchInviteeRows(sql, binds),
        isInviteeRowArray
      );
    } catch (error) {
      logger.warning(req, 'get_org_lens_meetings', 'Invitee query failed, returning meetings without invitees', {
        err: error,
        account_id: accountId,
      });
      return byMeeting;
    }

    for (const row of rows) {
      const invitees = byMeeting.get(row.MEETING_ID) ?? [];
      invitees.push({
        name: row.FULL_NAME,
        title: row.JOB_TITLE ?? '',
        avatarUrl: row.AVATAR_URL ?? null,
        rsvpStatus: mapRsvpStatus(row.RSVP_STATUS),
      });
      byMeeting.set(row.MEETING_ID, invitees);
    }
    return byMeeting;
  }

  private async fetchInviteeRows(sql: string, binds: string[]): Promise<OrgUpcomingMeetingInviteeRow[]> {
    const result = await this.snowflakeService.execute<OrgUpcomingMeetingInviteeRow>(sql, binds);
    return result.rows;
  }

  private mapRowToOrgMeeting(row: OrgUpcomingMeetingRow, orgInvitees: OrgMeetingInvitee[]): OrgMeeting {
    const startTime = formatDateToUTC(row.NEXT_OCCURRENCE_UTC_TS) ?? '';
    const durationMinutes = row.MEETING_DURATION ?? 0;
    const startMs = startTime ? new Date(startTime).getTime() : Number.NaN;
    const endTime = Number.isFinite(startMs) ? new Date(startMs + durationMinutes * 60_000).toISOString() : startTime;
    const foundation = row.FOUNDATION_NAME ?? '';

    return {
      id: row.MEETING_ID,
      title: row.TOPIC,
      privacy: mapPrivacy(row.VISIBILITY),
      type: mapMeetingType(row.MEETING_TYPE_BUCKET),
      recurrenceLabel: row.RECURRENCE_LABEL ?? null,
      startTime,
      endTime,
      foundation,
      orgName: '',
      project: foundation,
      agenda: row.AGENDA ?? null,
      resources: [],
      rsvpTally: {
        yes: row.ATTENDING_COUNT ?? 0,
        maybe: row.MAYBE_COUNT ?? 0,
        no: row.NO_COUNT ?? 0,
        noResponse: row.NO_RESPONSE_COUNT ?? 0,
      },
      orgInvitees,
      guestCount: row.GUEST_COUNT ?? 0,
      joinUrl: null,
      statusFlags: {
        recording: !!row.RECORDING_ENABLED,
        transcripts: !!row.TRANSCRIPT_ENABLED,
        aiSummary: !!row.AI_SUMMARY_ENABLED,
      },
    };
  }
}

/** Deterministic, key-safe sub-resource suffix for the result-changing query params (base64url → only `[A-Za-z0-9_-]`). */
function paramSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function mapPrivacy(visibility: string | null): OrgMeetingPrivacy {
  return visibility?.toLowerCase() === 'private' ? 'private' : 'public';
}

function mapMeetingType(bucket: string | null): OrgMeetingType {
  if (bucket === 'board') return 'board';
  if (bucket === 'marketing') return 'marketing';
  // Upstream Snowflake bucket is still named 'working-group'; the UI-facing type was renamed to 'technical' (LFXV2-1901).
  if (bucket === 'working-group') return 'technical';
  return 'other';
}

/** Inverse of `mapMeetingType` — converts a UI-facing type filter value back to the Snowflake bucket it's stored under. */
function mapMeetingTypeToBucket(type: OrgMeetingType): string {
  if (type === 'technical') return 'working-group';
  return type;
}

function mapRsvpStatus(status: string): OrgMeetingRsvpStatus {
  return status === 'yes' || status === 'maybe' || status === 'no' ? status : null;
}

/** List rows reach the client through `mapRowToOrgMeeting`, which reads `MEETING_ID` with no fallback — validate the contract key so a poisoned `[{}]` entry degrades to a miss. */
function isMeetingRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['MEETING_ID'] === 'string');
}

function isInviteeRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['MEETING_ID'] === 'string' && typeof el['FULL_NAME'] === 'string');
}

function isProjectRowArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((el) => isObjectRow(el) && typeof el['PROJECT_NAME'] === 'string');
}
