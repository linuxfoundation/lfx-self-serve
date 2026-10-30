// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';
import type { OrgAllEmployeeCodeContribution } from './org-people.interface';

/** Role badge — Maintainer when the person holds a maintainer role overlapping the range (lfx-self-serve#4482); on the parent row any project, on the expansion that project. */
export type OrgContributorRole = 'Maintainer' | 'Contributor';

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
  /** Maintainer when the person holds at least one maintainer role overlapping the window in the project scope, Contributor otherwise. */
  role: OrgContributorRole;
  /** Authored commits over the window (distinct SHAs, any branch; merged to the main branch only under `commitScope=merged`). Zero for review/PR-only contributors. */
  commits: number;
  /** Code-contribution activities over the window (commits, PRs, reviews, comments) — the count shown under `metric=code`. */
  codeActivities: number;
  /** ISO date `YYYY-MM-DD`. `MAX(activity_date)` over the person's code-contribution activity in the window. */
  lastActiveTs: string | null;
  /** Distinct project count in the window. Drives the expanded sub-table header (`Projects Involved (N)`). */
  projectsCount: number;
  /** Argmax project by the selected metric — tiebreak by `last_active DESC NULLS LAST`, then `project_name ASC`. NULL only if the person has zero rows in the window. */
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
  /** Maintainer when the person holds a maintainer role on this project overlapping the window. A person with the Maintainer badge on the parent row can (and often does) show Contributor pills on most of their project sub-rows (Item 5 Simon-Deziel pattern). */
  role: OrgContributorRole;
  /** Per-project authored commits over the window. Sums across a person's project rows equal that person's parent-row `commits` value (Item 5 consistency lock). */
  commits: number;
  /** Per-project code-contribution activities over the window; sums to the parent row's `codeActivities`. */
  codeActivities: number;
  /** Per-project `MAX(activity_date)` over the window. Drives the "Last Active" column in the expanded sub-table. */
  lastActiveTs: string | null;
}

/** Foundation dropdown option — only foundations the org has Contributors rows for in the active window (R2.2 tab-scoped narrowing). */
export interface OrgContributorFoundationOption {
  foundationId: string;
  foundationName: string;
}

/** Project dropdown option — the projects represented in the org's Contributors rows for the selected range and project scope. Sorted by project name; needs filter-typeahead at scale (~200+ projects for the largest organizations over 365 days). */
export interface OrgContributorProjectOption {
  projectId: string;
  projectName: string;
  /** Foundation name shown as subtext to disambiguate same-named projects across foundations (rare but possible). */
  foundationName: string | null;
}

/** Stats baseline — anchored to the BFF response per Item 3 lock; filter trio does NOT recompute. Time-window changes do (because the BFF refetches). */
export interface OrgContributorStatsBaseline {
  /**
   * Distinct maintainer roles — (member, Insights project) pairs — of the account overlapping the window in the project scope, with or without code.
   * `null` when the roles table is unavailable (never shown as zero).
   */
  maintainerRoles: number | null;
  /** Everyone in the response: people with code in the window, maintainers included. Equals `contributors[].length`. */
  contributors: number;
  /** Distinct `project_id` count over the projects array. */
  projects: number;
  /** Distinct `foundation_id` count over the projects array (non-null foundation_id only). */
  foundations: number;
}

/** Bundled GET response for `/api/orgs/:orgUid/lens/people/contributors?timeRange=…`. */
export interface OrgContributorsResponse {
  /** Set when Exclude team members was asked but the team-member flag could not be read: the counts include team members. */
  teamMembersUnavailable?: true;
  accountId: string;
  /** Echo of the time window the BFF aggregated over — clients use this to ignore late responses from a previous request when the user clicked through windows quickly. */
  timeRange: OrgLensTimeRange;
  contributors: OrgContributorRow[];
  projects: OrgContributorProjectRow[];
  foundationOptions: OrgContributorFoundationOption[];
  projectOptions: OrgContributorProjectOption[];
  stats: OrgContributorStatsBaseline;
}

// Client-only view types (NOT on the wire).

/** Pre-decorated Contributors main row VM — initials + avatar colour + label preformatting. */
export interface OrgContributorRowVm {
  personKey: string;
  displayName: string;
  title: string | null;
  initials: string;
  avatarColorClass: string;
  role: OrgContributorRole;
  /** The count for the selected metric — `commits` or `codeActivities` of the wire row. */
  count: number;
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
  /** The count for the selected metric. */
  count: number;
  lastActiveTs: string | null;
  /** Pre-formatted `MMM dd, yyyy` of `lastActiveTs`, or em-dash. */
  lastActiveLabel: string;
}

// Server-internal Snowflake row shape (not on the wire) — kept here so the rule against local interfaces in `apps/lfx-one/` holds.

/** Raw per-(person, project) aggregate row returned by the Snowflake query — server-internal shape. */
export interface ContributorPersonProjectRow {
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
  /** Authored commits, any branch. */
  COMMITS: number | null;
  /** Authored commits merged to the main branch. */
  MERGED_COMMITS: number | null;
  CODE_ACTIVITIES: number | null;
  LAST_ACTIVE_DATE: Date | string | null;
}

/** The count columns of {@link ContributorPersonProjectRow} the commit filters pick between. */
export type ContributorCountColumn = 'COMMITS' | 'MERGED_COMMITS' | 'CODE_ACTIVITIES';

/**
 * One project of one person's code in a window and project scope, read for the person drawer (lfx-self-serve#4404):
 * the columns of that person's {@link ContributorPersonProjectRow}s, so the drawer counts what the row counts.
 */
export type OrgPersonCodeProjectRow = Pick<
  ContributorPersonProjectRow,
  'PROJECT_ID' | 'PROJECT_NAME' | 'FOUNDATION_ID' | 'FOUNDATION_NAME' | 'COMMITS' | 'MERGED_COMMITS' | 'CODE_ACTIVITIES' | 'LAST_ACTIVE_DATE'
>;

/** A person's Code project (drawer, All Employees expanded row) before its Maintainer pill is set. */
export type OrgPersonCodeProjectCount = Omit<OrgAllEmployeeCodeContribution, 'isMaintainer'>;

/** A person's Code projects and the total they are shown with. */
export interface OrgPersonCodeContributions {
  projects: OrgPersonCodeProjectCount[];
  total: number;
}
