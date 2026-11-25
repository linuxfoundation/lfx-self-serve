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
  OrgLensRollUpScope,
  OrgLensRowOrganization,
  OrgLensTimeRange,
  OrgRollUpSetOrg,
  OrgTrainingFamilyScope,
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
  ORG_TRAINING_PAIRS_TABLE,
  orgTrainingAccountPredicate,
  orgTrainingParamSignature,
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
  CERTIFIED_PAIRS: number;
  PEOPLE_IN_TRAINING: number;
}

interface OrgTrainingCountRow {
  PEOPLE: number;
}

interface OrgTrainingAsOfRow {
  AS_OF: Date | string | null;
}

interface OrgTrainingRosterMembersRow {
  ROSTER_MEMBERS: number | null;
  AS_OF_TS: Date | string | null;
}

/**
 * The accounts a read counts and how its result may be cached: one organization (shared entry for an `org-grant` caller only)
 * or a family roll-up (an entry per served account set, so callers who can read different organizations never share one).
 */
interface OrgTrainingSource {
  readonly accounts: readonly string[];
  cache<T>(subResource: string, fetcher: () => Promise<T>, accept: (value: unknown) => boolean): Promise<T>;
}

interface OrgTrainingFamilyGroupRow extends OrgTrainingGroupRow {
  accountId: string;
}

interface OrgTrainingFamilyGroupsRaw {
  rows: OrgTrainingFamilyGroupRow[];
  totals: OrgTrainingGroupsResponse['totals'];
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
  ACCOUNT_ID?: string;
  GROUP_KEY: string | null;
  GROUP_LABEL: string | null;
  PEOPLE: number;
  COURSES_TAKEN: number;
  COMPLETED: number;
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
    const source = this.orgSource(accountId, qualification);
    return this.readTrainingStats(source, source, query);
  }

  /** Dropdown options: the people-list pairs in range, unfiltered. */
  public async getFilterOptions(accountId: string, range: OrgLensTimeRange, qualification: OrgLensReadQualification): Promise<OrgTrainingFilterOptions> {
    return this.readFilterOptions(this.orgSource(accountId, qualification), range);
  }

  /**
   * The family roll-up the Training reads serve: the organizations the roll-up gate verified, alphabetical, narrowed to
   * `company` when the Company filter names one (the caller checks that it is in the roll-up).
   */
  public familyScope(rollUp: OrgLensRollUpScope, company?: string): OrgTrainingFamilyScope {
    const organizations = [...rollUp.members].sort((a, b) => a.name.localeCompare(b.name) || a.accountId.localeCompare(b.accountId));
    return {
      rollUpKey: rollUp.rollUpKey,
      members: company ? organizations.filter((member) => member.accountId === company) : organizations,
      organizations,
      coverage: { complete: rollUp.complete, excludedCount: rollUp.excludedCount },
    };
  }

  /**
   * Stats of a family roll-up over the served accounts' pairs: person tiles count each person once across the family and
   * course tiles each person-and-course pair once, certified when any served account's pair is. Roster members adds up the
   * companies' counts: the roster model carries no person column. Filter values are checked against every organization of
   * the roll-up, as its dropdowns offer them.
   */
  public async getFamilyTrainingStats(req: Request, scope: OrgTrainingFamilyScope, query: OrgTrainingStatsQuery): Promise<OrgTrainingStats> {
    logger.debug(req, 'get_org_lens_training_stats', 'Reading family training stats', { roll_up_key: scope.rollUpKey, members: scope.members.length });
    const stats = await this.readTrainingStats(
      this.familySource(scope.rollUpKey, scope.members),
      this.familySource(scope.rollUpKey, scope.organizations),
      query
    );
    return { ...stats, organizations: scope.organizations.map(rowOrganization), rollUp: scope.coverage };
  }

  /** Dropdown options of a family roll-up: every value a served account's people-list pairs in range carry, whatever the Company filter. */
  public async getFamilyFilterOptions(req: Request, scope: OrgTrainingFamilyScope, range: OrgLensTimeRange): Promise<OrgTrainingFilterOptions> {
    logger.debug(req, 'get_org_lens_training_filter_options', 'Reading family training filter options', {
      roll_up_key: scope.rollUpKey,
      organizations: scope.organizations.length,
    });
    return this.readFilterOptions(this.familySource(scope.rollUpKey, scope.organizations), range);
  }

  /**
   * Group-by table of a family roll-up: one row per group value and company, each counting that company's own pairs, so a
   * person in two companies appears in both rows. `totals` count over the whole tab once, so they can be less than the sum
   * of the rows and still equal the stat tiles. Search, sort and paging run in memory; ties sort by label, then company.
   */
  public async getFamilyGroups(
    req: Request,
    scope: OrgTrainingFamilyScope,
    query: OrgTrainingStatsQuery,
    params: OrgTrainingGroupsParams
  ): Promise<OrgTrainingGroupsResponse> {
    const { groupBy, tab, searchQuery } = params;
    const sortField = params.sortField ?? DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD;
    const sortOrder = params.sortOrder ?? DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER;
    const pageSize = params.pageSize ?? DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE;
    const offset = params.offset ?? 0;

    logger.debug(req, 'get_org_training_groups', 'Reading family training groups', {
      roll_up_key: scope.rollUpKey,
      members: scope.members.length,
      group_by: groupBy,
      tab,
      has_search: !!searchQuery,
      sort_field: sortField,
      sort_order: sortOrder,
      page_size: pageSize,
      offset,
    });

    if (!(await this.carriesOnlyKnownFilters(this.familySource(scope.rollUpKey, scope.organizations), query))) {
      return { data: [...EMPTY_ORG_TRAINING_GROUPS_RESPONSE.data], total: 0, totals: { ...EMPTY_ORG_TRAINING_GROUPS_RESPONSE.totals } };
    }
    const source = this.familySource(scope.rollUpKey, scope.members);
    const raw = await source.cache(
      `training-groups-family:v2:${orgTrainingFiltersSignature(query)}:${groupBy}:${tab}`,
      () => this.fetchFamilyGroups(source, query, groupBy, tab),
      isGroupsRaw
    );

    const organizationOf = new Map(scope.members.map((member) => [member.accountId, rowOrganization(member)]));
    const rows: OrgTrainingGroupRow[] = raw.rows.flatMap(({ accountId, ...row }) => {
      const organization = organizationOf.get(accountId);
      return organization ? [{ ...row, organization }] : [];
    });

    const needle = searchQuery?.trim().toLowerCase();
    const matching = needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows;
    const direction = sortOrder === 'ASC' ? 1 : -1;
    matching.sort((a, b) => {
      const primary = sortField === 'label' ? a.label.localeCompare(b.label, 'en-US') : a[sortField] - b[sortField];
      if (primary !== 0) return primary * direction;
      return a.label.localeCompare(b.label, 'en-US') || (a.organization?.name ?? '').localeCompare(b.organization?.name ?? '', 'en-US');
    });

    return { data: matching.slice(offset, offset + pageSize), total: matching.length, totals: raw.totals };
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

    if (!(await this.carriesOnlyKnownFilters(this.orgSource(accountId, qualification), query))) {
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
    if (!(await this.carriesOnlyKnownFilters(this.orgSource(accountId, qualification), query))) {
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
      `training-group-employees:v2:${orgTrainingFiltersSignature(query)}:${groupBy}:${orgTrainingParamSignature([groupValue])}:${tab}:${status}`,
      () => this.fetchGroupEmployees(accountId, query, params),
      isGroupEmployeesRaw
    );

    return { groupBy, groupValue, label: raw.label || ORG_TRAINING_GROUP_NONE_LABELS[groupBy], tab, status, total: raw.total, data: raw.data };
  }

  private async readTrainingStats(source: OrgTrainingSource, filterSource: OrgTrainingSource, query: OrgTrainingStatsQuery): Promise<OrgTrainingStats> {
    if (!(await this.carriesOnlyKnownFilters(filterSource, query))) {
      // Zeros for every range metric; the roster is live and unfiltered, and the as-of is the build time of the same rows, so both come from the unfiltered stats entry.
      const unfilteredQuery: OrgTrainingStatsQuery = { range: query.range, foundation: null, project: null, course: null, level: null, format: null };
      const unfiltered = await source.cache(
        `training-stats:v7:${orgTrainingFiltersSignature(unfilteredQuery)}`,
        () => this.fetchTrainingStats(source.accounts, unfilteredQuery),
        isTrainingStats
      );
      return emptyTrainingStats(query.range, unfiltered.asOf, unfiltered.rosterMembers, unfiltered.rosterMembersAsOf);
    }
    return source.cache(`training-stats:v7:${orgTrainingFiltersSignature(query)}`, () => this.fetchTrainingStats(source.accounts, query), isTrainingStats);
  }

  private readFilterOptions(source: OrgTrainingSource, range: OrgLensTimeRange): Promise<OrgTrainingFilterOptions> {
    return source.cache(
      `training-filter-options:v2:${range}`,
      async () => {
        const { cte, binds } = buildOrgTrainingPairsCte(source.accounts, { range, foundation: null, project: null, course: null, level: null, format: null });
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

  private orgSource(accountId: string, qualification: OrgLensReadQualification): OrgTrainingSource {
    return { accounts: [accountId], cache: (subResource, fetcher, accept) => this.cached(qualification, accountId, subResource, fetcher, accept) };
  }

  /**
   * A family roll-up's accounts. Every caller reaching here passed the roll-up gate for each of them, so the entry is shared
   * by callers who read the same account set and by no one else: the sorted account ids are part of the key.
   */
  private familySource(rollUpKey: string, organizations: readonly OrgRollUpSetOrg[]): OrgTrainingSource {
    const accounts = organizations.map((organization) => organization.accountId);
    const accountSignature = orgTrainingParamSignature([...accounts].sort());
    return {
      accounts,
      cache: (subResource, fetcher, accept) =>
        withOrgCache(rollUpKey, `${subResource}:family:${accountSignature}`, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS, fetcher, accept),
    };
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
      `training-groups:v2:${orgTrainingFiltersSignature(query)}:${groupBy}:${tab}`,
      () => this.fetchGroups([accountId], query, groupBy, tab),
      isGroupsRaw
    );
  }

  /**
   * Whether every filter the request sets names a value the org's people-list training rows carry. A value the org never
   * carries (another org's value kept across an org switch, a stale shared URL) is not an error: the callers answer it with
   * the zero payload before any stats/groups/drawer cache key or statement exists, which keeps that key space bounded by
   * the org's own values. A value valid for the org with no rows in the selected range is served as zero data by the normal path.
   */
  private async carriesOnlyKnownFilters(source: OrgTrainingSource, query: OrgTrainingStatsQuery): Promise<boolean> {
    const requested = ORG_TRAINING_FILTER_KEYS.filter((filter) => query[filter] !== null);
    if (requested.length === 0) return true;

    const known = await this.getKnownFilterValues(source);
    return requested.every((filter) => known[filter].includes(query[filter] as string));
  }

  /** The known-value set, bounded by the accounts' own attribute values; cached as its own entry as the source allows. */
  private getKnownFilterValues(source: OrgTrainingSource): Promise<OrgTrainingKnownFilterValues> {
    return source.cache(
      'training-filter-known:v2',
      async () => {
        const sql = `
          WITH known_pairs AS (
            SELECT FOUNDATION_ID, PROJECT_ID, COURSE_NAME, COURSE_LEVEL, COURSE_FORMAT
            FROM ${ORG_TRAINING_PAIRS_TABLE}
            WHERE ${orgTrainingAccountPredicate(source.accounts)}
              AND IS_ON_PEOPLE_LIST
          )
          SELECT 'foundation' AS FILTER_KEY, FOUNDATION_ID AS FILTER_VALUE FROM known_pairs
          UNION
          SELECT 'project', PROJECT_ID FROM known_pairs
          UNION
          SELECT 'course', COURSE_NAME FROM known_pairs
          UNION
          SELECT 'level', COURSE_LEVEL FROM known_pairs
          UNION
          SELECT 'format', COURSE_FORMAT FROM known_pairs
        `;
        const result = await this.snowflakeService.execute<OrgTrainingKnownValueRow>(sql, [...source.accounts]);
        return buildKnownFilterValues(result.rows);
      },
      isKnownFilterValues
    );
  }

  private async fetchTrainingStats(accounts: readonly string[], query: OrgTrainingStatsQuery): Promise<OrgTrainingStats> {
    const { cte, binds } = buildOrgTrainingPairsCte(accounts, query);
    const accountPredicate = orgTrainingAccountPredicate(accounts);
    // A family keeps one row per account and pair, so a pair certified in one account is in training in none: people in
    // training are those with a pair whose key no certified row carries. One account has one row per pair, so its own flag
    // decides, without scanning `f` again.
    const peopleInTraining =
      accounts.length > 1
        ? '(SELECT COUNT(DISTINCT PERSON_KEY) FROM f WHERE NOT IS_CERTIFIED AND PAIR_KEY NOT IN (SELECT PAIR_KEY FROM f WHERE IS_CERTIFIED))'
        : 'COUNT(DISTINCT IFF(NOT IS_CERTIFIED, PERSON_KEY, NULL))';
    const pairsSql = `
      WITH ${cte}
      SELECT
        COUNT(DISTINCT PERSON_KEY)                                                                         AS PEOPLE,
        COUNT(DISTINCT PAIR_KEY)                                                                           AS COURSES_TAKEN,
        COUNT(DISTINCT IFF(IS_CERTIFIED AND ${orgTrainingTabPredicate('certifications')}, PAIR_KEY, NULL))   AS CERTIFICATIONS,
        COUNT(DISTINCT IFF(IS_CERTIFIED AND ${orgTrainingTabPredicate('certifications')}, PERSON_KEY, NULL)) AS CERTIFIED_PEOPLE,
        COUNT(DISTINCT IFF(IS_CERTIFIED AND ${orgTrainingTabPredicate('trainings')}, PAIR_KEY, NULL))        AS TRAININGS_COMPLETED,
        COUNT(DISTINCT IFF(IS_CERTIFIED, PAIR_KEY, NULL))                                                  AS CERTIFIED_PAIRS,
        ${peopleInTraining}                                                                                AS PEOPLE_IN_TRAINING
      FROM f
    `;

    // Learners the warehouse attributes to the org outside its people list (lfx-self-serve#4287): counted only while no filter
    // is set, like their list, and null (not counted) otherwise; a key that also has people-list rows is that person.
    // They are never added to the people-list numbers: every other metric reads the people-list pairs `f`.
    // Across a family, a learner is outside only when no served account lists them.
    const outsideSql = `
      SELECT COUNT(DISTINCT PERSON_KEY) AS PEOPLE
      FROM ${ORG_TRAINING_PAIRS_TABLE}
      WHERE ${accountPredicate}
        AND TIME_RANGE = ?
        AND NOT IS_ON_PEOPLE_LIST
        AND PERSON_KEY NOT IN (
          SELECT PERSON_KEY
          FROM ${ORG_TRAINING_PAIRS_TABLE}
          WHERE ${accountPredicate}
            AND TIME_RANGE = ?
            AND IS_ON_PEOPLE_LIST
        )
    `;

    // One build time for every range of the account.
    const asOfSql = `
      SELECT MAX(DBT_RUN_AT) AS AS_OF
      FROM ${ORG_TRAINING_PAIRS_TABLE}
      WHERE ${accountPredicate}
    `;

    // One row per account with an LF Education training client; none otherwise. Live: not windowed, not filtered. The model
    // publishes a count per account and no person column, so a family adds its companies' counts; with no row the sum is NULL.
    const rosterSql = `
      SELECT SUM(ROSTER_MEMBERS) AS ROSTER_MEMBERS, MAX(AS_OF_TS) AS AS_OF_TS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_ROSTER_MEMBERS
      WHERE ${accountPredicate}
    `;

    // Any filter leaves learners outside the people list uncounted (null), as their list is hidden then.
    const includeOutside = !hasOrgTrainingFilter(query);
    const [pairsResult, outsideResult, asOfResult, rosterResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingPairStatsRow>(pairsSql, binds),
      includeOutside
        ? this.snowflakeService.execute<OrgTrainingCountRow>(outsideSql, [...accounts, query.range, ...accounts, query.range])
        : Promise.resolve({ rows: [] as OrgTrainingCountRow[] }),
      this.snowflakeService.execute<OrgTrainingAsOfRow>(asOfSql, [...accounts]),
      this.snowflakeService.execute<OrgTrainingRosterMembersRow>(rosterSql, [...accounts]),
    ]);

    const pairs = pairsResult.rows[0];
    const outside = outsideResult.rows[0]?.PEOPLE ?? 0;
    const roster = rosterResult.rows[0];
    const hasRoster = roster !== undefined && roster.ROSTER_MEMBERS !== null;
    const coursesTaken = pairs?.COURSES_TAKEN ?? 0;
    const certifications = pairs?.CERTIFICATIONS ?? 0;
    const trainingsCompleted = pairs?.TRAININGS_COMPLETED ?? 0;

    return {
      range: query.range,
      asOf: toIsoTimestamp(asOfResult.rows[0]?.AS_OF),
      // No row: the org has no LF Education training client, so there is no roster to count (not zero members).
      rosterMembers: hasRoster ? roster.ROSTER_MEMBERS : null,
      rosterMembersAsOf: hasRoster ? toIsoTimestamp(roster.AS_OF_TS) : null,
      peopleWithTrainingActivity: pairs?.PEOPLE ?? 0,
      learnersOutsidePeopleList: includeOutside ? outside : null,
      coursesTaken,
      certifications,
      certifiedPeople: pairs?.CERTIFIED_PEOPLE ?? 0,
      trainingsCompleted,
      completionRatePct: orgTrainingCompletionRatePct({ coursesTaken, certifications, trainingsCompleted }),
      coursesInProgress: coursesTaken - (pairs?.CERTIFIED_PAIRS ?? 0),
      peopleInTraining: pairs?.PEOPLE_IN_TRAINING ?? 0,
    };
  }

  private async fetchFamilyGroups(
    source: OrgTrainingSource,
    query: OrgTrainingStatsQuery,
    groupBy: OrgTrainingGroupsParams['groupBy'],
    tab: OrgTrainingGroupsParams['tab']
  ): Promise<OrgTrainingFamilyGroupsRaw> {
    const raw = await this.fetchGroups(source.accounts, query, groupBy, tab, true);
    return { rows: raw.rows.filter((row): row is OrgTrainingFamilyGroupRow => typeof row.accountId === 'string'), totals: raw.totals };
  }

  /** `perAccount`: one row per group value and account (the family table); the totals always count each pair of the tab once. */
  private async fetchGroups(
    accounts: readonly string[],
    query: OrgTrainingStatsQuery,
    groupBy: OrgTrainingGroupsParams['groupBy'],
    tab: OrgTrainingGroupsParams['tab'],
    perAccount = false
  ): Promise<{ rows: (OrgTrainingGroupRow & { accountId?: string })[]; totals: OrgTrainingGroupsResponse['totals'] }> {
    const { cte, binds } = buildOrgTrainingPairsCte(accounts, query);
    const group = ORG_TRAINING_GROUP_SQL[groupBy];
    const tabPredicate = orgTrainingTabPredicate(tab);

    const rowsSql = `
      WITH ${cte}
      SELECT
        ${perAccount ? 'ACCOUNT_ID                      AS ACCOUNT_ID,\n        ' : ''}${group.key}                    AS GROUP_KEY,
        ${group.label}                  AS GROUP_LABEL,
        COUNT(DISTINCT PERSON_KEY)                        AS PEOPLE,
        COUNT(DISTINCT PAIR_KEY)                          AS COURSES_TAKEN,
        COUNT(DISTINCT IFF(IS_CERTIFIED, PAIR_KEY, NULL)) AS COMPLETED,
        MAX(COURSE_LEVEL)               AS LEVEL,
        MAX(FOUNDATION_NAME)            AS FOUNDATION
      FROM f
      WHERE ${tabPredicate}
      GROUP BY ${perAccount ? 'ACCOUNT_ID, ' : ''}${group.key}
    `;
    // Over the whole tab set (people are distinct across groups), so the footer equals the stat tiles.
    const totalsSql = `
      WITH ${cte}
      SELECT
        COUNT(DISTINCT PERSON_KEY)                        AS PEOPLE,
        COUNT(DISTINCT PAIR_KEY)                          AS COURSES_TAKEN,
        COUNT(DISTINCT IFF(IS_CERTIFIED, PAIR_KEY, NULL)) AS COMPLETED
      FROM f
      WHERE ${tabPredicate}
    `;

    const [rowsResult, totalsResult] = await Promise.all([
      this.snowflakeService.execute<OrgTrainingGroupSqlRow>(rowsSql, binds),
      this.snowflakeService.execute<{ PEOPLE: number; COURSES_TAKEN: number; COMPLETED: number }>(totalsSql, binds),
    ]);

    const rows = rowsResult.rows.map((row) => {
      const key = row.GROUP_KEY ?? '';
      return {
        ...(perAccount && row.ACCOUNT_ID ? { accountId: row.ACCOUNT_ID } : {}),
        key,
        label: key === '' ? ORG_TRAINING_GROUP_NONE_LABELS[groupBy] : (row.GROUP_LABEL ?? key),
        people: row.PEOPLE || 0,
        coursesTaken: row.COURSES_TAKEN || 0,
        completed: row.COMPLETED || 0,
        inProgress: (row.COURSES_TAKEN || 0) - (row.COMPLETED || 0),
        level: groupBy === 'course' ? (row.LEVEL ?? null) : null,
        foundation: groupBy === 'course' || groupBy === 'project' ? (row.FOUNDATION ?? null) : null,
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
        inProgress: (totals?.COURSES_TAKEN ?? 0) - (totals?.COMPLETED ?? 0),
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
      SELECT COUNT(DISTINCT PAIR_KEY) AS TOTAL, ${group.label} AS GROUP_LABEL
      FROM f
      WHERE ${where}
    `;
    // Identity from the all-time, all-projects ORG_PEOPLE_ALL_RANGES row of each current employee (IS_FORMER = FALSE), the
    // read People › Trainees uses, so the roster matches the pair count for any range. ORG_PEOPLE_ALL would drop members
    // whose only training is older than its 12-month engagement gate or reaches them through a merged learner. That row is
    // unique per (account, person); one row per person however many pairs. No other training query joins ORG_PEOPLE_ALL.
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

function rowOrganization(organization: OrgRollUpSetOrg): OrgLensRowOrganization {
  return { accountId: organization.accountId, name: organization.name };
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
