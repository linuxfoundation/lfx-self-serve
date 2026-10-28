// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_CONTRIBUTORS_RESPONSE, ORG_CONTRIBUTOR_PROJECT_COLUMNS, ORG_CONTRIBUTOR_ROW_COLUMNS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  CompactOrgContributorRowsCache,
  ContributorPersonProjectRow,
  ContributorCountColumn,
  OrgCommitFilters,
  OrgContributorFoundationOption,
  OrgContributorMaintainerRoleRow,
  OrgContributorProjectOption,
  OrgContributorProjectRow,
  OrgContributorRow,
  OrgContributorsResponse,
  OrgContributorStatsBaseline,
  OrgLensTimeRange,
  OrgProjectScope,
} from '@lfx-one/shared/interfaces';
import {
  dedupeByKey,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  orgLensTimeRangeDays,
  toColumnar,
  tupleKey,
} from '@lfx-one/shared/utils';

import { toIsoDate } from '../helpers/date-format.helper';
import { orgMaintainerRoleOverlap, readMaintainerRoles } from '../helpers/org-maintainer-roles-sql.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache, withOrgCompactCache } from './valkey.service';

/** Contributors tab data access — single bundled GET, time-window aggregated server-side per Item 2 A1 lock. */
export class OrgPeopleContributorsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Aggregates contributors-daily to (account, person, project) for the window and project scope, rolled up to
   * person-grain with argmax-most-active-project. `commits` follows the commit scope; `codeActivities` is always
   * sent so the tab can switch metric; the most-active project follows the metric. Maintainer badges and the
   * Maintainer roles tile come from the account's roles overlapping the same window and scope (lfx-self-serve#4482).
   */
  public async getContributors(accountId: string, timeRange: OrgLensTimeRange, filters: OrgCommitFilters): Promise<OrgContributorsResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange };
    }

    // `people-contributors:v5:{timeRange}:{projectScope}` (lfx-self-serve#4482): the rows no longer carry the
    // declared-maintainer flags, so a `v4` entry must miss. The commit scope and metric only pick counts after the
    // read, so they share the entry.
    const [rows, roles] = await Promise.all([
      withOrgCompactCache(
        accountId,
        `people-contributors:v5:${timeRange}:${filters.projectScope}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchPersonProjectRows(accountId, timeRange, filters.projectScope),
        { encode: encodeContributorRows, decode: decodeContributorRows, accept: isCompactContributorRows }
      ),
      withOrgCache(
        accountId,
        `people-contributors-roles:v1:${timeRange}:${filters.projectScope}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchMaintainerRoles(accountId, timeRange, filters.projectScope),
        isMaintainerRoleRows,
        // `null` (roles table missing) is served as unavailable — no badges, no tile count — and never stored.
        (value) => value !== null
      ),
    ]);
    return buildResponse(accountId, timeRange, filters, rows, roles);
  }

  /**
   * Single SQL pass; cutoff and scope inlined (allow-listed) so the planner can fold them, only `account_id` is bound. dbt model gates bots.
   * A commit can be authored on an LF and a non-LF project (a mirror). `daily_commits` credits it once across all
   * projects, so a scoped read sums `daily_scope_commits`, which credits it once within the row's own scope: the
   * per-scope count then matches the Code page's distinct commits for that scope.
   */
  private async fetchPersonProjectRows(accountId: string, timeRange: OrgLensTimeRange, projectScope: OrgProjectScope): Promise<ContributorPersonProjectRow[]> {
    const cutoffSnowflake = timeRangeCutoffSnowflake(timeRange);
    const datePredicate = cutoffSnowflake ? `AND activity_date >= ${cutoffSnowflake}` : '';
    const [commitsColumn, mergedCommitsColumn] =
      projectScope === 'all' ? ['daily_commits', 'daily_merged_commits'] : ['daily_scope_commits', 'daily_scope_merged_commits'];

    const query = `
      SELECT
        person_key,
        project_id,
        MAX(lfid) AS lfid,
        MAX(lf_username) AS lf_username,
        MIN(cdp_member_id) AS cdp_member_id,
        MAX(display_name) AS display_name,
        MAX(title) AS title,
        MAX(project_name) AS project_name,
        MAX(project_slug) AS project_slug,
        MAX(foundation_id) AS foundation_id,
        MAX(foundation_name) AS foundation_name,
        MAX(foundation_slug) AS foundation_slug,
        SUM(${commitsColumn}) AS commits,
        SUM(${mergedCommitsColumn}) AS merged_commits,
        SUM(daily_code_activities) AS code_activities,
        MAX(activity_date) AS last_active_date
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ?
        ${datePredicate}
        ${orgProjectScopePredicate(projectScope)}
      GROUP BY person_key, project_id
    `;

    const result = await this.snowflakeService.execute<ContributorPersonProjectRow>(query, [accountId]);
    return result.rows;
  }

  /** The account's maintainer roles overlapping the window in the project scope, whether or not the person has code in it; `null` when the roles table is missing. */
  private fetchMaintainerRoles(
    accountId: string,
    timeRange: OrgLensTimeRange,
    projectScope: OrgProjectScope
  ): Promise<OrgContributorMaintainerRoleRow[] | null> {
    const overlap = orgMaintainerRoleOverlap(timeRange);
    const query = `
      SELECT PERSON_KEY, MEMBER_ID, SEGMENT_ID, PROJECT_ID
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ?
        AND ${overlap.sql}
        ${orgProjectScopePredicate(projectScope, 'IS_LF_PROJECT')}
    `;
    return readMaintainerRoles<OrgContributorMaintainerRoleRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES', query, [accountId, ...overlap.binds]);
  }
}

/** Snowflake date-cutoff SQL fragment (inline, not bound — the day count comes from the allow-listed range) so the planner can fold it; null for 'all' (all time — the dbt model keeps the full history). */
function timeRangeCutoffSnowflake(timeRange: OrgLensTimeRange): string | null {
  return timeRange === 'all' ? null : `DATEADD(day, -${orgLensTimeRangeDays(timeRange)}, CURRENT_DATE())`;
}

/**
 * Single O(N) pass over (person, project) rows to populate projects[], contributors[] (argmax most-active by the
 * metric), stats, foundationOptions[], projectOptions[]. `commits` is the commit scope's column (authored or merged).
 * A person is a Maintainer when they hold a role in `roles`; a project row, when they hold one on that project.
 * `roles` is `null` when the roles table is missing: nobody is badged and the Maintainer roles stat is `null`.
 */
function buildResponse(
  accountId: string,
  timeRange: OrgLensTimeRange,
  filters: OrgCommitFilters,
  raw: ContributorPersonProjectRow[],
  roles: OrgContributorMaintainerRoleRow[] | null
): OrgContributorsResponse {
  const maintainerPeople = new Set((roles ?? []).map((role) => role.PERSON_KEY));
  const maintainerPersonProjects = new Set((roles ?? []).map((role) => tupleKey([role.PERSON_KEY, role.PROJECT_ID])));
  const commitsColumn: ContributorCountColumn = filters.commitScope === 'merged' ? 'MERGED_COMMITS' : 'COMMITS';
  const mostActiveColumn: ContributorCountColumn = filters.metric === 'code' ? 'CODE_ACTIVITIES' : commitsColumn;
  const projects: OrgContributorProjectRow[] = [];
  const personMap = new Map<string, OrgContributorRow>();
  const personMostActive = new Map<string, ContributorPersonProjectRow>();
  const foundationMap = new Map<string, OrgContributorFoundationOption>();
  const projectMap = new Map<string, OrgContributorProjectOption>();
  const distinctProjectIds = new Set<string>();
  const distinctFoundationIds = new Set<string>();

  for (const row of raw) {
    const projectRow: OrgContributorProjectRow = {
      personKey: row.PERSON_KEY,
      projectId: row.PROJECT_ID,
      projectName: row.PROJECT_NAME ?? row.PROJECT_ID,
      projectSlug: row.PROJECT_SLUG,
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
      foundationSlug: row.FOUNDATION_SLUG,
      role: maintainerPersonProjects.has(tupleKey([row.PERSON_KEY, row.PROJECT_ID])) ? 'Maintainer' : 'Contributor',
      commits: row[commitsColumn] ?? 0,
      codeActivities: row.CODE_ACTIVITIES ?? 0,
      lastActiveTs: toIsoDate(row.LAST_ACTIVE_DATE),
    };
    projects.push(projectRow);

    distinctProjectIds.add(row.PROJECT_ID);
    if (row.FOUNDATION_ID) distinctFoundationIds.add(row.FOUNDATION_ID);

    if (row.FOUNDATION_ID && row.FOUNDATION_NAME && !foundationMap.has(row.FOUNDATION_ID)) {
      foundationMap.set(row.FOUNDATION_ID, { foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME });
    }
    if (!projectMap.has(row.PROJECT_ID)) {
      projectMap.set(row.PROJECT_ID, {
        projectId: row.PROJECT_ID,
        projectName: row.PROJECT_NAME ?? row.PROJECT_ID,
        foundationName: row.FOUNDATION_NAME,
      });
    }

    const existing = personMap.get(row.PERSON_KEY);
    const commits = row[commitsColumn] ?? 0;
    const codeActivities = row.CODE_ACTIVITIES ?? 0;
    const lastActiveTs = projectRow.lastActiveTs;
    if (!existing) {
      personMap.set(row.PERSON_KEY, {
        personKey: row.PERSON_KEY,
        displayName: row.DISPLAY_NAME ?? row.CDP_MEMBER_ID,
        title: row.TITLE,
        lfid: row.LFID,
        lfUsername: row.LF_USERNAME,
        cdpMemberId: row.CDP_MEMBER_ID,
        role: maintainerPeople.has(row.PERSON_KEY) ? 'Maintainer' : 'Contributor',
        commits,
        codeActivities,
        lastActiveTs,
        projectsCount: 1,
        mostActiveProjectName: row.PROJECT_NAME ?? row.PROJECT_ID,
        mostActiveProjectFoundationName: row.FOUNDATION_NAME,
      });
      personMostActive.set(row.PERSON_KEY, row);
    } else {
      existing.commits += commits;
      existing.codeActivities += codeActivities;
      existing.projectsCount += 1;
      if (lastActiveTs && (!existing.lastActiveTs || lastActiveTs > existing.lastActiveTs)) {
        existing.lastActiveTs = lastActiveTs;
      }
      const currentMost = personMostActive.get(row.PERSON_KEY);
      if (currentMost && compareMostActive(row, currentMost, mostActiveColumn) < 0) {
        personMostActive.set(row.PERSON_KEY, row);
        existing.mostActiveProjectName = row.PROJECT_NAME ?? row.PROJECT_ID;
        existing.mostActiveProjectFoundationName = row.FOUNDATION_NAME;
      }
    }
  }

  const contributors = Array.from(personMap.values());
  const stats = computeStats(roles, contributors.length, distinctProjectIds.size, distinctFoundationIds.size);

  const foundationOptions = Array.from(foundationMap.values()).sort((a, b) => a.foundationName.localeCompare(b.foundationName));
  const projectOptions = Array.from(projectMap.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));

  return {
    accountId,
    timeRange,
    contributors,
    projects,
    foundationOptions,
    projectOptions,
    stats,
  };
}

/** Most-active tiebreak (Item 4): the count column → last_active_date NULLS LAST → name (PROJECT_ID when null) → PROJECT_ID. Returns <0 when `a` beats `b`. */
function compareMostActive(a: ContributorPersonProjectRow, b: ContributorPersonProjectRow, column: ContributorCountColumn): number {
  const countDelta = (b[column] ?? 0) - (a[column] ?? 0);
  if (countDelta !== 0) return countDelta;
  const ta = toIsoDate(a.LAST_ACTIVE_DATE) ?? '';
  const tb = toIsoDate(b.LAST_ACTIVE_DATE) ?? '';
  if (ta !== tb) return ta > tb ? -1 : 1;
  const nameDelta = (a.PROJECT_NAME ?? a.PROJECT_ID).localeCompare(b.PROJECT_NAME ?? b.PROJECT_ID);
  if (nameDelta !== 0) return nameDelta;
  return a.PROJECT_ID.localeCompare(b.PROJECT_ID);
}

/**
 * Item 3 lock: all over the BFF response, not the active filter. Maintainer roles are distinct (member, Insights
 * project) pairs overlapping the window, with or without code (`null` when the roles are unavailable); Contributors
 * are everyone with code in it.
 */
function computeStats(
  roles: OrgContributorMaintainerRoleRow[] | null,
  contributors: number,
  projects: number,
  foundations: number
): OrgContributorStatsBaseline {
  return {
    maintainerRoles: roles === null ? null : new Set(roles.map((role) => tupleKey([role.MEMBER_ID, role.SEGMENT_ID]))).size,
    contributors,
    projects,
    foundations,
  };
}

/**
 * Compacts the aggregate rows for Valkey storage (GH-1906).
 *
 * The grain is (person, project), so a person who contributes to twenty projects carries their
 * identity twenty times and, worse, each of those rows repeats the project's and foundation's id,
 * name and slug. Storing those six project-level columns once per distinct project and referencing
 * them by index — on top of dropping the 17 repeated uppercase column names via columnar storage —
 * is what brings the 'all' window back under the write cap.
 */
function encodeContributorRows(rows: ContributorPersonProjectRow[]): CompactOrgContributorRowsCache {
  // Keyed on the whole tuple, not on PROJECT_ID: the project-level columns are `MAX()` aggregates
  // per (person, project), so two rows for one project could in principle disagree, and collapsing
  // them onto the first one seen would make the decoded rows differ from the uncached ones.
  // Keyed once per row and reused for both the dictionary and the index array: the key is the
  // expensive part of the encode, and computing it twice per row bought nothing.
  const keys = new Map<ContributorPersonProjectRow, string>(
    rows.map((row) => [row, tupleKey([row.PROJECT_ID, row.PROJECT_NAME, row.PROJECT_SLUG, row.FOUNDATION_ID, row.FOUNDATION_NAME, row.FOUNDATION_SLUG])])
  );
  const projects = dedupeByKey(rows, (row) => keys.get(row)!);

  return {
    projects: toColumnar(projects.values, ORG_CONTRIBUTOR_PROJECT_COLUMNS),
    rows: toColumnar(rows, ORG_CONTRIBUTOR_ROW_COLUMNS),
    // Every row was part of the set `projects` was built from, so the lookup always resolves.
    rowProjects: rows.map((row) => projects.indexOf.get(keys.get(row)!)!),
  };
}

/** Rebuilds the aggregate rows {@link encodeContributorRows} stored, so `buildResponse` sees exactly what a cache miss would hand it. */
function decodeContributorRows(value: CompactOrgContributorRowsCache): ContributorPersonProjectRow[] {
  const projects = fromColumnar<ContributorPersonProjectRow>(value.projects);
  const rows = fromColumnar<ContributorPersonProjectRow>(value.rows);
  rows.forEach((row, index) => Object.assign(row, projects[value.rowProjects[index]]));
  return rows;
}

function isCompactContributorRows(value: unknown): boolean {
  const cache = value as Partial<CompactOrgContributorRowsCache> | null;
  if (!cache || typeof cache !== 'object' || !isColumnarTable(cache.projects) || !isColumnarTable(cache.rows)) {
    return false;
  }
  // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
  // "successfully" into rows missing data the writer always emits, which is worse than a miss —
  // the tab renders with holes in it for the rest of the TTL instead of refetching.
  if (!hasExactColumns(cache.projects, ORG_CONTRIBUTOR_PROJECT_COLUMNS) || !hasExactColumns(cache.rows, ORG_CONTRIBUTOR_ROW_COLUMNS)) {
    return false;
  }
  // Exact columns prove the SHAPE; these prove the VALUES, and both are needed — the column check
  // does NOT subsume them. A current-shape entry whose required cell is absent or mistyped decodes
  // into a row the mapper then reads, so it has to be a miss.
  // A guard must never be STRICTER than the uncached path: the mapper passes a null column straight
  // through, so demanding a string would turn one null row into a permanent miss for that org.
  // Absence and wrong types are still rejected — those the mapper cannot survive.
  const personKeyIndex = ORG_CONTRIBUTOR_ROW_COLUMNS.indexOf('PERSON_KEY');
  const memberIdIndex = ORG_CONTRIBUTOR_ROW_COLUMNS.indexOf('CDP_MEMBER_ID');
  const projectIdIndex = ORG_CONTRIBUTOR_PROJECT_COLUMNS.indexOf('PROJECT_ID');
  // `CDP_MEMBER_ID` may be null, not just a string: the query fills it with `MIN(cdp_member_id)`, and
  // an aggregate over an all-NULL group returns NULL. Prod held no such group when this was written,
  // but the cache must never be stricter than the uncached path — which passes a NULL straight
  // through — or one such row would make that org's entry a permanent miss.
  if (
    !cache.rows.r.every((row) => isStoredNullableString(row[personKeyIndex]) && isStoredNullableString(row[memberIdIndex])) ||
    !cache.projects.r.every((row) => isStoredNullableString(row[projectIdIndex]))
  ) {
    return false;
  }
  // Every reference must resolve, so the decode can rebuild each row in full rather than silently
  // emitting one with no project at all — a truncated entry is a miss, not a partial hit.
  const projectCount = cache.projects.r.length;
  return (
    Array.isArray(cache.rowProjects) &&
    cache.rowProjects.length === cache.rows.r.length &&
    cache.rowProjects.every((index) => Number.isInteger(index) && index >= 0 && index < projectCount)
  );
}

/** A required stored cell: present (not the absence marker) and a string. */
function isStoredString(cell: unknown): boolean {
  return typeof cell === 'string' && !isColumnarAbsent(cell);
}

/** As {@link isStoredString}, but `null` is a legal warehouse value the uncached mapper already handles. */
function isStoredNullableString(cell: unknown): boolean {
  return cell === null || isStoredString(cell);
}

/** A stored roles entry is an array of rows whose keys are all strings; anything else is a miss. */
function isMaintainerRoleRows(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((row: Partial<OrgContributorMaintainerRoleRow> | null) =>
      (['PERSON_KEY', 'MEMBER_ID', 'SEGMENT_ID', 'PROJECT_ID'] as const).every((column) => typeof row?.[column] === 'string')
    )
  );
}
