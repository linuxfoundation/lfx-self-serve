// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import {
  buildHealthMetricsTrainingCourseRowView,
  buildHealthMetricsTrainingEnrollmentView,
  buildHealthMetricsTrainingSubNavItems,
  formatHealthMetricsTrainingCount,
  formatHealthMetricsTrainingCoursesCountLabel,
  formatHealthMetricsTrainingRevenue,
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

  it('renders no badge or note while no section reads data', () => {
    expect(buildHealthMetricsTrainingSubNavItems().every((item) => item.count === null && item.note === '')).toBe(true);
  });

  it('badges a section once it reports a count', () => {
    expect(buildHealthMetricsTrainingSubNavItems({ courses: 12 }).find((item) => item.key === 'courses')?.count).toBe(12);
  });
});

const PERIOD: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: 3850, certifications: 620, revenueUsd: 100000 },
  baseline: { enrollments: 3500, certifications: 620, revenueUsd: 125000 },
  byType: [
    { deliveryType: 'E-Learning', enrollments: 2900, revenueUsd: 0 },
    { deliveryType: 'Certification Exam', enrollments: 620, revenueUsd: 70000 },
    { deliveryType: 'Instructor Led', enrollments: 330, revenueUsd: 30000 },
  ],
};

/** The same period figures under every range, overridden where a test needs them. */
function withPeriod(overrides: Partial<HealthMetricsTrainingEnrollmentPeriod> = {}): HealthMetricsTrainingEnrollment {
  const period = { ...PERIOD, ...overrides };
  return {
    measured: true,
    periods: { YTD: period, COMPLETED_YEAR: period, COMPLETED_YEAR_2: period, COMPLETED_YEAR_3: period },
    trend: [
      { year: 2026, enrollments: 3850 },
      { year: 2025, enrollments: 3400 },
    ],
  };
}

const ENROLLMENT = withPeriod();

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

  it('projects the selected period from the one read', () => {
    const enrollment: HealthMetricsTrainingEnrollment = {
      ...ENROLLMENT,
      periods: { ...ENROLLMENT.periods, COMPLETED_YEAR: { ...PERIOD, totals: { enrollments: 4100, certifications: 700, revenueUsd: 90000 } } },
    };

    expect(buildHealthMetricsTrainingEnrollmentView(enrollment, 'YTD', 'enrollments').headline.value).toBe('3,850');
    expect(buildHealthMetricsTrainingEnrollmentView(enrollment, 'COMPLETED_YEAR', 'enrollments').headline.value).toBe('4,100');
  });

  it('names the baseline for the running year and for a completed one', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').baselineLabel).toBe('all against the same point last year');
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'COMPLETED_YEAR', 'enrollments').baselineLabel).toBe('all against 2024');
  });

  it('shows not available for every delta when the period has no baseline', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(withPeriod({ baseline: null }), 'COMPLETED_YEAR_3', 'enrollments');

    expect(view.baselineLabel).toBe('no earlier year to compare against');
    expect([view.headline, ...view.side].every((stat) => stat.delta === 'not available' && stat.deltaDirection === 'neutral')).toBe(true);
  });

  it('shows not available for a delta whose baseline is zero or NULL, and for a NULL figure', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({
        totals: { enrollments: 10, certifications: null, revenueUsd: 50 },
        baseline: { enrollments: 0, certifications: 5, revenueUsd: null },
      }),
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

  it('sorts a type with unmeasured revenue last with no bar', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({ byType: [{ deliveryType: 'MicroCourse', enrollments: 40, revenueUsd: null }, ...PERIOD.byType] }),
      'YTD',
      'revenue'
    );

    expect(view.byType.at(-1)).toEqual({ deliveryType: 'MicroCourse', label: 'Microcourses', value: 'not available', barWidthPct: 0 });
  });

  it('keeps the model order for the enrollment bars rather than re-sorting', () => {
    const byType = [PERIOD.byType[2], PERIOD.byType[0], PERIOD.byType[1]];

    const view = buildHealthMetricsTrainingEnrollmentView(withPeriod({ byType }), 'YTD', 'enrollments');
    expect(view.byType.map((row) => row.deliveryType)).toEqual(['Instructor Led', 'E-Learning', 'Certification Exam']);
  });

  it('leaves Bundle and types without enrollments off the enrollment bars, and edX off the revenue bars', () => {
    const byType = [
      ...PERIOD.byType,
      { deliveryType: 'Bundle', enrollments: 0, revenueUsd: 90000 },
      { deliveryType: 'edX', enrollments: 500, revenueUsd: 0 },
      { deliveryType: 'MicroCourse', enrollments: 0, revenueUsd: 0 },
    ];

    const enrollments = buildHealthMetricsTrainingEnrollmentView(withPeriod({ byType }), 'YTD', 'enrollments');
    expect(enrollments.byType.map((row) => row.deliveryType)).toEqual(['E-Learning', 'Certification Exam', 'Instructor Led', 'edX']);

    const revenue = buildHealthMetricsTrainingEnrollmentView(withPeriod({ byType }), 'YTD', 'revenue');
    expect(revenue.byType.map((row) => row.deliveryType)).toEqual(['Bundle', 'Certification Exam', 'Instructor Led', 'E-Learning', 'MicroCourse']);
  });

  it('counts the delivery types with enrollments, never Bundle', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'YTD', 'enrollments').typeCountLabel).toBe('3 delivery types');
    expect(buildHealthMetricsTrainingEnrollmentView(withPeriod({ byType: PERIOD.byType.slice(0, 1) }), 'YTD', 'enrollments').typeCountLabel).toBe(
      '1 delivery type'
    );
    const byType = [
      ...PERIOD.byType,
      { deliveryType: 'Bundle', enrollments: 0, revenueUsd: 90000 },
      { deliveryType: 'MicroCourse', enrollments: 0, revenueUsd: 0 },
    ];
    expect(buildHealthMetricsTrainingEnrollmentView(withPeriod({ byType }), 'YTD', 'revenue').typeCountLabel).toBe('3 delivery types');
  });

  it('shows not available for a revenue delta whose baseline netted negative', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(
      withPeriod({ baseline: { enrollments: 3500, certifications: 620, revenueUsd: -5000 } }),
      'YTD',
      'enrollments'
    );

    expect(view.side[1].delta).toBe('not available');
  });

  it('orders the trend by year and marks the running year partial', () => {
    expect(buildHealthMetricsTrainingEnrollmentView(ENROLLMENT, 'COMPLETED_YEAR', 'revenue').trend).toEqual([
      { year: 2025, enrollments: 3400, isPartialYear: false, yearLabel: '2025', enrollmentsLabel: '3,400' },
      { year: 2026, enrollments: 3850, isPartialYear: true, yearLabel: '2026 (partial year)', enrollmentsLabel: '3,850' },
    ]);
  });

  it('builds an empty view from the unmeasured read', () => {
    const view = buildHealthMetricsTrainingEnrollmentView(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED, 'YTD', 'enrollments');

    expect(view.headline.value).toBe('not available');
    expect(view.byType).toEqual([]);
    expect(view.trend).toEqual([]);
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
  it('labels a paid, covered certification with its revenue and the certification pill', () => {
    expect(buildHealthMetricsTrainingCourseRowView(COURSE)).toEqual({
      courseKey: 'course-1',
      courseName: 'Example Practitioner Exam',
      typeLabel: 'Certification',
      typeClass: 'bg-blue-50 text-blue-700',
      enrollmentsLabel: '1,250',
      revenueLabel: '$45K',
      revenueMeasured: true,
    });
  });

  it('shows free for a free course rather than $0', () => {
    const view = buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'E-Learning', isFree: true, hasPurchaseCoverage: false, revenueUsd: 0 });

    expect(view).toMatchObject({ typeLabel: 'eLearning', typeClass: 'bg-gray-100 text-gray-600', revenueLabel: 'free', revenueMeasured: false });
  });

  it('shows not available where purchases are not captured, LF Education does not say whether it is free, or revenue is NULL', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, hasPurchaseCoverage: false, revenueUsd: 0 }).revenueLabel).toBe('not available');
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'edX', isFree: null, revenueUsd: 0 })).toMatchObject({
      typeLabel: 'edX',
      revenueLabel: 'not available',
      revenueMeasured: false,
    });
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, revenueUsd: null }).revenueLabel).toBe('not available');
  });

  it('keeps a refund-driven negative revenue as it is', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, deliveryType: 'Instructor Led', revenueUsd: -1200 })).toMatchObject({
      typeLabel: 'Instructor-led',
      revenueLabel: '-$1.2K',
    });
  });

  it('renders NULL enrollments as not available', () => {
    expect(buildHealthMetricsTrainingCourseRowView({ ...COURSE, enrollments: null }).enrollmentsLabel).toBe('not available');
  });
});

describe('formatHealthMetricsTrainingCoursesCountLabel', () => {
  it('counts courses, singular for one, and a dash while unmeasured', () => {
    expect(formatHealthMetricsTrainingCoursesCountLabel(1)).toBe('1 course');
    expect(formatHealthMetricsTrainingCoursesCountLabel(1760)).toBe('1,760 courses');
    expect(formatHealthMetricsTrainingCoursesCountLabel(null)).toBe('—');
  });
});
