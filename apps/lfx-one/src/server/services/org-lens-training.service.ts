// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER,
  EMPTY_ORG_TRAINING_GROUPS_RESPONSE,
  MAX_ORG_TRAINING_GROUP_EMPLOYEES,
  ORG_TRAINING_FILTER_KEYS,
  ORG_TRAINING_GROUP_NONE_LABELS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  OrgTrainingGroupEmployee,
  OrgDropdownOption,
  OrgLensTimeRange,
  OrgTrainingFilterOptions,
  OrgTrainingFilters,
  OrgTrainingGroupEmployeesParams,
  OrgTrainingGroupEmployeesResponse,
  OrgTrainingGroupRow,
  OrgTrainingGroupsParams,
  OrgTrainingGroupsResponse,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
} from '@lfx-one/shared/interfaces';
import {
  hasOrgTrainingFilter,
  isOrgLensTimeRange,
  normalizeOrgTrainingFilterValue,
  orgTrainingCompletionRatePct,
  orgTrainingFiltersSignature,
} from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { ServiceValidationError } from '../errors';
import { toIsoTimestamp } from '../helpers/date-format.helper';
import type { OrgLensReadQualification } from '../helpers/org-lens-read-access.helper';
import {
  buildOrgTrainingPairsCte,
  ORG_TRAINING_GROUP_SQL,
  orgTrainingParamSignature,
  orgTrainingRangePredicate,
  orgTrainingStatusPredicate,
  orgTrainingTabPredicate,
} from '../helpers/org-training-pairs.sql';
import { isWellFormedOrgTrainingFilterValue } from '../helpers/org-training-filter.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

interface OrgTrainingPairStatsRow {
  PEOPLE: number;
  COURSES_TAKEN: number;
  CERTIFICATIONS: number;
  CERTIFIED_PEOPLE: number;
  TRAININGS_COMPLETED: number;
  COURSES_IN_PROGRESS: number;
  PEOPLE_IN_TRAINING: number;
}

interface OrgTrainingCountRow {
  PEOPLE: number;
}

interface OrgTrainingAsOfRow {
  AS_OF: Date | string | null;
}

interface OrgTrainingRosterMembersRow {
  ROSTER_MEMBERS: number;
  AS_OF_TS: Date | string | null;
}

interface OrgTrainingOptionRow {
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  COURSE_NAME: string | null;
  COURSE_LEVEL: string | null;
  COURSE_FORMAT: string | null;
}

interface OrgTrainingGroupSqlRow {
  GROUP_KEY: string | null;
  GROUP_LABEL: string | null;
  PEOPLE: number;
  COURSES_TAKEN: number;
  COMPLETED: number;
  IN_PROGRESS: number;
  LEVEL: string | null;
  FOUNDATION: string | null;
}

interface OrgTrainingGroupsRaw {
  rows: OrgTrainingGroupRow[];
  totals: OrgTrainingGroupsResponse['totals'];
}

interface OrgTrainingGroupEmployeesRaw {
  label: string;
  total: number;
  data: OrgTrainingGroupEmployee[];
}

interface OrgRosterEmployeeRow {
  CONTACT_ID: string;
  NAME: string | null;
  JOB_TITLE: string | null;
}

interface OrgTrainingGroupCountRow {
  TOTAL: number;
  GROUP_LABEL: string | null;
}

/** The distinct values the org's people-list training rows carry for each filter, as a request value is compared (trimmed, capped). */
type OrgTrainingKnownFilterValues = Record<keyof OrgTrainingFilters, string[]>;

interface OrgTrainingKnownValueRow {
  FILTER_KEY: keyof OrgTrainingFilters;
  FILTER_VALUE: string | null;
}

/**
 * Learner numbers of the shared Training / Trainees view: one pairs definition (see org-training-pairs.sql) behind stats, options, groups and drawers.
 *
 * Caching follows the Groups page (`OrgLensGroupsService.getGroups`): the shared Valkey entries are served only to a
 * caller whose access resolved as `org-grant` on this org. A caller the roster does not list and the authorizer admitted
 * (`auditor-entitlement`) is resolved directly and nothing is read from or stored in the shared cache, so upstream stays
 * the deciding authority for that request.
 *
 * Request filter values are compared with the org's own known values before any stats/groups/drawer cache key or SQL is built:
 * a value the org never carries is answered with the zero payload (never a 400, never a cache key), which keeps the key space
 * bounded by the org's own attribute values. Only a malformed value is a 400, and the controller raises it.
 */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  /** The one stats function: both pages and the Overview tile call it, so equal queries always give equal numbers. */
  public async getTrainingStats(accountId: string, query: OrgTrainingStatsQuery, qualification: OrgLensReadQualification): Promise<OrgTrainingStats> {
    if (!(await this.carriesOnlyKnownFilters(accountId, query, qualification))) {
      // Zeros for every range metric; the roster is live and unfiltered, and the as-of is the build time of the same rows, so both come from the unfiltered stats entry.
      const unfiltered = await this.cached(
        qualification,
        accountId,
        `training-stats:v6:${orgTrainingFiltersSignature({ range: query.range, foundation: null, project: null, course: null, level: null, format: null })}`,
        () => this.fetchTrainingStats(accountId, { range: query.range, foundation: null, project: null, course: null, level: null, format: null }),
        isTrainingStats
      );
      return emptyTrainingStats(query.range, unfiltered.asOf, unfiltered.rosterMembers, unfiltered.rosterMembersAsOf);
    }
    return this.cached(
      qualification,
      accountId,
      `training-stats:v6:${orgTrainingFiltersSignature(query)}`,
      () => this.fetchTrainingStats(accountId, query),
      isTrainingStats
    );
  }

  /** Dropdown options: the people-list pairs in range, unfiltered. */
  public async getFilterOptions(accountId: string, range: OrgLensTimeRange, qualification: OrgLensReadQualification): Promise<OrgTrainingFilterOptions> {
    return this.cached(
      qualification,
      accountId,
      `training-filter-options:v1:${range}`,
      async () => {
        const { cte, binds } = buildOrgTrainingPairsCte(accountId, { range, foundation: null, project: null, course: null, level: null, format: null });
        const sql = `
          WITH ${cte}
          SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME, PROJECT_ID, PROJECT_NAME, COURSE_NAME, COURSE_LEVEL, COURSE_FORMAT
          FROM f
        `;
        const result = await this.snowflakeService.execute<OrgTrainingOptionRow>(sql, binds);
        return buildFilterOptions(result.rows);
      },
      isFilterOptions
    );
  }

  /** Group-by table page of one tab. The full group set is cached; search, sort and paging run in memory. */
  public async getGroups(
    req: Request,
    accountId: string,
    query: OrgTrainingStatsQuery,
    params: OrgTrainingGroupsParams,
    qualification: OrgLensReadQualification
  ): Promise<OrgTrainingGroupsResponse> {
    const { groupBy, tab, searchQuery } = params;
    const sortField = params.sortField ?? DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD;
    const sortOrder = params.sortOrder ?? DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER;
    const pageSize = params.pageSize ?? DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE;
    const offset = params.offset ?? 0;

    logger.debug(req, 'get_org_training_groups', 'Reading org training groups', {
      account_id: accountId,
      group_by: groupBy,
      tab,
      has_search: !!searchQuery,
      sort_field: sortField,
      sort_order: sortOrder,
      page_size: pageSize,
      offset,
    });

    if (!(await this.carriesOnlyKnownFilters(accountId, query, qualification))) {
      return { data: [...EMPTY_ORG_TRAINING_GROUPS_RESPONSE.data], total: 0, totals: { ...EMPTY_ORG_TRAINING_GROUPS_RESPONSE.totals } };
    }
    const raw = await this.getGroupsRaw(accountId, query, groupBy, tab, qualification);

    const needle = searchQuery?.trim().toLowerCase();
    const matching = needle ? raw.rows.filter((row) => row.label.toLowerCase().includes(needle)) : [...raw.rows];
    const direction = sortOrder === 'ASC' ? 1 : -1;
    matching.sort((a, b) => {
      const primary = sortField === 'label' ? a.label.localeCompare(b.label, 'en-US') : a[sortField] - b[sortField];
      return primary !== 0 ? primary * direction : a.label.localeCompare(b.label, 'en-US');
    });

    return { data: matching.slice(offset, offset + pageSize), total: matching.length, totals: raw.totals };
  }

  /** Drill-down of one group cell: `total` is the pair count; `data` lists current employees only. */
  public async getGroupEmployees(
    req: Request,
    accountId: string,
    query: OrgTrainingStatsQuery,
    params: OrgTrainingGroupEmployeesParams,
    qualification: OrgLensReadQualification
  ): Promise<OrgTrainingGroupEmployeesResponse> {
    const { groupBy, groupValue, tab, status } = params;

    logger.debug(req, 'get_org_training_group_employees', 'Reading org training group employees', {
      account_id: accountId,
      group_by: groupBy,
      tab,
      status,
    });

    // A filter value the org never carries answers an empty drawer, before any cache key or statement.
    if (!(await this.carriesOnlyKnownFilters(accountId, query, qualification))) {
      return { groupBy, groupValue, label: ORG_TRAINING_GROUP_NONE_LABELS[groupBy], tab, status, total: 0, data: [] };
    }
    // The cell must be a group of this table: an unknown value never reaches a cache key or SQL.
    const groups = await this.getGroupsRaw(accountId, query, groupBy, tab, qualification);
    if (!groups.rows.some((row) => row.key === groupValue)) {
      throw ServiceValidationError.forField('groupValue', 'groupValue is not a group of this table', { operation: 'get_org_training_group_employees' });
    }

    const raw = await this.cached(
      qualification,
      accountId,
      `training-group-employees:v1:${orgTrainingFiltersSignature(query)}:${groupBy}:${orgTrainingParamSignature([groupValue])}:${tab}:${status}`,
      () => this.fetchGroupEmployees(accountId, query, params),
      isGroupEmployeesRaw
    );

    return { groupBy, groupValue, label: raw.label || ORG_TRAINING_GROUP_NONE_LABELS[groupBy], tab, status, total: raw.total, data: raw.data };
  }

  /** Shared Valkey entry for an `org-grant` caller; any other caller resolves directly and stores nothing. */
  private cached<T>(
    qualification: OrgLensReadQualification,
    accountId: string,
    subResource: string,
    fetcher: () => Promise<T>,
    accept: (value: unknown) => boolean
  ): Promise<T> {
    return qualification === 'org-grant' ? withOrgCache(accountId, subResource, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS, fetcher, accept) : fetcher();
  }

  private getGroupsRaw(
    accountId: string,
    query: OrgTrainingStatsQuery,
    groupBy: OrgTrainingGroupsParams['groupBy'],
    tab: OrgTrainingGroupsParams['tab'],
    qualification: OrgLensReadQualification
  ): Promise<OrgTrainingGroupsRaw> {
    return this.cached(
      qualification,
      accountId,
      `training-groups:v1:${orgTrainingFiltersSignature(query)}:${groupBy}:${tab}`,
      () => this.fetchGroups(accountId, query, groupBy, tab),
      isGroupsRaw
    );
  }

  /**
   * Whether every filter the request sets names a value the org's people-list training rows carry. A value the org never
   * carries (another org's value kept across an org switch, a stale shared URL) is not an error: the callers answer it with
   * the zero payload before any stats/groups/drawer cache key or statement exists, which keeps that key space bounded by
   * the org's own values. The set is the DISTINCT raw row values over all time, not the options of a range or the resolved
   * pair attributes: a pair's attribute is the greatest value of its in-range rows, so a value that only some rows carry
   * (a `Beginner` row of a pair that resolves to `Intermediate` all-time) is a value the dropdown of a narrower range offers
   * and must be accepted. A value valid for the org with no rows in the selected range is served as zero data by the normal path.
   */
  private async carriesOnlyKnownFilters(accountId: string, query: OrgTrainingStatsQuery, qualification: OrgLensReadQualification): Promise<boolean> {
    const requested = ORG_TRAINING_FILTER_KEYS.filter((filter) => query[filter] !== null);
    if (requested.length === 0) return true;

    const known = await this.getKnownFilterValues(accountId, qualification);
    return requested.every((filter) => known[filter].includes(query[filter] as string));
  }

  /** The known-value set, bounded by the org's own attribute values; cached as its own entry for an `org-grant` caller only. */
  private getKnownFilterValues(accountId: string, qualification: OrgLensReadQualification): Promise<OrgTrainingKnownFilterValues> {
    return this.cached(
      qualification,
      accountId,
      'training-filter-known:v1',
      async () => {
        // rows_in_range of the all-time query: the exact row set every range's pairs are resolved from.
        const { cte, binds } = buildOrgTrainingPairsCte(accountId, { range: 'all', foundation: null, project: null, course: null, level: null, format: null });
        const sql = `
          WITH ${cte}
          SELECT 'foundation' AS FILTER_KEY, FOUNDATION_ID AS FILTER_VALUE FROM rows_in_range
          UNION
          SELECT 'project', PROJECT_ID FROM rows_in_range
          UNION
          SELECT 'course', COURSE_NAME FROM rows_in_range
          UNION
          SELECT 'level', COURSE_LEVEL FROM rows_in_range
          UNION
          SELECT 'format', COURSE_FORMAT FROM rows_in_range
        `;
        const result = await this.snowflakeService.execute<OrgTrainingKnownValueRow>(sql, binds);
        return buildKnownFilterValues(result.rows);
      },
      isKnownFilterValues
    );
  }

  private async fetchTrainingStats(accountId: string, query: OrgTrainingStatsQuery): Promise<OrgTrainingStats> {
    const { cte, binds } = buildOrgTrainingPairsCte(accountId, query);
    const pairsSql = `
      WITH ${cte}
      SELECT
        COUNT(DISTINCT PERSON_KEY)                                                                       AS PEOPLE,
        COUNT(*)                                                                                         AS COURSES_TAKEN,
        COUNT_IF(IS_CERTIFIED AND ${orgTrainingTabPredicate('certifications')})                          AS CERTIFICATIONS,
        COUNT(DISTINCT IFF(IS_CERTIFIED AND ${orgTrainingTabPredicate('certifications')}, PERSON_KEY, NULL)) AS CERTIFIED_PEOPLE,
        COUNT_IF(IS_CERTIFIED AND ${orgTrainingTabPredicate('trainings')})                               AS TRAININGS_COMPLETED,
        COUNT_IF(NOT IS_CERTIFIED)                                                                       AS COURSES_IN_PROGRESS,
        COUNT(DISTINCT IFF(NOT IS_CERTIFIED, PERSON_KEY, NULL))                                          AS PEOPLE_IN_TRAINING
      FROM f
    `;

    // Learners the warehouse attributes to the org outside its people list (lfx-self-serve#4287): counted only while no filter
    // is set, like their list, and null (not counted) otherwise; a key that also has people-list rows is that person.
    // They are never added to the people-list numbers: every other metric reads the people-list pairs `f`.
    const inRange = orgTrainingRangePredicate(query.range);
    const outsideSql = `
      SELECT COUNT(DISTINCT PERSON_KEY) AS PEOPLE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND NOT IS_ON_PEOPLE_LIST
        AND STATUS IN ('Enrolled', 'Certified')
        AND ACTIVITY_TS IS NOT NULL
        ${inRange}
        AND PERSON_KEY NOT IN (
          SELECT PERSON_KEY
          FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
          WHERE ACCOUNT_ID = ?
            AND IS_ON_PEOPLE_LIST
            AND STATUS IN ('Enrolled', 'Certified')
            AND ACTIVITY_TS IS NOT NULL
            ${inRange}
        )
    `;

    // One build time for every range of the account.
    const asOfSql = `
      SELECT MAX(DBT_RUN_AT) AS AS_OF
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
    `;

    // One row per account with an LF Education training client; none otherwise. Live: not windowed, not filtered.
    const rosterSql = `
      SELECT ROSTER_MEMBERS, AS_OF_TS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_ROSTER_MEMBERS
      WHERE ACCOUNT_ID = ?
    `;

    // Any filter leaves learners outside the people list uncounted (null), as their list is hidden then.
    const includeOutside = !hasOrgTrainingFilter(query);
    const [pairsResult, outsideResult, asOfResult, rosterResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingPairStatsRow>(pairsSql, binds),
      includeOutside
        ? this.snowflakeService.execute<OrgTrainingCountRow>(outsideSql, [accountId, accountId])
        : Promise.resolve({ rows: [] as OrgTrainingCountRow[] }),
      this.snowflakeService.execute<OrgTrainingAsOfRow>(asOfSql, [accountId]),
      this.snowflakeService.execute<OrgTrainingRosterMembersRow>(rosterSql, [accountId]),
    ]);

    const pairs = pairsResult.rows[0];
    const outside = outsideResult.rows[0]?.PEOPLE ?? 0;
    const roster = rosterResult.rows[0];
    const coursesTaken = pairs?.COURSES_TAKEN ?? 0;
    const certifications = pairs?.CERTIFICATIONS ?? 0;
    const trainingsCompleted = pairs?.TRAININGS_COMPLETED ?? 0;

    return {
      range: query.range,
      asOf: toIsoTimestamp(asOfResult.rows[0]?.AS_OF),
      // No row: the org has no LF Education training client, so there is no roster to count (not zero members).
      rosterMembers: roster ? roster.ROSTER_MEMBERS : null,
      rosterMembersAsOf: roster ? toIsoTimestamp(roster.AS_OF_TS) : null,
      peopleWithTrainingActivity: pairs?.PEOPLE ?? 0,
      learnersOutsidePeopleList: includeOutside ? outside : null,
      coursesTaken,
      certifications,
      certifiedPeople: pairs?.CERTIFIED_PEOPLE ?? 0,
      trainingsCompleted,
      completionRatePct: orgTrainingCompletionRatePct({ coursesTaken, certifications, trainingsCompleted }),
      coursesInProgress: pairs?.COURSES_IN_PROGRESS ?? 0,
      peopleInTraining: pairs?.PEOPLE_IN_TRAINING ?? 0,
    };
  }

  private async fetchGroups(
    accountId: string,
    query: OrgTrainingStatsQuery,
    groupBy: OrgTrainingGroupsParams['groupBy'],
    tab: OrgTrainingGroupsParams['tab']
  ): Promise<OrgTrainingGroupsRaw> {
    const { cte, binds } = buildOrgTrainingPairsCte(accountId, query);
    const group = ORG_TRAINING_GROUP_SQL[groupBy];
    const tabPredicate = orgTrainingTabPredicate(tab);

    const rowsSql = `
      WITH ${cte}
      SELECT
        ${group.key}                    AS GROUP_KEY,
        ${group.label}                  AS GROUP_LABEL,
        COUNT(DISTINCT PERSON_KEY)      AS PEOPLE,
        COUNT(*)                        AS COURSES_TAKEN,
        COUNT_IF(IS_CERTIFIED)          AS COMPLETED,
        COUNT_IF(NOT IS_CERTIFIED)      AS IN_PROGRESS,
        MAX(COURSE_LEVEL)               AS LEVEL,
        MAX(FOUNDATION_NAME)            AS FOUNDATION
      FROM f
      WHERE ${tabPredicate}
      GROUP BY ${group.key}
    `;
    // Over the whole tab set (people are distinct across groups), so the footer equals the stat tiles.
    const totalsSql = `
      WITH ${cte}
      SELECT
        COUNT(DISTINCT PERSON_KEY)      AS PEOPLE,
        COUNT(*)                        AS COURSES_TAKEN,
        COUNT_IF(IS_CERTIFIED)          AS COMPLETED,
        COUNT_IF(NOT IS_CERTIFIED)      AS IN_PROGRESS
      FROM f
      WHERE ${tabPredicate}
    `;

    const [rowsResult, totalsResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingGroupSqlRow>(rowsSql, binds),
      this.snowflakeService.execute<{ PEOPLE: number; COURSES_TAKEN: number; COMPLETED: number; IN_PROGRESS: number }>(totalsSql, binds),
    ]);

    const rows: OrgTrainingGroupRow[] = rowsResult.rows.map((row) => {
      const key = row.GROUP_KEY ?? '';
      return {
        key,
        label: key === '' ? ORG_TRAINING_GROUP_NONE_LABELS[groupBy] : (row.GROUP_LABEL ?? key),
        people: row.PEOPLE || 0,
        coursesTaken: row.COURSES_TAKEN || 0,
        completed: row.COMPLETED || 0,
        inProgress: row.IN_PROGRESS || 0,
        level: groupBy === 'course' ? (row.LEVEL ?? null) : null,
        foundation: groupBy === 'course' || groupBy === 'project' ? (row.FOUNDATION ?? null) : null,
        // ORG_PEOPLE_TRAINING carries no logo column.
        logoUrl: null,
      };
    });
    const totals = totalsResult.rows[0];

    return {
      rows,
      totals: {
        people: totals?.PEOPLE ?? 0,
        coursesTaken: totals?.COURSES_TAKEN ?? 0,
        completed: totals?.COMPLETED ?? 0,
        inProgress: totals?.IN_PROGRESS ?? 0,
      },
    };
  }

  private async fetchGroupEmployees(
    accountId: string,
    query: OrgTrainingStatsQuery,
    params: OrgTrainingGroupEmployeesParams
  ): Promise<OrgTrainingGroupEmployeesRaw> {
    const { groupBy, groupValue, tab, status } = params;
    const { cte, binds } = buildOrgTrainingPairsCte(accountId, query);
    const group = ORG_TRAINING_GROUP_SQL[groupBy];
    const where = `${group.key} = ? AND ${orgTrainingTabPredicate(tab)} AND ${orgTrainingStatusPredicate(status)}`;
    const cellBinds = [...binds, groupValue];

    const countSql = `
      WITH ${cte}
      SELECT COUNT(*) AS TOTAL, ${group.label} AS GROUP_LABEL
      FROM f
      WHERE ${where}
    `;
    // Identity from the all-time, all-projects ORG_PEOPLE_ALL_RANGES row of each current employee (IS_FORMER = FALSE), the
    // read People › Trainees uses, so the roster matches the pair count for any range. ORG_PEOPLE_ALL would drop members
    // whose only training is older than its 12-month engagement gate or reaches them through a merged learner. That row is
    // unique per (account, person); one row per person however many pairs. No other training query joins ORG_PEOPLE_ALL:
    // stats, options and groups read ORG_PEOPLE_TRAINING alone.
    const namesSql = `
      WITH ${cte}
      SELECT
        p.PERSON_KEY AS CONTACT_ID,
        p.NAME       AS NAME,
        p.TITLE      AS JOB_TITLE
      FROM f
      INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES p
        ON p.ACCOUNT_ID = ?
        AND p.TIME_RANGE = 'all'
        AND p.PROJECT_SCOPE = 'all'
        AND p.IS_FORMER = FALSE
        AND p.PERSON_KEY = f.PERSON_KEY
      WHERE ${where}
      GROUP BY p.PERSON_KEY, p.NAME, p.TITLE
      ORDER BY p.NAME ASC NULLS LAST
      LIMIT ${MAX_ORG_TRAINING_GROUP_EMPLOYEES}
    `;

    const [countResult, namesResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingGroupCountRow>(countSql, cellBinds),
      this.snowflakeService.execute<OrgRosterEmployeeRow>(namesSql, [...binds, accountId, groupValue]),
    ]);

    return {
      label: countResult.rows[0]?.GROUP_LABEL ?? '',
      total: countResult.rows[0]?.TOTAL ?? 0,
      data: namesResult.rows.map((row) => ({ contactId: row.CONTACT_ID, name: row.NAME ?? row.CONTACT_ID, jobTitle: row.JOB_TITLE ?? null })),
    };
  }
}

/**
 * A warehouse value as a request names it: normalized (trimmed, capped), and null when blank or when it holds a control
 * character other than a tab, which no request may carry. Such a value is therefore never offered as an option, so every
 * option the dropdown shows can be selected.
 */
function wellFormedFilterValue(value: string | null | undefined): string | null {
  const normalized = normalizeOrgTrainingFilterValue(value);
  return normalized !== null && isWellFormedOrgTrainingFilterValue(normalized) ? normalized : null;
}

/**
 * The five dropdowns; an option exists only when a pair of the range carries it. Course options are names (versions merge).
 * Option values are normalized like a URL value (trimmed, capped), so every option can be named by a request and compares equal to it.
 */
function buildFilterOptions(rows: readonly OrgTrainingOptionRow[]): OrgTrainingFilterOptions {
  const foundations = new Map<string, string>();
  const projects = new Map<string, string>();
  const courses = new Map<string, string>();
  const levels = new Map<string, string>();
  const formats = new Map<string, string>();
  for (const row of rows) {
    const foundationId = wellFormedFilterValue(row.FOUNDATION_ID);
    const projectId = wellFormedFilterValue(row.PROJECT_ID);
    const course = wellFormedFilterValue(row.COURSE_NAME);
    const level = wellFormedFilterValue(row.COURSE_LEVEL);
    const format = wellFormedFilterValue(row.COURSE_FORMAT);
    if (foundationId && row.FOUNDATION_NAME) foundations.set(foundationId, row.FOUNDATION_NAME);
    if (projectId && row.PROJECT_NAME) projects.set(projectId, row.PROJECT_NAME);
    if (course) courses.set(course, course);
    if (level) levels.set(level, level);
    if (format) formats.set(format, format);
  }
  const toOptions = (entries: Map<string, string>): OrgDropdownOption[] =>
    [...entries].map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label, 'en-US'));
  return {
    foundations: toOptions(foundations),
    projects: toOptions(projects),
    courses: toOptions(courses),
    levels: toOptions(levels),
    formats: toOptions(formats),
  };
}

/** The distinct raw values of the all-time rows, one list per filter, normalized like a request value. */
function buildKnownFilterValues(rows: readonly OrgTrainingKnownValueRow[]): OrgTrainingKnownFilterValues {
  const known: Record<keyof OrgTrainingFilters, Set<string>> = {
    foundation: new Set(),
    project: new Set(),
    course: new Set(),
    level: new Set(),
    format: new Set(),
  };
  for (const row of rows) {
    const value = wellFormedFilterValue(row.FILTER_VALUE);
    if (value !== null && row.FILTER_KEY in known) known[row.FILTER_KEY].add(value);
  }
  return {
    foundation: [...known.foundation],
    project: [...known.project],
    course: [...known.course],
    level: [...known.level],
    format: [...known.format],
  };
}

/** The stats of a filter the org carries no value for: every range metric is zero; only the live, unfiltered roster is carried. */
function emptyTrainingStats(range: OrgLensTimeRange, asOf: string | null, rosterMembers: number | null, rosterMembersAsOf: string | null): OrgTrainingStats {
  return {
    range,
    asOf,
    rosterMembers,
    rosterMembersAsOf,
    peopleWithTrainingActivity: 0,
    learnersOutsidePeopleList: null,
    coursesTaken: 0,
    certifications: 0,
    certifiedPeople: 0,
    trainingsCompleted: 0,
    completionRatePct: 0,
    coursesInProgress: 0,
    peopleInTraining: 0,
  };
}

const isNumber = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value);
const isNullableNumber = (value: unknown): boolean => value === null || isNumber(value);
const isNullableString = (value: unknown): boolean => value === null || typeof value === 'string';

/** The full OrgTrainingStats shape: a partial or stale payload misses and is refetched instead of reaching the client. */
function isTrainingStats(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<keyof OrgTrainingStats, unknown>;
  return (
    isOrgLensTimeRange(v.range) &&
    isNullableString(v.asOf) &&
    isNullableNumber(v.rosterMembers) &&
    isNullableString(v.rosterMembersAsOf) &&
    isNumber(v.peopleWithTrainingActivity) &&
    isNullableNumber(v.learnersOutsidePeopleList) &&
    isNumber(v.coursesTaken) &&
    isNumber(v.certifications) &&
    isNumber(v.certifiedPeople) &&
    isNumber(v.trainingsCompleted) &&
    isNumber(v.completionRatePct) &&
    isNumber(v.coursesInProgress) &&
    isNumber(v.peopleInTraining)
  );
}

function isFilterOptions(value: unknown): boolean {
  const v = value as Partial<Record<keyof OrgTrainingFilterOptions, unknown>> | null;
  return !!v && Array.isArray(v.foundations) && Array.isArray(v.projects) && Array.isArray(v.courses) && Array.isArray(v.levels) && Array.isArray(v.formats);
}

function isKnownFilterValues(value: unknown): boolean {
  const v = value as Partial<Record<keyof OrgTrainingFilters, unknown>> | null;
  return !!v && ORG_TRAINING_FILTER_KEYS.every((filter) => Array.isArray(v[filter]) && (v[filter] as unknown[]).every((entry) => typeof entry === 'string'));
}

function isGroupsRaw(value: unknown): boolean {
  const v = value as Partial<OrgTrainingGroupsRaw> | null;
  return !!v && Array.isArray(v.rows) && !!v.totals && typeof v.totals.completed === 'number';
}

function isGroupEmployeesRaw(value: unknown): boolean {
  const v = value as Partial<OrgTrainingGroupEmployeesRaw> | null;
  return !!v && typeof v.total === 'number' && Array.isArray(v.data) && typeof v.label === 'string';
}
