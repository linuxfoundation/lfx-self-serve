// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { getYearForRange } from '../constants/dashboard-metrics.constants';
import {
  HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS,
  HEALTH_METRICS_TRAINING_NOT_AVAILABLE,
  HEALTH_METRICS_TRAINING_SECTIONS,
  HEALTH_METRICS_TRAINING_STRUCTURAL_ZERO_TYPES,
} from '../constants/health-metrics-training.constants';
import { formatCurrency } from './number.utils';

import type { HealthMetricsL2Range } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentStatView,
  HealthMetricsTrainingEnrollmentType,
  HealthMetricsTrainingEnrollmentTypeView,
  HealthMetricsTrainingEnrollmentView,
  HealthMetricsTrainingSectionKey,
  HealthMetricsTrainingSubNavItem,
} from '../interfaces/health-metrics-training.interface';

/** Sub-nav items for the Training tab; a section without a count carries no badge. */
export function buildHealthMetricsTrainingSubNavItems(
  counts: Partial<Record<HealthMetricsTrainingSectionKey, number | null>> = {}
): HealthMetricsTrainingSubNavItem[] {
  return HEALTH_METRICS_TRAINING_SECTIONS.map((section) => ({ key: section.key, label: section.label, count: counts[section.key] ?? null, note: '' }));
}

/** A rounded, `en-US`-pinned count, so the server render and the hydrated one agree; `not available` for unmeasured. */
export function formatHealthMetricsTrainingCount(value: number | null): string {
  return value === null ? HEALTH_METRICS_TRAINING_NOT_AVAILABLE : Math.round(value).toLocaleString('en-US');
}

/** A compact dollar figure; `not available` for unmeasured. */
export function formatHealthMetricsTrainingRevenue(value: number | null): string {
  return value === null ? HEALTH_METRICS_TRAINING_NOT_AVAILABLE : formatCurrency(value);
}

/** The design's name for an LF Education delivery type. */
export function getHealthMetricsTrainingDeliveryTypeLabel(deliveryType: string): string {
  return HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS[deliveryType] ?? deliveryType;
}

/** Render-ready Enrollment & revenue section for the period, with the by-type bars ranked by `metric`. */
export function buildHealthMetricsTrainingEnrollmentView(
  enrollment: HealthMetricsTrainingEnrollment,
  range: HealthMetricsL2Range,
  metric: HealthMetricsTrainingEnrollmentMetric
): HealthMetricsTrainingEnrollmentView {
  const { totals, baseline, byType } = enrollment.periods[range];
  const stat = (
    key: HealthMetricsTrainingEnrollmentStatView['key'],
    label: string,
    value: string,
    current: number | null,
    previous: number | null
  ): HealthMetricsTrainingEnrollmentStatView => ({ key, label, value, ...formatTrainingDelta(current, previous) });

  const partialYear = getYearForRange('YTD');

  return {
    baselineLabel: formatTrainingBaseline(range, baseline !== null),
    headline: stat('enrollments', 'Enrollments', formatHealthMetricsTrainingCount(totals.enrollments), totals.enrollments, baseline?.enrollments ?? null),
    side: [
      stat(
        'certifications',
        'Certifications earned',
        formatHealthMetricsTrainingCount(totals.certifications),
        totals.certifications,
        baseline?.certifications ?? null
      ),
      // Refunds can net a prior window negative, which would flip the sign of the change.
      stat('revenue', 'Revenue', formatHealthMetricsTrainingRevenue(totals.revenueUsd), totals.revenueUsd, positiveOrNull(baseline?.revenueUsd ?? null)),
    ],
    typeCountLabel: formatTrainingTypeCount(byType.filter((type) => !isStructuralZero(type, 'enrollments')).length),
    byType: buildTrainingTypeRows(byType, metric),
    trend: [...enrollment.trend]
      .sort((a, b) => a.year - b.year)
      .map((year) => {
        const isPartialYear = year.year === partialYear;
        return {
          year: year.year,
          enrollments: year.enrollments,
          isPartialYear,
          yearLabel: isPartialYear ? `${year.year} (partial year)` : String(year.year),
          enrollmentsLabel: formatHealthMetricsTrainingCount(year.enrollments),
        };
      }),
  };
}

/** Enrollments keep the model's `sort_rank` order; revenue re-ranks highest first. NULL and 0 rows stay, only structural types drop. */
function buildTrainingTypeRows(
  types: HealthMetricsTrainingEnrollmentType[],
  metric: HealthMetricsTrainingEnrollmentMetric
): HealthMetricsTrainingEnrollmentTypeView[] {
  const pick = (type: HealthMetricsTrainingEnrollmentType): number | null => (metric === 'revenue' ? type.revenueUsd : type.enrollments);
  const shown = types.filter((type) => !isStructuralZero(type, metric));
  const max = Math.max(0, ...shown.map((type) => pick(type) ?? 0));
  const ordered = metric === 'revenue' ? [...shown].sort((a, b) => (pick(b) ?? -Infinity) - (pick(a) ?? -Infinity)) : shown;

  return ordered.map((type) => {
    const value = pick(type);
    return {
      deliveryType: type.deliveryType,
      label: getHealthMetricsTrainingDeliveryTypeLabel(type.deliveryType),
      value: metric === 'revenue' ? formatHealthMetricsTrainingRevenue(value) : formatHealthMetricsTrainingCount(value),
      barWidthPct: value === null || max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100)),
    };
  });
}

function isStructuralZero(type: HealthMetricsTrainingEnrollmentType, metric: HealthMetricsTrainingEnrollmentMetric): boolean {
  return HEALTH_METRICS_TRAINING_STRUCTURAL_ZERO_TYPES[metric].includes(type.deliveryType);
}

function formatTrainingTypeCount(count: number): string {
  return `${count} ${count === 1 ? 'delivery type' : 'delivery types'}`;
}

function positiveOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

/** Names what every delta compares against, so a change never stands without its baseline. */
function formatTrainingBaseline(range: HealthMetricsL2Range, compared: boolean): string {
  if (!compared) return 'no earlier year to compare against';
  if (range === 'YTD') return 'all against the same point last year';

  return `all against ${getYearForRange(range) - 1}`;
}

/** A whole-percent change; `not available` without a measured, non-zero baseline. */
function formatTrainingDelta(current: number | null, previous: number | null): Pick<HealthMetricsTrainingEnrollmentStatView, 'delta' | 'deltaDirection'> {
  if (current === null || previous === null || previous === 0) return { delta: HEALTH_METRICS_TRAINING_NOT_AVAILABLE, deltaDirection: 'neutral' };

  const rounded = Math.round(((current - previous) / previous) * 100);
  if (rounded === 0) return { delta: '0%', deltaDirection: 'neutral' };

  return { delta: `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`, deltaDirection: rounded > 0 ? 'up' : 'down' };
}
