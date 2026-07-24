// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatableArtifactConfig, CreatableArtifactType } from '../interfaces/create-artifact.interface';

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
  },
  {
    type: 'newsletter',
    label: 'Newsletter',
    description: 'Publish a newsletter to keep a project community informed.',
    icon: 'fa-light fa-paper-plane',
    createRoute: '/newsletters/create',
    group: 'engage',
  },
  {
    type: 'vote',
    label: 'Vote',
    description: 'Open a vote to reach a decision with a project community.',
    icon: 'fa-light fa-check-to-slot',
    createRoute: '/votes/create',
    group: 'decide',
  },
  {
    type: 'survey',
    label: 'Survey',
    description: 'Gather structured feedback from a project community.',
    icon: 'fa-light fa-clipboard-list',
    createRoute: '/surveys/create',
    group: 'decide',
  },
  {
    type: 'group',
    label: 'Group',
    description: 'Create a group/committee to organize members around a project.',
    icon: 'fa-light fa-people-group',
    createRoute: '/groups/create',
    group: 'organize',
  },
  {
    type: 'mailing-list',
    label: 'Mailing List',
    description: 'Set up a mailing list for project communications.',
    icon: 'fa-light fa-envelope',
    createRoute: '/mailing-lists/create',
    group: 'organize',
  },
];

/**
 * Artifact types (singular `CreatableArtifactType` form) that a committee writer — not just a
 * project writer — may create against, provided a `committee_uid` is carried into the flow. Must
 * stay in sync with `COMMITTEE_WRITE_FEATURES` below, which mirrors the same set in the plural
 * `data.writeFeature` route-config vocabulary already used by `meetings.routes.ts`,
 * `surveys.routes.ts`, and `votes.routes.ts`.
 */
export const COMMITTEE_WRITE_ARTIFACT_TYPES: CreatableArtifactType[] = ['meeting', 'survey', 'vote'];

/**
 * Same set as `COMMITTEE_WRITE_ARTIFACT_TYPES`, spelled in the plural `writeFeature` vocabulary
 * that route `data` blocks and `writerGuard` already use. Derived (every entry here is a regular
 * "+s" plural of its `COMMITTEE_WRITE_ARTIFACT_TYPES` counterpart) rather than hand-maintained, so
 * the guard and the create-picker backend can't drift apart on which types allow a committee target.
 */
export const COMMITTEE_WRITE_FEATURES: readonly string[] = COMMITTEE_WRITE_ARTIFACT_TYPES.map((type) => `${type}s`);
