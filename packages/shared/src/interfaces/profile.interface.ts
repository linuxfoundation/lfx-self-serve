// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile tab configuration for the profile layout navigation
 */
export interface ProfileTab {
  id: string;
  label: string;
  route: string;
  icon?: string;
  visible?: boolean; // For role-based visibility (future)
}

/**
 * Project affiliation for the Overview tab
 */
export interface ProfileProject {
  id: string;
  name: string;
  logo?: string;
  role: string;
  roleConfirmed: boolean;
  organization: string;
  organizationLogo?: string;
}

/**
 * Connected identity provider types
 */
export type IdentityProvider = 'github' | 'gitlab' | 'linkedin' | 'google' | 'email';

/**
 * Connected identity for the Overview tab
 */
export interface ConnectedIdentity {
  id: string;
  provider: IdentityProvider;
  identifier: string;
  verified: boolean;
  icon?: string;
}

/**
 * Profile header data displayed in the profile layout card
 * Extends and normalizes the UserMetadata for display purposes
 */
export interface ProfileHeaderData {
  firstName: string;
  lastName: string;
  username: string;
  jobTitle?: string;
  organization?: string;
  city?: string;
  stateProvince?: string;
  country?: string;
  address?: string;
  postalCode?: string;
  phoneNumber?: string;
  tshirtSize?: string;
  avatarUrl?: string;
}

/**
 * Skill item for skill management
 */
export interface ProfileSkill {
  id: string;
  name: string;
  category?: string;
}

/**
 * Affiliation basis information - how the affiliation was determined
 */
export interface AffiliationBasis {
  source: string;
  contributionCount?: number;
}

/**
 * Affiliation scope types
 */
export type AffiliationScope = 'Global' | 'Project' | 'Committee';

/**
 * User affiliation with an organization
 */
export interface Affiliation {
  id: string;
  organization: string;
  organizationLogo?: string;
  basis: AffiliationBasis;
  scope: AffiliationScope;
  verified: boolean;
  startDate: string;
  endDate?: string;
}

/**
 * Verification choice for identity verification dialog
 */
export type VerificationChoice = 'yes' | 'no' | undefined;

/**
 * Map of identity ID to verification choice
 */
export type VerificationChoices = Record<string, VerificationChoice>;

/**
 * Map of identity ID to contribution count
 */
export type ContributionCounts = Record<string, number>;
