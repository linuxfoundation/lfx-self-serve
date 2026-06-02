// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_CONTRIBUTORS_RESPONSE } from '@lfx-one/shared/constants';
import type {
  OrgContributorFoundationOption,
  OrgContributorProjectOption,
  OrgContributorProjectRow,
  OrgContributorRow,
  OrgContributorsResponse,
  OrgContributorStatsBaseline,
  OrgContributorTimeRange,
} from '@lfx-one/shared/interfaces';

import { toIsoDate } from '../helpers/date-format.helper';
import { SnowflakeService } from './snowflake.service';

/** Raw per-(person, project) aggregate row returned by the Snowflake query — server-internal shape. */
interface ContributorPersonProjectRow {
  PERSON_KEY: string;
  PROJECT_ID: string;
  LFID: string | null;
  LF_USERNAME: string | null;
  CDP_MEMBER_ID: string;
  DISPLAY_NAME: string | null;
  TITLE: string | null;
  PROJECT_NAME: string | null;
  PROJECT_SLUG: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  FOUNDATION_SLUG: string | null;
  COMMITS: number | null;
  CODE_ACTIVITIES: number | null;
  LAST_ACTIVE_DATE: Date | string | null;
  IS_DECLARED_MAINTAINER_FOR_PROJECT: boolean | null;
  IS_DECLARED_MAINTAINER_FOR_ORG: boolean | null;
}

/** Contributors tab data access — single bundled GET, time-window aggregated server-side per Item 2 A1 lock. */
export class OrgPeopleContributorsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Aggregates the contributors-daily platinum to (account, person, project)
   * grain for the requested window, then rolls up to person-grain rows with
   * argmax-most-active-project pre-computed. Stats + filter dropdown options
   * are derived from the same scope so the client side never re-queries.
   */
  public async getContributors(accountId: string, timeRange: OrgContributorTimeRange): Promise<OrgContributorsResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange };
    }

    const rows = await this.fetchPersonProjectRows(accountId, timeRange);
    return buildResponse(accountId, timeRange, rows);
  }

  /**
   * One SQL pass produces every metric the tab needs. The time-window cutoff
   * is inlined into the query as a Snowflake `DATEADD(...)` expression (see
   * `timeRangeCutoffSnowflake`) so the planner can fold it at compile time;
   * the only user-controlled value (`account_id`) stays bound. The dbt model
   * already gates `is_segment_active = TRUE` and `member_is_bot = FALSE`, so
   * retired projects and bot rows never enter — no filter needed here.
   */
  private async fetchPersonProjectRows(accountId: string, timeRange: OrgContributorTimeRange): Promise<ContributorPersonProjectRow[]> {
    const cutoffSnowflake = timeRangeCutoffSnowflake(timeRange);
    const datePredicate = cutoffSnowflake ? `AND activity_date >= ${cutoffSnowflake}` : '';

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
        SUM(daily_commits) AS commits,
        SUM(daily_code_activities) AS code_activities,
        MAX(activity_date) AS last_active_date,
        BOOLOR_AGG(is_declared_maintainer_for_project) AS is_declared_maintainer_for_project,
        BOOLOR_AGG(is_declared_maintainer_for_org) AS is_declared_maintainer_for_org
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ?
        ${datePredicate}
      GROUP BY person_key, project_id
    `;

    const result = await this.snowflakeService.execute<ContributorPersonProjectRow>(query, [accountId]);
    return result.rows;
  }
}

/**
 * Snowflake date-cutoff SQL fragment for a time-window selection. Returned as
 * an inline SQL expression (not a bind) so Snowflake's query compiler can fold
 * it at plan time; the only user-controlled value (`accountId`) stays bound.
 * `all` returns null — the dbt model already caps activity at 3 years rolling,
 * so an unfiltered query is the natural "All Time = 3yr proxy" surface.
 */
function timeRangeCutoffSnowflake(timeRange: OrgContributorTimeRange): string | null {
  switch (timeRange) {
    case '30d':
      return 'DATEADD(day, -30, CURRENT_DATE())';
    case '90d':
      return 'DATEADD(day, -90, CURRENT_DATE())';
    case '12mo':
      return 'DATEADD(month, -12, CURRENT_DATE())';
    case 'all':
      return null;
  }
}

/**
 * Wire-shape projection. Walks the per-(person, project) rows once to populate:
 *   - `projects[]` — the expansion-grain sub-rows (1:1 from input)
 *   - `contributors[]` — person-grain parent rows with argmax-most-active-project
 *   - `stats` — distinct counts per Item 3 lock
 *   - `foundationOptions[]` / `projectOptions[]` — dedup + sort for the dropdowns
 * No second SQL pass; total work is O(N) where N = person×project rows for the window.
 */
function buildResponse(accountId: string, timeRange: OrgContributorTimeRange, raw: ContributorPersonProjectRow[]): OrgContributorsResponse {
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
      role: row.IS_DECLARED_MAINTAINER_FOR_PROJECT === true ? 'Maintainer' : 'Contributor',
      commits: row.COMMITS ?? 0,
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
    const commits = row.COMMITS ?? 0;
    const lastActiveTs = projectRow.lastActiveTs;
    if (!existing) {
      personMap.set(row.PERSON_KEY, {
        personKey: row.PERSON_KEY,
        displayName: row.DISPLAY_NAME ?? row.CDP_MEMBER_ID,
        title: row.TITLE,
        lfid: row.LFID,
        lfUsername: row.LF_USERNAME,
        cdpMemberId: row.CDP_MEMBER_ID,
        role: row.IS_DECLARED_MAINTAINER_FOR_ORG === true ? 'Maintainer' : 'Contributor',
        commits,
        lastActiveTs,
        projectsCount: 1,
        mostActiveProjectName: row.PROJECT_NAME ?? row.PROJECT_ID,
        mostActiveProjectFoundationName: row.FOUNDATION_NAME,
      });
      personMostActive.set(row.PERSON_KEY, row);
    } else {
      existing.commits += commits;
      existing.projectsCount += 1;
      if (lastActiveTs && (!existing.lastActiveTs || lastActiveTs > existing.lastActiveTs)) {
        existing.lastActiveTs = lastActiveTs;
      }
      // Maintainer-for-org is denormalized to every (person, *) row but BOOLOR_AGG is paranoid against partial NULLs upstream.
      if (row.IS_DECLARED_MAINTAINER_FOR_ORG === true && existing.role !== 'Maintainer') {
        existing.role = 'Maintainer';
      }
      const currentMost = personMostActive.get(row.PERSON_KEY);
      if (currentMost && compareMostActive(row, currentMost) < 0) {
        personMostActive.set(row.PERSON_KEY, row);
        existing.mostActiveProjectName = row.PROJECT_NAME ?? row.PROJECT_ID;
        existing.mostActiveProjectFoundationName = row.FOUNDATION_NAME;
      }
    }
  }

  const contributors = Array.from(personMap.values());
  const stats = computeStats(contributors, distinctProjectIds.size, distinctFoundationIds.size);

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

/**
 * Most-active-project tiebreak chain per Item 4 lock:
 *   1. Higher commits first
 *   2. More recent `last_active_date` (NULLs sort last)
 *   3. Alphabetical project name (falling back to `PROJECT_ID` when name is null)
 *   4. `PROJECT_ID` as the final deterministic tiebreaker
 * Returns < 0 when `a` should beat `b`. The `PROJECT_ID` fallbacks guarantee a
 * stable order across runs even if two rows happen to tie on commits + date
 * and one (or both) PROJECT_NAME is null — without this, sort order would be
 * non-deterministic for those edge-case pairs.
 */
function compareMostActive(a: ContributorPersonProjectRow, b: ContributorPersonProjectRow): number {
  const commitsDelta = (b.COMMITS ?? 0) - (a.COMMITS ?? 0);
  if (commitsDelta !== 0) return commitsDelta;
  const ta = toIsoDate(a.LAST_ACTIVE_DATE) ?? '';
  const tb = toIsoDate(b.LAST_ACTIVE_DATE) ?? '';
  if (ta !== tb) return ta > tb ? -1 : 1;
  const nameDelta = (a.PROJECT_NAME ?? a.PROJECT_ID).localeCompare(b.PROJECT_NAME ?? b.PROJECT_ID);
  if (nameDelta !== 0) return nameDelta;
  return a.PROJECT_ID.localeCompare(b.PROJECT_ID);
}

/** Item 3 lock: distinct people by role, distinct projects, distinct (non-null) foundations — all over the BFF response, not the active filter. */
function computeStats(contributors: OrgContributorRow[], projects: number, foundations: number): OrgContributorStatsBaseline {
  let maintainers = 0;
  for (const c of contributors) {
    if (c.role === 'Maintainer') maintainers++;
  }
  return {
    maintainers,
    contributors: contributors.length - maintainers,
    projects,
    foundations,
  };
}
