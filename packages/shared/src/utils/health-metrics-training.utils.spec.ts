// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import {
  buildHealthMetricsTrainingCourseRowView,
  buildHealthMetricsTrainingEnrollmentView,
  buildHealthMetricsTrainingSubNavItems,
  formatHealthMetricsTrainingCount,
  parseHealthMetricsTrainingCoursesType,
  getHealthMetricsTrainingDeliveryTypeLabel,
} from './health-metrics-training.utils';

import type {
  HealthMetricsTrainingCourse,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentPeriod,
} from '../interfaces/health-metrics-training.interface';

describe('buildHealthMetricsTrainingSubNavItems', () => {
  it('lists every section in render order, with its label', () => {
    const items = buildHealthMetricsTrainingSubNavItems();

    expect(items.map((item) => item.key)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.key));
    expect(items.map((item) => item.label)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => section.label));
  });

  it('carries no note before Courses reports its count, or for a zero count', () => {
    expect(buildHealthMetricsTrainingSubNavItems().every((item) => item.note === '')).toBe(true);
    expect(buildHealthMetricsTrainingSubNavItems(0).every((item) => item.note === '')).toBe(true);
  });

  it('notes the course count on Courses only, singular for one', () => {
    const notes = (count: number) => buildHealthMetricsTrainingSubNavItems(count).map((item) => `${item.key}:${item.note}`);

    expect(notes(1760)).toEqual(['enroll:', 'courses:1,760 courses']);
    expect(notes(1)).toEqual(['enroll:', 'courses:1 course']);
  });
});

const PERIOD: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000 },
  change: { enrollments: 0.1, certifications: 0.004, revenueUsd: -0.2 },
  byType: [
    { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 2900, revenueUsd: 0 },
    { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 620, revenueUsd: 70000 },
    { deliveryType: 'Instructor Led', isListed: true, isListedRevenue: true, enrollments: 330, revenueUsd: 30000 },
  ],
};

/** The same period figures under every range, overridden where a test needs them. */
function withPeriod(overrides: Partial<HealthMetricsTrainingEnrollmentPeriod> = {}): HealthMetricsTrainingEnrollment {
  const period = { ...PERIOD, ...overrides };
  return {
    measured: true,
    periods: { YTD: period, COMPLETED_YEAR: period, COMPLETED_YEAR_2: period, COMPLETED_YEAR_3: period },
    trend: [
      { year: 2026, enrollments: 3850, certificationExams: 620, microcourses: 100, instructorLed: 330 },
      { year: 2025, enrollments: 3400, certificationExams: 500, microcourses: 0, instructorLed: 300 },
    ],
    goals: HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED.goals,
  };
}

const ENROLLMENT = withPeriod();

describe('formatHealthMetricsTrainingCount', () => {
  it('renders NULL as not available and a measured zero as zero', () => {
    expect(formatHealthMetricsTrainingCount(null)).toBe('not available');
    expect(formatHealthMetricsTrainingCount(0)).toBe('0');
    expect(formatHealthMetricsTrainingCount(3850)).toBe('3,850');
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

  it('leads the metrics row with the selected measure, revenue in compact currency, with no change or baseline', () => {
    const enrollments = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').metrics;
    expect(enrollments).toEqual([
      { key: 'enrollments', label: 'Enrollments', value: '3,850' },
      { key: 'certifications', label: 'Certifications earned', value: '620' },
      { key: 'revenue', label: 'Revenue', value: '$100K' },
    ]);

    const revenue = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'revenue').metrics;
    expect(revenue.map((item) => item.key)).toEqual(['revenue', 'enrollments', 'certifications']);
  });

  it('dashes an unset figure in the metrics row', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({ totals: { enrollments: null, certifications: 0, revenueUsd: null } }),
      'YTD',
      'enrollments'
    );

    expect(view.metrics.map((item) => item.value)).toEqual(['—', '0', '—']);
  });

  it('charts the current year and the five before it, oldest first, the current year full and the rest muted', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments');

    expect(view.subHeading).toBe('Enrollments by type over the years');
    expect(view.chart.columns.map((column) => column.label)).toEqual(['2021', '2022', '2023', '2024', '2025', '2026 YTD']);
    expect(view.chart.columns.map((column) => column.opacity)).toEqual([0.35, 0.35, 0.35, 0.35, 0.35, 1]);
    expect(view.chart.heightPx).toBe(220);
    expect(view.chart.barWidthPx).toBe(44);
  });

  it('stacks enrollments by type with Other as the rest of the total, and shares in the popup', () => {
    const column = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').chart.columns.at(-1);

    expect(column?.segments.map((segment) => segment.key)).toEqual(['certification', 'microcourse', 'instructorLed', 'other']);
    expect(column?.total).toBe('3,850');
    expect(column?.tip.title).toBe('2026 YTD · 3,850 enrollments');
    expect(column?.tip.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      'Certification exams: 620 · 16%',
      'Microcourses: 100 · 3%',
      'Instructor-led: 330 · 9%',
      'Other: 2,800 · 73%',
    ]);
  });

  it('keeps a year with no activity at zero, with no total over it', () => {
    const column = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').chart.columns[0];

    expect(column.total).toBe('');
    expect(column.segments.every((segment) => segment.heightPct === 0)).toBe(true);
    expect(column.tip.title).toBe('2021 · 0 enrollments');
  });

  it('charts revenue by type for the four years the summary covers, Free for a zero, and none for the two before', () => {
    const paidElearning = withPeriod({
      byType: [
        { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 2900, revenueUsd: 12000 },
        { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 620, revenueUsd: 70000 },
        { deliveryType: 'Instructor Led', isListed: true, isListedRevenue: true, enrollments: 330, revenueUsd: 0 },
      ],
    });
    const view = buildHealthMetricsTrainingEnrollmentView(paidElearning, 'YTD', 'revenue');
    const [oldest, , , , , current] = view.chart.columns;

    expect(view.subHeading).toBe('Revenue by type over the years');
    expect(view.chart.yTicks[0].startsWith('$')).toBe(true);
    expect(current.tip.title).toBe('2026 YTD · $100K revenue');
    expect(current.total).toBe('$100K');
    // Microcourses has no row in the period, so no captured revenue and no popup row; Instructor-led's zero is Free.
    expect(current.tip.rows.map((row) => `${row.label}: ${row.value}`)).toEqual(['Certification exams: $70K', 'Instructor-led: Free', 'Other: $12K']);
    expect(oldest.segments).toEqual([]);
    expect(oldest.total).toBe('');
    expect(oldest.tip).toEqual({ title: 'Revenue not available for 2021', rows: [] });
  });

  it('leaves edX out of Other in Revenue, as its revenue is never captured', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({
        byType: [
          { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 2900, revenueUsd: 12000 },
          { deliveryType: 'edX', isListed: true, isListedRevenue: false, enrollments: 50, revenueUsd: 5000 },
        ],
      }),
      'YTD',
      'revenue'
    );

    expect(view.chart.columns.at(-1)?.tip.rows.find((row) => row.label === 'Other')?.value).toBe('$12K');
  });

  it('hides Other in Revenue when every year shown has none', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'revenue');

    expect(view.chart.series.map((series) => series.key)).not.toContain('other');
  });

  it('reads a year with no measured total as not available, and keeps a missing type out of Other', () => {
    const partial = withPeriod();
    partial.trend = [
      { year: 2026, enrollments: 1000, certificationExams: null, microcourses: 100, instructorLed: 300 },
      { year: 2025, enrollments: null, certificationExams: null, microcourses: null, instructorLed: null },
    ];
    const columns = buildHealthMetricsTrainingEnrollmentView(partial, 'YTD', 'enrollments').chart.columns;
    const [current, last] = [columns.at(-1), columns.at(-2)];

    expect(last?.segments).toEqual([]);
    expect(last?.tip).toEqual({ title: '2025 · enrollments not available', rows: [] });
    // Other is unknown in every year shown, so it drops out like an all-zero Other.
    expect(current?.tip.rows.map((row) => `${row.label}: ${row.value}`)).toEqual([
      'Certification exams: —',
      'Microcourses: 100 · 10%',
      'Instructor-led: 300 · 30%',
    ]);
  });

  it('counts only types active in the year in Revenue, so a quiet type never reads Free, and puts no total over a quiet year', () => {
    const quiet = withPeriod({
      totals: { enrollments: 0, certifications: 0, revenueUsd: 0 },
      byType: [
        { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 0, revenueUsd: 0 },
        { deliveryType: 'MicroCourse', isListed: false, isListedRevenue: false, enrollments: 0, revenueUsd: 0 },
      ],
    });
    const current = buildHealthMetricsTrainingEnrollmentView(quiet, 'YTD', 'revenue').chart.columns.at(-1);

    expect(current?.tip.rows).toEqual([]);
    expect(current?.total).toBe('');
  });

  it("keeps a refund-only Other, which still counts in the year's net total", () => {
    const refunds = withPeriod({
      byType: [
        { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 620, revenueUsd: 70000 },
        { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 10, revenueUsd: -200 },
      ],
    });
    const view = buildHealthMetricsTrainingEnrollmentView(refunds, 'YTD', 'revenue');

    expect(view.chart.series.map((series) => series.key)).toContain('other');
    expect(view.chart.columns.at(-1)?.tip.rows.find((row) => row.label === 'Other')?.value).toBe('−$200');
  });

  it('draws a known revenue total with no split as one neutral bar, said so in its popup', () => {
    const unsplit = withPeriod({ byType: [] });
    const view = buildHealthMetricsTrainingEnrollmentView(unsplit, 'YTD', 'revenue');
    const current = view.chart.columns.at(-1);

    expect(view.chart.series.at(-1)).toEqual({ key: 'unsplit', label: 'Not split by type', color: expect.any(String) });
    expect(current?.segments.find((segment) => segment.key === 'unsplit')?.heightPct).toBeGreaterThan(0);
    expect(current?.total).toBe('$100K');
    expect(current?.tip).toEqual({ title: '2026 YTD · $100K revenue · split by type not available', rows: [] });
    expect(view.table.headers.at(-2)).toBe('Not split by type');
  });

  it('keeps a quiet $0 year with no split on the quiet path: no label, no neutral bar or legend entry', () => {
    const quiet = withPeriod({ totals: { enrollments: 0, certifications: 0, revenueUsd: 0 }, byType: [] });
    const view = buildHealthMetricsTrainingEnrollmentView(quiet, 'YTD', 'revenue');

    expect(view.chart.series.map((series) => series.key)).not.toContain('unsplit');
    expect(view.chart.columns.at(-1)?.total).toBe('');
    expect(view.table.rows.at(-1)?.cells.at(-1)).toBe('$0');
  });

  it('judges a missing split on the active types only, so quiet zero rows do not hide it', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({
        byType: [
          { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 620, revenueUsd: null },
          { deliveryType: 'MicroCourse', isListed: false, isListedRevenue: false, enrollments: 0, revenueUsd: 0 },
        ],
      }),
      'YTD',
      'revenue'
    );

    expect(view.chart.columns.at(-1)?.tip.title).toBe('2026 YTD · $100K revenue · split by type not available');
  });

  it('drops Other from the chart and legend when it is zero in every year shown', () => {
    const noOther = withPeriod();
    noOther.trend = [{ year: 2026, enrollments: 1050, certificationExams: 620, microcourses: 100, instructorLed: 330 }];
    const view = buildHealthMetricsTrainingEnrollmentView(noOther, 'YTD', 'enrollments');

    expect(view.chart.series.map((series) => series.key)).toEqual(['certification', 'microcourse', 'instructorLed']);
    expect(view.chart.columns.at(-1)?.tip.rows.map((row) => row.label)).not.toContain('Other');
    expect(view.table.headers).toEqual(['Year', 'Certification exams', 'Microcourses', 'Instructor-led', 'Total']);
  });

  it('gives screen readers a row per year with a column per type and the total', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments');

    expect(view.table.headers).toEqual(['Year', 'Certification exams', 'Microcourses', 'Instructor-led', 'Other', 'Total']);
    expect(view.table.rows.at(-1)).toEqual({ key: '2026', cells: ['2026 YTD', '620', '100', '330', '2,800', '3,850'] });
    // A quiet year's total reads 0 to screen readers, though no label sits over its empty column.
    expect(view.table.rows[0].cells.at(-1)).toBe('0');
  });

  it('builds an all-dash view from the unmeasured read, with revenue not available for every year', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, 'YTD', 'revenue');

    expect(view.metrics.map((item) => item.value)).toEqual(['—', '—', '—']);
    expect(view.chart.columns.every((column) => column.tip.title.startsWith('Revenue not available'))).toBe(true);
  });
});

const COURSE: HealthMetricsTrainingCourse = {
  courseKey: 'course-1',
  courseName: 'Example Practitioner Exam',
  deliveryType: 'Certification Exam',
  isFree: false,
  hasPurchaseCoverage: true,
  enrollments: 1250,
  revenueUsd: 45000,
};

describe('buildHealthMetricsTrainingCourseRowView', () => {
  it('labels a paid, covered certification with its revenue and the certification badge', () => {
    expect(buildHealthMetricsTrainingCourseRowView(COURSE)).toEqual({
      courseKey: 'course-1',
      courseName: 'Example Practitioner Exam',
      typeLabel: 'Certification',
      typeClass: 'bg-blue-50 text-blue-700',
      typeIcon: 'fa-light fa-award',
      enrollmentsLabel: '1,250',
      revenueLabel: '$45K',
      revenueFree: false,
    });
  });

  it('shows Free for a free course rather than $0', () => {
    const view = buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'E-Learning', isFree: true, hasPurchaseCoverage: false, revenueUsd: 0 });

    expect(view).toMatchObject({
      typeLabel: 'eLearning',
      typeClass: 'bg-gray-100 text-gray-600',
      typeIcon: 'fa-light fa-laptop',
      revenueLabel: 'Free',
      revenueFree: true,
    });
  });

  it('shows a dash, never Free, where purchases are not captured, LF Education does not say whether it is free, or revenue is NULL', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, hasPurchaseCoverage: false, revenueUsd: 0 }).revenueLabel).toBe('—');
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'edX', isFree: null, revenueUsd: 0 })).toMatchObject({
      typeLabel: 'edX',
      typeIcon: 'fa-light fa-laptop',
      revenueLabel: '—',
      revenueFree: false,
    });
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, revenueUsd: null }).revenueLabel).toBe('—');
  });

  it('keeps a refund-driven negative revenue, written as the chart writes it', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'Instructor Led', revenueUsd: -1200 })).toMatchObject({
      typeLabel: 'Instructor-led',
      typeIcon: 'fa-light fa-chalkboard-user',
      revenueLabel: '−$1.2K',
    });
  });

  it('gives Microcourse its own label with the eLearning icon', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'MicroCourse' })).toMatchObject({
      typeLabel: 'Microcourse',
      typeClass: 'bg-gray-100 text-gray-600',
      typeIcon: 'fa-light fa-laptop',
    });
  });

  it('keeps the cents of a nonzero amount that would round to $0, a refund included', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, revenueUsd: 0.42 }).revenueLabel).toBe('$0.42');
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, revenueUsd: -0.35 }).revenueLabel).toBe('−$0.35');
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, revenueUsd: 0 }).revenueLabel).toBe('$0');
  });

  it('renders NULL enrollments as a dash', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, enrollments: null }).enrollmentsLabel).toBe('—');
  });
});

describe('parseHealthMetricsTrainingCoursesType', () => {
  it('keeps a known type, maps an older link value to its new cut, and falls back to All types', () => {
    expect(parseHealthMetricsTrainingCoursesType('instructor-led')).toBe('instructor-led');
    expect(parseHealthMetricsTrainingCoursesType('certifications')).toBe('certification');
    expect(parseHealthMetricsTrainingCoursesType('toString')).toBe('all');
    expect(parseHealthMetricsTrainingCoursesType(null)).toBe('all');
  });
});
