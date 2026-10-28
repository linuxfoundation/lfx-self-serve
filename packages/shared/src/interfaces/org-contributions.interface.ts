// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgCommitFilters } from './org-commit-filters.interface';
import type { OrgLensTimeRange } from './org-lens-time-range.interface';
import type { OrgContributorFoundationOption } from './org-people-contributors.interface';

// Org Lens → Code Contributions page (LFXV2-1894). Source of truth is LFX Insights
// (CrowdSource pipeline ingesting GitHub / GitLab / Gerrit). All shapes here are
// derived/read-only — the page never mutates contribution data.

/** Upstream system a repository's commits flow from — inferred from the repo's upstream URL. */
export type ContributionSource = 'git' | 'github' | 'gitlab' | 'gerrit';

/** Sortable columns on the Repositories table. */
export type ContributionsSortColumn = 'commits' | 'firstCommit' | 'lastCommit';

/** Sort direction — `1` ascending, `-1` descending. */
export type ContributionsSortDirection = 1 | -1;

/** The three KPI-strip values. Plain stat cards per the LFX Self Serve pattern — no trend chip or freshness stamp. */
export interface OrgContributionsKpis {
  /** Distinct projects with >= 1 commit by an affiliated org member in scope. */
  projectsWithActivity: number;
  /** Distinct repos active in scope. */
  repositories: number;
  /** Total commits by affiliated org members across the active date-range scope. */
  commits: number;
}

/** One row in the Repositories table — commit counts scoped to the active filters. */
export interface OrgContributionRepoRow {
  repositoryId: string;
  /** Full path, e.g. `kubernetes/kubernetes`. */
  repositoryPath: string;
  projectId: string;
  projectName: string;
  projectSlug: string | null;
  projectLogoUrl: string | null;
  /** Source badge — inferred from `upstreamUrl`. */
  source: ContributionSource;
  upstreamUrl: string | null;
  /** Commit count by affiliated org members in the active filter scope. */
  commits: number;
  /** Earliest commit by any affiliated org member — lifetime, not scoped by date range. */
  firstCommitTs: string | null;
  /** Latest commit by any affiliated org member within scope. */
  lastCommitTs: string | null;
}

/** Project filter option. A pick matches that project only, never its sub-projects (lfx-self-serve#4559). */
export interface OrgContributionProjectOption {
  slug: string;
  projectId: string;
  name: string;
  /** Per-project count in the window and project type, shown as rich subtext in the select. */
  commits: number;
  /** Foundation the project rolls up to (same id as People → Contributors), or null when it has none. */
  foundationId: string | null;
}

/** Employee filter option. Per spec the real list is scoped to employees with >= 1 commit in the current Project + Date-Range scope; the demo scaffold returns the full employee catalog (scoping lands in the data pass). */
export interface OrgContributionEmployeeOption {
  id: string;
  displayName: string;
  commits: number;
}

/** One row in the org-wide Commits activity feed — a flat list of recent commits across all active repos. */
export interface OrgContributionCommitRow {
  commitSha: string;
  /** Stable Crowd.dev member UUID — employee filter key. */
  contributorId: string | null;
  /** Org Lens person identity for the shared detail drawer (DP2) — COALESCE(LFID-mapped user_id, 'cdp:'||member_id). */
  personKey: string | null;
  projectName: string;
  committerName: string;
  /** Contributor avatar URL (member_logo from warehouse). Initials are the client fallback when null. */
  committerAvatarUrl: string | null;
  /** Job title / role shown under the committer name. */
  committerTitle: string | null;
  /** Commit handle (without the leading `@`). */
  username: string | null;
  /** Source badge inferred from the repo's upstream URL. */
  source: ContributionSource;
  /** ISO committed timestamp. */
  committedTs: string;
  message: string;
  /** Upstream commit URL for the linked message. */
  commitUrl: string | null;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/contributions`. Server-paginated. */
export interface OrgContributionsResponse {
  accountId: string;
  /** Echo of the window the BFF aggregated over — lets the client drop late responses. */
  dateRange: OrgLensTimeRange;
  kpis: OrgContributionsKpis;
  repositories: OrgContributionRepoRow[];
  /** Org-wide recent-commits activity feed (most recent first). */
  commits: OrgContributionCommitRow[];
  /** Foundations with any code contribution by the org in the window and project type, whatever the code-count option; never narrowed by the picks. */
  foundationOptions: OrgContributorFoundationOption[];
  /** Projects in the window and project type, never narrowed by the picks; the page lists the picked foundation's projects. */
  projectOptions: OrgContributionProjectOption[];
  /** Employees in the window and project type, narrowed to the picked foundation. */
  employeeOptions: OrgContributionEmployeeOption[];
  /** Repositories rows matching the active filters — drives the Repositories pager + tab count. */
  totalRecords: number;
  /** Commits feed rows matching the active filters — drives the Commits pager + tab count. */
  commitsTotalRecords: number;
}

/** Composed filter/pagination state — serialized to URL query params and to the BFF request. `metric` switches the KPI, Repositories and option counts; the Commits feed always lists commits. */
export interface OrgContributionsQuery extends OrgCommitFilters {
  /** Active tab — KPI search follows this tab's semantics; `page`/`size` paginate the active table. */
  view: ContributionsView;
  dateRange: OrgLensTimeRange;
  /** Free-text search. On the Repositories tab it scopes the Repository path; on the Commits feed it scopes message/project/committer/username. */
  search: string;
  /** Selected foundation id (exact `foundation_id`, as on People → Contributors); empty for any foundation. */
  foundation: string;
  /** Selected project slugs (or project ids); each matches that project exactly. */
  projects: string[];
  /** Selected employee ids (Crowd.dev member_id values). */
  employees: string[];
  sort: ContributionsSortColumn;
  dir: ContributionsSortDirection;
  commitSort: ContributionsCommitSortColumn;
  commitDir: ContributionsSortDirection;
  /** 1-based page index for the active `view` table. */
  page: number;
  size: number;
}

// Client-only view types (NOT on the wire) ----------------------------------

/** Pre-decorated Repositories table row — source badge label/icon + preformatted dates. */
export interface OrgContributionRepoRowVm {
  repositoryId: string;
  repositoryPath: string;
  projectName: string;
  projectLogoUrl: string | null;
  /** Project initials for the logo fallback square when `projectLogoUrl` is null. */
  projectInitials: string;
  /** Tailwind background class for the logo fallback square. */
  projectLogoColorClass: string;
  source: ContributionSource;
  /** Display label for the source badge, e.g. `GitHub`. */
  sourceLabel: string;
  /** Font Awesome icon class for the source badge. */
  sourceIconClass: string;
  /** Upstream repo URL — the Repository name links out to this. */
  upstreamUrl: string | null;
  commits: number;
  firstCommitTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `firstCommitTs`, or em-dash. */
  firstCommitLabel: string;
  lastCommitTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `lastCommitTs`, or em-dash. */
  lastCommitLabel: string;
}

/** Multi-select option carrying a commit-count subtext (projects / employees filters). */
export interface ContributionsFilterOption {
  label: string;
  value: string;
  sublabel: string;
}

/** Repositories-table headers for one {@link OrgCommitFilters.metric}. */
export interface ContributionsMetricLabels {
  /** Count column header, e.g. `Commits`. */
  count: string;
  firstDate: string;
  lastDate: string;
}

/** Active content tab — drives tab-aware KPI search semantics and which table `page`/`size` paginate. */
export type ContributionsView = 'repositories' | 'commits';

/** Sortable columns on the org-wide Commits activity feed (server-side). */
export type ContributionsCommitSortColumn = 'project' | 'committer' | 'username' | 'date';

/** Pre-decorated Commits-feed row — committer avatar + source icon + preformatted date. */
export interface OrgContributionCommitRowVm {
  commitSha: string;
  contributorId: string | null;
  /** Org Lens person identity — drives `PersonDetailDrawerService.open`. */
  personKey: string | null;
  projectName: string;
  committerName: string;
  committerTitle: string | null;
  /** Contributor avatar URL (member_logo). Initials fallback when null. */
  committerAvatarUrl: string | null;
  username: string | null;
  source: ContributionSource;
  /** Human-readable source label, e.g. `GitHub` — used for accessible labels. */
  sourceLabel: string;
  /** Font Awesome icon class for the source, shown next to the username. */
  sourceIconClass: string;
  /** External user-profile URL for the handle (e.g. https://github.com/<user>), or null when the source has no public profile. */
  profileUrl: string | null;
  committedTs: string;
  /** Pre-formatted `MMM dd, yyyy` of `committedTs`. */
  committedLabel: string;
  message: string;
  commitUrl: string | null;
  /** Committer initials for the avatar circle. */
  initials: string;
  /** Tailwind background class for the avatar circle. */
  avatarColorClass: string;
}
