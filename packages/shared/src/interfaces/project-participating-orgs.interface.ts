// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Project Lens → Participating Organizations (#2091). Read-only shapes over the
// ANALYTICS.PLATINUM_LFX_ONE.PROJECT_PARTICIPATING_ORGS{,_SUMMARY} tables (lf-dbt
// project_lens models): every company contributing code to a project, split into
// current members of the project's parent foundation and non-members.

import type { PROJECT_PARTICIPATING_ORGS_SEGMENTS, PROJECT_PARTICIPATING_ORGS_SORT_FIELDS } from '../constants/project-participating-orgs.constants';
import type { ContributionsDateRange } from './org-contributions.interface';
import type { MembershipTierClass } from './org-lens.interface';

/** Activity window; same vocabulary and options as Org Lens → Code Contributions. */
export type ProjectParticipatingOrgsRange = ContributionsDateRange;

/** Tab: every listed company, current members only, or non-members (including Unidentified). */
export type ProjectParticipatingOrgsSegment = (typeof PROJECT_PARTICIPATING_ORGS_SEGMENTS)[number];

/** Server-side sortable columns. `tier` orders members by tier rank (Platinum first); non-members, and rows with no % change, sort last. */
export type ProjectParticipatingOrgsSortField = (typeof PROJECT_PARTICIPATING_ORGS_SORT_FIELDS)[number];

export type ProjectParticipatingOrgsSortDirection = 'asc' | 'desc';

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
}

/** `GET /api/projects/:slug/participating-orgs/summary` — `summary` is null when the project has no code activity in the range. */
export interface ProjectParticipatingOrgsSummaryResponse {
  summary: ProjectParticipatingOrgsSummary | null;
}

/** One company row. Holds no per-caller data, so a page is shared-cacheable across viewers. */
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
  /** Change against the previous window as a fraction (0.3 = +30%), modeled in lf-dbt; null for `all` or a zero baseline. */
  commitsChange: number | null;
  contributors: number;
  /** Contributors in the equal-length previous window; null for `all`. */
  contributorsPrev: number | null;
  /** Change against the previous window as a fraction, modeled in lf-dbt; null for `all` or a zero baseline. */
  contributorsChange: number | null;
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

/**
 * `GET /api/projects/:slug/participating-orgs/org-lens-links?accountIds=` — which of the given member
 * companies the caller can open in Org Lens (`b2b_org#auditor`, the Org Lens gate). Per caller, never
 * shared-cached; empty when the access check fails, so names fall back to plain text.
 */
export interface ProjectParticipatingOrgsOrgLensLinksResponse {
  readableAccountIds: string[];
}

/** The viewer's Org Lens access for one page's member set (`key`), so it is never applied to another page's rows. */
export interface ProjectParticipatingOrgsOrgLensLinksAnswer {
  key: string;
  readable: ReadonlySet<string>;
}

/** Filters the CSV export takes: the list query without paging. */
export type ProjectParticipatingOrgsExportFilters = Omit<ProjectParticipatingOrgsQuery, 'pageSize' | 'offset'>;

/** Page body state: data (possibly still loading), no activity in the range, no access, or a failed read. */
export type ProjectParticipatingOrgsViewState = 'ready' | 'empty' | 'forbidden' | 'error';

/**
 * How a row's company name renders for the viewer: an Org Lens membership link, a member the viewer
 * cannot open (plain text + access tooltip), or a plain name (non-members, including Unidentified companies).
 */
export type ProjectParticipatingOrgNameKind = 'org-lens-link' | 'no-access' | 'plain';

/** Colour of a change cell: up (green), down (red), flat (gray), first-period ("New"), or no comparison ("—"). */
export type ProjectParticipatingOrgChangeTone = 'positive' | 'negative' | 'neutral' | 'new' | 'none';

/** One row metric with its change against the equal-length previous window. */
export interface ProjectParticipatingOrgMetricVm {
  value: number;
  /** Signed whole percent (`+34%`, `-8%`, `0%`), `New` when the previous window was zero, `—` for All Time or zero-to-zero. */
  changeLabel: string;
  changeTone: ProjectParticipatingOrgChangeTone;
  /** Text colour for `changeTone`, from `PROJECT_PARTICIPATING_ORGS_CHANGE_TONE_CLASSES`. */
  changeClass: string;
}

/** Table row view model for the Participating Organizations page. */
export interface ProjectParticipatingOrgRowVm {
  participantKey: string;
  name: string;
  logoUrl: string | null;
  /** Uppercase first letter of the name, shown when there is no logo. */
  initial: string;
  nameKind: ProjectParticipatingOrgNameKind;
  /** `routerLink` commands to the company's Org Lens membership page for this foundation; set only for `org-lens-link`. */
  orgLensLink: string[] | null;
  /** Member badge text (`Gold Member`, or `Member` when the tier is unknown); null for non-members. */
  membershipLabel: string | null;
  /** Tailwind classes for the member badge; null for non-members. */
  membershipBadgeClass: string | null;
  commits: ProjectParticipatingOrgMetricVm;
  contributors: ProjectParticipatingOrgMetricVm;
}
