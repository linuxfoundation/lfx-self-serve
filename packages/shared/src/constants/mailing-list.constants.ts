// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MailingListType } from '../enums/mailing-list.enum';

/**
 * Configurable labels for mailing lists displayed throughout the UI
 * @description This constant allows the user-facing labels to be changed
 * while keeping all code and file names consistent
 * @readonly
 * @example
 * // Use in templates to display the label
 * <h1>{{MAILING_LIST_LABEL.plural}}</h1> // Displays "Mailing Lists"
 * <span>{{MAILING_LIST_LABEL.singular}} Name</span> // Displays "Mailing List Name"
 */
export const MAILING_LIST_LABEL = {
  singular: 'Mailing List',
  plural: 'Mailing Lists',
} as const;

/**
 * Maximum number of linked groups to show before displaying "+N more" badge
 * @description Controls how many group badges are visible in the table before collapsing
 * @readonly
 */
export const MAILING_LIST_MAX_VISIBLE_GROUPS = 2;

/**
 * Type badge display labels
 * @description Human-readable labels for mailing list types
 */
export const MAILING_LIST_TYPE_LABELS = {
  [MailingListType.ANNOUNCEMENT]: 'Announcement',
  [MailingListType.DISCUSSION_MODERATED]: 'Moderated',
  [MailingListType.DISCUSSION_OPEN]: 'Open',
} as const;

/**
 * Step titles for the mailing list manage wizard
 * @description Defines the step labels displayed in the progress indicator
 */
export const MAILING_LIST_STEP_TITLES = ['Basic Information', 'Settings', 'People & Groups'] as const;

/**
 * Total number of steps in the mailing list wizard
 */
export const MAILING_LIST_TOTAL_STEPS = MAILING_LIST_STEP_TITLES.length;
