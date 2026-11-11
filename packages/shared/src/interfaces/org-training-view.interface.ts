// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from './org-lens-time-range.interface';
import type { OrgDropdownOption } from './org-memberships.interface';
import type { OrgTrainingGroupEmployee, OrgTrainingTabId } from './training.interface';

/** What the Training page's table groups the filtered person-course pairs by. */
export type OrgTrainingGroupBy = 'course' | 'foundation' | 'project' | 'level' | 'format';

/** The five course-level filters shared by Training & Certification and People › Trainees; null = no filter. */
export interface OrgTrainingFilters {
  /** Foundation id */
  foundation: string | null;
  /** Project id */
  project: string | null;
  /** Course name (covers every version of a course) */
  course: string | null;
  level: string | null;
  format: string | null;
}

/** Everything the shared filter bar writes to the URL. `groupBy` is ignored on People › Trainees. */
export interface OrgTrainingViewState extends OrgTrainingFilters {
  range: OrgLensTimeRange;
  groupBy: OrgTrainingGroupBy;
}

/** Query of the one stats call: range plus the five filters. */
export type OrgTrainingStatsQuery = Pick<OrgTrainingViewState, 'range'> & OrgTrainingFilters;

/**
 * Learner and enrollment numbers for one range and filter set, over person-course pairs of the org's people list.
 * Courses taken = certifications + trainingsCompleted + coursesInProgress. `asOf` is an ISO-8601 UTC timestamp
 * (MAX(DBT_RUN_AT) of ORG_PEOPLE_TRAINING), null when the org has no rows. Definitions: lfx-self-serve#4286.
 */
export interface OrgTrainingStats {
  range: OrgLensTimeRange;
  asOf: string | null;
  /** Live roster (ORG_TRAINING_ROSTER_MEMBERS), not filtered by range or filters; null when the org has no training program. */
  rosterMembers: number | null;
  rosterMembersAsOf: string | null;
  /** Distinct people-list people in the filtered pairs; learners outside the people list are not included. */
  peopleWithTrainingActivity: number;
  /** Distinct learners outside the people list in range (their own tile, never added to the people-list numbers); null (not counted) while a course-level filter is set. */
  learnersOutsidePeopleList: number | null;
  coursesTaken: number;
  /** Certified pairs of `Certification` products. */
  certifications: number;
  certifiedPeople: number;
  /** Certified pairs of `Training` products. */
  trainingsCompleted: number;
  /** (certifications + trainingsCompleted) / coursesTaken, rounded; 0 with no courses. */
  completionRatePct: number;
  /** Enrolled in range with no certificate in range. */
  coursesInProgress: number;
  peopleInTraining: number;
}

/** Options of the shared filter bar's five dropdowns for one range (people-list pairs in range). */
export interface OrgTrainingFilterOptions {
  foundations: OrgDropdownOption[];
  projects: OrgDropdownOption[];
  courses: OrgDropdownOption[];
  levels: OrgDropdownOption[];
  formats: OrgDropdownOption[];
}

/** One row of the Training page's group-by table. */
export interface OrgTrainingGroupRow {
  key: string;
  label: string;
  people: number;
  coursesTaken: number;
  completed: number;
  inProgress: number;
  level: string | null;
  foundation: string | null;
  logoUrl: string | null;
}

/** A group-by table row with its display strings resolved once (no template functions): meta line and count-button labels. */
export interface OrgTrainingGroupRowVm extends OrgTrainingGroupRow {
  /** Foundation (and level, for courses) under the label; empty when the grouping has no such attributes. */
  meta: string;
  /** Accessible name of the completed (Certified / Completed) count button: value, status and row. */
  completedAriaLabel: string;
  /** Accessible name of the in-progress count button: value, status and row. */
  inProgressAriaLabel: string;
}

/** Group-by table page for one tab; `totals` are over the whole group set (not the page) and equal the stat tiles. */
export interface OrgTrainingGroupsResponse {
  data: OrgTrainingGroupRow[];
  total: number;
  totals: { people: number; coursesTaken: number; completed: number; inProgress: number };
}

/** Drill-down status of a group row: completed = certified pairs, in-progress = enrolled pairs. */
export type OrgTrainingGroupStatus = 'completed' | 'in-progress';

/** Sortable columns of the group-by table. */
export type OrgTrainingGroupSortField = 'label' | 'people' | 'coursesTaken' | 'completed' | 'inProgress';

/** Query params of the group-by table call (on top of range + filters). `tab` splits the pairs by product type. */
export interface OrgTrainingGroupsParams {
  groupBy: OrgTrainingGroupBy;
  tab: OrgTrainingTabId;
  searchQuery?: string;
  sortField?: OrgTrainingGroupSortField;
  sortOrder?: 'ASC' | 'DESC';
  pageSize?: number;
  offset?: number;
}

/** Query params of the group drill-down drawer call (on top of range + filters). `groupValue` is the row's `key`. */
export interface OrgTrainingGroupEmployeesParams {
  groupBy: OrgTrainingGroupBy;
  groupValue: string;
  tab: OrgTrainingTabId;
  status: OrgTrainingGroupStatus;
}

/** Drill-down of one group row: `total` is the pair count (equals the cell clicked); `data` lists current employees only. */
export interface OrgTrainingGroupEmployeesResponse {
  groupBy: OrgTrainingGroupBy;
  groupValue: string;
  label: string;
  tab: OrgTrainingTabId;
  status: OrgTrainingGroupStatus;
  total: number;
  data: OrgTrainingGroupEmployee[];
}

/** Stats shown on the shared strip, in order. */
export type OrgTrainingStatKey =
  | 'rosterMembers'
  | 'peopleWithTrainingActivity'
  | 'learnersOutsidePeopleList'
  | 'coursesTaken'
  | 'certifications'
  | 'certifiedPeople'
  | 'trainingsCompleted'
  | 'completionRate'
  | 'coursesInProgress'
  | 'peopleInTraining';

/** What a stat counts: label, unit, window (absent = the selected range) and the definition its tooltip states. */
export interface OrgTrainingStatDefinition {
  readonly label: string;
  readonly unit: string;
  /** Fixed window, e.g. `live, not filtered`; absent when the selected range is the window. */
  readonly window?: string;
  readonly definition: string;
  /** Short line under the number that replaces the unit/window caption's window part (e.g. the in-progress rule). */
  readonly caption?: string;
}

/** Layout of one stat tile. */
export interface OrgTrainingStatTileLayout {
  readonly key: OrgTrainingStatKey;
  readonly icon: string;
  readonly iconClass: string;
  readonly testId: string;
}

/** Client-only view of one stat tile (not on the wire). */
export interface OrgTrainingStatTileVm extends OrgTrainingStatTileLayout {
  readonly label: string;
  /** null when there is nothing to show: not loaded, or no training program for the roster. */
  readonly value: number | null;
  /** Rendered number (`36%` for the rate, localized count, em dash when null). */
  readonly display: string;
  readonly caption: string;
  readonly tooltip: string;
  readonly ariaLabel: string;
}
