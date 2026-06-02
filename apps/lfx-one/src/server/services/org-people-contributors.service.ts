// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_CONTRIBUTORS_RESPONSE } from '@lfx-one/shared/constants';
import type {
  ContributorPersonProjectRow,
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

/** Contributors tab data access — single bundled GET, time-window aggregated server-side per Item 2 A1 lock. */
export class OrgPeopleContributorsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Aggregates contributors-daily to (account, person, project) for the window, rolled up to person-grain with argmax-most-active-project. */
  public async getContributors(accountId: string, timeRange: OrgContributorTimeRange): Promise<OrgContributorsResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange };
    }

    const rows = await this.fetchPersonProjectRows(accountId, timeRange);
    return buildResponse(accountId, timeRange, rows);
  }

  /** Single SQL pass; cutoff inlined as Snowflake `DATEADD(...)` for plan-time folding, only `account_id` is bound. dbt model gates retired projects + bots. */
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

/** Snowflake date-cutoff SQL fragment (inline, not bound) so the planner can fold it; null for 'all' (dbt caps at 3yr rolling). */
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

/** Single O(N) pass over (person, project) rows to populate projects[], contributors[] (argmax most-active), stats, foundationOptions[], projectOptions[]. */
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

/** Most-active tiebreak (Item 4): commits → last_active_date NULLS LAST → name (PROJECT_ID when null) → PROJECT_ID. Returns <0 when `a` beats `b`. */
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
