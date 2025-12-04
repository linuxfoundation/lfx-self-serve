// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import { lfxColors } from './colors.constants';

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
 * Committee category info for card-based selection
 * @description Defines icons, descriptions, and colors for each committee category
 */
export interface CommitteeCategoryInfo {
  icon: string;
  description: string;
  examples: string;
  color: string;
}

/**
 * Committee category configurations with visual styling
 * @description Maps category values to their display info (follows meeting type pattern)
 */
export const COMMITTEE_CATEGORY_CONFIGS: Record<string, CommitteeCategoryInfo> = {
  Ambassador: {
    icon: 'fa-light fa-bullhorn',
    description: 'Community advocates who promote and represent the project',
    examples: 'Developer advocates, community evangelists, regional representatives',
    color: lfxColors.violet[500],
  },
  Board: {
    icon: 'fa-light fa-user-crown',
    description: 'Governance body for strategic decisions and project direction',
    examples: 'Board of directors, governing board, advisory board',
    color: lfxColors.red[500],
  },
  'Code of Conduct': {
    icon: 'fa-light fa-shield-check',
    description: 'Ensures community standards and handles conduct issues',
    examples: 'CoC committee, conduct review board, community standards team',
    color: lfxColors.red[500],
  },
  Committers: {
    icon: 'fa-light fa-code-commit',
    description: 'Contributors with commit access to project repositories',
    examples: 'Core committers, project committers, module maintainers',
    color: lfxColors.blue[500],
  },
  'Expert Group': {
    icon: 'fa-light fa-lightbulb',
    description: 'Specialized group focused on specific technical domains',
    examples: 'Security experts, performance specialists, API designers',
    color: lfxColors.amber[500],
  },
  'Finance Committee': {
    icon: 'fa-light fa-coins',
    description: 'Oversees budget, funding, and financial decisions',
    examples: 'Budget committee, finance review board, funding allocation',
    color: lfxColors.emerald[500],
  },
  'Government Advisory Council': {
    icon: 'fa-light fa-landmark',
    description: 'Advises on government relations and public sector engagement',
    examples: 'Public sector advisory, government liaison, policy advisors',
    color: lfxColors.violet[500],
  },
  'Legal Committee': {
    icon: 'fa-light fa-scale-balanced',
    description: 'Handles licensing, compliance, and legal matters',
    examples: 'License review, IP committee, legal advisory',
    color: lfxColors.amber[500],
  },
  Maintainers: {
    icon: 'fa-light fa-gear',
    description: 'Core team responsible for project maintenance and releases',
    examples: 'Project maintainers, release managers, core team',
    color: lfxColors.blue[500],
  },
  'Marketing Committee/Sub Committee': {
    icon: 'fa-light fa-chart-line-up',
    description: 'Drives marketing initiatives and community growth',
    examples: 'Marketing team, growth committee, outreach group',
    color: lfxColors.emerald[500],
  },
  'Marketing Mailing List': {
    icon: 'fa-light fa-envelope',
    description: 'Communication channel for marketing discussions',
    examples: 'Marketing announcements, campaign coordination',
    color: lfxColors.emerald[500],
  },
  'Marketing Oversight Committee/Marketing Advisory Committee': {
    icon: 'fa-light fa-chart-pie',
    description: 'Strategic oversight for marketing activities',
    examples: 'Marketing strategy, brand guidelines, campaign approval',
    color: lfxColors.emerald[500],
  },
  'Product Security': {
    icon: 'fa-light fa-shield-halved',
    description: 'Handles security vulnerabilities and advisories',
    examples: 'Security response team, vulnerability disclosure, CVE handling',
    color: lfxColors.red[500],
  },
  'Special Interest Group': {
    icon: 'fa-light fa-users-viewfinder',
    description: 'Focused group for specific topics or use cases',
    examples: 'Cloud SIG, Edge SIG, Documentation SIG',
    color: lfxColors.blue[500],
  },
  'Technical Advisory Committee': {
    icon: 'fa-light fa-diagram-project',
    description: 'Advises on technical direction and architecture',
    examples: 'TAC committee, architecture review, technical guidance',
    color: lfxColors.violet[500],
  },
  'Technical Mailing List': {
    icon: 'fa-light fa-at',
    description: 'Communication channel for technical discussions',
    examples: 'Dev discussions, RFC reviews, technical Q&A',
    color: lfxColors.violet[500],
  },
  'Technical Oversight Committee': {
    icon: 'fa-light fa-sitemap',
    description: 'Oversees technical governance and standards',
    examples: 'TOC committee, project incubation, technical standards',
    color: lfxColors.violet[500],
  },
  'Technical Steering Committee': {
    icon: 'fa-light fa-compass',
    description: 'Steers technical roadmap and priorities',
    examples: 'TSC committee, roadmap planning, release decisions',
    color: lfxColors.violet[500],
  },
  'Working Group': {
    icon: 'fa-light fa-users-gear',
    description: 'Collaborative group working on specific initiatives',
    examples: 'Documentation WG, Testing WG, CI/CD WG',
    color: lfxColors.amber[500],
  },
  Other: {
    icon: 'fa-light fa-folder-open',
    description: 'Other committee types not covered by standard categories',
    examples: 'Custom committees, ad-hoc groups, temporary teams',
    color: lfxColors.gray[500],
  },
};

/**
 * Available committee category types for classification
 * @description Standard categories used across the LFX platform for organizing committees
 * @readonly
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
  { label: 'Technical Advisory Committee', value: 'Technical Advisory Committee' },
  { label: 'Technical Mailing List', value: 'Technical Mailing List' },
  { label: 'Technical Oversight Committee', value: 'Technical Oversight Committee' },
  { label: 'Technical Steering Committee', value: 'Technical Steering Committee' },
  { label: 'Working Group', value: 'Working Group' },
  { label: 'Other', value: 'Other' },
];

/**
 * Filtered committee categories for specific UI contexts
 * @description Subset of categories for restricted selection (e.g., forms, dashboards)
 */
export const FILTERED_COMMITTEE_CATEGORIES = [
  { label: 'Special Interest Group', value: 'Special Interest Group' },
  { label: 'Technical Advisory Committee', value: 'Technical Advisory Committee' },
  { label: 'Technical Oversight Committee', value: 'Technical Oversight Committee' },
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
  'Legal Committee': 'bg-red-100 text-red-800',
  'Code of Conduct': 'bg-red-100 text-red-800',
  'Product Security': 'bg-red-100 text-red-800',

  // Special interest groups
  'Special Interest Group': 'bg-blue-100 text-blue-800',
  'Expert Group': 'bg-blue-100 text-blue-800',

  // Working groups
  'Working Group': 'bg-amber-100 text-amber-800',

  // Technical committees
  'Technical Steering Committee': 'bg-emerald-100 text-emerald-800',
  'Technical Advisory Committee': 'bg-blue-100 text-blue-700',
  'Technical Oversight Committee': 'bg-blue-100 text-blue-700',
  'Technical Mailing List': 'bg-blue-100 text-blue-700',

  // Technical roles
  Maintainers: 'bg-blue-100 text-blue-800',
  Committers: 'bg-blue-100 text-blue-800',

  // Marketing and outreach
  'Marketing Oversight Committee/Marketing Advisory Committee': 'bg-violet-100 text-violet-700',
  'Marketing Committee/Sub Committee': 'bg-violet-100 text-violet-700',
  'Marketing Mailing List': 'bg-violet-100 text-violet-700',
  Ambassador: 'bg-violet-100 text-violet-700',

  // Finance
  'Finance Committee': 'bg-emerald-100 text-emerald-800',

  // Other/miscellaneous
  Other: 'bg-gray-100 text-gray-800',
} as const;

/**
 * Internal default color scheme for unknown committee types
 * @private
 */
const DEFAULT_COMMITTEE_TYPE_COLOR = 'bg-gray-100 text-gray-800';

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
  if (lowerCategory.includes('legal')) return 'bg-red-100 text-red-800';
  if (lowerCategory.includes('code of conduct')) return 'bg-red-100 text-red-800';
  if (lowerCategory.includes('product security')) return 'bg-red-100 text-red-800';

  // Special interest groups
  if (lowerCategory.includes('special interest')) return 'bg-blue-100 text-blue-800';
  if (lowerCategory.includes('expert')) return 'bg-blue-100 text-blue-800';

  // Working groups
  if (lowerCategory.includes('working group')) return 'bg-amber-100 text-amber-800';

  // Technical committees
  if (lowerCategory.includes('technical steering')) return 'bg-emerald-100 text-emerald-800';
  if (lowerCategory.includes('technical advisory')) return 'bg-blue-100 text-blue-700';
  if (lowerCategory.includes('technical oversight')) return 'bg-blue-100 text-blue-700';
  if (lowerCategory.includes('technical mailing')) return 'bg-blue-100 text-blue-700';

  // Technical roles
  if (lowerCategory.includes('maintainer')) return 'bg-blue-100 text-blue-800';
  if (lowerCategory.includes('committer')) return 'bg-blue-100 text-blue-800';

  // Marketing and outreach
  if (lowerCategory.includes('marketing oversight')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('marketing committee')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('marketing mailing')) return 'bg-violet-100 text-violet-700';
  if (lowerCategory.includes('ambassador')) return 'bg-violet-100 text-violet-700';

  // Finance
  if (lowerCategory.includes('finance')) return 'bg-emerald-100 text-emerald-800';

  // Other/miscellaneous
  if (lowerCategory.includes('other')) return 'bg-gray-100 text-gray-800';

  // Fallback to exact match or default
  return COMMITTEE_TYPE_COLORS[category as keyof typeof COMMITTEE_TYPE_COLORS] || DEFAULT_COMMITTEE_TYPE_COLOR;
}

// ============================================================================
// Committee Form Configuration Constants
// ============================================================================

/**
 * Step titles for the committee creation/edit stepper
 * @description Array of human-readable titles for each step in the committee form
 */
export const COMMITTEE_STEP_TITLES = [`${COMMITTEE_LABEL.singular} Type`, 'Basic Information', `${COMMITTEE_LABEL.singular} Settings`, 'Add Members'];

/**
 * Total number of steps in the committee form
 * @description Must match the length of COMMITTEE_STEP_TITLES array
 * @example 4 steps: Category → Basic Info → Settings → Add Members
 */
export const COMMITTEE_TOTAL_STEPS = COMMITTEE_STEP_TITLES.length;

/**
 * Committee form step indices
 * @description One-based step numbers for form navigation and validation
 * @readonly
 */
export const COMMITTEE_FORM_STEPS = {
  /** Step 1: Select committee category/type */
  CATEGORY: 1,
  /** Step 2: Basic information (name, parent, description, website) */
  BASIC_INFO: 2,
  /** Step 3: Configure settings (toggles for various features) */
  SETTINGS: 3,
  /** Step 4: Add members to the committee */
  ADD_MEMBERS: 4,
};

/**
 * Committee settings features for Step 2 form
 * @description Feature toggles for committee settings (follows MEETING_FEATURES pattern)
 */
export const COMMITTEE_SETTINGS_FEATURES = [
  {
    key: 'business_email_required',
    icon: 'fa-light fa-shield',
    title: 'Business Email Required',
    description: 'Require members to have a business email address',
    color: lfxColors.blue[500],
  },
  {
    key: 'enable_voting',
    icon: 'fa-light fa-check-to-slot',
    title: 'Enable Voting',
    description: `Allow members to vote on ${COMMITTEE_LABEL.singular.toLowerCase()} matters`,
    recommended: true,
    color: lfxColors.violet[500],
  },
  {
    key: 'is_audit_enabled',
    icon: 'fa-light fa-file-check',
    title: 'Enable Audit',
    description: `Track and log all ${COMMITTEE_LABEL.singular.toLowerCase()} activity for compliance`,
    color: lfxColors.emerald[500],
  },
  {
    key: 'joinable',
    icon: 'fa-light fa-users',
    title: 'Joinable',
    description: `Allow users to join the ${COMMITTEE_LABEL.singular.toLowerCase()} without invitation`,
    color: lfxColors.amber[500],
  },
  {
    key: 'public',
    icon: 'fa-light fa-eye',
    title: `Make ${COMMITTEE_LABEL.singular} Public`,
    description: `Make ${COMMITTEE_LABEL.singular.toLowerCase()} visible to all users`,
    recommended: true,
    color: lfxColors.violet[500],
  },
  {
    key: 'sso_group_enabled',
    icon: 'fa-light fa-key',
    title: 'Enable SSO Group',
    description: 'Sync membership with Single Sign-On provider',
    color: lfxColors.red[500],
  },
];
