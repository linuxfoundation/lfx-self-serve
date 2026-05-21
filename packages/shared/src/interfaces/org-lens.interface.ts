// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Canonical Org Lens membership tier classes, declared in rank order (Platinum highest). */
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

// Foundations and Projects section
export type OrgLensRowKind = 'member' | 'non_member' | 'outside_lf';
export type OrgRoleBadge = 'Director' | 'Member' | 'Non-Member';
export type VotingStatusBadge = 'Voting' | 'Observer' | '—';
export type GovernanceParticipationBucket = 'Active' | 'Partial' | 'Inactive' | '—';
export type ProjectInfluenceBucket = 'Leading' | 'Contributing' | 'Participating' | 'Silent';

/** One project row inside a foundation's inline-detail table; sorted by commits DESC on the wire. */
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

/** One row in the foundations table; `projects` is pre-loaded so caret toggle never fetches. */
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

/** Loading lifecycle states for the foundations-and-projects section UI. */
export type OrgLensFoundationsSectionStatus = 'loading' | 'error' | 'ready' | 'empty';

/** Combined status + payload for the foundations-and-projects component's state signal. */
export interface OrgLensFoundationsSectionState {
  status: OrgLensFoundationsSectionStatus;
  data: OrgLensFoundationsAndProjectsResponse | null;
}

/** Route data for `/org/*` placeholders — drives the shared placeholder header + empty-state copy. */
export interface OrgPlaceholderRouteData {
  title?: string;
  description?: string;
  icon?: string;
}
