// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MembershipTierClass, OrgLensFoundationsAndProjectsResponse, OrgLensFoundationsSectionState } from '../interfaces/org-lens.interface';

/** Canonical 13-class membership tier order — used for breakdown rendering and any rank-aware comparator. */
export const MEMBERSHIP_TIER_ORDER: MembershipTierClass[] = [
  'Platinum',
  'Premier',
  'Founding',
  'Strategic',
  'Gold',
  'Steering',
  'Silver',
  'General',
  'Associate',
  'End User',
  'Academic',
  'Contributor',
  'Other',
];

/** Empty-shaped Org Lens foundations-and-projects response — placeholder while the wire request resolves. */
export const ORG_LENS_FOUNDATIONS_EMPTY_RESPONSE: OrgLensFoundationsAndProjectsResponse = {
  accountId: '',
  accountName: '',
  statStrip: {
    foundations: { total: 0, breakdown: {} },
    projects: { total: 0, leading: 0, contributing: 0, participating: 0, silent: 0 },
    governanceRoles: { total: 0, boardMembers: 0, committeeMembers: 0 },
    meetingsThisWeek: { total: 0, board: 0, technical: 0, marketing: 0, workingGroup: 0, other: 0 },
  },
  rows: [],
};

/** Initial section state for the foundations-and-projects component — loading until the first response arrives. */
export const ORG_LENS_FOUNDATIONS_INITIAL_STATE: OrgLensFoundationsSectionState = { status: 'loading', data: null };

/** Foundation-logo letter-square fallback palette: deterministic `djb2(foundationId) % 5` map into the chromatic LFX families (excludes `gray` so squares never blend into the Outside-LF umbrella row). */
export const FOUNDATION_LOGO_SQUARE_PALETTE: readonly string[] = [
  'bg-blue-600 text-white',
  'bg-emerald-600 text-white',
  'bg-amber-600 text-white',
  'bg-red-600 text-white',
  'bg-violet-600 text-white',
];

/** 503 copy when the BFF could not verify the caller's access to an organization (grant roster or authorizer unavailable). */
export const ORG_ACCESS_UNVERIFIABLE_MESSAGE = "Couldn't verify your access to this organization right now. Please try again.";

/** How long a copy-to-clipboard confirmation stays on screen in the Org Lens person-detail drawer. */
export const PERSON_DRAWER_COPIED_RESET_MS = 2000;

/** lf-dbt's view of the Overview Active Contributors trend (lfx-self-serve#4694); a read names it so a missing view degrades the trend only. */
export const ORG_CONTRIBUTORS_MONTHLY_VIEW = 'ORG_CONTRIBUTORS_MONTHLY';

/** ORG_CONTRIBUTORS_MONTHLY's monthly count without CDP team members, read under the default Team members = Exclude (lfx-self-serve#4685). */
export const ORG_CONTRIBUTORS_MONTHLY_EXCLUDING_COLUMN = 'UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS';

/** ORG_MAINTAINER_ROLES_MONTHLY's monthly roles without CDP team members, read under the default Team members = Exclude (lfx-self-serve#4685). */
export const ORG_MAINTAINER_ROLES_MONTHLY_EXCLUDING_COLUMN = 'ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS';

/** ORG_CODE_CONTRIBUTIONS' lifetime first commit per account and repository without CDP team members' commits, read under Exclude (lfx-self-serve#4685). */
export const ORG_REPO_FIRST_NON_TEAM_COMMIT_COLUMN = 'ORG_REPO_FIRST_NON_TEAM_COMMIT_TS';

/**
 * Project Detail's sparkline tables: the account's value without CDP team members, read under the default
 * (lfx-self-serve#4685). Set only on the `maintainer-roles` series; NULL on every other series.
 */
export const ORG_LENS_PROJECT_ORG_VALUE_EXCLUDING_COLUMN = 'ORG_VALUE_EXCLUDING_TEAM_MEMBERS';

/** Project Detail's sparkline series (METRIC_KEY) of maintainer roles, drawn on the Maintainer roles card (lfx-self-serve#4605). */
export const ORG_LENS_PROJECT_MAINTAINER_ROLES_METRIC_KEY = 'maintainer-roles';
