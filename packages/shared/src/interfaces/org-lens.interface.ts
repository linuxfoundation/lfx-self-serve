// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX Org Lens membership tier classes, in descending tier order.
 * Drives any tier-based ranking or filtering on the client side.
 * The set of valid values must stay in sync with the canonical tier
 * classes emitted by the upstream membership-tier table.
 *
 * Rank: Platinum(1) > Premier(2) > Founding(3) > Strategic(4) > Gold(5) >
 *       Steering(6) > Silver(7) > General(8) > Associate(9) > End User(10) >
 *       Academic(11) > Contributor(12) > Other(13)
 *
 * Migration from the prior 10-class ladder to the current 13-class one:
 * - Sponsor is REMOVED. Existing 'Associate Sponsor' display labels
 *   reclassify to Associate via the upstream LIKE '%Associate%' arm.
 * - Steering DEMOTED from rank 3 to rank 6 (now below Gold).
 * - Founding, Strategic, End User, Contributor are NEW canonical classes.
 */
export type MembershipTierClass =
  | 'Platinum'
  | 'Premier'
  | 'Founding'
  | 'Strategic'
  | 'Gold'
  | 'Steering'
  | 'Silver'
  | 'General'
  | 'Associate'
  | 'End User'
  | 'Academic'
  | 'Contributor'
  | 'Other';

/**
 * Raw row from ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ACCOUNT_CONTEXT — the
 * single denormalised platinum table that resolves a Salesforce
 * account_id to the full Org Lens display context (account attributes,
 * Crowd.dev mapping, highest active corporate membership tier).
 */
export interface OrgLensAccountContextRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  ACCOUNT_SLUG: string | null;
  LOGO_URL: string | null;
  CDEV_ORG_ID: string | null;
  CDEV_ORG_NAME: string | null;
  CDEV_ORG_LOGO: string | null;
  IS_MEMBER: boolean;
  MEMBER_ACCOUNT_TYPE: string | null;
  MEMBERSHIP_ID: string | null;
  MEMBERSHIP_PROJECT_ID: string | null;
  MEMBERSHIP_PROJECT_NAME: string | null;
  MEMBERSHIP_TIER_DISPLAY_NAME: string | null;
  MEMBERSHIP_TIER_CLASS: MembershipTierClass | null;
}

export interface OrgLensAccountContextResponse {
  accountId: string;
  accountName: string;
  accountSlug: string | null;
  logoUrl: string | null;
  cdevOrgId: string | null;
  cdevOrgName: string | null;
  cdevOrgLogo: string | null;
  isMember: boolean;
  memberAccountType: string | null;
  membershipId: string | null;
  membershipProjectId: string | null;
  membershipProjectName: string | null;
  membershipTierDisplayName: string | null;
  membershipTierClass: MembershipTierClass | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Foundations and Projects section
// ─────────────────────────────────────────────────────────────────────────

export type OrgLensRowKind = 'member' | 'non_member' | 'outside_lf';
export type OrgRoleBadge = 'Director' | 'Member' | 'Non-Member';
export type VotingStatusBadge = 'Voting' | 'Observer' | '—';
export type GovernanceParticipationBucket = 'Active' | 'Partial' | 'Inactive' | '—';
export type ProjectInfluenceBucket = 'Leading' | 'Contributing' | 'Participating' | 'Silent';

/**
 * One inline-detail-table row per project the org is involved with under a foundation.
 * Sorted by `commits` DESC on the wire.
 */
export interface OrgLensFoundationProject {
  projectId: string;
  projectSlug: string;
  projectName: string;
  isLfProject: boolean;
  influence: ProjectInfluenceBucket;
  maintainers: number;
  contributors: number;
  collaborators: number;
  commits: number;
}

/**
 * One row in the foundations table. Inline-detail data is pre-loaded
 * inside `projects` so the caret toggle never triggers a fetch.
 */
export interface OrgLensFoundationRow {
  foundationId: string;
  foundationSlug: string;
  foundationName: string;
  foundationLogoUrl: string | null;
  rowKind: OrgLensRowKind;
  membershipTierClass: MembershipTierClass | null;
  membershipTierDisplayName: string | null;
  projectCount: number;
  badges: {
    orgRole: OrgRoleBadge;
    votingStatus: VotingStatusBadge;
    governanceParticipation: GovernanceParticipationBucket;
    /** 0..1; null on outside-lf rows (no LF governance to participate in). */
    governanceAttendancePct: number | null;
  };
  projects: OrgLensFoundationProject[];
}

export interface OrgLensFoundationsStatStrip {
  foundations: {
    total: number;
    /** Zero buckets MUST be omitted on the wire. */
    breakdown: Partial<Record<MembershipTierClass, number>>;
  };
  projects: {
    total: number;
    leading: number;
    contributing: number;
    participating: number;
    silent: number;
  };
  governanceRoles: {
    total: number;
    boardMembers: number;
    committeeMembers: number;
  };
  meetingsThisWeek: {
    total: number;
    board: number;
    technical: number;
    marketing: number;
    workingGroup: number;
    other: number;
  };
}

export interface OrgLensFoundationsAndProjectsResponse {
  accountId: string;
  accountName: string;
  statStrip: OrgLensFoundationsStatStrip;
  /** Render-ordered: member tier-ranked → non-member by project count → outside-lf last. */
  rows: OrgLensFoundationRow[];
}
