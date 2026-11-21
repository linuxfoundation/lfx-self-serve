// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import { HEALTH_METRICS_L2_RANGES } from '../constants/health-metrics-l2.constants';
import {
  HEALTH_METRICS_TRAINING_COURSE_DEFAULT_TYPE_ICON,
  HEALTH_METRICS_TRAINING_COURSE_FREE_LABEL,
  HEALTH_METRICS_TRAINING_COURSE_TYPE_ICONS,
  HEALTH_METRICS_TRAINING_COURSE_TYPE_LABELS,
  HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES,
  HEALTH_METRICS_TRAINING_COURSES_LEGACY_TYPES,
  HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES,
  HEALTH_METRICS_TRAINING_COURSES_TYPE_OPTIONS,
  HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_BAR_WIDTH_PX,
  HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_HEIGHT_PX,
  HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS,
  HEALTH_METRICS_TRAINING_ENROLLMENT_UNSPLIT_SERIES,
  HEALTH_METRICS_TRAINING_NOT_AVAILABLE,
  HEALTH_METRICS_TRAINING_SECTIONS,
  HEALTH_METRICS_TRAINING_REVENUE_UNCAPTURED_TYPES,
  HEALTH_METRICS_TRAINING_TREND_YEARS,
} from '../constants/health-metrics-training.constants';
import { buildHealthMetricsColumnChart, formatHealthMetricsChartCompact } from './health-metrics-column-chart.utils';
import { formatHealthMetricsPercent } from './health-metrics-table.utils';

import type { HealthMetricsColumnChartInputColumn, HealthMetricsColumnChartSeries } from '../interfaces/health-metrics-column-chart.interface';
import type { HealthMetricsChartTipRowView, HealthMetricsL2Range, HealthMetricsMetricItem } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsTrainingCourse,
  HealthMetricsTrainingCourseRowView,
  HealthMetricsTrainingCoursesType,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentPeriod,
  HealthMetricsTrainingEnrollmentType,
  HealthMetricsTrainingEnrollmentView,
  HealthMetricsTrainingEnrollmentYear,
  HealthMetricsTrainingSubNavItem,
} from '../interfaces/health-metrics-training.interface';

/** Sub-nav items for the Training tab; no section here carries a note. */
/** The sub-nav, with Courses carrying its course count once read, e.g. `176 courses`; no note while the count is unset or zero. */
export function buildHealthMetricsTrainingSubNavItems(coursesCount: number | null = null): HealthMetricsTrainingSubNavItem[] {
  const coursesNote = coursesCount ? `${formatHealthMetricsTrainingCount(coursesCount)} ${coursesCount === 1 ? 'course' : 'courses'}` : '';
  return HEALTH_METRICS_TRAINING_SECTIONS.map((section) => ({ key: section.key, label: section.label, note: section.key === 'courses' ? coursesNote : '' }));
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
  const isCertification = HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES.certification.includes(course.deliveryType);
  const revenueMeasured = course.isFree === false && course.hasPurchaseCoverage && course.revenueUsd !== null;

  return {
    courseKey: course.courseKey,
    courseName: course.courseName,
    typeLabel: HEALTH_METRICS_TRAINING_COURSE_TYPE_LABELS[course.deliveryType] ?? course.deliveryType,
    typeClass: isCertification ? HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES.certification : HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES.other,
    typeIcon: Object.hasOwn(HEALTH_METRICS_TRAINING_COURSE_TYPE_ICONS, course.deliveryType)
      ? HEALTH_METRICS_TRAINING_COURSE_TYPE_ICONS[course.deliveryType]
      : HEALTH_METRICS_TRAINING_COURSE_DEFAULT_TYPE_ICON,
    enrollmentsLabel: course.enrollments === null ? '—' : formatHealthMetricsTrainingCount(course.enrollments),
    revenueLabel: formatCourseRevenue(course, revenueMeasured),
    revenueFree: course.isFree === true,
  };
}

/** The Course type from the URL or the select; an older link's value maps to its new cut, and anything else is All types. */
export function parseHealthMetricsTrainingCoursesType(value: string | null | undefined): HealthMetricsTrainingCoursesType {
  if (value && Object.hasOwn(HEALTH_METRICS_TRAINING_COURSES_LEGACY_TYPES, value)) return HEALTH_METRICS_TRAINING_COURSES_LEGACY_TYPES[value];
  return HEALTH_METRICS_TRAINING_COURSES_TYPE_OPTIONS.find((option) => option.id === value)?.id ?? 'all';
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
  // A refund keeps it too: net revenue below zero is still part of the year's total.
  const keep = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map(
    (_, index) => index !== otherIndex || columns.some((column) => (column.values?.[index] ?? 0) !== 0)
  );
  const series: HealthMetricsColumnChartSeries[] = HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.filter((_, index) => keep[index]).map(
    ({ key, label, color }) => ({
      key,
      label,
      color,
    })
  );
  // A year with a revenue total but no split by type draws it as one neutral bar, in its own series.
  const unsplit = columns.some((column) => column.unsplit !== undefined);
  if (unsplit) series.push(HEALTH_METRICS_TRAINING_ENROLLMENT_UNSPLIT_SERIES);
  const keepRow = (row: HealthMetricsChartTipRowView) => series.some((entry) => entry.label === row.label);
  const isRevenue = metric === 'revenue';
  // The design's totals read "{N}" for enrollments and "${N}K" for revenue; the axis stays compact either way.
  const formatTotal = isRevenue ? formatTrainingChartUsd : formatHealthMetricsTrainingCount;
  const formatTick = isRevenue ? formatTrainingChartUsd : formatHealthMetricsChartCompact;

  const chartColumns: (HealthMetricsColumnChartInputColumn & { tableTotal: number | null })[] = columns.map((column, columnIndex) => ({
    key: String(years[columnIndex]),
    label: column.label,
    sub: '',
    values: column.values ? [...column.values.filter((_, index) => keep[index]), ...(unsplit ? [column.unsplit ?? null] : [])] : null,
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

/** Net revenue as compact currency, as the chart writes it, negative after refunds; a free course reads "Free", and uncaptured revenue "—", never "Free". */
function formatCourseRevenue(course: HealthMetricsTrainingCourse, measured: boolean): string {
  if (course.isFree === true) return HEALTH_METRICS_TRAINING_COURSE_FREE_LABEL;

  if (!measured) return '—';
  const revenue = course.revenueUsd ?? 0;
  // A nonzero amount that would round to $0 keeps its cents, so a small sale or refund never reads as none.
  if (revenue !== 0 && Math.abs(revenue) < 0.5) return `${revenue < 0 ? '−' : ''}$${Math.abs(revenue).toFixed(2)}`;
  return formatTrainingChartUsd(revenue);
}

interface TrainingColumn {
  label: string;
  /** One per segment, bottom up; `null` for a year with no data for the measure. */
  values: (number | null)[] | null;
  /** The label over the stack; `null` hides it for a year with no activity. */
  total: number | null;
  /** The total the screen-reader table reads: 0 for a quiet year, `null` only where the measure is not available. */
  tableTotal: number | null;
  /** A revenue total known only as a whole, drawn as one neutral bar; absent for a year split by type. */
  unsplit?: number;
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
  if (!period || !enrollment.measured) {
    return { label, values: null, total: null, tableTotal: null, tipTitle: `Revenue not available for ${year}`, tipRows: [] };
  }
  const known = period.totals.revenueUsd;
  // Every type has a row in every period; only one active in the year counts, so a quiet type never reads "Free".
  const types = covered.filter((type) => (type.enrollments ?? 0) > 0 || (type.revenueUsd ?? 0) !== 0);
  // Whether the split is known is judged on the active types alone, so quiet zero rows never stand in for a missing split.
  if (!types.some((type) => type.revenueUsd !== null) && known !== null && known !== 0) {
    // A known total with no split still draws, as one neutral bar.
    return {
      label,
      values: HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS.map(() => null),
      unsplit: known,
      total: known,
      tableTotal: known,
      tipTitle: `${label} · ${formatTrainingChartUsd(known)} revenue · split by type not available`,
      tipRows: [],
    };
  }
  if (known === null && !types.some((type) => type.revenueUsd !== null)) {
    return { label, values: null, total: null, tableTotal: null, tipTitle: `Revenue not available for ${year}`, tipRows: [] };
  }

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
