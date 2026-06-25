// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_ALL_EMPLOYEE_STATS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeCodeContribution,
  OrgAllEmployeeCommitteeMembership,
  OrgAllEmployeeDetail,
  OrgAllEmployeeEvent,
  OrgAllEmployeeRow,
  OrgAllEmployeeStats,
  OrgAllEmployeeTraining,
  OrgAllEmployeeTrainingStatus,
  OrgAllEmployeeVotingStatus,
  OrgAllEmployeesResponse,
  OrgPersonSource,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, splitDisplayName } from '@lfx-one/shared/utils';

import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Per-(account, person) row from PLATINUM_LFX_ONE.ORG_PEOPLE_ALL. */
interface OrgPeopleAllRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  LFID: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  PHOTO: string | null;
  SEATS_COUNT: number;
  BOARD_SEATS_COUNT: number;
  COMMITTEE_SEATS_COUNT: number;
  COMMITS_COUNT: number;
  EVENTS_COUNT: number;
  COURSES_COUNT: number;
}

/** Roster row including the raw ENGAGED_FOUNDATION_IDS column (Snowflake ARRAY may arrive as a JSON string or a parsed array). */
type OrgPeopleAllRowRaw = OrgPeopleAllRow & { ENGAGED_FOUNDATION_IDS: string | string[] | null };

/** One-row aggregate from PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_STATS. */
interface OrgPeopleStatsRow {
  ACCOUNT_ID: string;
  ACTIVE_IN_OSS: number;
  IN_GOVERNANCE: number;
  CODE_CONTRIBUTORS: number;
  EVENT_ATTENDEES: number;
  TRAINEES: number;
}

/** Distinct (foundation_id, foundation_name) pair powering the All Foundations dropdown. */
interface FoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

interface CommitteeMembershipRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  COMMITTEE_ID: string;
  COMMITTEE_NAME: string | null;
  COMMITTEE_TYPE: string | null;
  IS_BOARD: boolean;
  COMMITTEE_ROLE: string | null;
  VOTING_STATUS: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface CodeContributionRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  PROJECT_ID: string;
  PROJECT_NAME: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  TOTAL_COMMITS: number;
  IS_MAINTAINER: boolean;
  LAST_ACTIVITY_DATE: Date | string | null;
}

interface EventRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  EVENT_ID: string;
  EVENT_NAME: string | null;
  EVENT_END_DATE: Date | string | null;
  IS_SPEAKER: boolean;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface TrainingRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  COURSE_OR_CERT_ID: string;
  STATUS: string | null;
  COURSE_ID: string | null;
  COURSE_NAME: string | null;
}

/** Org Lens "People → All Employees" analytics — backed by the 6 PLATINUM_LFX_ONE.ORG_PEOPLE_* tables. Empty rows produce an empty envelope, never a 404. */
export class OrgLensPeopleService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + stats + foundations payload; three Snowflake queries in parallel, served through the shared per-org cache. */
  public async getAllEmployees(accountId: string): Promise<OrgAllEmployeesResponse> {
    const raw = await withOrgCache(
      accountId,
      'people-all',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchAllEmployeesRaw(accountId),
      isAllEmployeesRaw
    );

    return {
      accountId,
      rows: raw.rowsRaw.map((row) => this.mapEmployeeRow(row)),
      stats: this.mapStats(raw.statsRaw),
      foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
    };
  }

  /** Chevron-expansion detail for one person within an account; four Snowflake queries in parallel, served through the shared per-org cache. */
  public async getEmployeeDetail(accountId: string, personKey: string): Promise<OrgAllEmployeeDetail> {
    const { committeeRows, codeRows, eventRows, trainingRows } = await this.fetchEmployeeDetailRaw(accountId, personKey);

    const memberships = committeeRows.map((row) => this.mapCommitteeRow(row));
    const boardSeats = memberships.filter((m) => m.isBoard);
    const committeeSeats = memberships.filter((m) => !m.isBoard);

    // EVENTS detail is grained one-row-per-(account, person, event_id) so distinct rows == the parent events_count.
    const eventsCount = eventRows.length;
    const events = eventRows.map((row) => this.mapEventRow(row, eventsCount));

    // COUNT(DISTINCT) over the same id mapTrainingRow uses (COURSE_ID with COURSE_OR_CERT_ID fallback), so counts and rendered row keys agree.
    const distinctCourseIds = new Set<string>();
    const distinctCertifiedCourseIds = new Set<string>();
    for (const row of trainingRows) {
      const courseId = row.COURSE_ID ?? row.COURSE_OR_CERT_ID;
      if (courseId) {
        distinctCourseIds.add(courseId);
        if (row.STATUS === 'Certified') {
          distinctCertifiedCourseIds.add(courseId);
        }
      }
    }
    const coursesCount = distinctCourseIds.size;
    const certificationsCount = distinctCertifiedCourseIds.size;
    const training = trainingRows.map((row) => this.mapTrainingRow(row, coursesCount, certificationsCount));

    return {
      personKey,
      boardSeats,
      committeeSeats,
      code: codeRows.map((row) => this.mapCodeRow(row)),
      events,
      training,
    };
  }

  /** Three parallel Snowflake reads returning raw rows; mapping happens after the cache read. */
  private async fetchAllEmployeesRaw(
    accountId: string
  ): Promise<{ rowsRaw: OrgPeopleAllRowRaw[]; statsRaw: OrgPeopleStatsRow[]; foundationRaw: FoundationOptionRow[] }> {
    const rowsQuery = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL,
        PHOTO,
        SEATS_COUNT,
        BOARD_SEATS_COUNT,
        COMMITTEE_SEATS_COUNT,
        COMMITS_COUNT,
        EVENTS_COUNT,
        COURSES_COUNT,
        ENGAGED_FOUNDATION_IDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ?
      ORDER BY NAME ASC NULLS LAST
    `;

    const statsQuery = `
      SELECT
        ACCOUNT_ID,
        ACTIVE_IN_OSS,
        IN_GOVERNANCE,
        CODE_CONTRIBUTORS,
        EVENT_ATTENDEES,
        TRAINEES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_STATS
      WHERE ACCOUNT_ID = ?
    `;

    // Distinct (foundation_id, foundation_name) pairs across the four detail tables; keeps the BFF confined to PLATINUM_LFX_ONE.
    const foundationQuery = `
      WITH pairs AS (
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMMITTEE_MEMBERSHIP
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
      )
      SELECT FOUNDATION_ID, FOUNDATION_NAME
      FROM pairs
      ORDER BY FOUNDATION_NAME ASC
    `;

    const [rowsResult, statsResult, foundationResult] = await Promise.all([
      this.snowflakeService.execute<OrgPeopleAllRowRaw>(rowsQuery, [accountId]),
      this.snowflakeService.execute<OrgPeopleStatsRow>(statsQuery, [accountId]),
      this.snowflakeService.execute<FoundationOptionRow>(foundationQuery, [accountId, accountId, accountId, accountId]),
    ]);

    return { rowsRaw: rowsResult.rows, statsRaw: statsResult.rows, foundationRaw: foundationResult.rows };
  }

  private mapEmployeeRow(row: OrgPeopleAllRowRaw): OrgAllEmployeeRow {
    const name = cleanDisplayName(row.NAME, row.EMAIL);
    const [firstName, lastName] = splitDisplayName(name);
    return {
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name,
      firstName,
      lastName,
      title: row.TITLE,
      email: row.EMAIL,
      avatarUrl: row.PHOTO ?? null,
      sources: ['snowflake'] as OrgPersonSource[],
      seatsCount: row.SEATS_COUNT ?? 0,
      boardSeatsCount: row.BOARD_SEATS_COUNT ?? 0,
      committeeSeatsCount: row.COMMITTEE_SEATS_COUNT ?? 0,
      commitsCount: row.COMMITS_COUNT ?? 0,
      eventsCount: row.EVENTS_COUNT ?? 0,
      coursesCount: row.COURSES_COUNT ?? 0,
      engagedFoundationIds: this.parseFoundationIdArray(row.ENGAGED_FOUNDATION_IDS),
    };
  }

  private mapStats(rows: OrgPeopleStatsRow[]): OrgAllEmployeeStats {
    if (rows.length === 0) {
      return EMPTY_ORG_ALL_EMPLOYEE_STATS;
    }

    const row = rows[0];
    return {
      activeInOss: row.ACTIVE_IN_OSS ?? 0,
      inGovernance: row.IN_GOVERNANCE ?? 0,
      codeContributors: row.CODE_CONTRIBUTORS ?? 0,
      eventAttendees: row.EVENT_ATTENDEES ?? 0,
      trainees: row.TRAINEES ?? 0,
    };
  }

  /** Cached per-org detail bundle (four raw row arrays); a non-filter-safe personKey bypasses the shared cache to keep the key namespace intact. */
  private async fetchEmployeeDetailRaw(
    accountId: string,
    personKey: string
  ): Promise<{ committeeRows: CommitteeMembershipRow[]; codeRows: CodeContributionRow[]; eventRows: EventRow[]; trainingRows: TrainingRow[] }> {
    if (!isFilterSafeIdentifier(personKey)) {
      return this.runEmployeeDetailFetch(accountId, personKey);
    }

    return withOrgCache(
      accountId,
      `people-detail:${personKey}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.runEmployeeDetailFetch(accountId, personKey),
      isEmployeeDetailRaw
    );
  }

  private async runEmployeeDetailFetch(
    accountId: string,
    personKey: string
  ): Promise<{ committeeRows: CommitteeMembershipRow[]; codeRows: CodeContributionRow[]; eventRows: EventRow[]; trainingRows: TrainingRow[] }> {
    const [committeeRows, codeRows, eventRows, trainingRows] = await Promise.all([
      this.fetchCommitteeMembershipRows(accountId, personKey),
      this.fetchCodeContributionRows(accountId, personKey),
      this.fetchEventRows(accountId, personKey),
      this.fetchTrainingRows(accountId, personKey),
    ]);
    return { committeeRows, codeRows, eventRows, trainingRows };
  }

  private async fetchCommitteeMembershipRows(accountId: string, personKey: string): Promise<CommitteeMembershipRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        COMMITTEE_ID,
        COMMITTEE_NAME,
        COMMITTEE_TYPE,
        IS_BOARD,
        COMMITTEE_ROLE,
        VOTING_STATUS,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMMITTEE_MEMBERSHIP
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY IS_BOARD DESC, COMMITTEE_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<CommitteeMembershipRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private async fetchCodeContributionRows(accountId: string, personKey: string): Promise<CodeContributionRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        PROJECT_ID,
        PROJECT_NAME,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        TOTAL_COMMITS,
        IS_MAINTAINER,
        LAST_ACTIVITY_DATE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY TOTAL_COMMITS DESC NULLS LAST, PROJECT_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<CodeContributionRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private async fetchEventRows(accountId: string, personKey: string): Promise<EventRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        EVENT_ID,
        EVENT_NAME,
        EVENT_END_DATE,
        IS_SPEAKER,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY EVENT_END_DATE DESC NULLS LAST, EVENT_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<EventRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private async fetchTrainingRows(accountId: string, personKey: string): Promise<TrainingRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        COURSE_OR_CERT_ID,
        STATUS,
        COURSE_ID,
        COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY STATUS ASC NULLS LAST, COURSE_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<TrainingRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private mapCommitteeRow(row: CommitteeMembershipRow): OrgAllEmployeeCommitteeMembership {
    return {
      committeeId: row.COMMITTEE_ID,
      committeeName: row.COMMITTEE_NAME ?? row.COMMITTEE_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      committeeRole: row.COMMITTEE_ROLE ?? '',
      votingStatus: mapVotingStatus(row.VOTING_STATUS),
      isBoard: row.IS_BOARD === true,
    };
  }

  private mapCodeRow(row: CodeContributionRow): OrgAllEmployeeCodeContribution {
    return {
      projectId: row.PROJECT_ID,
      projectName: row.PROJECT_NAME ?? row.PROJECT_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      totalCommits: row.TOTAL_COMMITS ?? 0,
      lastActivityDate: toDateString(row.LAST_ACTIVITY_DATE),
      isMaintainer: row.IS_MAINTAINER === true,
    };
  }

  private mapEventRow(row: EventRow, eventsCount: number): OrgAllEmployeeEvent {
    return {
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME ?? row.EVENT_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      isSpeaker: row.IS_SPEAKER === true,
      eventsCount,
      lastEventEndDate: toDateString(row.EVENT_END_DATE),
    };
  }

  private mapTrainingRow(row: TrainingRow, coursesCount: number, certificationsCount: number): OrgAllEmployeeTraining {
    const status: OrgAllEmployeeTrainingStatus = row.STATUS === 'Certified' ? 'Certified' : 'Enrolled';
    return {
      courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
      courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
      status,
      certificationsCount,
      coursesCount,
    };
  }

  /** Snowflake ARRAY may arrive as a JSON string or an already-parsed array depending on driver config. */
  private parseFoundationIdArray(raw: string | string[] | null | undefined): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
    } catch {
      // single-value fall-through
    }
    return typeof raw === 'string' && raw.length > 0 ? [raw] : [];
  }
}

/** Upstream occasionally carries bracketed placeholder names (e.g. "[[Unknown]] [[unknown]]") or a blank name; surface the email instead so the row stays identifiable, with a generic label only when no email exists. */
function cleanDisplayName(rawName: string | null, email: string | null): string {
  const name = (rawName ?? '').trim();
  const isPlaceholder = name === '' || /\[\[[^\]]*\]\]/.test(name);
  if (!isPlaceholder) {
    return name;
  }
  return (email ?? '').trim() || 'Unknown member';
}

function isAllEmployeesRaw(value: unknown): boolean {
  const v = value as { rowsRaw?: unknown; statsRaw?: unknown; foundationRaw?: unknown } | null;
  return !!v && Array.isArray(v.rowsRaw) && Array.isArray(v.statsRaw) && Array.isArray(v.foundationRaw);
}

function isEmployeeDetailRaw(value: unknown): boolean {
  const v = value as { committeeRows?: unknown; codeRows?: unknown; eventRows?: unknown; trainingRows?: unknown } | null;
  return !!v && Array.isArray(v.committeeRows) && Array.isArray(v.codeRows) && Array.isArray(v.eventRows) && Array.isArray(v.trainingRows);
}

/** Narrow upstream free-text voting status to the three badges; unknown values collapse to 'Non-voting'. */
function mapVotingStatus(raw: string | null): OrgAllEmployeeVotingStatus {
  if (!raw) return 'Non-voting';
  const normalized = raw.trim();
  if (normalized === 'Voting Rep' || normalized === 'Voting') return 'Voting';
  if (normalized === 'Observer') return 'Observer';
  return 'Non-voting';
}

/** Normalize Snowflake `Date | string | null` to an ISO `YYYY-MM-DD` string, or null when missing/unparseable; mirrors ProjectService.toIsoDate so non-ISO strings can't leak "Invalid Da" garbage to the client. */
function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
