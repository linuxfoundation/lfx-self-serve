// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Foundation Lens → Participating Companies (#5697). The foundation-level counterpart of the project page
// (project-participating-orgs.interface.ts): every company contributing to any project of a foundation, with
// foundation totals read from the warehouse's foundation-level rows and a per-project breakdown on demand.

import type { MembershipTierClass } from './org-lens.interface';
import type {
  ProjectParticipatingOrgChangeTone,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsSegment,
  ProjectParticipatingOrgsSortDirection,
  ProjectParticipatingOrgsSortField,
} from './project-participating-orgs.interface';

/** Activity window, in the warehouse's `time_range` vocabulary: the past 12 months (default), 90 days, 30 days, or all time. */
export type FoundationParticipatingOrgsRange = ProjectParticipatingOrgsRange;
export type FoundationParticipatingOrgsSegment = ProjectParticipatingOrgsSegment;
export type FoundationParticipatingOrgsSortField = ProjectParticipatingOrgsSortField;
export type FoundationParticipatingOrgsSortDirection = ProjectParticipatingOrgsSortDirection;

/** Both CSV files the export offers: one row per company, or one row per company and project. */
export type FoundationParticipatingOrgsExportKind = 'summary' | 'by-project';

/** One project of the foundation, for the scope picker. `maturity` is null for foundations without maturity levels. */
export interface FoundationParticipatingOrgsProject {
  slug: string;
  name: string;
  maturity: string | null;
}

/** `GET /api/foundation-participating-orgs/projects` */
export interface FoundationParticipatingOrgsProjectsResponse {
  projects: FoundationParticipatingOrgsProject[];
}

/** Summary request: the list filters without the tab, sorting and paging (the tab counts cover every tab). */
export type FoundationParticipatingOrgsSummaryQuery = Pick<FoundationParticipatingOrgsQuery, 'foundationSlug' | 'range' | 'projectSlug' | 'search' | 'tier'>;

/** Cards and tab counts for one foundation, range and scope (the whole foundation, or one project), narrowed by the search and tier filters. */
export interface FoundationParticipatingOrgsSummary {
  foundationSlug: string;
  foundationName: string;
  /** Number of projects in the foundation. */
  projectCount: number;
  /** Set when the summary is scoped to one project. */
  projectSlug: string | null;
  projectName: string | null;
  range: FoundationParticipatingOrgsRange;
  /** Build date of the warehouse tables the figures come from (ISO `YYYY-MM-DD`); null when the warehouse does not report one. */
  asOfDate: string | null;
  /** Companies with activity in the range that match the search and tier filters (the All tab). */
  companiesCount: number;
  /** Tier classes the foundation's roster actually holds (unfiltered), in display order; the tier picker offers these only. */
  availableTiers: MembershipTierClass[];
  /** The full membership roster matching the search and tier filters, contributing or not. */
  membersCount: number;
  /** Matching members with activity in the range (the Members tab). */
  contributingMembersCount: number;
  /** Matching non-members with activity in the range (the Non-Members tab). */
  nonMembersCount: number;
  /** Commits from member companies divided by all commits in scope, in [0, 1]; null when there are no commits. */
  memberCommitShare: number | null;
}

/** `GET /api/foundation-participating-orgs/summary` — `summary` is null when there is no activity in the range. */
export interface FoundationParticipatingOrgsSummaryResponse {
  summary: FoundationParticipatingOrgsSummary | null;
}

/** One company row: foundation totals in the foundation scope, project figures when scoped to one project. */
export interface FoundationParticipatingOrg {
  participantKey: string;
  /** Salesforce account id; null when it cannot be matched to a company record. */
  accountId: string | null;
  name: string;
  logoUrl: string | null;
  /** Foundation membership on the last day of the range. */
  isMember: boolean;
  /** Highest current tier class; null for non-members. Tier names come from the data. */
  membershipTierClass: MembershipTierClass | null;
  /** Other LF membership data available (for example project-level membership), shown beside the foundation badge. */
  otherMemberships: string[];
  /** Foundation projects where the company has commits or contributors in the range. */
  projectsInvolved: number;
  commits: number;
  commitsChange: number | null;
  /** Unique people; a person active in several projects counts once. */
  contributors: number;
  contributorsChange: number | null;
}

export interface FoundationParticipatingOrgsQuery {
  foundationSlug: string;
  range: FoundationParticipatingOrgsRange;
  segment: FoundationParticipatingOrgsSegment;
  /** Scope to one project; omitted means the foundation total. */
  projectSlug?: string;
  search?: string;
  tier?: MembershipTierClass;
  sort: FoundationParticipatingOrgsSortField;
  dir: FoundationParticipatingOrgsSortDirection;
  pageSize: number;
  offset: number;
}

export type FoundationParticipatingOrgsExportFilters = Omit<FoundationParticipatingOrgsQuery, 'pageSize' | 'offset'>;

/** `GET /api/foundation-participating-orgs` */
export interface FoundationParticipatingOrgsPage {
  rows: FoundationParticipatingOrg[];
  totalRecords: number;
}

/** One line of a company's project breakdown (a project, or the foundation total row). */
export interface FoundationParticipatingOrgProjectLine {
  projectSlug: string;
  name: string;
  maturity: string | null;
  commits: number;
  commitsChange: number | null;
  contributors: number;
  contributorsChange: number | null;
  /** The project's commits divided by the company's foundation total, in [0, 1]. */
  shareOfCompanyCommits: number;
}

/** The "Other N projects" row that keeps a large company's breakdown adding up. Contributors are not summed (people count once). */
export interface FoundationParticipatingOrgOtherProjects {
  count: number;
  commits: number;
  shareOfCompanyCommits: number;
  /** The share as a whole percent, `24%`. */
  shareLabel: string;
}

/**
 * `GET /api/foundation-participating-orgs/breakdown`. `projects` is every project the company is active in, sorted by
 * commits; the client shows the first {@link FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N} unless it asks for all.
 */
export interface FoundationParticipatingOrgBreakdown {
  total: FoundationParticipatingOrgProjectLine;
  projects: FoundationParticipatingOrgProjectLine[];
}

export type FoundationParticipatingOrgsViewState = 'ready' | 'empty' | 'forbidden' | 'error';

export type FoundationParticipatingOrgChangeTone = ProjectParticipatingOrgChangeTone;

/** One metric with its change label, as the table and the breakdown render it. */
export interface FoundationParticipatingOrgMetricVm {
  value: number;
  changeLabel: string;
  changeTone: FoundationParticipatingOrgChangeTone;
  changeClass: string;
}

export interface FoundationParticipatingOrgRowVm {
  participantKey: string;
  accountId: string | null;
  name: string;
  logoUrl: string | null;
  initial: string;
  projectsInvolved: number;
  projectsInvolvedLabel: string;
  membershipLabel: string | null;
  membershipBadgeClass: string | null;
  otherMemberships: string[];
  commits: FoundationParticipatingOrgMetricVm;
  contributors: FoundationParticipatingOrgMetricVm;
}

export interface FoundationParticipatingOrgProjectLineVm extends FoundationParticipatingOrgProjectLine {
  commitsVm: FoundationParticipatingOrgMetricVm;
  contributorsVm: FoundationParticipatingOrgMetricVm;
  shareLabel: string;
  sharePercent: number;
  /** True for the project the page is scoped to, so its row is highlighted. */
  inView?: boolean;
}

/** A project-scope picker option group (one maturity level, or all projects when the foundation has none). */
export interface FoundationParticipatingOrgsProjectOptionGroup {
  label: string;
  items: { label: string; value: string }[];
}

/** One expanded company's project breakdown while it loads, after it loads, or when it failed. */
export interface FoundationParticipatingOrgBreakdownState {
  status: 'loading' | 'ready' | 'error';
  data: FoundationParticipatingOrgBreakdown | null;
  showAll: boolean;
  filter: string;
}

/** What the breakdown panel renders for one company: the total row, the shown lines and the folded remainder. */
export interface FoundationParticipatingOrgBreakdownView {
  state: FoundationParticipatingOrgBreakdownState;
  total: FoundationParticipatingOrgProjectLineVm | null;
  lines: FoundationParticipatingOrgProjectLineVm[];
  other: FoundationParticipatingOrgOtherProjects | null;
  /** More projects than the top-N, so the panel offers a filter. */
  canFilter: boolean;
}

/** The filters shown as removable chips above the table. */
export type FoundationParticipatingOrgsFilterChipId = 'search' | 'project' | 'tier' | 'range';

export interface FoundationParticipatingOrgsFilterChip {
  id: FoundationParticipatingOrgsFilterChipId;
  label: string;
}

// What a data source reports. The warehouse already rolls every project's activity up to its ancestors, so a foundation's
// own project row holds the foundation total with people counted once across all of its projects; the source returns
// those totals and the per-project lines separately, and the service never sums contributors.
export interface FoundationParticipatingOrgsSourceProject {
  slug: string;
  name: string;
  /** The warehouse model carries no maturity stage, so the picker lists these under one group. */
  maturity: string | null;
  /** Commits in the range, for ordering the picker busiest first. */
  commits: number;
}

/** A company's foundation-level figures for one range (the foundation project's row of the warehouse list). */
export interface FoundationParticipatingOrgsSourceCompany {
  key: string;
  accountId: string | null;
  name: string;
  logoUrl: string | null;
  isMember: boolean;
  tier: MembershipTierClass | null;
  otherMemberships: string[];
  /** Foundation projects where the company has commits or contributors in the range. */
  projectsInvolved: number;
  commits: number;
  commitsChange: number | null;
  /** Unique people across the whole foundation; a person active in several projects counts once. */
  contributors: number;
  contributorsChange: number | null;
}

export interface FoundationParticipatingOrgsSourceFoundation {
  slug: string;
  name: string;
  /** Build date of the figures (ISO `YYYY-MM-DD`); null when the source does not report one. */
  asOfDate: string | null;
  projects: FoundationParticipatingOrgsSourceProject[];
  /** Every company with activity in the range, plus members without any (zero figures). */
  companies: FoundationParticipatingOrgsSourceCompany[];
}

/** One company's figures in one project of the foundation. */
export interface FoundationParticipatingOrgsSourceProjectLine {
  companyKey: string;
  projectSlug: string;
  commits: number;
  commitsChange: number | null;
  contributors: number;
  contributorsChange: number | null;
}

/** Which project lines to read: one project's (the project scope), one company's (its breakdown), or the named companies' (the by-project export). */
export interface FoundationParticipatingOrgsSourceLineFilter {
  projectSlug?: string;
  companyKey?: string;
  /** Reads only these companies' lines (the by-project export's matching companies). */
  companyKeys?: string[];
  /** Reads at most this many lines, so the by-project export is bounded. */
  limit?: number;
}

/** One company as the service reports it for a foundation, range and optional project scope. */
export interface FoundationCompanyActivity {
  row: FoundationParticipatingOrg;
  /** Every project the company is active in for the range, sorted by commits. */
  lines: FoundationParticipatingOrgProjectLine[];
}
