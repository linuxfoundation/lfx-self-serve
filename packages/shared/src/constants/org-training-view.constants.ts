// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingFilterOptions, OrgTrainingGroupBy, OrgTrainingGroupsResponse } from '../interfaces/org-training-view.interface';

/**
 * Query parameters of the shared Training / Trainees view; `range` is ORG_LENS_TIME_RANGE_QUERY_PARAM. The project
 * filter is `trainingProject`: a bare `project` is the app-wide project context (ProjectContextService), which
 * would select a project lens. The other names collide with no app-wide parameter.
 */
export const ORG_TRAINING_VIEW_QUERY_PARAMS = {
  foundation: 'foundation',
  project: 'trainingProject',
  course: 'course',
  level: 'level',
  format: 'format',
  groupBy: 'groupBy',
} as const;

export const ORG_TRAINING_DEFAULT_GROUP_BY: OrgTrainingGroupBy = 'course';

/** Group-by dropdown options of the Training page. */
export const ORG_TRAINING_GROUP_BY_OPTIONS: readonly { label: string; value: OrgTrainingGroupBy }[] = [
  { label: 'Course', value: 'course' },
  { label: 'Foundation', value: 'foundation' },
  { label: 'Project', value: 'project' },
  { label: 'Level', value: 'level' },
  { label: 'Format', value: 'format' },
] as const;

export const VALID_ORG_TRAINING_GROUP_BY_VALUES: ReadonlySet<string> = new Set(ORG_TRAINING_GROUP_BY_OPTIONS.map((option) => option.value));

/** Longest filter value accepted from a URL or request. */
export const MAX_ORG_TRAINING_FILTER_VALUE_LENGTH = 200;

/** Group value shown for a pair without the grouped attribute. */
export const ORG_TRAINING_GROUP_NONE_LABELS: Readonly<Record<OrgTrainingGroupBy, string>> = {
  course: 'No course name',
  foundation: 'No foundation',
  project: 'No project',
  level: 'No level',
  format: 'No format',
};

/** The five course-level filters, in display order. */
export const ORG_TRAINING_FILTER_KEYS = ['foundation', 'project', 'course', 'level', 'format'] as const;

export const EMPTY_ORG_TRAINING_FILTER_OPTIONS: OrgTrainingFilterOptions = { foundations: [], projects: [], courses: [], levels: [], formats: [] };

export const EMPTY_ORG_TRAINING_GROUPS_RESPONSE: OrgTrainingGroupsResponse = {
  data: [],
  total: 0,
  totals: { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 },
};
