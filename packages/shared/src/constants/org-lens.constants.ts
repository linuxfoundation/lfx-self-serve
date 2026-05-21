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
