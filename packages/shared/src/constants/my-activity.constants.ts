// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MyActivityTab } from '../interfaces/my-activity.interface';
import { COMMITTEE_LABEL } from './committees.constants';

/**
 * Configurable labels for My Activity displayed throughout the UI
 * @description This constant allows the user-facing labels to be changed
 * while keeping all code and file names consistent
 * @readonly
 */
export const MY_ACTIVITY_LABEL = {
  singular: 'My Activity',
  plural: 'My Activities',
  description: 'View your votes and surveys participation',
};

/**
 * Tab options for My Activity module
 * @description Available tabs in the My Activity dashboard
 * @readonly
 */
export const MY_ACTIVITY_TAB_OPTIONS: { label: string; value: MyActivityTab }[] = [
  { label: 'Votes', value: 'votes' },
  { label: 'Surveys', value: 'surveys' },
];

/**
 * Filter labels for My Activity tables
 * @description Default labels for filter dropdowns in activity tables
 * @readonly
 */
export const MY_ACTIVITY_FILTER_LABELS = {
  allCommittees: `All ${COMMITTEE_LABEL.plural}`,
  allStatus: 'All Status',
};
