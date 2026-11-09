// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_TIME_RANGE_QUERY_PARAM } from '../constants/org-lens-time-range.constants';
import {
  MAX_ORG_TRAINING_FILTER_VALUE_LENGTH,
  ORG_TRAINING_FILTER_KEYS,
  ORG_TRAINING_DEFAULT_GROUP_BY,
  ORG_TRAINING_VIEW_QUERY_PARAMS,
  VALID_ORG_TRAINING_GROUP_BY_VALUES,
} from '../constants/org-training-view.constants';
import type { OrgTrainingFilters, OrgTrainingGroupBy, OrgTrainingStatsQuery, OrgTrainingViewState } from '../interfaces/org-training-view.interface';
import { orgLensTimeRangeUrlParam, parseOrgLensTimeRange } from './org-lens-time-range.utils';

/**
 * Strips leading and trailing U+0020 only (what Snowflake `TRIM` strips by default; a tab or other whitespace stays).
 * An index scan, not a regular expression: a `/^ +| +$/` trim backtracks quadratically on long runs of spaces.
 */
export function trimOrgTrainingSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start++;
  while (end > start && value.charCodeAt(end - 1) === 32) end--;
  return value.slice(start, end);
}

/**
 * A course name, level or format (or an option value) as the pairs SQL reads it, `NULLIF(TRIM(LEFT(TRIM(col), 200)), '')`:
 * spaces trimmed, cut to {@link MAX_ORG_TRAINING_FILTER_VALUE_LENGTH}, trimmed again (so the rule is idempotent), null when blank. The one rule the BFF, the
 * dropdown options and the Trainees client share, so an option the dropdown offers is the string the pairs carry.
 */
export function normalizeOrgTrainingFilterValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  // Trim again after the cut: a space at the cut point would otherwise end the value, and normalizing the result again would shorten it.
  const normalized = trimOrgTrainingSpaces(trimOrgTrainingSpaces(value).slice(0, MAX_ORG_TRAINING_FILTER_VALUE_LENGTH));
  return normalized === '' ? null : normalized;
}

/** URL query (read through `get`) → view state: absent/empty = no filter, unknown range = default, unknown groupBy = course. */
export function parseOrgTrainingViewState(get: (param: string) => string | null | undefined): OrgTrainingViewState {
  const groupBy = get(ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy);
  return {
    range: parseOrgLensTimeRange(get(ORG_LENS_TIME_RANGE_QUERY_PARAM)),
    foundation: normalizeOrgTrainingFilterValue(get(ORG_TRAINING_VIEW_QUERY_PARAMS.foundation)),
    project: normalizeOrgTrainingFilterValue(get(ORG_TRAINING_VIEW_QUERY_PARAMS.project)),
    course: normalizeOrgTrainingFilterValue(get(ORG_TRAINING_VIEW_QUERY_PARAMS.course)),
    level: normalizeOrgTrainingFilterValue(get(ORG_TRAINING_VIEW_QUERY_PARAMS.level)),
    format: normalizeOrgTrainingFilterValue(get(ORG_TRAINING_VIEW_QUERY_PARAMS.format)),
    groupBy: typeof groupBy === 'string' && VALID_ORG_TRAINING_GROUP_BY_VALUES.has(groupBy) ? (groupBy as OrgTrainingGroupBy) : ORG_TRAINING_DEFAULT_GROUP_BY,
  };
}

/** View state → router query params; `null` (dropped from the URL) for every default. */
export function serializeOrgTrainingViewState(state: OrgTrainingViewState): Record<string, string | null> {
  return {
    [ORG_LENS_TIME_RANGE_QUERY_PARAM]: orgLensTimeRangeUrlParam(state.range),
    [ORG_TRAINING_VIEW_QUERY_PARAMS.foundation]: state.foundation,
    [ORG_TRAINING_VIEW_QUERY_PARAMS.project]: state.project,
    [ORG_TRAINING_VIEW_QUERY_PARAMS.course]: state.course,
    [ORG_TRAINING_VIEW_QUERY_PARAMS.level]: state.level,
    [ORG_TRAINING_VIEW_QUERY_PARAMS.format]: state.format,
    [ORG_TRAINING_VIEW_QUERY_PARAMS.groupBy]: state.groupBy === ORG_TRAINING_DEFAULT_GROUP_BY ? null : state.groupBy,
  };
}

/** The stats query (range + filters) of a view state. */
export function orgTrainingStatsQuery(state: OrgTrainingStatsQuery): OrgTrainingStatsQuery {
  return { range: state.range, foundation: state.foundation, project: state.project, course: state.course, level: state.level, format: state.format };
}

/** Key-safe cache/sub-resource signature of range + filters (base64url JSON, only `[A-Za-z0-9_-]`). */
export function orgTrainingFiltersSignature(query: OrgTrainingStatsQuery): string {
  const json = JSON.stringify([query.range, ...ORG_TRAINING_FILTER_KEYS.map((key) => query[key])]);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  let end = base64.length;
  while (end > 0 && base64.charCodeAt(end - 1) === 61) end--;
  return base64.slice(0, end);
}

/** Whether any filter narrows the pairs. */
export function hasOrgTrainingFilter(filters: OrgTrainingFilters): boolean {
  return ORG_TRAINING_FILTER_KEYS.some((key) => filters[key] !== null);
}

/** Completion rate: (certifications + trainings completed) / courses taken, rounded; 0 with no courses. */
export function orgTrainingCompletionRatePct(counts: { coursesTaken: number; certifications: number; trainingsCompleted: number }): number {
  return counts.coursesTaken > 0 ? Math.round(((counts.certifications + counts.trainingsCompleted) / counts.coursesTaken) * 100) : 0;
}

/** Client-side match of a row's pair attributes against the filters (Trainees table rows). */
export function matchesOrgTrainingFilters(
  row: { foundationId: string | null; projectId: string | null; courseName: string | null; courseLevel: string | null; courseFormat: string | null },
  filters: OrgTrainingFilters
): boolean {
  return (
    (filters.foundation === null || row.foundationId === filters.foundation) &&
    (filters.project === null || row.projectId === filters.project) &&
    (filters.course === null || row.courseName === filters.course) &&
    (filters.level === null || row.courseLevel === filters.level) &&
    (filters.format === null || row.courseFormat === filters.format)
  );
}
