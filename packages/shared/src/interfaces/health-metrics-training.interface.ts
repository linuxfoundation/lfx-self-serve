// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import type { HealthMetricsColumnChartView } from './health-metrics-column-chart.interface';
import type { HealthMetricsL2Range, HealthMetricsL2SubNavItem, HealthMetricsMetricItem } from './health-metrics-l2.interface';
import type { HealthMetricsTableSort } from './health-metrics-table.interface';

/** Section key from the design's `T2VIEWS`; doubles as the URL fragment and the scroll-spy allowlist. */
export type HealthMetricsTrainingSectionKey = (typeof HEALTH_METRICS_TRAINING_SECTIONS)[number]['key'];

/** Training's sub-nav entry, keyed to its own sections. */
export interface HealthMetricsTrainingSubNavItem extends HealthMetricsL2SubNavItem {
  key: HealthMetricsTrainingSectionKey;
}

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
  /** PCC's listed types (`is_listed_delivery_type`); MicroCourse and Bundle count in the totals but are not listed. */
  isListed: boolean;
  /** Listed on the revenue view (`is_listed_revenue_delivery_type`), which adds Bundle. */
  isListedRevenue: boolean;
  enrollments: number | null;
  revenueUsd: number | null;
}

/** Enrollments in one calendar year, in total and for the three named delivery types; `null` is not measured. */
export interface HealthMetricsTrainingEnrollmentYear {
  year: number;
  enrollments: number | null;
  certificationExams: number | null;
  microcourses: number | null;
  instructorLed: number | null;
}

/** The model's change against the same point last year, as fractions (`0.12` is +12%); `null` when it has none. */
export interface HealthMetricsTrainingEnrollmentChange {
  enrollments: number | null;
  certifications: number | null;
  revenueUsd: number | null;
}

/**
 * One period of the section. `totals` is the `All` row; `change` is the model's change for it, `null` for a
 * period the model does not compare. `byType` comes in the period's rank order.
 */
export interface HealthMetricsTrainingEnrollmentPeriod {
  totals: HealthMetricsTrainingEnrollmentTotals;
  change: HealthMetricsTrainingEnrollmentChange | null;
  byType: HealthMetricsTrainingEnrollmentType[];
}

/** One year's goals and the view's progress against them (0–1, capped at 1). `null` is no goal set. */
export interface HealthMetricsTrainingEnrollmentGoals {
  enrollments: number | null;
  revenueUsd: number | null;
  enrollmentsProgress: number | null;
  revenueProgress: number | null;
}

/** The Enrollment & revenue section: every L2 period, plus the period-independent yearly trend. */
export interface HealthMetricsTrainingEnrollment {
  measured: boolean;
  periods: Record<HealthMetricsL2Range, HealthMetricsTrainingEnrollmentPeriod>;
  trend: HealthMetricsTrainingEnrollmentYear[];
  /** Each period's goals; a past year is no goal set until the goals sheet carries that year. */
  goals: Record<HealthMetricsL2Range, HealthMetricsTrainingEnrollmentGoals>;
}

/** What the header switch shows: the metrics row's lead figure and the chart's measure. */
export type HealthMetricsTrainingEnrollmentMetric = 'enrollments' | 'revenue';

/** One choice on the Enrollments / Revenue header switch. */
export interface HealthMetricsTrainingEnrollmentMetricOption {
  id: HealthMetricsTrainingEnrollmentMetric;
  label: string;
}

/** The chart's stacked segments, bottom up. */
export type HealthMetricsTrainingEnrollmentSegmentKey = 'certification' | 'microcourse' | 'instructorLed' | 'other';

/** One stacked segment: its label, its palette colour and the LF Education delivery type it counts (`null` for Other). */
export interface HealthMetricsTrainingEnrollmentSegment {
  key: HealthMetricsTrainingEnrollmentSegmentKey;
  label: string;
  color: string;
  deliveryType: string | null;
}

/** The chart's screen-reader table: a row per year, a column per type shown and the total. */
export interface HealthMetricsTrainingEnrollmentTableView {
  headers: string[];
  rows: { key: string; cells: string[] }[];
}

/** Render-ready Enrollment & revenue section. */
export interface HealthMetricsTrainingEnrollmentView {
  /** The selected measure first, then the other two; an unset figure reads "—". */
  metrics: HealthMetricsMetricItem[];
  subHeading: string;
  chart: HealthMetricsColumnChartView;
  table: HealthMetricsTrainingEnrollmentTableView;
}

/** The delivery-type cut in the Courses card header. */
export type HealthMetricsTrainingCoursesType = 'all' | 'certification' | 'elearning' | 'instructor-led';

/** One choice in the Course type select. */
export interface HealthMetricsTrainingCoursesTypeOption {
  id: HealthMetricsTrainingCoursesType;
  label: string;
}

/** The Courses table's sortable columns. */
export type HealthMetricsTrainingCoursesSortKey = 'course' | 'type' | 'enrollments' | 'revenue';

/** Query params the Courses section reads on arrival and writes back; `null` clears one the URL carries. */
export interface HealthMetricsTrainingQueryParams {
  trnType?: HealthMetricsTrainingCoursesType | null;
  trnSearch?: string | null;
  trnPage?: number | null;
}

/** One page of every course ever enrolled in, ranked by the period, cut by delivery type and a name search. */
export interface HealthMetricsTrainingCoursesQuery {
  foundationSlug: string;
  range: HealthMetricsL2Range;
  type: HealthMetricsTrainingCoursesType;
  /** Matched anywhere in the course name; empty matches every course. */
  search: string;
  offset: number;
  pageSize: number;
  /** A column the reader picked, over every page; `null` keeps the view's rank. */
  sort: HealthMetricsTableSort<HealthMetricsTrainingCoursesSortKey> | null;
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

/** `GET /api/analytics/training-courses` — one page, in the view's rank or a picked column's order. */
export interface HealthMetricsTrainingCourses {
  rows: HealthMetricsTrainingCourse[];
  /** Courses matching the type and search. */
  totalRecords: number;
  /** Every course ever enrolled in (`scope_courses_count`); `null` when the read was not measured. */
  scopeTotal: number | null;
  /** Courses with enrollments or revenue in the period, over every type and search, so no sort or filter moves it. */
  activeTotal: number | null;
}

/** A courses row with every label ready to render. */
export interface HealthMetricsTrainingCourseRowView {
  courseKey: string;
  courseName: string;
  typeLabel: string;
  /** The type badge's fill and ink. */
  typeClass: string;
  /** The type badge's 12px Font Awesome icon. */
  typeIcon: string;
  enrollmentsLabel: string;
  /** Compact currency, negative after refunds; "Free" for a free course; "—" where revenue is not captured. */
  revenueLabel: string;
  /** "Free" reads in neutral-500; a figure and "—" take the cell's own ink and dash. */
  revenueFree: boolean;
}
