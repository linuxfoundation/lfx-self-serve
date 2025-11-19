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
  { label: 'Ambassador', value: 'Ambassador' },
  { label: 'Board', value: 'Board' },
  { label: 'Code of Conduct', value: 'Code of Conduct' },
  { label: 'Committers', value: 'Committers' },
  { label: 'Expert Group', value: 'Expert Group' },
  { label: 'Finance Committee', value: 'Finance Committee' },
  { label: 'Government Advisory Council', value: 'Government Advisory Council' },
  { label: 'Legal Committee', value: 'Legal Committee' },
  { label: 'Maintainers', value: 'Maintainers' },
  { label: 'Marketing Committee/Sub Committee', value: 'Marketing Committee/Sub Committee' },
  { label: 'Marketing Mailing List', value: 'Marketing Mailing List' },
  { label: 'Marketing Oversight Committee/Marketing Advisory Committee', value: 'Marketing Oversight Committee/Marketing Advisory Committee' },
  { label: 'Product Security', value: 'Product Security' },
  { label: 'Special Interest Group', value: 'Special Interest Group' },
  { label: 'Technical Mailing List', value: 'Technical Mailing List' },
  { label: 'Technical Oversight Committee/Technical Advisory Committee', value: 'Technical Oversight Committee/Technical Advisory Committee' },
  { label: 'Technical Steering Committee', value: 'Technical Steering Committee' },
  { label: 'Working Group', value: 'Working Group' },
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
  { label: 'Director', value: CommitteeMemberRole.DIRECTOR },
  { label: 'Lead', value: CommitteeMemberRole.LEAD },
  { label: 'LF Staff', value: CommitteeMemberRole.LF_STAFF },
  { label: 'Secretary', value: CommitteeMemberRole.SECRETARY },
  { label: 'TAC/TOC Representative', value: CommitteeMemberRole.TAC_TOC_REPRESENTATIVE },
  { label: 'Treasurer', value: CommitteeMemberRole.TREASURER },
  { label: 'Vice Chair', value: CommitteeMemberRole.VICE_CHAIR },
  { label: 'None', value: CommitteeMemberRole.NONE },
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
  { label: 'Emeritus', value: CommitteeMemberVotingStatus.EMERITUS },
  { label: 'Observer', value: CommitteeMemberVotingStatus.OBSERVER },
  { label: 'Voting Rep', value: CommitteeMemberVotingStatus.VOTING_REP },
  { label: 'None', value: CommitteeMemberVotingStatus.NONE },
];

/**
 * Internal committee type color mappings for exact match fallback
 * @private - Use getCommitteeTypeColor() function instead
 * @description Uses LFX semantic color tokens from the design system
 */
const COMMITTEE_TYPE_COLORS = {
  // Board and governance
  Board: 'bg-violet-100 text-violet-800',
  'Government Advisory Council': 'bg-violet-100 text-violet-800',

  // Legal and compliance
  'Legal Committee': 'bg-negative-100 text-negative-800',
  'Code of Conduct': 'bg-negative-100 text-negative-800',
  'Product Security': 'bg-negative-100 text-negative-800',

  // Special interest groups
  'Special Interest Group': 'bg-brand-100 text-brand-800',
  'Expert Group': 'bg-brand-100 text-brand-800',

  // Working groups
  'Working Group': 'bg-warning-100 text-warning-800',

  // Technical committees
  'Technical Steering Committee': 'bg-positive-100 text-positive-800',
  'Technical Oversight Committee/Technical Advisory Committee': 'bg-brand-100 text-brand-700',
  'Technical Mailing List': 'bg-brand-100 text-brand-700',

  // Technical roles
  Maintainers: 'bg-brand-100 text-brand-800',
  Committers: 'bg-brand-100 text-brand-800',

  // Marketing and outreach
  'Marketing Oversight Committee/Marketing Advisory Committee': 'bg-violet-100 text-violet-700',
  'Marketing Committee/Sub Committee': 'bg-violet-100 text-violet-700',
  'Marketing Mailing List': 'bg-violet-100 text-violet-700',
  Ambassador: 'bg-violet-100 text-violet-700',

  // Finance
  'Finance Committee': 'bg-positive-100 text-positive-800',

  // Other/miscellaneous
  Other: 'bg-neutral-100 text-neutral-800',
} as const;

/**
 * Internal default color scheme for unknown committee types
 * @private
 */
const DEFAULT_COMMITTEE_TYPE_COLOR = 'bg-neutral-100 text-neutral-800';

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

  // Board and governance
  if (lowerCategory.includes('board')) return 'bg-violet-100 text-violet-800';
  if (lowerCategory.includes('government')) return 'bg-violet-100 text-violet-800';

  // Legal and compliance
  if (lowerCategory.includes('legal')) return 'bg-negative-100 text-negative-800';
  if (lowerCategory.includes('code of conduct')) return 'bg-negative-100 text-negative-800';
  if (lowerCategory.includes('product security')) return 'bg-negative-100 text-negative-800';

  // Special interest groups
  if (lowerCategory.includes('special interest')) return 'bg-brand-100 text-brand-800';
  if (lowerCategory.includes('expert')) return 'bg-brand-100 text-brand-800';

  // Working groups
  if (lowerCategory.includes('working group')) return 'bg-warning-100 text-warning-800';

  // Technical committees
  if (lowerCategory.includes('technical steering')) return 'bg-positive-100 text-positive-800';
  if (lowerCategory.includes('technical oversight')) return 'bg-brand-100 text-brand-700';
  if (lowerCategory.includes('technical mailing')) return 'bg-brand-100 text-brand-700';

  // Technical roles
  if (lowerCategory.includes('maintainer')) return 'bg-brand-100 text-brand-800';
  if (lowerCategory.includes('committer')) return 'bg-brand-100 text-brand-800';

  // Marketing and outreach
  if (lowerCategory.includes('marketing oversight')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('marketing committee')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('marketing mailing')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('ambassador')) return 'bg-violet-100 text-violet-700';

  // Finance
  if (lowerCategory.includes('finance')) return 'bg-positive-100 text-positive-800';

  // Other/miscellaneous
  if (lowerCategory.includes('other')) return 'bg-neutral-100 text-neutral-800';

  // Fallback to exact match or default
  return COMMITTEE_TYPE_COLORS[category as keyof typeof COMMITTEE_TYPE_COLORS] || DEFAULT_COMMITTEE_TYPE_COLOR;
}
