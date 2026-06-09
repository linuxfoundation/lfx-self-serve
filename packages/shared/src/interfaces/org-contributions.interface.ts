// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Org Lens → Code Contributions page (LFXV2-1894). Source of truth is LFX Insights
// (CrowdSource pipeline ingesting GitHub / GitLab / Gerrit). All shapes here are
// derived/read-only — the page never mutates contribution data.

/** Upstream system a repository's commits flow from — inferred from the repo's upstream URL. */
export type ContributionSource = 'git' | 'github' | 'gitlab' | 'gerrit';

/** Date-range window the KPI strip + table aggregate over. Default `12mo` (Past 12 Months). */
export type ContributionsDateRange = '30d' | '90d' | '12mo' | 'all';

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
  /** Total commits by affiliated org members in scope. */
  commits1yr: number;
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

/** Project filter option — hierarchical (a parent foundation carries `parentSlug = null`; children point back). */
export interface OrgContributionProjectOption {
  slug: string;
  projectId: string;
  name: string;
  /** Per-project commit count in scope, shown as rich subtext in the select. */
  commits: number;
  /** Parent foundation slug, or null for a top-level foundation. */
  parentSlug: string | null;
}

/** Employee filter option — only employees with >= 1 commit in the current Project + Date-Range scope. */
export interface OrgContributionEmployeeOption {
  id: string;
  displayName: string;
  commits: number;
}

/** One row in the org-wide Commits activity feed — a flat list of recent commits across all active repos. */
export interface OrgContributionCommitRow {
  commitSha: string;
  projectName: string;
  committerName: string;
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
  dateRange: ContributionsDateRange;
  kpis: OrgContributionsKpis;
  repositories: OrgContributionRepoRow[];
  /** Org-wide recent-commits activity feed (most recent first). */
  commits: OrgContributionCommitRow[];
  projectOptions: OrgContributionProjectOption[];
  employeeOptions: OrgContributionEmployeeOption[];
  /** Total rows matching the active filters across all pages — drives the footer + pager. */
  totalRecords: number;
}

/** Composed filter/pagination state — serialized to URL query params and to the BFF request. */
export interface OrgContributionsQuery {
  dateRange: ContributionsDateRange;
  /** Free-text search; scopes the Repository column only. */
  search: string;
  /** Selected project slugs. */
  projects: string[];
  /** Selected employee ids. */
  employees: string[];
  sort: ContributionsSortColumn;
  dir: ContributionsSortDirection;
  /** 1-based page index. */
  page: number;
  size: number;
}

/** Date-range dropdown option — label rendered as-is in `<lfx-select>`. */
export interface ContributionsDateRangeOption {
  label: string;
  value: ContributionsDateRange;
}

// Client-only view types (NOT on the wire) ----------------------------------

/** Pre-decorated Repositories table row — source badge label/icon + preformatted dates. */
export interface OrgContributionRepoRowVm {
  repositoryId: string;
  repositoryPath: string;
  projectName: string;
  projectLogoUrl: string | null;
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

/** Tabs in the committer side panel — mirrors the LFX person-profile panel. */
export type CommitterPanelTab = 'events' | 'training' | 'code' | 'governance';

/** Demo event-participation item shown in the committer panel's Events tab. */
export interface OrgCommitterEventItem {
  name: string;
  /** ISO date of the event. */
  date: string;
  /** Participation role, e.g. Attendee / Speaker. */
  role: string;
}

/** Demo training/certification item shown in the committer panel's Training tab. */
export interface OrgCommitterTrainingItem {
  course: string;
  /** Completion status, e.g. Completed / In Progress. */
  status: string;
}

/** Demo governance item (board / committee seat) shown in the committer panel's Governance tab. */
export interface OrgCommitterGovernanceItem {
  role: string;
  body: string;
}

/** Committer side-panel view-model — derived client-side from the loaded Commits feed. */
export interface OrgCommitterDetailVm {
  name: string;
  title: string | null;
  username: string | null;
  source: ContributionSource;
  sourceIconClass: string;
  /** External user-profile URL for the handle, or null when the source has no public profile. */
  profileUrl: string | null;
  initials: string;
  avatarColorClass: string;
  /** Commit count across the rows currently in the feed. */
  totalCommits: number;
  /** Distinct project names the committer has commits in. */
  projects: string[];
  /** The committer's commit rows (already decorated + sorted). */
  commits: OrgContributionCommitRowVm[];
  /** Demo cross-engagement sections (Events / Training / Governance) — populated client-side for the scaffold. */
  events: OrgCommitterEventItem[];
  training: OrgCommitterTrainingItem[];
  governance: OrgCommitterGovernanceItem[];
}

/** Sortable columns on the org-wide Commits activity feed (client-side). */
export type ContributionsCommitSortColumn = 'project' | 'committer' | 'username' | 'date';

/** Pre-decorated Commits-feed row — committer avatar + source icon + preformatted date. */
export interface OrgContributionCommitRowVm {
  commitSha: string;
  projectName: string;
  committerName: string;
  committerTitle: string | null;
  username: string | null;
  source: ContributionSource;
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
