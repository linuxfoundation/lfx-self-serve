// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_ROW_CAP,
  HEALTH_METRICS_ENGAGEMENT_ORG_PARTICIPATION_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_GROUPS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_LEVELS,
  HEALTH_METRICS_ENGAGEMENT_RANGES,
  HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_DEFAULT,
  HEALTH_METRICS_ENGAGEMENT_REP_ROW_CAP,
  SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE,
} from '@lfx-one/shared/constants';
import type {
  HealthMetricsEngagementGroupAttendance,
  HealthMetricsEngagementGroupPeriod,
  HealthMetricsEngagementGroupQuery,
  HealthMetricsEngagementGroupRow,
  HealthMetricsEngagementMeetingParticipation,
  HealthMetricsEngagementNonMemberCounts,
  HealthMetricsEngagementNonMemberParticipation,
  HealthMetricsEngagementNonMemberPeriod,
  HealthMetricsEngagementNonMemberQuery,
  HealthMetricsEngagementNonMemberRow,
  HealthMetricsEngagementOrgCounts,
  HealthMetricsEngagementOrgParticipation,
  HealthMetricsEngagementOrgPeriod,
  HealthMetricsEngagementOrgQuery,
  HealthMetricsEngagementOrgRow,
  HealthMetricsEngagementParticipationPeriod,
  HealthMetricsEngagementParticipationQuery,
  HealthMetricsEngagementParticipationRow,
  HealthMetricsEngagementRepPeriod,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementRepQuery,
  HealthMetricsEngagementRepresentatives,
  HealthMetricsEngagementRepRow,
  SnowflakeQueryResult,
} from '@lfx-one/shared/interfaces';

import { BaseApiError } from '../errors/base.error';
import { MicroserviceError } from '../errors/microservice.error';
import { getCodeForStatus } from '../helpers/http-status.helper';
import { clampInteger } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type { Request } from 'express';
import type { Bind } from 'snowflake-sdk';

const GROUP_ATTENDANCE_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_GROUP_ATTENDANCE';
const MEETING_PARTICIPATION_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_MEETING_PARTICIPATION';
const ORG_PARTICIPATION_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_ORG_PARTICIPATION';
const NON_MEMBER_PARTICIPATION_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_NON_MEMBER_PARTICIPATION';
const REPRESENTATIVES_VIEW = 'ANALYTICS.PLATINUM_LFX_ONE.ENGAGEMENT_REPRESENTATIVES';

/** The ranges this view has columns for — `COMPLETED_YEAR_4` is not one of them. */
type SupportedEngagementRange = (typeof HEALTH_METRICS_ENGAGEMENT_RANGES)[number];

/**
 * Column suffix per period. The view carries no `COMPLETED_YEAR_4` columns, so that range is
 * rejected at the controller rather than silently resolving to a different year.
 */
const RANGE_COLUMN_SUFFIX: Record<SupportedEngagementRange, string> = {
  YTD: 'ytd',
  COMPLETED_YEAR: 'last_completed_year',
  COMPLETED_YEAR_2: 'prev_completed_year',
  COMPLETED_YEAR_3: '3rd_last_completed_year',
};

/**
 * The period each range is compared against. Every delta is derived from these columns rather than
 * the view's own `*_CHANGE_*` columns: those exist only for YTD, and deriving keeps the delta in
 * the same unit as the value it came from. `COMPLETED_YEAR_3` has no prior period in the view.
 */
const RANGE_PRIOR_COLUMN_SUFFIX: Partial<Record<SupportedEngagementRange, string>> = {
  YTD: 'prev_ytd',
  COMPLETED_YEAR: 'prev_completed_year',
  COMPLETED_YEAR_2: '3rd_last_completed_year',
};

/** True when this service can serve the range — the controller uses it to validate before binding. */
export function isSupportedEngagementRange(range: string): range is SupportedEngagementRange {
  return Object.prototype.hasOwnProperty.call(RANGE_COLUMN_SUFFIX, range);
}

interface GroupAttendanceRow {
  COMMITTEE_ID: string | null;
  COMMITTEE_NAME: string | null;
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  GROUP_TYPE_LABEL: string | null;
  LAST_MET_DATE: Date | string | null;
  TOTAL_RECORDS: number | null;
  DORMANT_GROUPS: number | null;
  IS_PAGE_ROW: boolean | null;
  [periodColumn: string]: unknown;
}

/** Identifies one read for the shared error path: what was queried, and how it is reported. */
interface ReadContext {
  view: string;
  operation: string;
  clientMessage: string;
}

/** Identifies one capped read: where it cuts, and the two log lines it writes. */
interface CapContext {
  cap: number;
  operation: string;
  subject: string;
  noun: string;
  foundationSlug: string;
}

interface OrgParticipationRow {
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  MEMBERSHIP_TIER: string | null;
  IS_MEMBER: boolean | null;
  LAST_ENGAGED_DATE: Date | string | null;
  DAYS_SINCE_LAST_ENGAGED: number | null;
  IS_LAPSED_180D: boolean | null;
  SCOPE_ORGS_COUNT: number | null;
  SCOPE_LAPSED_ORGS_COUNT: number | null;
  [periodColumn: string]: unknown;
}

interface NonMemberParticipationRow {
  ACCOUNT_ID: string | null;
  ACCOUNT_NAME: string | null;
  MEMBERSHIP_STATUS: string | null;
  SCOPE_ORGS_COUNT: number | null;
  [periodColumn: string]: unknown;
}

interface RepresentativesRow {
  REP_KEY: string | null;
  PERSON_DISPLAY_NAME: string | null;
  ACCOUNT_NAME: string | null;
  COMMITTEE_NAME: string | null;
  LAST_ATTENDED_DATE: Date | string | null;
  [periodColumn: string]: unknown;
}

interface MeetingParticipationRow {
  MEETING_TYPE_LEVEL: string | null;
  MEETING_TYPE_GROUP: string | null;
  MEETING_TYPE_LABEL: string | null;
  TOTAL_GROUPS_COUNT: number | null;
  [periodColumn: string]: unknown;
}

export class HealthMetricsEngagementService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * One page of Group attendance. The view precomputes `SORT_RANK_<period>` (dormant first, then
   * ascending attendance), so the product's ranking is applied in SQL and survives pagination —
   * sorting a single page client-side would rank only that page.
   */
  public async getGroupAttendance(req: Request, query: HealthMetricsEngagementGroupQuery): Promise<HealthMetricsEngagementGroupAttendance> {
    if (!isSupportedEngagementRange(query.range)) {
      return HEALTH_METRICS_ENGAGEMENT_GROUP_ATTENDANCE_DEFAULT;
    }

    const suffix = RANGE_COLUMN_SUFFIX[query.range];

    const binds: Bind[] = [query.foundationSlug];

    let projectPredicate = '';
    if (query.projectSlug) {
      projectPredicate = 'AND project_slug = ?';
      binds.push(query.projectSlug);
    }

    // Each committee row belongs to exactly one project, so all-projects scope drops the predicate
    // rather than selecting a denormalized roll-up row — this view has no `is_all_projects`.
    let typePredicate = '';
    const typeLabels = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS[query.groupType];
    if (typeLabels?.length) {
      typePredicate = `AND group_type_label IN (${typeLabels.map(() => '?').join(', ')})`;
      binds.push(...typeLabels);
    }

    const size = clampInteger(query.size, 1, 100, 25);
    const offset = (clampInteger(query.page, 1, 10_000, 1) - 1) * size;
    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => periodSelectList(RANGE_COLUMN_SUFFIX[range])).join(',\n        ');

    // The totals are a separate aggregate joined onto the page, not a window over it: read as
    // `COUNT(*) OVER()` off the first row they vanish whenever the page is empty, so an out-of-range
    // page would report a foundation with zero groups and collapse the table into its empty state.
    const sql = `
      WITH scoped AS (
        SELECT *
        FROM ${GROUP_ATTENDANCE_VIEW}
        WHERE foundation_slug = ?
          ${projectPredicate}
          ${typePredicate}
      ),
      totals AS (
        SELECT
          COUNT(*) AS total_records,
          -- The view's own dormancy flag. Any further metric definition belongs in dbt, not here.
          SUM(CASE WHEN is_dormant_${suffix} THEN 1 ELSE 0 END) AS dormant_groups
        FROM scoped
      ),
      page AS (
        SELECT
          committee_id,
          committee_name,
          project_slug,
          project_name,
          last_met_date,
          group_type_label,
          ${periodColumns},
          sort_rank_${suffix} AS sort_rank,
          -- Distinguishes a real page row from the totals-only row the LEFT JOIN keeps below.
          -- committee_id cannot serve: it is nullable, so a null-id group would be dropped silently.
          TRUE AS is_page_row
        FROM scoped
        -- The trailing keys narrow the tie so paging rarely repeats or skips a same-named group.
        -- None of them is guaranteed unique — committee_id is nullable — so identical rows under a
        -- null id still tie; a hard guarantee needs a non-null row key on the view itself.
        -- Every key is nullable, and NULLS LAST pins their placement: the session's
        -- DEFAULT_NULL_ORDERING would otherwise let a pooled connection drift a null between pages.
        ORDER BY sort_rank_${suffix} ASC NULLS LAST, committee_name ASC NULLS LAST, committee_id ASC NULLS LAST, project_slug ASC NULLS LAST, group_type_label ASC NULLS LAST
        LIMIT ${size} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY page.sort_rank ASC NULLS LAST, page.committee_name ASC NULLS LAST, page.committee_id ASC NULLS LAST, page.project_slug ASC NULLS LAST, page.group_type_label ASC NULLS LAST
    `;

    const result = await this.executeRead<GroupAttendanceRow>(req, sql, binds, {
      view: GROUP_ATTENDANCE_VIEW,
      operation: 'get_engagement_group_attendance',
      clientMessage: 'Group attendance is unavailable right now.',
    });

    logger.debug(req, 'get_engagement_group_attendance', 'Fetched group attendance page', {
      foundation_slug: query.foundationSlug,
      project_slug: query.projectSlug,
      group_type: query.groupType,
      range: query.range,
      row_count: result.rows.length,
    });

    const first = result.rows[0];
    // A page past the end still returns one row — the totals, with every page column null.
    const pageRows = result.rows.filter((row) => row.IS_PAGE_ROW === true);

    return {
      rows: pageRows.map(mapGroupRow),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      counts: {
        groups: Number(first?.TOTAL_RECORDS ?? 0),
        dormantGroups: Number(first?.DORMANT_GROUPS ?? 0),
      },
    };
  }

  /**
   * The hero's roll-up and the meeting-type table in one read. The view carries both as rows of the
   * same shape, distinguished by `meeting_type_level`, so splitting them client-side costs nothing
   * and a second round trip would only re-read the same grain.
   */
  public async getMeetingParticipation(req: Request, query: HealthMetricsEngagementParticipationQuery): Promise<HealthMetricsEngagementMeetingParticipation> {
    if (!isSupportedEngagementRange(query.range)) {
      return HEALTH_METRICS_ENGAGEMENT_MEETING_PARTICIPATION_DEFAULT;
    }

    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => participationSelectList(RANGE_COLUMN_SUFFIX[range])).join(',\n        ');
    const levels = HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_LEVELS;

    // The project selector is visual-only today, so every read is the all-projects roll-up row the
    // view denormalizes — summing the per-project rows would double-count shared meetings.
    const sql = `
      SELECT
        meeting_type_level,
        meeting_type_group,
        meeting_type_label,
        total_groups_count,
        ${periodColumns},
        attendance_pct_prev_ytd,
        meetings_held_count_prev_ytd
      FROM ${MEETING_PARTICIPATION_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
        AND meeting_type_level IN (${levels.map(() => '?').join(', ')})
    `;

    const result = await this.executeRead<MeetingParticipationRow>(req, sql, [query.foundationSlug, ...levels], {
      view: MEETING_PARTICIPATION_VIEW,
      operation: 'get_engagement_meeting_participation',
      clientMessage: 'Meeting participation is unavailable right now.',
    });

    logger.debug(req, 'get_engagement_meeting_participation', 'Fetched meeting participation', {
      foundation_slug: query.foundationSlug,
      range: query.range,
      row_count: result.rows.length,
    });

    const total = result.rows.find((row) => row.MEETING_TYPE_LEVEL === 'all');
    const groups = result.rows.filter((row) => row.MEETING_TYPE_LEVEL === 'group');

    return {
      total: total ? mapParticipationRow(total) : null,
      rows: groups.map(mapParticipationRow).sort((a, b) => participationOrder(a.group) - participationOrder(b.group)),
    };
  }

  /**
   * Every organization in one read, with all four periods on each row: search, the lapsed cut and
   * the period pill all resolve client-side, so none of them costs a request.
   */
  public async getOrgParticipation(req: Request, query: HealthMetricsEngagementOrgQuery): Promise<HealthMetricsEngagementOrgParticipation> {
    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => orgSelectList(RANGE_COLUMN_SUFFIX[range])).join(',\n        ');
    // A capped read has to keep the ranked head, so the cut runs on the best rank across the
    // periods; the sentinel parks an org the view left unranked behind every ranked one.
    const bestSortRank = `LEAST(${HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => `IFNULL(sort_rank_${RANGE_COLUMN_SUFFIX[range]}, 2147483647)`).join(', ')})`;

    // The caption counts are denormalized onto every row and cover the whole scope, so they are
    // read off a row rather than counted here — a `COUNT(*)` would only ever match the row count.
    const sql = `
      SELECT
        account_id,
        account_name,
        membership_tier,
        is_member,
        last_engaged_date,
        days_since_last_engaged,
        is_lapsed_180d,
        scope_orgs_count,
        scope_lapsed_orgs_count,
        ${periodColumns}
      FROM ${ORG_PARTICIPATION_VIEW}
      WHERE foundation_slug = ?
        AND is_all_projects = TRUE
      ORDER BY ${bestSortRank} ASC, account_name ASC NULLS LAST, account_id ASC NULLS LAST
      LIMIT ${HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP + 1}
    `;

    const result = await this.executeRead<OrgParticipationRow>(req, sql, [query.foundationSlug], {
      view: ORG_PARTICIPATION_VIEW,
      operation: 'get_engagement_org_participation',
      clientMessage: 'Organization participation is unavailable right now.',
    });

    const rows = this.capRows(req, result.rows, {
      cap: HEALTH_METRICS_ENGAGEMENT_ORG_ROW_CAP,
      operation: 'get_engagement_org_participation',
      subject: 'organization participation',
      noun: 'Organization',
      foundationSlug: query.foundationSlug,
    });

    const first = rows[0];
    if (!first) return HEALTH_METRICS_ENGAGEMENT_ORG_PARTICIPATION_DEFAULT;

    return {
      rows: rows.map(mapOrgRow),
      counts: mapOrgCounts(first),
    };
  }

  /**
   * Every non-member organization in one read, with all four periods on each row — this view has no
   * project key, so the section is foundation-scoped and the period pill resolves client-side.
   */
  public async getNonMemberParticipation(req: Request, query: HealthMetricsEngagementNonMemberQuery): Promise<HealthMetricsEngagementNonMemberParticipation> {
    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => nonMemberSelectList(RANGE_COLUMN_SUFFIX[range])).join(',\n        ');
    // A capped read has to keep the ranked head, so the cut runs on the best rank across the
    // periods; the sentinel parks an org the view left unranked behind every ranked one.
    const bestSortRank = `LEAST(${HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => `IFNULL(sort_rank_${RANGE_COLUMN_SUFFIX[range]}, 2147483647)`).join(', ')})`;

    // `scope_orgs_count` is denormalized onto every row and covers the whole scope, so it is read
    // off a row rather than counted here — a `COUNT(*)` would only ever match the row count.
    const sql = `
      SELECT
        account_id,
        account_name,
        membership_status,
        scope_orgs_count,
        ${periodColumns}
      FROM ${NON_MEMBER_PARTICIPATION_VIEW}
      WHERE foundation_slug = ?
      ORDER BY ${bestSortRank} ASC, account_name ASC NULLS LAST, account_id ASC NULLS LAST
      LIMIT ${HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_ROW_CAP + 1}
    `;

    const result = await this.executeRead<NonMemberParticipationRow>(req, sql, [query.foundationSlug], {
      view: NON_MEMBER_PARTICIPATION_VIEW,
      operation: 'get_engagement_non_member_participation',
      clientMessage: 'Non-member participation is unavailable right now.',
    });

    const rows = this.capRows(req, result.rows, {
      cap: HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_ROW_CAP,
      operation: 'get_engagement_non_member_participation',
      subject: 'non-member participation',
      noun: 'Non-member',
      foundationSlug: query.foundationSlug,
    });

    const first = rows[0];
    if (!first) return HEALTH_METRICS_ENGAGEMENT_NON_MEMBER_PARTICIPATION_DEFAULT;

    return {
      rows: rows.map(mapNonMemberRow),
      counts: mapNonMemberCounts(first),
    };
  }

  /**
   * Every representative in one read, with all four periods on each row. The view publishes
   * project-grain rows and its own per-period flags; the read takes both as published rather than
   * regrouping, because re-deriving them here would restate metrics dbt already owns.
   */
  public async getRepresentatives(req: Request, query: HealthMetricsEngagementRepQuery): Promise<HealthMetricsEngagementRepresentatives> {
    const periodColumns = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => repSelectList(RANGE_COLUMN_SUFFIX[range])).join(',\n        ');

    // Caption counts are deduped to (person, committee) upstream while these rows are per project,
    // so a rep on one committee under two projects is two rows the caption counts once.
    const sql = `
      SELECT
        _key AS rep_key,
        person_display_name,
        account_name,
        committee_name,
        last_attended_date,
        ${periodColumns}
      FROM ${REPRESENTATIVES_VIEW}
      WHERE foundation_slug = ?
      ORDER BY last_attended_date ASC NULLS FIRST, person_display_name ASC NULLS LAST, committee_name ASC NULLS LAST, rep_key ASC
      LIMIT ${HEALTH_METRICS_ENGAGEMENT_REP_ROW_CAP + 1}
    `;

    const result = await this.executeRead<RepresentativesRow>(req, sql, [query.foundationSlug], {
      view: REPRESENTATIVES_VIEW,
      operation: 'get_engagement_representatives',
      clientMessage: 'Representatives are unavailable right now.',
    });

    const rows = this.capRows(req, result.rows, {
      cap: HEALTH_METRICS_ENGAGEMENT_REP_ROW_CAP,
      operation: 'get_engagement_representatives',
      subject: 'representatives',
      noun: 'Representative',
      foundationSlug: query.foundationSlug,
    });

    const first = rows[0];
    if (!first) return HEALTH_METRICS_ENGAGEMENT_REPRESENTATIVES_DEFAULT;

    return {
      rows: rows.map(mapRepRow),
      counts: mapRepCounts(first),
    };
  }

  /** One cap rule for every engagement read, so a new capped section cannot log or cut differently. */
  private capRows<T>(req: Request, rows: T[], context: CapContext): T[] {
    // Reading one past the cap is what separates a scope of exactly the cap from a truncated one.
    const truncated = rows.length > context.cap;
    const capped = truncated ? rows.slice(0, context.cap) : rows;

    logger.debug(req, context.operation, `Fetched ${context.subject}`, {
      foundation_slug: context.foundationSlug,
      row_count: capped.length,
    });

    // Truncating leaves the table short of the caption's own count, so say so out loud.
    if (truncated) {
      logger.warning(req, context.operation, `${context.noun} rows hit the read cap`, {
        foundation_slug: context.foundationSlug,
        row_cap: context.cap,
      });
    }

    return capped;
  }

  /**
   * `expectMissingObject` still rejects. It records a *success* against the shared circuit breaker
   * instead of a failure, so a missing view or absent GRANT here cannot open the breaker every
   * other Snowflake dashboard depends on. The 500 reaches `apiErrorHandler` either way.
   *
   * The SDK names the fully-qualified view in its message, so a generic sentence is put in
   * `clientMessage` — the raw text stays on `message`, which is what the log records. The provider
   * `code` and `service` are dropped for the same reason.
   */
  private async executeRead<T>(req: Request, sql: string, binds: Bind[], context: ReadContext): Promise<SnowflakeQueryResult<T>> {
    const startTime = Date.now();
    try {
      return await this.snowflakeService.execute<T>(sql, binds, { expectMissingObject: true });
    } catch (error) {
      // The breaker treats this as expected and logs it at `warning`, but the same message covers a
      // revoked GRANT — an access-control event that has to be alertable on its own.
      if (SnowflakeService.isMissingObjectError(error)) {
        // Its own operation key: logging under the controller's would delete that entry from the
        // request's operation stack, leaving `apiErrorHandler` to invent a path-derived one.
        logger.error(req, `${context.operation}_missing_object`, startTime, error, {
          snowflake_expected_missing_object: context.view,
        });
      }

      // SnowflakeService's own generic sentence is replaced by this widget's; any other client message
      // was chosen by the site that threw it and passes through untouched.
      const hasSiteClientMessage =
        error instanceof BaseApiError && error.clientMessage !== undefined && error.clientMessage !== SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE;
      if (!(error instanceof BaseApiError) || hasSiteClientMessage) throw error;

      throw new MicroserviceError(error.message, error.statusCode, getCodeForStatus(error.statusCode), {
        operation: error.operation,
        clientMessage: context.clientMessage,
        originalError: error,
      });
    }
  }
}

function periodSelectList(suffix: string): string {
  return ['meetings_count', 'invited_count', 'attended_count', 'attendance_pct', 'is_dormant'].map((column) => `${column}_${suffix}`).join(', ');
}

function mapGroupRow(row: GroupAttendanceRow): HealthMetricsEngagementGroupRow {
  return {
    committeeId: row.COMMITTEE_ID ?? '',
    committeeName: row.COMMITTEE_NAME ?? '',
    projectSlug: row.PROJECT_SLUG,
    projectName: row.PROJECT_NAME,
    groupTypeLabel: row.GROUP_TYPE_LABEL,
    lastMetDate: toIsoDate(row.LAST_MET_DATE),
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapGroupPeriod(row, range)),
  };
}

function mapGroupPeriod(row: GroupAttendanceRow, range: SupportedEngagementRange): HealthMetricsEngagementGroupPeriod {
  const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();
  const attendance = row[`ATTENDANCE_PCT_${suffix}`];

  return {
    range,
    meetingsHeld: Number(row[`MEETINGS_COUNT_${suffix}`] ?? 0),
    invitedCount: Number(row[`INVITED_COUNT_${suffix}`] ?? 0),
    attendedCount: Number(row[`ATTENDED_COUNT_${suffix}`] ?? 0),
    // A null share means nobody was invited at all, which the table renders as an em dash — keep it
    // distinct from a real 0%.
    attendancePct: attendance === null || attendance === undefined ? null : Number(attendance),
    dormant: row[`IS_DORMANT_${suffix}`] === true,
  };
}

function orgSelectList(suffix: string): string {
  return [
    'scope_meetings_held_count',
    'meetings_org_total_count',
    'meetings_invited_count',
    'meetings_attended_count',
    'attendance_pct',
    'avg_reps_per_meeting',
    'sort_rank',
  ]
    .map((column) => `${column}_${suffix}`)
    .join(', ');
}

function mapOrgRow(row: OrgParticipationRow): HealthMetricsEngagementOrgRow {
  return {
    accountId: row.ACCOUNT_ID ?? '',
    accountName: row.ACCOUNT_NAME ?? '',
    // Rendered as the view reports it: this view is not member-only, so `Non-Member` is a real tier
    // here and filtering it out would desync the caption's own denormalized org count.
    membershipTier: row.MEMBERSHIP_TIER ?? '',
    isMember: row.IS_MEMBER === true,
    lastEngagedDate: toIsoDate(row.LAST_ENGAGED_DATE),
    daysSinceLastEngaged: toNullableNumber(row.DAYS_SINCE_LAST_ENGAGED),
    lapsed: row.IS_LAPSED_180D === true,
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapOrgPeriod(row, range)),
  };
}

function mapOrgPeriod(row: OrgParticipationRow, range: SupportedEngagementRange): HealthMetricsEngagementOrgPeriod {
  const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();

  return {
    range,
    meetingsHeld: Number(row[`SCOPE_MEETINGS_HELD_COUNT_${suffix}`] ?? 0),
    meetingsTotal: Number(row[`MEETINGS_ORG_TOTAL_COUNT_${suffix}`] ?? 0),
    invitedCount: Number(row[`MEETINGS_INVITED_COUNT_${suffix}`] ?? 0),
    attendedCount: Number(row[`MEETINGS_ATTENDED_COUNT_${suffix}`] ?? 0),
    // Null means no meeting concerned this org at all, which renders as an em dash — keep it
    // distinct from a real 0%.
    attendancePct: toNullableNumber(row[`ATTENDANCE_PCT_${suffix}`]),
    avgReps: toNullableNumber(row[`AVG_REPS_PER_MEETING_${suffix}`]),
    sortRank: toNullableNumber(row[`SORT_RANK_${suffix}`]),
  };
}

/**
 * Both counts are period-agnostic and identical on every row, so any row answers for the scope.
 * A null count over rows that exist is unmeasured — reporting 0 there would caption a full table.
 */
function mapOrgCounts(row: OrgParticipationRow): HealthMetricsEngagementOrgCounts | null {
  const orgs = toNullableNumber(row.SCOPE_ORGS_COUNT);
  const lapsedOrgs = toNullableNumber(row.SCOPE_LAPSED_ORGS_COUNT);
  if (orgs === null || lapsedOrgs === null) return null;

  return { orgs, lapsedOrgs };
}

function nonMemberSelectList(suffix: string): string {
  return ['meetings_attended_count', 'distinct_people_count', 'sort_rank'].map((column) => `${column}_${suffix}`).join(', ');
}

function mapNonMemberRow(row: NonMemberParticipationRow): HealthMetricsEngagementNonMemberRow {
  return {
    accountId: row.ACCOUNT_ID ?? '',
    accountName: row.ACCOUNT_NAME ?? '',
    // Rendered as the view reports it; the organization-matching gap the footnote warns about is a
    // data problem upstream, not something to paper over by rewriting the status here.
    membershipStatus: row.MEMBERSHIP_STATUS ?? '',
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapNonMemberPeriod(row, range)),
  };
}

function mapNonMemberPeriod(row: NonMemberParticipationRow, range: SupportedEngagementRange): HealthMetricsEngagementNonMemberPeriod {
  const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();

  return {
    range,
    meetingsAttended: Number(row[`MEETINGS_ATTENDED_COUNT_${suffix}`] ?? 0),
    distinctPeople: Number(row[`DISTINCT_PEOPLE_COUNT_${suffix}`] ?? 0),
    sortRank: toNullableNumber(row[`SORT_RANK_${suffix}`]),
  };
}

/**
 * The count is period-agnostic and identical on every row, so any row answers for the scope. A null
 * count over rows that exist is unmeasured — reporting 0 there would caption a full table.
 */
function mapNonMemberCounts(row: NonMemberParticipationRow): HealthMetricsEngagementNonMemberCounts | null {
  const orgs = toNullableNumber(row.SCOPE_ORGS_COUNT);
  if (orgs === null) return null;

  return { orgs };
}

function participationSelectList(suffix: string): string {
  return ['meetings_held_count', 'invited_count', 'attended_count', 'attendance_pct', 'active_groups_count', 'never_attended_count']
    .map((column) => `${column}_${suffix}`)
    .join(', ');
}

function mapParticipationRow(row: MeetingParticipationRow): HealthMetricsEngagementParticipationRow {
  const group = row.MEETING_TYPE_GROUP;

  return {
    level: row.MEETING_TYPE_LEVEL === 'all' ? 'all' : 'group',
    group,
    label: row.MEETING_TYPE_LABEL ?? group ?? '',
    totalGroups: Number(row.TOTAL_GROUPS_COUNT ?? 0),
    governance: group !== null && HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_GROUPS.includes(group),
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapParticipationPeriod(row, range)),
  };
}

function mapParticipationPeriod(row: MeetingParticipationRow, range: SupportedEngagementRange): HealthMetricsEngagementParticipationPeriod {
  const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();
  const priorSuffix = RANGE_PRIOR_COLUMN_SUFFIX[range]?.toUpperCase();
  const attendance = toNullableNumber(row[`ATTENDANCE_PCT_${suffix}`]);
  const meetingsHeld = Number(row[`MEETINGS_HELD_COUNT_${suffix}`] ?? 0);
  const priorAttendance = priorSuffix ? toNullableNumber(row[`ATTENDANCE_PCT_${priorSuffix}`]) : null;
  const priorMeetings = priorSuffix ? toNullableNumber(row[`MEETINGS_HELD_COUNT_${priorSuffix}`]) : null;

  return {
    range,
    meetingsHeld,
    invitedCount: Number(row[`INVITED_COUNT_${suffix}`] ?? 0),
    attendedCount: Number(row[`ATTENDED_COUNT_${suffix}`] ?? 0),
    // A null share means nobody was invited at all, which renders as an em dash — keep it distinct
    // from a real 0%.
    attendancePct: attendance,
    activeGroups: Number(row[`ACTIVE_GROUPS_COUNT_${suffix}`] ?? 0),
    neverAttended: Number(row[`NEVER_ATTENDED_COUNT_${suffix}`] ?? 0),
    // Derived rather than read from the view's `*_CHANGE_*` columns: those cover YTD only, and
    // deriving keeps each delta in the same unit as the value it came from.
    attendanceChangePp: attendance === null || priorAttendance === null ? null : attendance - priorAttendance,
    meetingsChangePct: priorMeetings === null || priorMeetings === 0 ? null : (meetingsHeld - priorMeetings) / priorMeetings,
  };
}

/** Unknown groups sort after every known one rather than being dropped from the table. */
function participationOrder(group: string | null): number {
  const index = group === null ? -1 : HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER.indexOf(group);
  return index === -1 ? HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER.length : index;
}

/**
 * One period's columns as the view publishes them. The `ALL_PROJECTS` caption columns are
 * denormalized onto every row, so the alias drops the scope from the name the mapper reads.
 */
function repSelectList(suffix: string): string {
  return [
    `meetings_invited_count_${suffix}`,
    `meetings_attended_count_${suffix}`,
    `has_never_attended_${suffix}`,
    `is_lapsed_${suffix}`,
    `scope_reps_count_all_projects_${suffix} AS scope_reps_count_${suffix}`,
    `scope_never_attended_reps_count_all_projects_${suffix} AS scope_never_attended_reps_count_${suffix}`,
  ].join(', ');
}

function mapRepRow(row: RepresentativesRow): HealthMetricsEngagementRepRow {
  return {
    key: row.REP_KEY ?? '',
    personName: row.PERSON_DISPLAY_NAME ?? '',
    accountName: row.ACCOUNT_NAME ?? '',
    committeeName: row.COMMITTEE_NAME ?? '',
    lastAttendedDate: toIsoDate(row.LAST_ATTENDED_DATE),
    periods: HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => mapRepPeriod(row, range)),
  };
}

function mapRepPeriod(row: RepresentativesRow, range: SupportedEngagementRange): HealthMetricsEngagementRepPeriod {
  const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();

  return {
    range,
    meetingsInvited: Number(row[`MEETINGS_INVITED_COUNT_${suffix}`] ?? 0),
    meetingsAttended: Number(row[`MEETINGS_ATTENDED_COUNT_${suffix}`] ?? 0),
    neverAttended: row[`HAS_NEVER_ATTENDED_${suffix}`] === true,
    lapsed: row[`IS_LAPSED_${suffix}`] === true,
  };
}

/**
 * Unlike the org and non-member captions, this view counts its scope per period, so every period
 * ships its own pair. A null anywhere is unmeasured — reporting 0 there would caption a full table.
 */
function mapRepCounts(row: RepresentativesRow): HealthMetricsEngagementRepPeriodCounts[] | null {
  const counts = HEALTH_METRICS_ENGAGEMENT_RANGES.map((range) => {
    const suffix = RANGE_COLUMN_SUFFIX[range].toUpperCase();

    return {
      range,
      reps: toNullableNumber(row[`SCOPE_REPS_COUNT_${suffix}`]),
      neverAttendedReps: toNullableNumber(row[`SCOPE_NEVER_ATTENDED_REPS_COUNT_${suffix}`]),
    };
  });

  if (counts.some((count) => count.reps === null || count.neverAttendedReps === null)) return null;

  return counts.map((count) => ({ range: count.range, reps: count.reps ?? 0, neverAttendedReps: count.neverAttendedReps ?? 0 }));
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;

  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
