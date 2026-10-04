// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import type { FilterPillOption } from './dashboard-metric.interface';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem } from './health-metrics-l2.interface';

/** Section key from the design's `T2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsTrainingSectionKey = (typeof HEALTH_METRICS_TRAINING_SECTIONS)[number]['key'];

/** Training's sub-nav badge, keyed to its own sections. */
export interface HealthMetricsTrainingSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsTrainingSectionKey;
}

/** `GET /api/analytics/training-presence` query. */
export interface HealthMetricsTrainingPresenceQuery {
  foundationSlug: string;
}

/** Whether the foundation runs a training programme through LF Education. */
export interface HealthMetricsTrainingPresence {
  hasProgramme: boolean;
}

/** What the Training tab renders: a skeleton while reading, the shell, the no-programme state, or an error. */
export type HealthMetricsTrainingPresenceState = 'loading' | 'present' | 'absent' | 'failed';

/** `GET /api/analytics/training-enrollment` query; one read carries every period, so a period change never re-reads. */
export interface HealthMetricsTrainingEnrollmentQuery {
  foundationSlug: string;
}

/** The KPI strip's figures for one period; `null` is not measured, never zero. */
export interface HealthMetricsTrainingEnrollmentTotals {
  enrollments: number | null;
  certifications: number | null;
  revenueUsd: number | null;
}

/** One delivery type's figures for the period, as LF Education names it (e.g. `E-Learning`). */
export interface HealthMetricsTrainingEnrollmentType {
  deliveryType: string;
  enrollments: number | null;
  revenueUsd: number | null;
}

/** Enrollments in one calendar year. */
export interface HealthMetricsTrainingEnrollmentYear {
  year: number;
  enrollments: number | null;
}

/**
 * One period of the section. `totals` is the `All` row; `baseline` is the comparison period's
 * `All` row, `null` when the period has no earlier one. `byType` comes in the period's rank order.
 */
export interface HealthMetricsTrainingEnrollmentPeriod {
  totals: HealthMetricsTrainingEnrollmentTotals;
  baseline: HealthMetricsTrainingEnrollmentTotals | null;
  byType: HealthMetricsTrainingEnrollmentType[];
}

/** The Enrollment & revenue section: every L2 period, plus the period-independent yearly trend. */
export interface HealthMetricsTrainingEnrollment {
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsTrainingEnrollmentPeriod>;
  trend: HealthMetricsTrainingEnrollmentYear[];
}

/** What the by-type bars rank by; the trend always shows enrollments. */
export type HealthMetricsTrainingEnrollmentMetric = 'enrollments' | 'revenue';

/** A toggle option for the by-type bars. */
export interface HealthMetricsTrainingEnrollmentMetricOption extends FilterPillOption {
  id: HealthMetricsTrainingEnrollmentMetric;
}

/** A KPI with its formatted value and its change against the baseline. */
export interface HealthMetricsTrainingEnrollmentStatView {
  key: 'enrollments' | 'certifications' | 'revenue';
  label: string;
  value: string;
  delta: string;
  deltaDirection: 'up' | 'down' | 'neutral';
}

/** One ranked bar under the toggle. */
export interface HealthMetricsTrainingEnrollmentTypeView {
  deliveryType: string;
  label: string;
  value: string;
  barWidthPct: number;
}

/** One column of the enrollment trend; the running year is partial. */
export interface HealthMetricsTrainingEnrollmentYearView {
  year: number;
  enrollments: number | null;
  isPartialYear: boolean;
  /** The year, marked when partial, and its count, for the chart's screen-reader table. */
  yearLabel: string;
  enrollmentsLabel: string;
}

/** Render-ready Enrollment & revenue section. */
export interface HealthMetricsTrainingEnrollmentView {
  baselineLabel: string;
  headline: HealthMetricsTrainingEnrollmentStatView;
  side: HealthMetricsTrainingEnrollmentStatView[];
  typeCountLabel: string;
  byType: HealthMetricsTrainingEnrollmentTypeView[];
  trend: HealthMetricsTrainingEnrollmentYearView[];
}

/** The delivery-type cut over the courses table. */
export type HealthMetricsTrainingCoursesType = 'all' | 'certifications' | 'elearning';

/** A type pill whose id is the cut it applies. */
export interface HealthMetricsTrainingCoursesTypeOption extends FilterPillOption {
  id: HealthMetricsTrainingCoursesType;
}

/** Query params the Courses section reads on arrival and writes back; `null` clears one the URL carries. */
export interface HealthMetricsTrainingQueryParams {
  trnType?: HealthMetricsTrainingCoursesType | null;
  trnSearch?: string | null;
  trnPage?: number | null;
}

/** One page of the courses with enrollments in a period, cut by delivery type and a name search. */
export interface HealthMetricsTrainingCoursesQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  type: HealthMetricsTrainingCoursesType;
  /** Matched anywhere in the course name; empty matches every course. */
  search: string;
  offset: number;
  pageSize: number;
}

/** One course's figures for the period. `isFree` is `null` where LF Education does not say (edX). */
export interface HealthMetricsTrainingCourse {
  courseKey: string;
  courseName: string;
  deliveryType: string;
  isFree: boolean | null;
  /** Whether purchases are captured for the course, so its revenue can be read as measured. */
  hasPurchaseCoverage: boolean;
  enrollments: number | null;
  revenueUsd: number | null;
}

/** `GET /api/analytics/training-courses` — one page, ranked by enrollments. */
export interface HealthMetricsTrainingCourses {
  rows: HealthMetricsTrainingCourse[];
  /** Courses matching the type and search. */
  totalRecords: number;
  /** Every course with enrollments in the period; `null` when the read was not measured. */
  scopeTotal: number | null;
}

/** A courses row with every label ready to render. */
export interface HealthMetricsTrainingCourseRowView {
  courseKey: string;
  courseName: string;
  typeLabel: string;
  typeClass: string;
  enrollmentsLabel: string;
  /** `free` for a free course, `not available` where revenue is not captured; never a `$0` that reads as none sold. */
  revenueLabel: string;
  /** Whether `revenueLabel` is a figure rather than a note, which renders muted. */
  revenueMeasured: boolean;
}
