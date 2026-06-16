// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  ContributionSource,
  ContributionsCommitSortColumn,
  ContributionsDateRange,
  ContributionsSortColumn,
  ContributionsView,
  OrgContributionCommitRow,
  OrgContributionEmployeeOption,
  OrgContributionProjectOption,
  OrgContributionRepoRow,
  OrgContributionsKpis,
  OrgContributionsQuery,
  OrgContributionsResponse,
} from '@lfx-one/shared/interfaces';

import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

const PLATINUM_TABLE = 'ANALYTICS.PLATINUM_LFX_ONE.ORG_CODE_CONTRIBUTIONS';

interface ContributionsKpiRow {
  PROJECTS_WITH_ACTIVITY: number;
  REPOSITORIES: number;
  COMMITS: number;
}

interface ContributionsRepoRow {
  REPOSITORY_URL: string;
  REPOSITORY_PATH: string;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  PROJECT_SLUG: string | null;
  PROJECT_LOGO: string | null;
  SOURCE: ContributionSource;
  COMMITS: number;
  FIRST_COMMIT_TS: Date | string | null;
  LAST_COMMIT_TS: Date | string | null;
  TOTAL_RECORDS: number;
}

interface ContributionsCommitRow {
  COMMIT_ID: string;
  MEMBER_ID: string | null;
  PROJECT_NAME: string | null;
  MEMBER_DISPLAY_NAME: string | null;
  MEMBER_LOGO: string | null;
  GITHUB_USERNAME: string | null;
  SOURCE: ContributionSource;
  ACTIVITY_TS: Date | string | null;
  COMMIT_MESSAGE: string | null;
  COMMIT_URL: string | null;
  TOTAL_RECORDS: number;
}

interface ContributionsProjectOptionRow {
  PROJECT_ID: string;
  PROJECT_SLUG: string | null;
  PROJECT_NAME: string | null;
  PARENT_SLUG: string | null;
  COMMITS: number;
}

interface ContributionsEmployeeOptionRow {
  MEMBER_ID: string;
  MEMBER_DISPLAY_NAME: string | null;
  COMMITS: number;
}

/** Code Contributions page data access (LFXV2-1894) — reads `platinum_lfx_one_org_code_contributions`. */
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

    const scope = buildScopeFilters(query);
    const kpiSearch = buildKpiSearchFilter(query);
    const repoSearch = buildRepoSearchFilter(query.search);
    const commitSearch = buildCommitSearchFilter(query.search);

    const repoPagination = viewAwarePagination(query, 'repositories');
    const commitPagination = viewAwarePagination(query, 'commits');

    const raw = await withOrgCache(
      accountId,
      `contributions:${contributionsSignature(query)}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchContributionsRaw(accountId, query, scope, kpiSearch, repoSearch, commitSearch, repoPagination, commitPagination),
      isContributionsRaw
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
      projectOptions: raw.projectOptionRows.map(mapProjectOption),
      employeeOptions: raw.employeeOptionRows.map(mapEmployeeOption),
      totalRecords,
      commitsTotalRecords,
    };
  }

  private async fetchContributionsRaw(
    accountId: string,
    query: OrgContributionsQuery,
    scope: ScopeFilters,
    kpiSearch: SearchFilter,
    repoSearch: SearchFilter,
    commitSearch: SearchFilter,
    repoPagination: ViewAwarePagination,
    commitPagination: ViewAwarePagination
  ): Promise<{
    kpiRows: ContributionsKpiRow[];
    repoRows: ContributionsRepoRow[];
    commitRows: ContributionsCommitRow[];
    projectOptionRows: ContributionsProjectOptionRow[];
    employeeOptionRows: ContributionsEmployeeOptionRow[];
  }> {
    const [kpiResult, repoResult, commitResult, projectResult, employeeResult] = await Promise.all([
      this.fetchKpis(accountId, scope, kpiSearch),
      this.fetchRepositories(accountId, scope, repoSearch, query, repoPagination),
      this.fetchCommits(accountId, scope, commitSearch, query, commitPagination),
      this.fetchProjectOptionRows(accountId, query.dateRange),
      this.fetchEmployeeOptionRows(accountId, query.dateRange),
    ]);

    return {
      kpiRows: kpiResult.rows,
      repoRows: repoResult.rows,
      commitRows: commitResult.rows,
      projectOptionRows: projectResult.rows,
      employeeOptionRows: employeeResult.rows,
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
        ${scope.projectPredicate}
        ${scope.employeePredicate}
        ${kpiSearch.predicate}
    `;
    return this.snowflakeService.execute<ContributionsKpiRow>(sql, [accountId, ...scope.binds, ...kpiSearch.binds]);
  }

  private async fetchRepositories(
    accountId: string,
    scope: ScopeFilters,
    repoSearch: SearchFilter,
    query: OrgContributionsQuery,
    pagination: ViewAwarePagination
  ): Promise<{ rows: ContributionsRepoRow[] }> {
    const offset = (pagination.page - 1) * pagination.size;
    const orderBy = repoOrderByColumn(query.sort);
    const sortDir = query.dir === 1 ? 'ASC' : 'DESC';

    const sql = `
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
          MIN(org_repo_first_commit_ts) AS first_commit_ts,
          MAX(activity_ts) AS last_commit_ts
        FROM ${PLATINUM_TABLE}
        WHERE account_id = ?
          ${scope.datePredicate}
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
    return this.snowflakeService.execute<ContributionsRepoRow>(sql, [accountId, ...scope.binds, ...repoSearch.binds]);
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
          ${scope.projectPredicate}
          ${scope.employeePredicate}
          ${commitSearch.predicate}
        QUALIFY ROW_NUMBER() OVER (PARTITION BY commit_id ORDER BY activity_ts DESC) = 1
      )
      SELECT
        commit_id,
        member_id,
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
    return this.snowflakeService.execute<ContributionsCommitRow>(sql, [accountId, ...scope.binds, ...commitSearch.binds]);
  }

  private async fetchProjectOptionRows(accountId: string, dateRange: ContributionsDateRange): Promise<{ rows: ContributionsProjectOptionRow[] }> {
    const datePredicate = dateRangePredicate(dateRange);
    const sql = `
      SELECT
        project_id,
        ANY_VALUE(project_slug) AS project_slug,
        ANY_VALUE(project_name) AS project_name,
        ANY_VALUE(parent_slug) AS parent_slug,
        COUNT(DISTINCT commit_id) AS commits
      FROM ${PLATINUM_TABLE}
      WHERE account_id = ?
        ${datePredicate}
        AND project_id IS NOT NULL
      GROUP BY project_id
      ORDER BY commits DESC, project_name ASC
    `;
    return this.snowflakeService.execute<ContributionsProjectOptionRow>(sql, [accountId]);
  }

  private async fetchEmployeeOptionRows(accountId: string, dateRange: ContributionsDateRange): Promise<{ rows: ContributionsEmployeeOptionRow[] }> {
    const datePredicate = dateRangePredicate(dateRange);
    const sql = `
      SELECT
        member_id,
        ANY_VALUE(member_display_name) AS member_display_name,
        COUNT(DISTINCT commit_id) AS commits
      FROM ${PLATINUM_TABLE}
      WHERE account_id = ?
        ${datePredicate}
        AND member_id IS NOT NULL
      GROUP BY member_id
      ORDER BY commits DESC, member_display_name ASC
    `;
    return this.snowflakeService.execute<ContributionsEmployeeOptionRow>(sql, [accountId]);
  }
}

interface ScopeFilters {
  datePredicate: string;
  projectPredicate: string;
  employeePredicate: string;
  binds: string[];
}

interface SearchFilter {
  predicate: string;
  binds: string[];
}

interface ViewAwarePagination {
  page: number;
  size: number;
}

/** Active tab uses client page/size; inactive tab fetches one row at offset 0 only to read COUNT(*) OVER(). */
function viewAwarePagination(query: OrgContributionsQuery, tab: ContributionsView): ViewAwarePagination {
  if (query.view === tab) {
    return { page: query.page, size: query.size };
  }
  return { page: 1, size: 1 };
}

function buildScopeFilters(query: OrgContributionsQuery): ScopeFilters {
  const binds: string[] = [];
  const datePredicate = dateRangePredicate(query.dateRange);
  const projectPredicate = projectFilterPredicate(query.projects, binds);
  const employeePredicate = employeeFilterPredicate(query.employees, binds);
  return { datePredicate, projectPredicate, employeePredicate, binds };
}

function buildKpiSearchFilter(query: OrgContributionsQuery): SearchFilter {
  return query.view === 'commits' ? buildCommitSearchFilter(query.search) : buildRepoSearchFilter(query.search);
}

function buildRepoSearchFilter(search: string): SearchFilter {
  const trimmed = search.trim();
  if (!trimmed) {
    return { predicate: '', binds: [] };
  }
  return { predicate: 'AND repository_path ILIKE ?', binds: [`%${trimmed}%`] };
}

function buildCommitSearchFilter(search: string): SearchFilter {
  const trimmed = search.trim();
  if (!trimmed) {
    return { predicate: '', binds: [] };
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

function dateRangePredicate(dateRange: ContributionsDateRange): string {
  switch (dateRange) {
    case '30d':
      return 'AND activity_ts >= DATEADD(day, -30, CURRENT_TIMESTAMP())';
    case '90d':
      return 'AND activity_ts >= DATEADD(day, -90, CURRENT_TIMESTAMP())';
    case '12mo':
      return 'AND activity_ts >= DATEADD(month, -12, CURRENT_TIMESTAMP())';
    case 'all':
      return '';
  }
}

function projectFilterPredicate(projects: string[], binds: string[]): string {
  if (!projects.length) {
    return '';
  }
  const placeholders = projects.map(() => '?').join(', ');
  // project_slug / parent_slug / project_id each get the same binds, in order.
  for (let i = 0; i < 3; i += 1) {
    binds.push(...projects);
  }
  return `AND (project_slug IN (${placeholders}) OR parent_slug IN (${placeholders}) OR project_id IN (${placeholders}))`;
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
    parentSlug: row.PARENT_SLUG,
  };
}

function mapEmployeeOption(row: ContributionsEmployeeOptionRow): OrgContributionEmployeeOption {
  return {
    id: row.MEMBER_ID,
    displayName: row.MEMBER_DISPLAY_NAME ?? row.MEMBER_ID,
    commits: row.COMMITS ?? 0,
  };
}

/** Deterministic, key-safe cache-key suffix covering every query field that changes the SQL (filter arrays sorted so member order never fragments the key); base64url keeps it to `[A-Za-z0-9_-]`. */
function contributionsSignature(query: OrgContributionsQuery): string {
  const parts = [
    query.dateRange,
    query.view,
    query.search,
    query.sort,
    query.dir,
    query.commitSort,
    query.commitDir,
    query.page,
    query.size,
    [...query.projects].sort().join(','),
    [...query.employees].sort().join(','),
  ];
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

function isContributionsRaw(value: unknown): boolean {
  const v = value as { kpiRows?: unknown; repoRows?: unknown; commitRows?: unknown; projectOptionRows?: unknown; employeeOptionRows?: unknown } | null;
  return (
    !!v &&
    isRowArray(v.kpiRows) &&
    isRowArray(v.repoRows, 'REPOSITORY_URL') &&
    isRowArray(v.commitRows, 'COMMIT_ID') &&
    isRowArray(v.projectOptionRows, 'PROJECT_ID') &&
    isRowArray(v.employeeOptionRows, 'MEMBER_ID')
  );
}

/** Array guard that also samples a representative element so a corrupt/legacy row object degrades to a cache miss: the element must be a non-null object and, when a contract key is given, must carry it. */
function isRowArray(value: unknown, requiredKey?: string): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const first = value[0];
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return false;
  return requiredKey === undefined || requiredKey in (first as Record<string, unknown>);
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
  return {
    commitSha: row.COMMIT_ID,
    contributorId: row.MEMBER_ID,
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

function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const isoLike = value.includes(' ') ? value.replace(' ', 'T') : value;
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}

function emptyResponse(accountId: string, dateRange: ContributionsDateRange): OrgContributionsResponse {
  return {
    accountId,
    dateRange,
    kpis: { projectsWithActivity: 0, repositories: 0, commits: 0 },
    repositories: [],
    commits: [],
    projectOptions: [],
    employeeOptions: [],
    totalRecords: 0,
    commitsTotalRecords: 0,
  };
}
