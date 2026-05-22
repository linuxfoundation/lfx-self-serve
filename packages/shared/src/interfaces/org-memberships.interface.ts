// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface OrgMembershipsSummary {
  activeMemberships: number;
  renewingWithin90Days: number;
  governanceRoles: number;
}

export interface OrgActiveMembership {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  projectCount: number;
  memberCount: number;
  membershipTier: string;
  tierStartDate: string | null;
  tierEndDate: string | null;
  memberSince: string | null;
  boardMembers: number;
  committeeMembers: number;
  orgProjects: number;
}

export interface OrgActiveMembershipsResponse {
  accountId: string;
  summary: OrgMembershipsSummary;
  memberships: OrgActiveMembership[];
}

export interface OrgExpiredMembership {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  membershipTier: string;
  tierStartDate: string | null;
  tierEndDate: string | null;
  expirationDate: string | null;
  actionType: 'renew' | 'contact';
}

export interface OrgExpiredMembershipsResponse {
  accountId: string;
  memberships: OrgExpiredMembership[];
}

export interface OrgDiscoverOpportunity {
  foundationId: string;
  foundationName: string;
  foundationLogo: string | null;
  category: string;
  suggestedTier: string;
  relevantProjects: number;
  contributors: number;
  contributions: number;
}

export interface OrgDiscoverOpportunitiesResponse {
  accountId: string;
  opportunities: OrgDiscoverOpportunity[];
}
