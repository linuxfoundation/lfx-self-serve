// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CDP_TEAM_MEMBER_COLUMN, ORG_REPO_FIRST_NON_TEAM_COMMIT_COLUMN, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  ContributionsCommitRow,
  ContributionsCommitSortColumn,
  ContributionsEmployeeOptionRow,
  ContributionsFoundationOptionRow,
  ContributionsKpiRow,
  ContributionsProjectOptionRow,
  ContributionsRaw,
  ContributionsRepoRow,
  ContributionsSortColumn,
  ContributionsView,
  OrgContributionCommitRow,
  OrgContributionEmployeeOption,
  OrgContributionProjectOption,
  OrgContributionRepoRow,
  OrgContributionsKpis,
  OrgContributionsQuery,
  OrgContributionsResponse,
  OrgLensTimeRange,
  SnowflakeQueryOptions,
} from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';
import { createHash } from 'crypto';

import { toIsoTimestamp } from '../helpers/date-format.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { orgTeamMembersPredicate, orgTeamMembersQueryOptions, readWithOrgTeamMembersFallback } from '../helpers/org-team-members.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

const PLATINUM_TABLE = 'ANALYTICS.PLATINUM_LFX_ONE.ORG_CODE_CONTRIBUTIONS';
const CODE_ACTIVITY_TABLE = 'ANALYTICS.PLATINUM_LFX_ONE.ORG_CODE_ACTIVITY_DAILY';

/**
 * Code Contributions page data access (LFXV2-1894). Commits (metric `commits`, and the Commits feed under either
 * metric) read `ORG_CODE_CONTRIBUTIONS`, one row per authored commit SHA; metric `code` reads the KPI strip,
 * Repositories table and filter-option counts from `ORG_CODE_ACTIVITY_DAILY`. The Foundation and Project filters
 * match `foundation_id` and the project exactly, as People → Contributors does (lfx-self-serve#4559).
 */
export class OrgContributionsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** KPI strip + filter options + server-paginated Repositories table + Commits feed. */
  public async getContributions(accountId: string, query: OrgContributionsQuery): Promise<OrgContributionsResponse> {
    if (!accountId) {
      return emptyResponse(accountId, query.dateRange);
    }

    // `v5`: exact project match, the foundation filter and foundation options (lfx-self-serve#4559), and filter arrays
    // delimited by JSON in the signature. A payload read while the team-member flag (team members served) or the non-team
    // First Commit column (that date inclusive) is missing is never stored (lfx-self-serve#4685).
    const raw = await withOrgCache(
      accountId,
      `contributions:v5:${contributionsSignature(query)}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const read = await readWithOrgTeamMembersFallback(query.teamMembers, 'get_org_lens_contributions', (teamMembers) =>
          this.fetchContributionsRaw(accountId, { ...query, teamMembers })
        );
        return read.teamMembersUnavailable ? { ...read.value, teamMembersUnavailable: true as const } : read.value;
      },
      isContributionsRaw,
      (value) => !value.teamMembersUnavailable && !value.firstCommitUnavailable
    );

    const kpis = mapKpis(raw.kpiRows[0]);
    const totalRecords = raw.repoRows.length > 0 ? raw.repoRows[0].TOTAL_RECORDS : 0;
    const repositories = query.view === 'repositories' ? raw.repoRows.map(mapRepoRow) : [];
    const commitsTotalRecords = raw.commitRows.length > 0 ? raw.commitRows[0].TOTAL_RECORDS : 0;
    const commits = query.view === 'commits' ? raw.commitRows.map(mapCommitRow) : [];

    return {
      accountId,
      dateRange: query.dateRange,
      kpis,
      repositories,
      commits,
      foundationOptions: raw.foundationOptionRows.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
      projectOptions: raw.projectOptionRows.map(mapProjectOption),
      employeeOptions: raw.employeeOptionRows.map(mapEmployeeOption),
      totalRecords,
      commitsTotalRecords,
      ...(raw.teamMembersUnavailable ? { teamMembersUnavailable: true as const } : {}),
    };
  }

  private async fetchContributionsRaw(accountId: string, query: OrgContributionsQuery): Promise<ContributionsRaw> {
    const commitScope = buildCommitScopeFilters(query);
    const codeScope = query.metric === 'code' ? buildCodeScopeFilters(query) : null;
    const repoSearch = buildRepoSearchFilter(query.search);
    const commitSearch = buildCommitSearchFilter(query.search);
    const repoPagination = viewAwarePagination(query, 'repositories');
    const commitPagination = viewAwarePagination(query, 'commits');

    const [kpiResult, repoResult, commitResult, foundationResult, projectResult, employeeResult] = await Promise.all([
      codeScope
        ? this.fetchCodeKpis(accountId, codeScope, buildCodeKpiSearchFilter(query))
        : this.fetchKpis(accountId, commitScope, buildKpiSearchFilter(query)),
      codeScope
        ? this.fetchCodeRepositories(accountId, codeScope, repoSearch, query, repoPagination)
        : this.fetchRepositories(accountId, commitScope, repoSearch, query, repoPagination),
      // The Commits feed lists commits under either metric.
      this.fetchCommits(accountId, commitScope, commitSearch, query, commitPagination),
      this.fetchFoundationOptionRows(accountId, codeScope ?? buildCodeScopeFilters(query)),
      codeScope ? this.fetchCodeProjectOptionRows(accountId, codeScope) : this.fetchProjectOptionRows(accountId, commitScope),
      codeScope ? this.fetchCodeEmployeeOptionRows(accountId, codeScope) : this.fetchEmployeeOptionRows(accountId, commitScope),
    ]);

    return {
      kpiRows: kpiResult.rows,
      repoRows: repoResult.rows,
      commitRows: commitResult.rows,
      foundationOptionRows: foundationResult.rows,
      projectOptionRows: projectResult.rows,
      employeeOptionRows: employeeResult.rows,
      ...(repoResult.firstCommitUnavailable ? { firstCommitUnavailable: true as const } : {}),
    };
  }

  private async fetchKpis(accountId: string, scope: ScopeFilters, kpiSearch: SearchFilter): Promise<{ rows: ContributionsKpiRow[] }> {
    const sql = `
      SELECT
        COUNT(DISTINCT COALESCE(project_id, project_slug, project_name)) AS PROJECTS_WITH_ACTIVITY,
        COUNT(DISTINCT repository_url) AS REPOSITORIES,
        COUNT(DISTINCT commit_id) AS COMMITS
      FROM ${PLATINUM_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        ${scope.foundationPredicate}
        ${scope.projectPredicate}
        ${scope.employeePredicate}
        ${kpiSearch.predicate}
    `;
    return this.snowflakeService.execute<ContributionsKpiRow>(sql, [accountId, ...scope.binds, ...kpiSearch.binds], scope.queryOptions);
  }

  /** Metric `code`: the commits KPI field carries the code-contribution activity total. */
  private async fetchCodeKpis(accountId: string, scope: ScopeFilters, kpiSearch: SearchFilter): Promise<{ rows: ContributionsKpiRow[] }> {
    const sql = `
      SELECT
        COUNT(DISTINCT COALESCE(project_id, project_slug, project_name)) AS PROJECTS_WITH_ACTIVITY,
        COUNT(DISTINCT repository_url) AS REPOSITORIES,
        COALESCE(SUM(code_activities), 0) AS COMMITS
      FROM ${CODE_ACTIVITY_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        ${scope.foundationPredicate}
        ${scope.projectPredicate}
        ${scope.employeePredicate}
        ${kpiSearch.predicate}
    `;
    return this.snowflakeService.execute<ContributionsKpiRow>(sql, [accountId, ...scope.binds, ...kpiSearch.binds], scope.queryOptions);
  }

  private async fetchRepositories(
    accountId: string,
    scope: ScopeFilters,
    repoSearch: SearchFilter,
    query: OrgContributionsQuery,
    pagination: ViewAwarePagination
  ): Promise<{ rows: ContributionsRepoRow[]; firstCommitUnavailable: boolean }> {
    const offset = (pagination.page - 1) * pagination.size;
    const orderBy = repoOrderByColumn(query.sort);
    const sortDir = query.dir === 1 ? 'ASC' : 'DESC';

    // The lifetime First Commit is lf-dbt's, per account and repository: `org_repo_first_commit_ts` by anyone, or under
    // Exclude team members (lfx-self-serve#4685) `org_repo_first_non_team_commit_ts`, without them. Until that column is
    // built the inclusive one is read, and the payload is flagged and never stored.
    const sql = (firstCommitColumn: string): string => `
      WITH repo_agg AS (
        SELECT
          repository_url,
          ANY_VALUE(repository_path) AS repository_path,
          ANY_VALUE(project_id) AS project_id,
          ANY_VALUE(project_name) AS project_name,
          ANY_VALUE(project_slug) AS project_slug,
          ANY_VALUE(project_logo) AS project_logo,
          ANY_VALUE(source) AS source,
          COUNT(DISTINCT commit_id) AS commits,
          MIN(${firstCommitColumn}) AS first_commit_ts,
          MAX(activity_ts) AS last_commit_ts
        FROM ${PLATINUM_TABLE}
        WHERE account_id = ?
          ${scope.datePredicate}
          ${scope.scopePredicate}
          ${scope.foundationPredicate}
          ${scope.projectPredicate}
          ${scope.employeePredicate}
          ${repoSearch.predicate}
        GROUP BY repository_url
      )
      SELECT
        repository_url,
        repository_path,
        project_id,
        project_name,
        project_slug,
        project_logo,
        source,
        commits,
        first_commit_ts,
        last_commit_ts,
        COUNT(*) OVER() AS total_records
      FROM repo_agg
      ORDER BY ${orderBy} ${sortDir}, repository_url ASC
      LIMIT ${pagination.size} OFFSET ${offset}
    `;
    const binds = [accountId, ...scope.binds, ...repoSearch.binds];
    const read = await readWithOrgTeamMembersFallback(
      query.teamMembers,
      'get_org_lens_contributions_first_commit',
      (firstCommit) =>
        firstCommit === 'exclude'
          ? this.snowflakeService.execute<ContributionsRepoRow>(sql(ORG_REPO_FIRST_NON_TEAM_COMMIT_COLUMN), binds, {
              expectInvalidIdentifier: [ORG_CDP_TEAM_MEMBER_COLUMN, ORG_REPO_FIRST_NON_TEAM_COMMIT_COLUMN],
            })
          : this.snowflakeService.execute<ContributionsRepoRow>(sql('org_repo_first_commit_ts'), binds, scope.queryOptions),
      ORG_REPO_FIRST_NON_TEAM_COMMIT_COLUMN
    );
    return { rows: read.value.rows, firstCommitUnavailable: read.teamMembersUnavailable };
  }

  /**
   * Metric `code`: code-contribution activities per repository in the window. The first contribution is the
   * repo's lifetime first activity day for the account (window-independent, like `org_repo_first_commit_ts`).
   */
  private async fetchCodeRepositories(
    accountId: string,
    scope: ScopeFilters,
    repoSearch: SearchFilter,
    query: OrgContributionsQuery,
    pagination: ViewAwarePagination
  ): Promise<{ rows: ContributionsRepoRow[]; firstCommitUnavailable: boolean }> {
    const offset = (pagination.page - 1) * pagination.size;
    const orderBy = repoOrderByColumn(query.sort);
    const sortDir = query.dir === 1 ? 'ASC' : 'DESC';

    const sql = `
      WITH repo_first AS (
        SELECT repository_url, MIN(activity_date) AS first_commit_ts
        FROM ${CODE_ACTIVITY_TABLE}
        WHERE account_id = ?
          ${orgTeamMembersPredicate(query.teamMembers)}
        GROUP BY repository_url
      ),
      repo_agg AS (
        SELECT
          repository_url,
          ANY_VALUE(repository_path) AS repository_path,
          ANY_VALUE(project_id) AS project_id,
          ANY_VALUE(project_name) AS project_name,
          ANY_VALUE(project_slug) AS project_slug,
          ANY_VALUE(project_logo) AS project_logo,
          ANY_VALUE(source) AS source,
          SUM(code_activities) AS commits,
          MAX(activity_date) AS last_commit_ts
        FROM ${CODE_ACTIVITY_TABLE}
        WHERE account_id = ?
          ${scope.datePredicate}
          ${scope.scopePredicate}
          ${scope.foundationPredicate}
          ${scope.projectPredicate}
          ${scope.employeePredicate}
          ${repoSearch.predicate}
        GROUP BY repository_url
      )
      SELECT
        r.repository_url,
        r.repository_path,
        r.project_id,
        r.project_name,
        r.project_slug,
        r.project_logo,
        r.source,
        r.commits,
        f.first_commit_ts,
        r.last_commit_ts,
        COUNT(*) OVER() AS total_records
      FROM repo_agg r
      LEFT JOIN repo_first f ON f.repository_url = r.repository_url
      ORDER BY ${orderBy} ${sortDir}, r.repository_url ASC
      LIMIT ${pagination.size} OFFSET ${offset}
    `;
    const result = await this.snowflakeService.execute<ContributionsRepoRow>(
      sql,
      [accountId, accountId, ...scope.binds, ...repoSearch.binds],
      scope.queryOptions
    );
    // The first contribution comes from this query's own `repo_first`, which reads no rollout column.
    return { rows: result.rows, firstCommitUnavailable: false };
  }

  private async fetchCommits(
    accountId: string,
    scope: ScopeFilters,
    commitSearch: SearchFilter,
    query: OrgContributionsQuery,
    pagination: ViewAwarePagination
  ): Promise<{ rows: ContributionsCommitRow[] }> {
    const offset = (pagination.page - 1) * pagination.size;
    const orderBy = commitOrderByColumn(query.commitSort);
    const sortDir = query.commitDir === 1 ? 'ASC' : 'DESC';

    const sql = `
      WITH commit_rows AS (
        SELECT
          commit_id,
          member_id,
          person_key,
          project_name,
          member_display_name,
          member_logo,
          github_username,
          source,
          activity_ts,
          commit_message,
          commit_url
        FROM ${PLATINUM_TABLE}
        WHERE account_id = ?
          ${scope.datePredicate}
          ${scope.scopePredicate}
          ${scope.foundationPredicate}
          ${scope.projectPredicate}
          ${scope.employeePredicate}
          ${commitSearch.predicate}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY commit_id ORDER BY activity_ts DESC) = 1
      )
      SELECT
        commit_id,
        member_id,
        person_key,
        project_name,
        member_display_name,
        member_logo,
        github_username,
        source,
        activity_ts,
        commit_message,
        commit_url,
        COUNT(*) OVER() AS total_records
      FROM commit_rows
      ORDER BY ${orderBy} ${sortDir}, commit_id ASC
      LIMIT ${pagination.size} OFFSET ${offset}
    `;
    return this.snowflakeService.execute<ContributionsCommitRow>(sql, [accountId, ...scope.binds, ...commitSearch.binds], scope.queryOptions);
  }

  /**
   * Foundations the org made any code contribution to in the window and project type, read from code activity whatever
   * the code-count option, as People → Contributors does. Never narrowed by the foundation, project or employee picks,
   * so the dropdown always offers every foundation to switch to.
   */
  private async fetchFoundationOptionRows(accountId: string, codeScope: ScopeFilters): Promise<{ rows: ContributionsFoundationOptionRow[] }> {
    const sql = `
      SELECT
        foundation_id,
        ANY_VALUE(foundation_name) AS foundation_name
      FROM ${CODE_ACTIVITY_TABLE}
      WHERE account_id = ?
        ${codeScope.datePredicate}
        ${codeScope.scopePredicate}
        AND foundation_id IS NOT NULL
        AND foundation_name IS NOT NULL
      GROUP BY foundation_id
      ORDER BY foundation_name ASC
    `;
    return this.snowflakeService.execute<ContributionsFoundationOptionRow>(sql, [accountId], codeScope.queryOptions);
  }

  /**
   * Options follow the window and project/commit scope, not the foundation, project or employee picks. Each carries its
   * foundation, so the page lists the picked foundation's projects and drops picks outside it.
   */
  private async fetchProjectOptionRows(accountId: string, scope: ScopeFilters): Promise<{ rows: ContributionsProjectOptionRow[] }> {
    const sql = `
      SELECT
        project_id,
        ANY_VALUE(project_slug) AS project_slug,
        ANY_VALUE(project_name) AS project_name,
        ANY_VALUE(foundation_id) AS foundation_id,
        COUNT(DISTINCT commit_id) AS commits
      FROM ${PLATINUM_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        AND project_id IS NOT NULL
      GROUP BY project_id
      ORDER BY commits DESC, project_name ASC
    `;
    return this.snowflakeService.execute<ContributionsProjectOptionRow>(sql, [accountId], scope.queryOptions);
  }

  private async fetchCodeProjectOptionRows(accountId: string, scope: ScopeFilters): Promise<{ rows: ContributionsProjectOptionRow[] }> {
    const sql = `
      SELECT
        project_id,
        ANY_VALUE(project_slug) AS project_slug,
        ANY_VALUE(project_name) AS project_name,
        ANY_VALUE(foundation_id) AS foundation_id,
        SUM(code_activities) AS commits
      FROM ${CODE_ACTIVITY_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        AND project_id IS NOT NULL
      GROUP BY project_id
      ORDER BY commits DESC, project_name ASC
    `;
    return this.snowflakeService.execute<ContributionsProjectOptionRow>(sql, [accountId], scope.queryOptions);
  }

  private async fetchEmployeeOptionRows(accountId: string, scope: ScopeFilters): Promise<{ rows: ContributionsEmployeeOptionRow[] }> {
    const sql = `
      SELECT
        member_id,
        ANY_VALUE(member_display_name) AS member_display_name,
        COUNT(DISTINCT commit_id) AS commits
      FROM ${PLATINUM_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        ${scope.foundationPredicate}
        AND member_id IS NOT NULL
      GROUP BY member_id
      ORDER BY commits DESC, member_display_name ASC
    `;
    return this.snowflakeService.execute<ContributionsEmployeeOptionRow>(sql, [accountId, ...scope.foundationBinds], scope.queryOptions);
  }

  /** Metric `code`: each member's code-contribution activities in the window, project scope and picked foundation. */
  private async fetchCodeEmployeeOptionRows(accountId: string, scope: ScopeFilters): Promise<{ rows: ContributionsEmployeeOptionRow[] }> {
    const sql = `
      SELECT
        member_id,
        ANY_VALUE(member_display_name) AS member_display_name,
        SUM(code_activities) AS commits
      FROM ${CODE_ACTIVITY_TABLE}
      WHERE account_id = ?
        ${scope.datePredicate}
        ${scope.scopePredicate}
        ${scope.foundationPredicate}
        AND member_id IS NOT NULL
      GROUP BY member_id
      ORDER BY commits DESC, member_display_name ASC
    `;
    return this.snowflakeService.execute<ContributionsEmployeeOptionRow>(sql, [accountId, ...scope.foundationBinds], scope.queryOptions);
  }
}

interface ScopeFilters {
  datePredicate: string;
  /** Project scope (and, on commit reads, commit scope) — allow-listed values, inlined. */
  scopePredicate: string;
  foundationPredicate: string;
  /** The foundation predicate's binds alone, for the employee options, which skip the project and employee picks. */
  foundationBinds: string[];
  projectPredicate: string;
  employeePredicate: string;
  /** Foundation, project and employee binds, in the order their predicates appear. */
  binds: string[];
  /** Snowflake options of every read: under Exclude team members, a missing flag column is expected (lfx-self-serve#4685). */
  queryOptions: SnowflakeQueryOptions | undefined;
}

interface SearchFilter {
  predicate: string;
  binds: string[];
}

interface ViewAwarePagination {
  page: number;
  size: number;
}

const NO_SEARCH: SearchFilter = { predicate: '', binds: [] };

/** Active tab uses client page/size; inactive tab fetches one row at offset 0 only to read COUNT(*) OVER(). */
function viewAwarePagination(query: OrgContributionsQuery, tab: ContributionsView): ViewAwarePagination {
  if (query.view === tab) {
    return { page: query.page, size: query.size };
  }
  return { page: 1, size: 1 };
}

/** Filters over `ORG_CODE_CONTRIBUTIONS` (one row per authored commit SHA). */
function buildCommitScopeFilters(query: OrgContributionsQuery): ScopeFilters {
  const mergedPredicate = query.commitScope === 'merged' ? 'AND is_merged = TRUE' : '';
  return buildScopeFilters(query, dateRangePredicate(query.dateRange), `${orgProjectScopePredicate(query.projectScope)} ${mergedPredicate}`);
}

/** Filters over `ORG_CODE_ACTIVITY_DAILY`, which carries the same project, foundation and member columns; commit scope has no meaning for code activity. */
function buildCodeScopeFilters(query: OrgContributionsQuery): ScopeFilters {
  return buildScopeFilters(query, activityDatePredicate(query.dateRange), orgProjectScopePredicate(query.projectScope));
}

/** Every read applies `scopePredicate`, so the team-members exclusion rides along with the project (and commit) scope. */
function buildScopeFilters(query: OrgContributionsQuery, datePredicate: string, baseScopePredicate: string): ScopeFilters {
  const scopePredicate = `${baseScopePredicate} ${orgTeamMembersPredicate(query.teamMembers)}`.trim();
  const foundationBinds: string[] = query.foundation ? [query.foundation] : [];
  const foundationPredicate = query.foundation ? 'AND foundation_id = ?' : '';
  const binds: string[] = [...foundationBinds];
  const projectPredicate = projectFilterPredicate(query.projects, binds);
  const employeePredicate = employeeFilterPredicate(query.employees, binds);
  return {
    datePredicate,
    scopePredicate,
    foundationPredicate,
    foundationBinds,
    projectPredicate,
    employeePredicate,
    binds,
    queryOptions: orgTeamMembersQueryOptions(query.teamMembers),
  };
}

function buildKpiSearchFilter(query: OrgContributionsQuery): SearchFilter {
  return query.view === 'commits' ? buildCommitSearchFilter(query.search) : buildRepoSearchFilter(query.search);
}

/** Commit-text search has no counterpart in code activity, so the code KPI only follows the repository search. */
function buildCodeKpiSearchFilter(query: OrgContributionsQuery): SearchFilter {
  return query.view === 'commits' ? NO_SEARCH : buildRepoSearchFilter(query.search);
}

function buildRepoSearchFilter(search: string): SearchFilter {
  const trimmed = search.trim();
  if (!trimmed) {
    return NO_SEARCH;
  }
  return { predicate: 'AND repository_path ILIKE ?', binds: [`%${trimmed}%`] };
}

function buildCommitSearchFilter(search: string): SearchFilter {
  const trimmed = search.trim();
  if (!trimmed) {
    return NO_SEARCH;
  }
  const pattern = `%${trimmed}%`;
  return {
    predicate: `
      AND (
        commit_message ILIKE ?
        OR project_name ILIKE ?
        OR member_display_name ILIKE ?
        OR github_username ILIKE ?
      )`,
    binds: [pattern, pattern, pattern, pattern],
  };
}

/**
 * Calendar-day window on `activity_ts`: on or after N days before today, the boundary the code reads and the People
 * models use; none for all time. N comes from the allow-listed range, never from input.
 */
function dateRangePredicate(dateRange: OrgLensTimeRange): string {
  return dateRange === 'all' ? '' : `AND activity_ts::date >= DATEADD(day, -${orgLensTimeRangeDays(dateRange)}, CURRENT_DATE())`;
}

/** Date window on `activity_date`: on or after N days before today; none for all time. */
function activityDatePredicate(dateRange: OrgLensTimeRange): string {
  return dateRange === 'all' ? '' : `AND activity_date >= DATEADD(day, -${orgLensTimeRangeDays(dateRange)}, CURRENT_DATE())`;
}

/** A pick matches that project only, by slug or (for older links) id; never its sub-projects (lfx-self-serve#4559). */
function projectFilterPredicate(projects: string[], binds: string[]): string {
  if (!projects.length) {
    return '';
  }
  const placeholders = projects.map(() => '?').join(', ');
  // project_slug / project_id each get the same binds, in order.
  binds.push(...projects, ...projects);
  return `AND (project_slug IN (${placeholders}) OR project_id IN (${placeholders}))`;
}

function employeeFilterPredicate(employees: string[], binds: string[]): string {
  if (!employees.length) {
    return '';
  }
  const placeholders = employees.map(() => '?').join(', ');
  for (const id of employees) {
    binds.push(id);
  }
  return `AND member_id IN (${placeholders})`;
}

function repoOrderByColumn(sort: ContributionsSortColumn): string {
  switch (sort) {
    case 'firstCommit':
      return 'first_commit_ts';
    case 'lastCommit':
      return 'last_commit_ts';
    case 'commits':
      return 'commits';
  }
}

function commitOrderByColumn(sort: ContributionsCommitSortColumn): string {
  switch (sort) {
    case 'project':
      return 'project_name';
    case 'committer':
      return 'member_display_name';
    case 'username':
      return 'github_username';
    case 'date':
      return 'activity_ts';
  }
}

function mapKpis(row: ContributionsKpiRow | undefined): OrgContributionsKpis {
  return {
    projectsWithActivity: row?.PROJECTS_WITH_ACTIVITY ?? 0,
    repositories: row?.REPOSITORIES ?? 0,
    commits: row?.COMMITS ?? 0,
  };
}

function mapProjectOption(row: ContributionsProjectOptionRow): OrgContributionProjectOption {
  return {
    slug: row.PROJECT_SLUG ?? row.PROJECT_ID,
    projectId: row.PROJECT_ID,
    name: row.PROJECT_NAME ?? row.PROJECT_ID,
    commits: row.COMMITS ?? 0,
    foundationId: row.FOUNDATION_ID,
  };
}

function mapEmployeeOption(row: ContributionsEmployeeOptionRow): OrgContributionEmployeeOption {
  return {
    id: row.MEMBER_ID,
    displayName: row.MEMBER_DISPLAY_NAME ?? row.MEMBER_ID,
    commits: row.COMMITS ?? 0,
  };
}

/**
 * Deterministic, key-safe cache-key suffix covering every query field that changes the SQL (filter arrays sorted so
 * member order never fragments the key, and kept as arrays so JSON delimits their values: a value holding a comma
 * cannot collide with two values). A SHA-256 hex digest, so the free-text search cannot grow the key.
 */
function contributionsSignature(query: OrgContributionsQuery): string {
  const parts = [
    query.dateRange,
    query.projectScope,
    query.commitScope,
    query.metric,
    query.view,
    query.search,
    query.sort,
    query.dir,
    query.commitSort,
    query.commitDir,
    query.page,
    query.size,
    query.foundation,
    [...query.projects].sort(),
    [...query.employees].sort(),
    query.teamMembers,
  ];
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function isContributionsRaw(value: unknown): boolean {
  const v = value as Partial<Record<keyof ContributionsRaw, unknown>> | null;
  return (
    !!v &&
    isRowArray(v.kpiRows, 'PROJECTS_WITH_ACTIVITY', 'REPOSITORIES', 'COMMITS') &&
    isRowArray(v.repoRows, 'REPOSITORY_URL') &&
    isRowArray(v.commitRows, 'COMMIT_ID') &&
    isRowArray(v.foundationOptionRows, 'FOUNDATION_ID', 'FOUNDATION_NAME') &&
    isRowArray(v.projectOptionRows, 'PROJECT_ID', 'FOUNDATION_ID') &&
    isRowArray(v.employeeOptionRows, 'MEMBER_ID')
  );
}

/** Array guard that validates every element so a single corrupt/legacy row degrades the whole entry to a cache miss: each element must be a non-null object carrying all required contract keys. */
function isRowArray(value: unknown, ...requiredKeys: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.every((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
      return requiredKeys.every((key) => key in (row as Record<string, unknown>));
    })
  );
}

function mapRepoRow(row: ContributionsRepoRow): OrgContributionRepoRow {
  return {
    repositoryId: row.REPOSITORY_URL,
    repositoryPath: row.REPOSITORY_PATH,
    projectId: row.PROJECT_ID ?? '',
    projectName: row.PROJECT_NAME ?? '—',
    projectSlug: row.PROJECT_SLUG,
    projectLogoUrl: row.PROJECT_LOGO,
    source: row.SOURCE ?? 'git',
    upstreamUrl: row.REPOSITORY_URL,
    commits: row.COMMITS ?? 0,
    firstCommitTs: toIsoTimestamp(row.FIRST_COMMIT_TS),
    lastCommitTs: toIsoTimestamp(row.LAST_COMMIT_TS),
  };
}

function mapCommitRow(row: ContributionsCommitRow): OrgContributionCommitRow {
  // Prefer warehouse person_key (matches detail endpoint); cdp: fallback only when column is null.
  const personKey = row.PERSON_KEY ?? (row.MEMBER_ID ? `cdp:${row.MEMBER_ID}` : null);
  return {
    commitSha: row.COMMIT_ID,
    contributorId: row.MEMBER_ID,
    personKey,
    projectName: row.PROJECT_NAME ?? '—',
    committerName: row.MEMBER_DISPLAY_NAME ?? 'Unknown',
    committerAvatarUrl: row.MEMBER_LOGO,
    committerTitle: null,
    username: parseGithubUsername(row.GITHUB_USERNAME),
    source: row.SOURCE ?? 'git',
    committedTs: toIsoTimestamp(row.ACTIVITY_TS) ?? '',
    message: row.COMMIT_MESSAGE ?? '',
    commitUrl: row.COMMIT_URL,
  };
}

function parseGithubUsername(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.includes('/')) {
    return trimmed.replace(/^@/, '') || null;
  }
  const match = trimmed.match(/github\.com\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function emptyResponse(accountId: string, dateRange: OrgLensTimeRange): OrgContributionsResponse {
  return {
    accountId,
    dateRange,
    kpis: { projectsWithActivity: 0, repositories: 0, commits: 0 },
    repositories: [],
    commits: [],
    foundationOptions: [],
    projectOptions: [],
    employeeOptions: [],
    totalRecords: 0,
    commitsTotalRecords: 0,
  };
}
