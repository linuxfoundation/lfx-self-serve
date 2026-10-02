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
