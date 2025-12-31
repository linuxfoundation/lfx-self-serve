// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagProps, TagSeverity } from '../interfaces/components.interface';

/**
 * Tag type configuration
 * @description Centralized tag styling configuration for common use cases
 */
export interface TagTypeConfig {
  severity: TagProps['severity'];
  icon?: string;
  rounded?: boolean;
}

/**
 * Centralized tag type configurations
 * @description Pre-configured tag styles for common use cases across the application
 */
export const TAG_TYPE_CONFIGS: Record<string, TagTypeConfig> = {
  // Meeting Privacy
  meetingPrivate: { severity: 'danger', icon: 'fa-light fa-shield', rounded: false },
  meetingPublic: { severity: 'info', icon: 'fa-light fa-globe', rounded: false },

  // Meeting Recurrence
  meetingRecurring: { severity: 'secondary', icon: 'fa-light fa-repeat', rounded: false },

  // Meeting Features
  featureYoutube: { severity: 'danger', icon: 'fa-light fa-upload', rounded: false },
  featureRecording: { severity: 'info', icon: 'fa-light fa-video', rounded: false },
  featureTranscript: { severity: 'secondary', icon: 'fa-light fa-file-lines', rounded: false },
  featureAiSummary: { severity: 'success', icon: 'fa-light fa-sparkles', rounded: false },
  featureChat: { severity: 'info', icon: 'fa-light fa-messages', rounded: false },

  // Meeting DateTime
  meetingDateTime: { severity: 'secondary', icon: 'fa-light fa-calendar-days', rounded: false },

  // Roles
  roleHost: { severity: 'success', rounded: false },
  roleInvited: { severity: 'secondary', rounded: false },
  roleMember: { severity: 'info', rounded: false },

  // Status
  statusVerified: { severity: 'success', icon: 'fa-light fa-circle-check', rounded: true },
  statusUnverified: { severity: 'warn', icon: 'fa-light fa-circle-exclamation', rounded: true },
  statusActive: { severity: 'success', rounded: true },
  statusInactive: { severity: 'secondary', rounded: true },
  statusPending: { severity: 'warn', rounded: true },

  // Membership Tier
  tierMembership: { severity: 'secondary', icon: 'fa-light fa-star', rounded: false },

  // Category/Type
  categoryDefault: { severity: 'info', rounded: true },

  // Foundation
  foundation: { severity: 'info', rounded: false },
};

/**
 * Committee category to severity mapping
 * @description Maps committee categories to semantic severity levels for consistent styling
 */
export const COMMITTEE_CATEGORY_SEVERITY: Record<string, TagSeverity> = {
  // Governance & Leadership
  Board: 'danger',
  'Government Advisory Council': 'danger',

  // Technical
  'Technical Steering Committee': 'secondary',
  'Technical Oversight Committee/Technical Advisory Committee': 'secondary',
  'Technical Mailing List': 'secondary',
  Maintainers: 'info',
  Committers: 'info',

  // Legal & Compliance
  'Legal Committee': 'warn',
  'Code of Conduct': 'warn',

  // Finance
  'Finance Committee': 'success',

  // Security
  'Product Security': 'danger',

  // Marketing
  'Marketing Committee/Sub Committee': 'success',
  'Marketing Mailing List': 'success',
  'Marketing Oversight Committee/Marketing Advisory Committee': 'success',

  // Community & Outreach
  Ambassador: 'info',
  'Special Interest Group': 'secondary',
  'Working Group': 'secondary',
  'Expert Group': 'secondary',

  // Default
  Other: 'secondary',
};

/**
 * Get committee category severity
 * @param category - The committee category
 * @returns The severity level for the category
 */
export function getCommitteeCategorySeverity(category: string): TagSeverity {
  return COMMITTEE_CATEGORY_SEVERITY[category] || 'secondary';
}
