// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER,
  MAX_ORG_CERT_EMPLOYEES,
  ORG_TRAINING_GROUP_NONE_LABELS,
  ORG_TRAINING_VIEW_QUERY_PARAMS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  OrgCertEmployee,
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
import { hasOrgTrainingCourseFilter, isOrgLensTimeRange, orgTrainingCompletionRatePct, orgTrainingFiltersSignature } from '@lfx-one/shared/utils';
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
  data: OrgCertEmployee[];
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

/** Request filter → the filter-options list that must carry its value. */
const FILTER_OPTION_KEYS = [
  { filter: 'foundation', options: 'foundations' },
  { filter: 'project', options: 'projects' },
  { filter: 'course', options: 'courses' },
  { filter: 'level', options: 'levels' },
  { filter: 'format', options: 'formats' },
] as const satisfies readonly { filter: keyof OrgTrainingFilters; options: keyof OrgTrainingFilterOptions }[];

/**
 * Learner numbers of the shared Training / Trainees view: one pairs definition (see org-training-pairs.sql) behind stats, options, groups and drawers.
 *
 * Caching follows the Groups page (`OrgLensGroupsService.getGroups`): the shared Valkey entries are served only to a
 * caller whose access resolved as `org-grant` on this org. A caller the roster does not list and the authorizer admitted
 * (`auditor-entitlement`) is resolved directly and nothing is read from or stored in the shared cache, so upstream stays
 * the deciding authority for that request.
 *
 * Request filter values are validated against the all-time filter options before any cache key or SQL is built (a 400 for
 * an unknown value), which keeps the key space bounded by the org's own attribute values.
 */
export class OrgLensTrainingService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  /** The one stats function: both pages and the Overview tile call it, so equal queries always give equal numbers. */
  public async getTrainingStats(accountId: string, query: OrgTrainingStatsQuery, qualification: OrgLensReadQualification): Promise<OrgTrainingStats> {
    await this.assertKnownFilters(accountId, query, qualification);
    return this.cached(
      qualification,
      accountId,
      `training-stats:v5:${orgTrainingFiltersSignature(query)}`,
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

    await this.assertKnownFilters(accountId, query, qualification);
    const raw = await this.getGroupsRaw(accountId, query, groupBy, tab, qualification);

    const needle = searchQuery?.trim().toLowerCase();
    const matching = needle ? raw.rows.filter((row) => row.label.toLowerCase().includes(needle)) : [...raw.rows];
    const direction = sortOrder === 'ASC' ? 1 : -1;
    matching.sort((a, b) => {
      const primary = sortField === 'label' ? a.label.localeCompare(b.label) : a[sortField] - b[sortField];
      return primary !== 0 ? primary * direction : a.label.localeCompare(b.label);
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

    // The cell must be a group of this table: an unknown value never reaches a cache key or SQL.
    await this.assertKnownFilters(accountId, query, qualification);
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
   * 400 for a filter value the org's pairs never carry, so no unknown string reaches a cache key or SQL. Checked against
   * the all-time options (a superset of every range's), not the request's range: a value valid for the org but with no
   * rows in the selected range (the filter bar keeps it selected across a range change) is served as zero data.
   */
  private async assertKnownFilters(accountId: string, query: OrgTrainingStatsQuery, qualification: OrgLensReadQualification): Promise<void> {
    const requested = FILTER_OPTION_KEYS.filter(({ filter }) => query[filter] !== null);
    if (requested.length === 0) return;

    const options = await this.getFilterOptions(accountId, 'all', qualification);
    for (const { filter, options: optionsKey } of requested) {
      if (!options[optionsKey].some((option) => option.value === query[filter])) {
        throw ServiceValidationError.forField(ORG_TRAINING_VIEW_QUERY_PARAMS[filter], `${filter} is not an option of this organization's training view`, {
          operation: 'validate_org_training_filters',
        });
      }
    }
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

    // Learners the warehouse attributes to the org outside its people list (lfx-self-serve#4287): they carry no course
    // data, so they count toward people only while no filter is set; a key that also has people-list rows is that person.
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

    const includeOutside = !hasOrgTrainingCourseFilter(query);
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
      peopleWithTrainingActivity: (pairs?.PEOPLE ?? 0) + outside,
      learnersOutsidePeopleList: outside,
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
      LIMIT ${MAX_ORG_CERT_EMPLOYEES}
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

/** The five dropdowns; an option exists only when a pair of the range carries it. Course options are names (versions merge). */
function buildFilterOptions(rows: readonly OrgTrainingOptionRow[]): OrgTrainingFilterOptions {
  const foundations = new Map<string, string>();
  const projects = new Map<string, string>();
  const courses = new Map<string, string>();
  const levels = new Map<string, string>();
  const formats = new Map<string, string>();
  for (const row of rows) {
    if (row.FOUNDATION_ID && row.FOUNDATION_NAME) foundations.set(row.FOUNDATION_ID, row.FOUNDATION_NAME);
    if (row.PROJECT_ID && row.PROJECT_NAME) projects.set(row.PROJECT_ID, row.PROJECT_NAME);
    if (row.COURSE_NAME) courses.set(row.COURSE_NAME, row.COURSE_NAME);
    if (row.COURSE_LEVEL) levels.set(row.COURSE_LEVEL, row.COURSE_LEVEL);
    if (row.COURSE_FORMAT) formats.set(row.COURSE_FORMAT, row.COURSE_FORMAT);
  }
  const toOptions = (entries: Map<string, string>): OrgDropdownOption[] =>
    [...entries].map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    foundations: toOptions(foundations),
    projects: toOptions(projects),
    courses: toOptions(courses),
    levels: toOptions(levels),
    formats: toOptions(formats),
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
    isNumber(v.learnersOutsidePeopleList) &&
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

function isGroupsRaw(value: unknown): boolean {
  const v = value as Partial<OrgTrainingGroupsRaw> | null;
  return !!v && Array.isArray(v.rows) && !!v.totals && typeof v.totals.completed === 'number';
}

function isGroupEmployeesRaw(value: unknown): boolean {
  const v = value as Partial<OrgTrainingGroupEmployeesRaw> | null;
  return !!v && typeof v.total === 'number' && Array.isArray(v.data) && typeof v.label === 'string';
}
