// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Role badge — declared-maintainer rule (Item 4 lock); Maintainer > Contributor at the org level on the parent row, per-project on the expansion. */
export type OrgContributorRole = 'Maintainer' | 'Contributor';

/** Time-window slice the BFF aggregates over — drives a refetch per change (A1 architecture lock per Item 2). */
export type OrgContributorTimeRange = '30d' | '90d' | '12mo' | 'all';

/** Sortable columns on the Contributors main table. */
export type OrgContributorSortColumn = 'name' | 'role' | 'commits' | 'lastActive' | 'mostActiveProject';

/** Sort direction — `1` ascending, `-1` descending. */
export type OrgContributorSortDirection = 1 | -1;

/** Per-(account, person) main row — server-pre-aggregated over the active time window. */
export interface OrgContributorRow {
  /** Stable person key from the platinum model: `COALESCE(LFID, 'cdp:' || cdp_member_id)`. Surfaces unresolved CDP members per Q2 lock — never dropped. */
  personKey: string;
  /** Resolved name with fallback chain — already collapsed in the dbt model (`user_full_name → member_display_name → github_username`). Never blank in practice. */
  displayName: string;
  /** Job title from `silver_dim_member_user_mapping.user_title`; NULL for unresolved CDP members and resolved members with no job title. */
  title: string | null;
  /** LFX user_id (Salesforce). NULL when the person is an unresolved CDP-only member. */
  lfid: string | null;
  /** LFX username from `silver_dim_member_user_mapping.user_name`. NULL when the person is an unresolved CDP-only member. */
  lfUsername: string | null;
  /** CDP member_id — always present (row inclusion gate). Representative `MIN` when multiple CDP rows resolve to the same LFX user. */
  cdpMemberId: string;
  /** Item 4 R4.2 badge — the per-person derivative of `is_declared_maintainer_for_org`. Maintainer if true, Contributor otherwise. */
  role: OrgContributorRole;
  /** SUM of `daily_commits` over the window — main-branch merged commits only. Expected to be 0 on ~39% of rows (review/PR-only contributors). */
  commits: number;
  /** ISO date `YYYY-MM-DD`. `MAX(activity_date)` over the person's code-contribution activity in the window. */
  lastActiveTs: string | null;
  /** Distinct project count in the window. Drives the expanded sub-table header (`Projects Involved (N)`). */
  projectsCount: number;
  /** Argmax(commits) project name — tiebreak by `last_active DESC NULLS LAST`, then `project_name ASC`. NULL only if the person has zero rows in the window. */
  mostActiveProjectName: string | null;
  /** Foundation name of the argmax project — drives the column's subtext. NULL when the project is outside the foundation spine. */
  mostActiveProjectFoundationName: string | null;
}

/** Per-(account, person, project) row — the expansion grain. Aggregated server-side; bundled in the same payload as the parent rows. */
export interface OrgContributorProjectRow {
  personKey: string;
  projectId: string;
  projectName: string;
  /** Project slug — currently unused by the UI but carried so a future "click project → project page" iteration doesn't need a separate fetch. */
  projectSlug: string | null;
  foundationId: string | null;
  foundationName: string | null;
  foundationSlug: string | null;
  /** Per-project derivative of `is_declared_maintainer_for_project`. A person with the Maintainer badge on the parent row can (and often does) show Contributor pills on most of their project sub-rows (Item 5 Simon-Deziel pattern). */
  role: OrgContributorRole;
  /** Per-project `SUM(daily_commits)` over the window. Sums across a person's project rows equal that person's parent-row `commits` value (Item 5 consistency lock). */
  commits: number;
  /** Per-project `MAX(activity_date)` over the window. Drives the "Last Active" column in the expanded sub-table. */
  lastActiveTs: string | null;
}

/** Foundation dropdown option — only foundations the org has Contributors rows for in the active window (R2.2 tab-scoped narrowing). */
export interface OrgContributorFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Project dropdown option — only active projects the org has Contributors rows for in the active window. Sorted by project name; needs filter-typeahead at scale (~200+ projects for Red Hat at 12mo). */
export interface OrgContributorProjectOption {
  projectId: string;
  projectName: string;
  /** Foundation name shown as subtext to disambiguate same-named projects across foundations (rare but possible). */
  foundationName: string | null;
}

/** Stats baseline — anchored to the BFF response per Item 3 lock; filter trio does NOT recompute. Time-window changes do (because the BFF refetches). */
export interface OrgContributorStatsBaseline {
  /** Distinct people in the response whose `role === 'Maintainer'`. */
  maintainers: number;
  /** Distinct people in the response whose `role === 'Contributor'`. `maintainers + contributors === contributors[].length` by construction. */
  contributors: number;
  /** Distinct `project_id` count over the projects array. */
  projects: number;
  /** Distinct `foundation_id` count over the projects array (non-null foundation_id only). */
  foundations: number;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/contributors?timeRange=…`. */
export interface OrgContributorsResponse {
  accountId: string;
  /** Echo of the time window the BFF aggregated over — clients use this to ignore late responses from a previous request when the user clicked through windows quickly. */
  timeRange: OrgContributorTimeRange;
  contributors: OrgContributorRow[];
  projects: OrgContributorProjectRow[];
  foundationOptions: OrgContributorFoundationOption[];
  projectOptions: OrgContributorProjectOption[];
  stats: OrgContributorStatsBaseline;
}

// ============================================================
// Client-only view types (NOT on the wire)
// ============================================================

/** Pre-decorated Contributors main row VM — initials + avatar colour + label preformatting. */
export interface OrgContributorRowVm {
  personKey: string;
  displayName: string;
  title: string | null;
  initials: string;
  avatarColorClass: string;
  role: OrgContributorRole;
  commits: number;
  lastActiveTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `lastActiveTs`, or em-dash when missing. */
  lastActiveLabel: string;
  projectsCount: number;
  mostActiveProjectName: string | null;
  mostActiveProjectFoundationName: string | null;
}

/** One collapsed row in the expanded "Projects Involved" sub-table — one per `(personKey, projectId)`. */
export interface OrgContributorExpandedRowVm {
  projectId: string;
  projectName: string;
  foundationName: string | null;
  role: OrgContributorRole;
  commits: number;
  lastActiveTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `lastActiveTs`, or em-dash. */
  lastActiveLabel: string;
}

/** Time-window dropdown option — label rendered as-is in `<lfx-select>`. */
export interface OrgContributorTimeRangeOption {
  label: string;
  value: OrgContributorTimeRange;
}
