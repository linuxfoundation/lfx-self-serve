// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  ContributionsDateRange,
  OrgContributionCommitRow,
  OrgContributionRepoRow,
  OrgContributionsKpis,
  OrgContributionsQuery,
  OrgContributionsResponse,
} from '@lfx-one/shared/interfaces';

import { DEMO_COMMIT_FEED, DEMO_EMPLOYEE_OPTIONS, DEMO_EMPLOYEE_USERNAMES, DEMO_PROJECT_OPTIONS, DEMO_REPO_EMPLOYEES, DEMO_REPOS } from './org-contributions.demo';

/**
 * Code Contributions page data access (LFXV2-1894).
 *
 * SCAFFOLD: this worktree serves curated demo-company data (see `org-contributions.demo.ts`)
 * rather than querying real Salesforce / Snowflake. Filters, sort, and pagination are applied
 * over the demo set so the page behaves end-to-end. The follow-up data pass swaps the demo
 * source for LFX Insights queries (repositories index, commit rollups, org-affiliation
 * precedence explicit > email-domain > EasyCLA, rolling-365 trends) behind this same method.
 */
export class OrgContributionsService {
  /** Repositories table + KPI strip + filter options, server-paginated over the active filter scope. */
  public async getContributions(accountId: string, query: OrgContributionsQuery): Promise<OrgContributionsResponse> {
    // TODO(LFXV2-1894): replace demo source with Snowflake dbt models (repositories index + commit rollups).
    const filtered = this.filterRepos(query);
    const sorted = sortRepos(filtered, query);
    const page = paginate(sorted, query);

    return {
      accountId,
      dateRange: query.dateRange,
      kpis: buildKpis(filtered),
      repositories: page,
      commits: filterCommitFeed(query),
      projectOptions: DEMO_PROJECT_OPTIONS,
      employeeOptions: DEMO_EMPLOYEE_OPTIONS,
      totalRecords: filtered.length,
    };
  }

  /** Compose all four filters (AND) over the demo repos. Search scopes the Repository path only. */
  private filterRepos(query: OrgContributionsQuery): OrgContributionRepoRow[] {
    const projectScope = expandProjectSelection(query.projects);
    const cutoffMs = dateRangeCutoffMs(query.dateRange);
    const search = query.search.toLowerCase();

    return DEMO_REPOS.filter((repo) => {
      if (projectScope && !projectScope.has(repo.projectSlug ?? '')) {
        return false;
      }
      if (query.employees.length) {
        const contributors = DEMO_REPO_EMPLOYEES[repo.repositoryId] ?? [];
        if (!query.employees.some((id) => contributors.includes(id))) {
          return false;
        }
      }
      if (search && !repo.repositoryPath.toLowerCase().includes(search)) {
        return false;
      }
      if (cutoffMs !== null) {
        const lastMs = repo.lastCommitTs ? new Date(repo.lastCommitTs).getTime() : 0;
        if (lastMs < cutoffMs) {
          return false;
        }
      }
      return true;
    });
  }
}

/** Build the set of leaf project slugs a selection covers — a parent foundation pulls in all its children. */
function expandProjectSelection(selected: string[]): Set<string> | null {
  if (!selected.length) {
    return null;
  }
  const scope = new Set<string>();
  for (const slug of selected) {
    scope.add(slug);
    for (const option of DEMO_PROJECT_OPTIONS) {
      if (option.parentSlug === slug) {
        scope.add(option.slug);
      }
    }
  }
  return scope;
}

/** Resolve a project selection to the set of project *names* it covers (parents expand to children), or null when nothing is selected. */
function projectNamesForSelection(selected: string[]): Set<string> | null {
  const slugs = expandProjectSelection(selected);
  if (!slugs) {
    return null;
  }
  const names = new Set<string>();
  for (const option of DEMO_PROJECT_OPTIONS) {
    if (slugs.has(option.slug)) {
      names.add(option.name);
    }
  }
  return names;
}

/** Epoch-ms cutoff for the window, or null for `all`. */
function dateRangeCutoffMs(dateRange: ContributionsDateRange): number | null {
  const day = 86_400_000;
  switch (dateRange) {
    case '30d':
      return Date.now() - 30 * day;
    case '90d':
      return Date.now() - 90 * day;
    case '12mo':
      return Date.now() - 365 * day;
    case 'all':
      return null;
  }
}

function sortRepos(repos: OrgContributionRepoRow[], query: OrgContributionsQuery): OrgContributionRepoRow[] {
  const copy = [...repos];
  copy.sort((a, b) => {
    switch (query.sort) {
      case 'commits':
        return (a.commits - b.commits) * query.dir;
      case 'firstCommit':
        return (tsMs(a.firstCommitTs) - tsMs(b.firstCommitTs)) * query.dir;
      case 'lastCommit':
        return (tsMs(a.lastCommitTs) - tsMs(b.lastCommitTs)) * query.dir;
    }
  });
  return copy;
}

/** Org-wide Commits feed filter: Date Range bounds the window; Search scopes message/project/committer; Employees narrows by handle. */
function filterCommitFeed(query: OrgContributionsQuery): OrgContributionCommitRow[] {
  const cutoffMs = dateRangeCutoffMs(query.dateRange);
  const search = query.search.toLowerCase();
  const projectNames = projectNamesForSelection(query.projects);
  const usernames = new Set(query.employees.map((id) => DEMO_EMPLOYEE_USERNAMES[id]).filter((name): name is string => !!name));
  return DEMO_COMMIT_FEED.filter((commit) => {
    if (cutoffMs !== null && new Date(commit.committedTs).getTime() < cutoffMs) {
      return false;
    }
    if (projectNames && !projectNames.has(commit.projectName)) {
      return false;
    }
    if (usernames.size && (!commit.username || !usernames.has(commit.username))) {
      return false;
    }
    if (search) {
      const haystack = `${commit.message} ${commit.projectName} ${commit.committerName} ${commit.username ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

function buildKpis(repos: OrgContributionRepoRow[]): OrgContributionsKpis {
  return {
    // Count distinct projects by projectId — projectSlug is nullable and would collapse null-slug repos together.
    projectsWithActivity: new Set(repos.map((r) => r.projectId)).size,
    repositories: repos.length,
    commits: repos.reduce((acc, r) => acc + r.commits, 0),
  };
}

function paginate<T>(rows: T[], query: OrgContributionsQuery): T[] {
  const start = (query.page - 1) * query.size;
  return rows.slice(start, start + query.size);
}

function tsMs(iso: string | null): number {
  return iso ? new Date(iso).getTime() : 0;
}
