// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import {
  buildHealthMetricsTrainingEnrollmentView,
  buildHealthMetricsTrainingSubNavItems,
  formatHealthMetricsTrainingCount,
  formatHealthMetricsTrainingRevenue,
  getHealthMetricsTrainingDeliveryTypeLabel,
} from './health-metrics-training.utils';

import type { HealthMetricsTrainingEnrollment } from '../interfaces/health-metrics-training.interface';

describe('buildHealthMetricsTrainingSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsTrainingSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.label));
  });

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsTrainingSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });

  it('badges a section once it reports a count', () => {
    expect(buildHealthMetricsTrainingSubNavItems({ courses: 12 }).find((item) => item.key === 'courses')?.count).toBe(12);
  });
});

const ENROLLMENT: HealthMetricsTrainingEnrollment = {
  measured: true,
  totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000 },
  baseline: { enrollments: 3500, certifications: 620, revenueUsd: 125000 },
  byType: [
    { deliveryType: 'E-Learning', enrollments: 2900, revenueUsd: 0 },
    { deliveryType: 'Certification Exam', enrollments: 620, revenueUsd: 70000 },
    { deliveryType: 'Instructor Led', enrollments: 330, revenueUsd: 30000 },
  ],
  trend: [
    { year: 2026, enrollments: 3850 },
    { year: 2025, enrollments: 3400 },
  ],
};

describe('formatHealthMetricsTrainingCount / formatHealthMetricsTrainingRevenue', () => {
  it('renders NULL as not available and a measured zero as zero', () => {
    expect(formatHealthMetricsTrainingCount(null)).toBe('not available');
    expect(formatHealthMetricsTrainingCount(0)).toBe('0');
    expect(formatHealthMetricsTrainingCount(3850)).toBe('3,850');
    expect(formatHealthMetricsTrainingRevenue(null)).toBe('not available');
    expect(formatHealthMetricsTrainingRevenue(0)).toBe('$0');
  });
});

describe('getHealthMetricsTrainingDeliveryTypeLabel', () => {
  it('maps the design names and passes an unlisted type through', () => {
    expect(getHealthMetricsTrainingDeliveryTypeLabel('E-Learning')).toBe('eLearning');
    expect(getHealthMetricsTrainingDeliveryTypeLabel('Instructor Led')).toBe('Instructor-led');
    expect(getHealthMetricsTrainingDeliveryTypeLabel('edX')).toBe('edX');
  });
});

describe('buildHealthMetricsTrainingEnrollmentView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the KPI strip from the totals, each delta against the baseline', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments');

    expect(view.headline).toEqual({ key: 'enrollments', label: 'Enrollments', value: '3,850', delta: '+10%', deltaDirection: 'up' });
    expect(view.side.map((stat) => [stat.key, stat.value, stat.delta, stat.deltaDirection])).toEqual([
      ['certifications', '620', '0%', 'neutral'],
      ['revenue', '$100K', '−20%', 'down'],
    ]);
  });

  it('names the baseline for the running year and for a completed one', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').baselineLabel).toBe('all against the same point last year');
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'COMPLETED_YEAR', 'enrollments').baselineLabel).toBe('all against 2024');
  });

  it('shows not available for every delta when the period has no baseline', () => {
    const view = buildHealthMetricsTrainingEnrollmentView({ ...ENROLLMENT, baseline: null }, 'COMPLETED_YEAR_3', 'enrollments');

    expect(view.baselineLabel).toBe('no earlier year to compare against');
    expect([view.headline, ...view.side].every((stat) => stat.delta === 'not available' && stat.deltaDirection === 'neutral')).toBe(true);
  });

  it('shows not available for a delta whose baseline is zero or NULL, and for a NULL figure', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      {
        ...ENROLLMENT,
        totals: { enrollments: 10, certifications: null, revenueUsd: 50 },
        baseline: { enrollments: 0, certifications: 5, revenueUsd: null },
      },
      'YTD',
      'enrollments'
    );

    expect(view.headline.delta).toBe('not available');
    expect(view.side[0]).toMatchObject({ value: 'not available', delta: 'not available' });
    expect(view.side[1].delta).toBe('not available');
  });

  it('ranks the by-type bars by the toggle, scaled to the largest', () => {
    const enrollments = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments');
    expect(enrollments.byType.map((row) => [row.label, row.value])).toEqual([
      ['eLearning', '2,900'],
      ['Certification exams', '620'],
      ['Instructor-led', '330'],
    ]);
    expect(enrollments.byType[0].barWidthPct).toBe(100);

    const revenue = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'revenue');
    expect(revenue.byType.map((row) => [row.label, row.value, row.barWidthPct])).toEqual([
      ['Certification exams', '$70K', 100],
      ['Instructor-led', '$30K', (30000 / 70000) * 100],
      ['eLearning', '$0', 0],
    ]);
  });

  it('sorts an unmeasured type last with no bar', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      { ...ENROLLMENT, byType: [{ deliveryType: 'edX', enrollments: null, revenueUsd: null }, ...ENROLLMENT.byType] },
      'YTD',
      'enrollments'
    );

    expect(view.byType.at(-1)).toEqual({ deliveryType: 'edX', label: 'edX', value: 'not available', barWidthPct: 0 });
  });

  it('counts the delivery types', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').typeCountLabel).toBe('3 delivery types');
    expect(buildHealthMetricsTrainingEnrollmentView({ ...ENROLLMENT, byType: ENROLLMENT.byType.slice(0, 1) }, 'YTD', 'enrollments').typeCountLabel).toBe(
      '1 delivery type'
    );
  });

  it('orders the trend by year and marks the running year partial', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'COMPLETED_YEAR', 'revenue').trend).toEqual([
      { year: 2025, enrollments: 3400, isPartialYear: false },
      { year: 2026, enrollments: 3850, isPartialYear: true },
    ]);
  });

  it('builds an empty view from the unmeasured read', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, 'YTD', 'enrollments');

    expect(view.headline.value).toBe('not available');
    expect(view.byType).toEqual([]);
    expect(view.trend).toEqual([]);
  });
});
