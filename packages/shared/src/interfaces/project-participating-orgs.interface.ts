// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Project Lens → Participating Organizations (#2091). Read-only shapes over the
// ANALYTICS.PLATINUM_LFX_ONE.PROJECT_PARTICIPATING_ORGS{,_SUMMARY} tables (lf-dbt
// project_lens models): every company contributing code to a project, split into
// current members of the project's parent foundation and non-members.

import type {
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SHARE_BASES,
  PROJECT_PARTICIPATING_ORGS_SORT_FIELDS,
} from '../constants/project-participating-orgs.constants';
import type { ContributionsDateRange } from './org-contributions.interface';
import type { PeriodDelta } from './metric-trend.interface';
import type { MembershipTierClass } from './org-lens.interface';

/** Activity window; same vocabulary and options as Org Lens → Code Contributions. */
export type ProjectParticipatingOrgsRange = ContributionsDateRange;

/** Tab: every listed company, current members only, or non-members (including Unidentified). */
export type ProjectParticipatingOrgsSegment = (typeof PROJECT_PARTICIPATING_ORGS_SEGMENTS)[number];

/** Server-side sortable columns. `tier` orders members by tier rank (Platinum first); non-members sort last. */
export type ProjectParticipatingOrgsSortField = (typeof PROJECT_PARTICIPATING_ORGS_SORT_FIELDS)[number];

export type ProjectParticipatingOrgsSortDirection = 'asc' | 'desc';

/** Member Commit Share denominator: listed-company commits (default) or all commits including individuals. */
export type ProjectParticipatingOrgsShareBase = (typeof PROJECT_PARTICIPATING_ORGS_SHARE_BASES)[number];

/** Tiles and tab counts for one project and range. Counts ignore search and tier filters. */
export interface ProjectParticipatingOrgsSummary {
  projectSlug: string;
  /** Parent foundation slug — the membership the Members split is measured against. */
  foundationSlug: string | null;
  foundationName: string | null;
  range: ProjectParticipatingOrgsRange;
  /** Build date (ISO `YYYY-MM-DD`); every window ends at the start of this date. */
  asOfDate: string;
  orgsCount: number;
  membersCount: number;
  /** Includes `unidentifiedCount`. */
  nonMembersCount: number;
  unidentifiedCount: number;
  memberCommits: number;
  companyCommits: number;
  allCommits: number;
  /** `memberCommits / companyCommits` in [0, 1]; null when there are no company commits. */
  memberCommitShareOfCompanyCommits: number | null;
  /** `memberCommits / allCommits` in [0, 1]; null when there are no commits. */
  memberCommitShareOfAllCommits: number | null;
}

/** `GET /api/projects/:slug/participating-orgs/summary` — `summary` is null when the project has no code activity in the range. */
export interface ProjectParticipatingOrgsSummaryResponse {
  summary: ProjectParticipatingOrgsSummary | null;
}

/** One company row. */
export interface ProjectParticipatingOrg {
  /** Stable row key: the Salesforce account id, or `cdev:<organization id>` for an Unidentified company. */
  participantKey: string;
  /** Salesforce account id (the b2b_org uid); null for Unidentified companies. */
  accountId: string | null;
  name: string;
  logoUrl: string | null;
  /** Seen in contribution data but not matched to a company record. Never a member, never linked. */
  isUnidentified: boolean;
  /** Current active corporate member of the project's parent foundation. */
  isMember: boolean;
  /** Highest current tier class; null for non-members. */
  membershipTierClass: MembershipTierClass | null;
  commits: number;
  /** Commits in the equal-length previous window; null for `all`. */
  commitsPrev: number | null;
  contributors: number;
  /** Contributors in the equal-length previous window; null for `all`. */
  contributorsPrev: number | null;
  /**
   * True only for a member row whose company the caller can open in Org Lens
   * (`b2b_org#auditor`, the Org Lens gate). Per-caller: never cached across users.
   */
  canOpenOrgLens: boolean;
}

/** List query (validated server-side; the export takes the same filters without paging). */
export interface ProjectParticipatingOrgsQuery {
  range: ProjectParticipatingOrgsRange;
  segment: ProjectParticipatingOrgsSegment;
  /** Case-insensitive substring of the company name. */
  search?: string;
  /** Members of this tier class only (implies members). */
  tier?: MembershipTierClass;
  sort: ProjectParticipatingOrgsSortField;
  dir: ProjectParticipatingOrgsSortDirection;
  pageSize: number;
  offset: number;
}

/** `GET /api/projects/:slug/participating-orgs` */
export interface ProjectParticipatingOrgsPage {
  rows: ProjectParticipatingOrg[];
  /** Rows matching segment + search + tier, across all pages. */
  totalRecords: number;
  /** Parent foundation slug, used to build the member → Org Lens membership link. */
  foundationSlug: string | null;
}

/** Filters the CSV export takes: the list query without paging. */
export type ProjectParticipatingOrgsExportFilters = Omit<ProjectParticipatingOrgsQuery, 'pageSize' | 'offset'>;

/** Share-base toggle option on the Member Commit Share tile. */
export interface ProjectParticipatingOrgsShareBaseOption {
  label: string;
  value: ProjectParticipatingOrgsShareBase;
}

/** Page body state: data (possibly still loading), no activity in the range, no access, or a failed read. */
export type ProjectParticipatingOrgsViewState = 'ready' | 'empty' | 'forbidden' | 'error';

/**
 * How a row's company name renders for the viewer: an Org Lens membership link, a member the viewer
 * cannot open (plain text + access tooltip), an Unidentified company (tag), or a plain non-member name.
 */
export type ProjectParticipatingOrgNameKind = 'org-lens-link' | 'no-access' | 'unidentified' | 'plain';

/** One row metric with its change against the equal-length previous window. */
export interface ProjectParticipatingOrgMetricVm {
  value: number;
  /** Percent change; null for All Time, a first-period company (`isNew`), or a zero-to-zero window. */
  delta: PeriodDelta | null;
  /** Zero in the previous window, active in this one. */
  isNew: boolean;
}

/** Table row view model for the Participating Organizations page. */
export interface ProjectParticipatingOrgRowVm {
  participantKey: string;
  name: string;
  logoUrl: string | null;
  initials: string;
  avatarColorClass: string;
  nameKind: ProjectParticipatingOrgNameKind;
  /** `routerLink` commands to the company's Org Lens membership page for this foundation; set only for `org-lens-link`. */
  orgLensLink: string[] | null;
  /** Member tag text — the tier class, or `Member` when the class is unknown; null for non-members. */
  membershipLabel: string | null;
  commits: ProjectParticipatingOrgMetricVm;
  contributors: ProjectParticipatingOrgMetricVm;
}
