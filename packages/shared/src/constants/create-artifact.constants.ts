// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatableArtifactConfig } from '../interfaces/create-artifact.interface';

/**
 * Type-selection entries for the rail "Create" quick-link menu + dialog. Array
 * order is the render order, and the menu draws a separator wherever `group`
 * changes between adjacent entries — so this list is the single source of truth
 * for both sequence and grouping.
 *
 * Sequence is a semantic grouping, not usage frequency:
 *  - Engage:   Meeting, Newsletter
 *  - Decide:   Vote, Survey
 *  - Organize: Group, Mailing List
 */
export const CREATABLE_ARTIFACTS: CreatableArtifactConfig[] = [
  {
    type: 'meeting',
    label: 'Meeting',
    description: 'Schedule a recurring or one-time meeting for a project.',
    icon: 'fa-light fa-calendar',
    createRoute: '/meetings/create',
    group: 'engage',
    targetKinds: ['project', 'committee'],
  },
  {
    type: 'newsletter',
    label: 'Newsletter',
    description: 'Publish a newsletter to keep a project community informed.',
    icon: 'fa-light fa-paper-plane',
    createRoute: '/newsletters/create',
    group: 'engage',
    targetKinds: ['project'],
  },
  {
    type: 'vote',
    label: 'Vote',
    description: 'Open a vote to reach a decision with a project community.',
    icon: 'fa-light fa-check-to-slot',
    createRoute: '/votes/create',
    group: 'decide',
    targetKinds: ['project', 'committee'],
  },
  {
    type: 'survey',
    label: 'Survey',
    description: 'Gather structured feedback from a project community.',
    icon: 'fa-light fa-clipboard-list',
    createRoute: '/surveys/create',
    group: 'decide',
    targetKinds: ['project', 'committee'],
  },
  {
    type: 'group',
    label: 'Group',
    description: 'Create a group/committee to organize members around a project.',
    icon: 'fa-light fa-people-group',
    createRoute: '/groups/create',
    group: 'organize',
    targetKinds: ['project'],
  },
  {
    type: 'mailing-list',
    label: 'Mailing List',
    description: 'Set up a mailing list for project communications.',
    icon: 'fa-light fa-envelope',
    createRoute: '/mailing-lists/create',
    group: 'organize',
    targetKinds: ['project'],
  },
];
