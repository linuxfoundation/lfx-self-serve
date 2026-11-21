// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import {
  HEALTH_METRICS_TRAINING_COURSE_FREE_LABEL,
  HEALTH_METRICS_TRAINING_COURSE_TYPE_LABELS,
  HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES,
  HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES,
  HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_BAR_WIDTH_PX,
  HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_HEIGHT_PX,
  HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS,
  HEALTH_METRICS_TRAINING_NOT_AVAILABLE,
  HEALTH_METRICS_TRAINING_SECTIONS,
  HEALTH_METRICS_TRAINING_REVENUE_UNCAPTURED_TYPES,
  HEALTH_METRICS_TRAINING_TREND_YEARS,
} from '../constants/health-metrics-training.constants';
import { buildHealthMetricsColumnChart, formatHealthMetricsChartCompact } from './health-metrics-column-chart.utils';
import { formatHealthMetricsPercent } from './health-metrics-table.utils';
import { formatCurrency } from './number.utils';

import type { HealthMetricsColumnChartInputColumn, HealthMetricsColumnChartSeries } from '../interfaces/health-metrics-column-chart.interface';
import type { HealthMetricsChartTipRowView, HealthMetricsL2Range, HealthMetricsMetricItem } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsTrainingCourse,
  HealthMetricsTrainingCourseRowView,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentPeriod,
  HealthMetricsTrainingEnrollmentType,
  HealthMetricsTrainingEnrollmentView,
  HealthMetricsTrainingEnrollmentYear,
  HealthMetricsTrainingSubNavItem,
} from '../interfaces/health-metrics-training.interface';

/** Sub-nav items for the Training tab; no section here carries a note. */
export function buildHealthMetricsTrainingSubNavItems(): HealthMetricsTrainingSubNavItem[] {
  return HEALTH_METRICS_TRAINING_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: '' }));
}

/** A rounded, `en-US`-pinned count, so the server render and the hydrated one agree; `not available` for unmeasured. */
export function formatHealthMetricsTrainingCount(value: number | null): string {
  return value === null ? HEALTH_METRICS_TRAINING_NOT_AVAILABLE : Math.round(value).toLocaleString('en-US');
}

/** The design's name for an LF Education delivery type. */
export function getHealthMetricsTrainingDeliveryTypeLabel(deliveryType: string): string {
  return HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS[deliveryType] ?? deliveryType;
}

/** A courses row ready to render; revenue reads as a figure only for a paid course whose purchases are captured. */
export function buildHealthMetricsTrainingCourseRowView(course: HealthMetricsTrainingCourse): HealthMetricsTrainingCourseRowView {
  const isCertification = course.deliveryType === HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES.certifications;
  const revenueMeasured = course.isFree === false && course.hasPurchaseCoverage && course.revenueUsd !== null;

  return {
    courseKey: course.courseKey,
    courseName: course.courseName,
    typeLabel: HEALTH_METRICS_TRAINING_COURSE_TYPE_LABELS[course.deliveryType] ?? course.deliveryType,
    typeClass: isCertification ? HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES.certification : HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES.other,
    enrollmentsLabel: formatHealthMetricsTrainingCount(course.enrollments),
    revenueLabel: formatCourseRevenue(course, revenueMeasured),
    revenueMeasured,
  };
}

/** The count line over the courses table, e.g. `176 courses`; `—` while unmeasured. */
export function formatHealthMetricsTrainingCoursesCountLabel(total: number | null): string {
  if (total === null) return '—';

  return `${formatHealthMetricsTrainingCount(total)} ${total === 1 ? 'course' : 'courses'}`;
}

/**
 * Render-ready Enrollment & revenue: the period's three figures with the selected measure first, and the selected measure
 * by delivery type over the current year and the five before it. Revenue by type only reaches back four years.
 */
export function buildHealthMetricsTrainingEnrollmentView(
  enrollment: HealthMetricsTrainingEnrollment,
  range: HealthMetricsL2Range,
  metric: HealthMetricsTrainingEnrollmentMetric
): HealthMetricsTrainingEnrollmentView {
  const currentYear = getYearForRange('YTD');
  const years = Array.from({ length: HEALTH_METRICS_TRAINING_TREND_YEARS }, (_, index) => currentYear - HEALTH_METRICS_TRAINING_TREND_YEARS + 1 + index);
  const columns = years.map((year) => {
    const label = year === currentYear ? `${year} YTD` : String(year);
    return metric === 'revenue'
      ? revenueColumn(enrollment, year, label)
      : enrollmentColumn(
          enrollment.trend.find((row) => row.year === year),
          label
        );
  });

  // Other drops out of the chart and its legend when it is zero in every year shown.
  const otherIndex = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.findIndex((segment) => segment.key === 'other');
  const keep = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map(
    (_, index) => index !== otherIndex || columns.some((column) => (column.values?.[index] ?? 0) > 0)
  );
  const series: HealthMetricsColumnChartSeries[] = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.filter((_, index) => keep[index]).map(
    ({ key, label, color }) => ({
      key,
      label,
      color,
    })
  );
  const keepRow = (row: HealthMetricsChartTipRowView) => series.some((entry) => entry.label === row.label);
  const isRevenue = metric === 'revenue';
  // The design's totals read "{N}" for enrollments and "${N}K" for revenue; the axis stays compact either way.
  const formatTotal = isRevenue ? formatTrainingChartUsd : formatHealthMetricsTrainingCount;
  const formatTick = isRevenue ? formatTrainingChartUsd : formatHealthMetricsChartCompact;

  const chartColumns: (HealthMetricsColumnChartInputColumn & { tableTotal: number | null })[] = columns.map((column, columnIndex) => ({
    key: String(years[columnIndex]),
    label: column.label,
    sub: '',
    values: column.values ? column.values.filter((_, index) => keep[index]) : null,
    total: column.total,
    muted: years[columnIndex] !== currentYear,
    tipTitle: column.tipTitle,
    tipRows: column.tipRows.filter(keepRow),
    tableTotal: column.tableTotal,
  }));
  const subHeading = isRevenue ? 'Revenue by type over the years' : 'Enrollments by type over the years';

  return {
    metrics: buildTrainingMetrics(enrollment.periods[range], metric),
    subHeading,
    chart: buildHealthMetricsColumnChart({
      series,
      columns: chartColumns,
      peak: Math.max(0, ...columns.map((column) => Math.max(column.total ?? 0, stackHeight(column.values)))),
      heightPx: HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_HEIGHT_PX,
      barWidthPx: HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_BAR_WIDTH_PX,
      formatTotal,
      formatValue: formatTotal,
      formatTick,
      ariaLabel: `${subHeading}, ${years[0]} to ${currentYear}`,
    }),
    table: {
      headers: ['Year', ...series.map((entry) => entry.label), 'Total'],
      rows: chartColumns.map((column) => ({
        key: column.key,
        cells: [
          column.label,
          ...series.map((_, index) =>
            column.values?.[index] === null || column.values?.[index] === undefined ? '—' : formatTrainingValue(column.values[index], isRevenue)
          ),
          column.tableTotal === null ? '—' : formatTrainingValue(column.tableTotal, isRevenue),
        ],
      })),
    },
  };
}

/** Negative net revenue (refunds) shows as it is; free is reach, and an uncaptured course is not available. */
function formatCourseRevenue(course: HealthMetricsTrainingCourse, measured: boolean): string {
  if (course.isFree === true) return HEALTH_METRICS_TRAINING_COURSE_FREE_LABEL;

  return measured ? formatCurrency(course.revenueUsd ?? 0) : HEALTH_METRICS_TRAINING_NOT_AVAILABLE;
}

interface TrainingColumn {
  label: string;
  /** One per segment, bottom up; `null` for a year with no data for the measure. */
  values: (number | null)[] | null;
  /** The label over the stack; `null` hides it for a year with no activity. */
  total: number | null;
  /** The total the screen-reader table reads: 0 for a quiet year, `null` only where the measure is not available. */
  tableTotal: number | null;
  tipTitle: string;
  tipRows: HealthMetricsChartTipRowView[];
}

/** The period's Enrollments, Certifications earned and Revenue, the selected measure first; an unset figure reads "—". */
function buildTrainingMetrics(period: HealthMetricsTrainingEnrollmentPeriod, metric: HealthMetricsTrainingEnrollmentMetric): HealthMetricsMetricItem[] {
  const { enrollments, certifications, revenueUsd } = period.totals;
  const items: Record<'enrollments' | 'certifications' | 'revenue', HealthMetricsMetricItem> = {
    enrollments: { key: 'enrollments', label: 'Enrollments', value: enrollments === null ? '—' : formatHealthMetricsTrainingCount(enrollments) },
    certifications: {
      key: 'certifications',
      label: 'Certifications earned',
      value: certifications === null ? '—' : formatHealthMetricsTrainingCount(certifications),
    },
    revenue: { key: 'revenue', label: 'Revenue', value: revenueUsd === null ? '—' : formatTrainingChartUsd(revenueUsd) },
  };
  return metric === 'revenue' ? [items.revenue, items.enrollments, items.certifications] : [items.enrollments, items.certifications, items.revenue];
}

/**
 * A year's enrollments by type: Other is the total less the three named types, so a new type still counts. No row is a quiet
 * year at zero; a NULL total is not measured, and a NULL named count stays unknown rather than folding into Other.
 */
function enrollmentColumn(row: HealthMetricsTrainingEnrollmentYear | undefined, label: string): TrainingColumn {
  if (row && row.enrollments === null) {
    return { label, values: null, total: null, tableTotal: null, tipTitle: `${label} · enrollments not available`, tipRows: [] };
  }

  const total = row?.enrollments ?? 0;
  const named = row ? [row.certificationExams, row.microcourses, row.instructorLed] : [0, 0, 0];
  const other = named.some((value) => value === null) ? null : Math.max(0, total - named.reduce((sum: number, value) => sum + (value ?? 0), 0));
  const values = [...named, other];
  const share = (value: number) => (total > 0 ? ` · ${formatHealthMetricsPercent((value / total) * 100)}` : '');

  return {
    label,
    values,
    // A year with no activity keeps its column at zero, with no total over it; the table still reads its 0.
    total: total > 0 ? total : null,
    tableTotal: total,
    tipTitle: `${label} · ${formatHealthMetricsTrainingCount(total)} ${total === 1 ? 'enrollment' : 'enrollments'}`,
    tipRows: HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map((segment, index) => {
      const value = values[index];
      return {
        label: segment.label,
        value: value === null ? '—' : `${formatHealthMetricsTrainingCount(value)}${share(value)}`,
        color: segment.color,
        separated: false,
      };
    }),
  };
}

/**
 * A year's revenue by type, from the period that covers it. Other sums every other type except edX, whose revenue is never
 * captured; a type with no captured revenue has no row, and one at zero reads "Free". Years before the four periods have none.
 */
function revenueColumn(enrollment: HealthMetricsTrainingEnrollment, year: number, label: string): TrainingColumn {
  const range = HEALTH_METRICS_L2_RANGES.find((candidate) => getYearForRange(candidate) === year);
  const period = range ? enrollment.periods[range] : null;
  const covered = (period?.byType ?? []).filter((type) => !HEALTH_METRICS_TRAINING_REVENUE_UNCAPTURED_TYPES.includes(type.deliveryType));
  if (!period || !enrollment.measured || covered.every((type) => type.revenueUsd === null)) {
    return { label, values: null, total: null, tableTotal: null, tipTitle: `Revenue not available for ${year}`, tipRows: [] };
  }
  // Every type has a row in every period; only one active in the year counts, so a quiet type never reads "Free".
  const types = covered.filter((type) => (type.enrollments ?? 0) > 0 || (type.revenueUsd ?? 0) !== 0);

  const named = new Set(HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map((segment) => segment.deliveryType).filter(Boolean));
  const values = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map((segment) =>
    sumRevenue(types.filter((type) => (segment.deliveryType === null ? !named.has(type.deliveryType) : type.deliveryType === segment.deliveryType)))
  );
  const total = period.totals.revenueUsd;
  // A year with no activity keeps its column at zero, with no total over it, as Enrollments does.
  const active = (period.totals.enrollments ?? 0) > 0 || (total ?? 0) !== 0;

  return {
    label,
    values,
    total: active ? total : null,
    tableTotal: total,
    tipTitle: `${label} · ${total === null ? '—' : formatTrainingChartUsd(total)} revenue`,
    tipRows: HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.flatMap((segment, index) => {
      const value = values[index];
      if (value === null) return [];
      return [{ label: segment.label, value: value === 0 ? 'Free' : formatTrainingChartUsd(value), color: segment.color, separated: false }];
    }),
  };
}

/** The captured revenue of a set of types; `null` when none of them has any captured, which no row or bar shows. */
function sumRevenue(types: HealthMetricsTrainingEnrollmentType[]): number | null {
  const captured = types.map((type) => type.revenueUsd).filter((value): value is number => value !== null);
  return captured.length ? captured.reduce((sum, value) => sum + value, 0) : null;
}

/** A column's stacked height: its positive values summed, as the chart stacks them. */
function stackHeight(values: (number | null)[] | null): number {
  return (values ?? []).reduce((sum: number, value) => sum + Math.max(0, value ?? 0), 0);
}

function formatTrainingChartUsd(value: number): string {
  return `${value < 0 ? '−' : ''}$${formatHealthMetricsChartCompact(Math.abs(value))}`;
}

function formatTrainingValue(value: number, isRevenue: boolean): string {
  return isRevenue ? formatTrainingChartUsd(value) : formatHealthMetricsTrainingCount(value);
}
