// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';

/**
 * Available committee category types for classification
 * @description Standard categories used across the LFX platform for organizing committees
 * @readonly
 * @example
 * // Use in dropdown components
 * <LfxDropdown options={COMMITTEE_CATEGORIES} />
 */
export const COMMITTEE_CATEGORIES = [
  { label: 'Legal Committee', value: 'Legal Committee' },
  { label: 'Finance Committee', value: 'Finance Committee' },
  { label: 'Special Interest Group', value: 'Special Interest Group' },
  { label: 'Board', value: 'Board' },
  { label: 'Technical Oversight Committee/Technical Advisory Committee', value: 'Technical Oversight Committee/Technical Advisory Committee' },
  { label: 'Technical Steering Committee', value: 'Technical Steering Committee' },
  { label: 'Marketing Oversight Committee/Marketing Advisory Committee', value: 'Marketing Oversight Committee/Marketing Advisory Committee' },
  { label: 'Marketing Committee/Sub Committee', value: 'Marketing Committee/Sub Committee' },
  { label: 'Code of Conduct', value: 'Code of Conduct' },
  { label: 'Product Security', value: 'Product Security' },
  { label: 'Technical Mailing List', value: 'Technical Mailing List' },
  { label: 'Marketing Mailing List', value: 'Marketing Mailing List' },
  { label: 'Working Group', value: 'Working Group' },
  { label: 'Committers', value: 'Committers' },
  { label: 'Maintainers', value: 'Maintainers' },
  { label: 'Ambassador', value: 'Ambassador' },
  { label: 'Government Advisory Council', value: 'Government Advisory Council' },
  { label: 'Expert Group', value: 'Expert Group' },
  { label: 'Other', value: 'Other' },
];

/**
 * Available member roles within committees
 * @description Standard roles that members can have within committees and working groups
 * @readonly
 * @example
 * // Use for role assignment
 * const chairRole = MEMBER_ROLES.find(role => role.value === CommitteeMemberRole.CHAIR);
 */
export const MEMBER_ROLES = [
  { label: 'Chair', value: CommitteeMemberRole.CHAIR },
  { label: 'Counsel', value: CommitteeMemberRole.COUNSEL },
  { label: 'Developer Seat', value: CommitteeMemberRole.DEVELOPER_SEAT },
  { label: 'TAC/TOC Representative', value: CommitteeMemberRole.TAC_TOC_REPRESENTATIVE },
  { label: 'Director', value: CommitteeMemberRole.DIRECTOR },
  { label: 'Lead', value: CommitteeMemberRole.LEAD },
  { label: 'None', value: CommitteeMemberRole.NONE },
  { label: 'Secretary', value: CommitteeMemberRole.SECRETARY },
  { label: 'Treasurer', value: CommitteeMemberRole.TREASURER },
  { label: 'Vice Chair', value: CommitteeMemberRole.VICE_CHAIR },
  { label: 'LF Staff', value: CommitteeMemberRole.LF_STAFF },
];

/**
 * Available voting status types for committee members
 * @description Defines the voting rights and status of committee members
 * @readonly
 * @example
 * // Check if member has voting rights
 * const canVote = [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP].includes(member.voting?.status);
 */
export const VOTING_STATUSES = [
  { label: 'Alternate Voting Rep', value: CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP },
  { label: 'Observer', value: CommitteeMemberVotingStatus.OBSERVER },
  { label: 'Voting Rep', value: CommitteeMemberVotingStatus.VOTING_REP },
  { label: 'Emeritus', value: CommitteeMemberVotingStatus.EMERITUS },
  { label: 'None', value: CommitteeMemberVotingStatus.NONE },
];

/**
 * Committee type color mappings for consistent styling across the application
 * Colors match corresponding meeting types for consistency
 */
export const COMMITTEE_TYPE_COLORS = {
  // Board and governance
  Board: 'text-red-500', // Matches meeting type
  'Government Advisory Council': 'text-red-600', // Similar to board governance

  // Technical committees
  'Technical Steering Committee': 'text-purple-500', // Matches "Technical" meeting type
  'Technical Oversight Committee/Technical Advisory Committee': 'text-purple-500', // Matches "Technical" meeting type
  'Technical Mailing List': 'text-purple-400', // Technical related
  Maintainers: 'text-blue-500', // Matches meeting type
  Committers: 'text-blue-600', // Similar to maintainers

  // Legal and compliance
  'Legal Committee': 'text-amber-500', // Matches meeting type
  'Code of Conduct': 'text-amber-600', // Legal/compliance related
  'Product Security': 'text-amber-700', // Security/compliance

  // Marketing and outreach
  'Marketing Oversight Committee/Marketing Advisory Committee': 'text-green-500', // Matches marketing meeting type
  'Marketing Committee/Sub Committee': 'text-green-600', // Marketing related
  'Marketing Mailing List': 'text-green-400', // Marketing related
  Ambassador: 'text-green-700', // Outreach/marketing

  // Finance
  'Finance Committee': 'text-emerald-500', // Financial management

  // Working groups and special interest
  'Working Group': 'text-orange-700', // Distinct color for working groups
  'Special Interest Group': 'text-amber-600', // Special interest groups
  'Expert Group': 'text-amber-700', // Similar to special interest

  // Other/miscellaneous
  Other: 'text-gray-600', // General other category
} as const;

/**
 * Default color scheme for unknown committee types
 */
export const DEFAULT_COMMITTEE_TYPE_COLOR = 'text-gray-500';

/**
 * Get valid committee category values for validation
 */
export function getValidCommitteeCategories(): string[] {
  return COMMITTEE_CATEGORIES.map((category) => category.value);
}

/**
 * Get color class for a committee type
 */
export function getCommitteeTypeColor(type: string): string {
  return COMMITTEE_TYPE_COLORS[type as keyof typeof COMMITTEE_TYPE_COLORS] || DEFAULT_COMMITTEE_TYPE_COLOR;
}
