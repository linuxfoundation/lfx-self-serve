// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';

/**
 * Configurable labels for committees displayed throughout the UI
 * @description This constant allows the user-facing labels to be changed (e.g., to "Group/Groups")
 * while keeping all code and file names as "committees"
 * @readonly
 * @example
 * // Use in templates to display the label
 * <h1>{{COMMITTEE_LABEL.plural}}</h1> // Displays "Groups"
 * <span>{{COMMITTEE_LABEL.singular}} Name</span> // Displays "Group Name"
 */
export const COMMITTEE_LABEL = {
  singular: 'Group',
  plural: 'Groups',
} as const;

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
 * Committee type color mappings for badge styling
 * Returns background and text color classes for category badges
 */
export const COMMITTEE_TYPE_COLORS = {
  // Board and governance
  Board: 'bg-purple-100 text-purple-800',
  'Government Advisory Council': 'bg-purple-100 text-purple-800',

  // Legal and compliance
  'Legal Committee': 'bg-red-100 text-red-800',
  'Code of Conduct': 'bg-red-100 text-red-800',
  'Product Security': 'bg-red-100 text-red-800',

  // Special interest groups
  'Special Interest Group': 'bg-blue-100 text-blue-800',
  'Expert Group': 'bg-blue-100 text-blue-800',

  // Working groups
  'Working Group': 'bg-orange-100 text-orange-800',

  // Technical committees
  'Technical Steering Committee': 'bg-green-100 text-green-800',
  'Technical Oversight Committee/Technical Advisory Committee': 'bg-teal-100 text-teal-800',
  'Technical Mailing List': 'bg-teal-100 text-teal-800',

  // Technical roles
  Maintainers: 'bg-blue-100 text-blue-800',
  Committers: 'bg-blue-100 text-blue-800',

  // Marketing and outreach
  'Marketing Oversight Committee/Marketing Advisory Committee': 'bg-pink-100 text-pink-800',
  'Marketing Committee/Sub Committee': 'bg-pink-100 text-pink-800',
  'Marketing Mailing List': 'bg-pink-100 text-pink-800',
  Ambassador: 'bg-pink-100 text-pink-800',

  // Finance
  'Finance Committee': 'bg-emerald-100 text-emerald-800',

  // Other/miscellaneous
  Other: 'bg-gray-100 text-gray-800',
} as const;

/**
 * Default color scheme for unknown committee types
 */
export const DEFAULT_COMMITTEE_TYPE_COLOR = 'bg-gray-100 text-gray-800';

/**
 * Get valid committee category values for validation
 */
export function getValidCommitteeCategories(): string[] {
  return COMMITTEE_CATEGORIES.map((category) => category.value);
}

/**
 * Get color classes for a committee category badge
 * Returns background and text color classes based on category name
 * Uses partial string matching to categorize committee types
 */
export function getCommitteeTypeColor(category: string | undefined): string {
  if (!category) return DEFAULT_COMMITTEE_TYPE_COLOR;

  const lowerCategory = category.toLowerCase();

  // Check for partial matches in category name
  if (lowerCategory.includes('board')) return 'bg-purple-100 text-purple-800';
  if (lowerCategory.includes('legal')) return 'bg-red-100 text-red-800';
  if (lowerCategory.includes('special interest')) return 'bg-blue-100 text-blue-800';
  if (lowerCategory.includes('working group')) return 'bg-orange-100 text-orange-800';
  if (lowerCategory.includes('technical steering')) return 'bg-green-100 text-green-800';
  if (lowerCategory.includes('technical oversight')) return 'bg-teal-100 text-teal-800';
  if (lowerCategory.includes('marketing oversight')) return 'bg-pink-100 text-pink-800';
  if (lowerCategory.includes('marketing committee')) return 'bg-pink-100 text-pink-800';
  if (lowerCategory.includes('finance')) return 'bg-amber-100 text-amber-800';

  // Fallback to exact match or default
  return COMMITTEE_TYPE_COLORS[category as keyof typeof COMMITTEE_TYPE_COLORS] || DEFAULT_COMMITTEE_TYPE_COLOR;
}
