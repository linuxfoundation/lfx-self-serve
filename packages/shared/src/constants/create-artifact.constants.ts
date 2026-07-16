// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatableArtifactConfig } from '../interfaces/create-artifact.interface';

/**
 * Type-selection entries for the rail "Create" quick-link menu + dialog. Order
 * here is the render order.
 */
export const CREATABLE_ARTIFACTS: CreatableArtifactConfig[] = [
  {
    type: 'meeting',
    label: 'Meeting',
    description: 'Schedule a recurring or one-time meeting for a project.',
    icon: 'fa-light fa-calendar',
    createRoute: '/meetings/create',
  },
  {
    type: 'group',
    label: 'Group',
    description: 'Create a group/committee to organize members around a project.',
    icon: 'fa-light fa-people-group',
    createRoute: '/groups/create',
  },
  {
    type: 'mailing-list',
    label: 'Mailing List',
    description: 'Set up a mailing list for project communications.',
    icon: 'fa-light fa-envelope',
    createRoute: '/mailing-lists/create',
  },
];
