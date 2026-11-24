// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Project Lens → Participating Organizations (#2091). Read-only shapes over the
// ANALYTICS.PLATINUM_LFX_ONE.PROJECT_PARTICIPATING_ORGS{,_SUMMARY} tables (lf-dbt
// project_lens models): every company contributing code to a project, split into
// current members of the project's parent foundation and non-members.

import type {
  PROJECT_PARTICIPATING_ORGS_CONTRIBUTION_FILTERS,
  PROJECT_PARTICIPATING_ORGS_RANGES,
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SORT_FIELDS,
} from '../constants/project-participating-orgs.constants';
import type { MembershipTierClass } from './org-lens.interface';

/** Activity window — the `time_range` values the project_lens warehouse models are built for. */
export type ProjectParticipatingOrgsRange = (typeof PROJECT_PARTICIPATING_ORGS_RANGES)[number];

/** Range dropdown option — label rendered as-is. */
export interface ProjectParticipatingOrgsRangeOption {
  label: string;
  value: ProjectParticipatingOrgsRange;
}

/** Tab: every listed company, current members only, or non-members (including Unidentified). */
export type ProjectParticipatingOrgsSegment = (typeof PROJECT_PARTICIPATING_ORGS_SEGMENTS)[number];

/**
 * Contribution filter: `contributing` keeps companies with activity in the range; `not_contributing` keeps the
 * listed companies without (only members on a foundation's own project, who are listed contributing or not).
 */
export type ProjectParticipatingOrgsContributionFilter = (typeof PROJECT_PARTICIPATING_ORGS_CONTRIBUTION_FILTERS)[number];

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
  /** Companies with activity in the range (members and non-members). */
  orgsCount: number;
  /** Listed members: on a foundation's own project the full current roster, contributing or not. */
  membersCount: number;
  /** Members with activity in the range; `contributingMembersCount + nonMembersCount = orgsCount`. */
  contributingMembersCount: number;
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
  /**
   * The crowd.dev organization id of an Unidentified company (its CDP id, spec 062); null for every other row. A row
   * key only: whether it opens a CDP company page is decided per caller by the links read (FR-040, DR-041).
   */
  organizationId: string | null;
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
  /** Companies with or without activity in the range; omitted means all. */
  contribution?: Exclude<ProjectParticipatingOrgsContributionFilter, 'all'>;
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
 * `GET /api/projects/:slug/participating-orgs/org-lens-links?accountIds=&nonMemberAccountIds=&cdpIds=` — which of the
 * shown page's companies the caller can open: members through the Org Lens gate (`b2b_org#auditor`), non-members
 * through the caller's own Company Lens index read, CDP ids only inside the CDP audience (spec 062 FR-040). Per caller,
 * never shared-cached; each failed check drops only the links it decides, so names fall back to plain text.
 */
export interface ProjectParticipatingOrgsOrgLensLinksResponse {
  /** Member ids the caller's roster reads, plus non-member ids the caller reads from the Company Lens index (DR-041). */
  readableAccountIds: string[];
  /** The given CDP ids that are addressable CDP companies; always empty outside the CDP audience (FR-040, FR-012). */
  cdpCompanyIds: string[];
}

/** The validated links read query: the shown page's member account ids, non-member account ids and CDP ids (each possibly empty). */
export interface ProjectParticipatingOrgsLinksQuery {
  accountIds: string[];
  nonMemberAccountIds: string[];
  cdpIds: string[];
}

/** The viewer's Org Lens access for a page's rows: B2B account ids it may open, and CDP ids that open a CDP company page. */
export interface ProjectParticipatingOrgsLinks {
  readable: ReadonlySet<string>;
  /** CDP ids of the page that open a CDP company page for the viewer. */
  cdpCompanyIds: ReadonlySet<string>;
}

/** The viewer's Org Lens access for one page's member set (`key`), so it is never applied to another page's rows. */
export interface ProjectParticipatingOrgsOrgLensLinksAnswer extends ProjectParticipatingOrgsLinks {
  key: string;
}

/** Filters the CSV export takes: the list query without paging. */
export type ProjectParticipatingOrgsExportFilters = Omit<ProjectParticipatingOrgsQuery, 'pageSize' | 'offset'>;

/** Page body state: data (possibly still loading), no activity in the range, no access, or a failed read. */
export type ProjectParticipatingOrgsViewState = 'ready' | 'empty' | 'forbidden' | 'error';

/**
 * How a row's company name renders for the viewer: an Org Lens membership link, a member the viewer
 * cannot open (plain text + access tooltip), a non-member's Company Lens home link (DR-042), a CDP company
 * page link (spec 062 FR-040), or a plain name (anything else, with no hint).
 */
export type ProjectParticipatingOrgNameKind = 'org-lens-link' | 'no-access' | 'org-lens-home-link' | 'cdp-link' | 'plain';

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
  /** `routerLink` commands of the name link: the membership page (`org-lens-link`), the Company Lens home (`org-lens-home-link`) or the CDP page (`cdp-link`); null otherwise. */
  orgLensLink: string[] | null;
  /** Member badge text (`Gold Member`, or `Member` when the tier is unknown); null for non-members. */
  membershipLabel: string | null;
  /** Tailwind classes for the member badge; null for non-members. */
  membershipBadgeClass: string | null;
  commits: ProjectParticipatingOrgMetricVm;
  contributors: ProjectParticipatingOrgMetricVm;
}
