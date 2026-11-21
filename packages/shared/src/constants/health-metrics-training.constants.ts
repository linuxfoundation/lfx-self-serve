// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { lfxColors } from './colors.constants';
import { HEALTH_METRICS_L2_EMPTY_SOURCES } from './health-metrics-l2.constants';
import type { HealthMetricsL2Blank, HealthMetricsL2Range, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsTrainingCourses,
  HealthMetricsTrainingCoursesTypeOption,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentGoals,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentMetricOption,
  HealthMetricsTrainingEnrollmentPeriod,
  HealthMetricsTrainingEnrollmentSegment,
  HealthMetricsTrainingQueryParams,
  HealthMetricsTrainingSectionKey,
} from '../interfaces/health-metrics-training.interface';

/**
 * The two Training sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-trn-<key>`. Copy is verbatim from the design.
 */
export const HEALTH_METRICS_TRAINING_SECTIONS = [
  {
    key: 'enroll',
    empty: { icon: 'fa-light fa-graduation-cap', source: HEALTH_METRICS_L2_EMPTY_SOURCES.courses },
    label: 'Enrollment & revenue',
    heading: 'Enrollment & revenue',
    description: 'Course enrollments and the revenue they bring in.',
    provisional: true,
  },
  {
    key: 'courses',
    empty: { icon: 'fa-light fa-graduation-cap', source: HEALTH_METRICS_L2_EMPTY_SOURCES.courses },
    label: 'Courses',
    heading: 'Courses',
    description: 'Individual courses and certifications by enrollment. Free courses show no revenue — that is reach, not a gap.',
    provisional: true,
  },
] as const satisfies readonly HealthMetricsL2Section[];

/** The tab's blank card, shown in place of every section when none has data for the period. */
export const HEALTH_METRICS_TRAINING_BLANK: HealthMetricsL2Blank = {
  icon: 'fa-light fa-graduation-cap',
  noun: 'training',
  lead: 'Enrollments and revenue appear once the foundation has courses on LF Education.',
  reasons: ['No courses or certifications are published yet', 'No one has enrolled so far this year', 'Your LF Education contact can help plan a course'],
  pastActivity: 'training activity',
};

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX = 'sec-trn-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_TRAINING_DATA_SECTIONS = ['enroll', 'courses'] as const satisfies readonly HealthMetricsTrainingSectionKey[];

/** Rendered for a figure or a change that is not measured, so a gap never reads as zero. */
export const HEALTH_METRICS_TRAINING_NOT_AVAILABLE = 'not available';

/** The periods the model compares with the same point last year; only YTD carries change columns. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_COMPARED_RANGES: readonly HealthMetricsL2Range[] = ['YTD'];

/** A period with nothing measured. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: null, certifications: null, revenueUsd: null },
  change: null,
  byType: [],
};

/** A year with no goal set for either measure. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_GOALS_UNSET: HealthMetricsTrainingEnrollmentGoals = {
  enrollments: null,
  revenueUsd: null,
  enrollmentsProgress: null,
  revenueProgress: null,
};

/** The empty read: shown while loading, after a failure, and for a foundation without an `All` row. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED: HealthMetricsTrainingEnrollment = {
  measured: false,
  periods: {
    YTD: HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED,
    COMPLETED_YEAR: HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED,
    COMPLETED_YEAR_2: HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED,
    COMPLETED_YEAR_3: HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED,
  },
  trend: [],
  goals: {
    YTD: HEALTH_METRICS_TRAINING_ENROLLMENT_GOALS_UNSET,
    COMPLETED_YEAR: HEALTH_METRICS_TRAINING_ENROLLMENT_GOALS_UNSET,
    COMPLETED_YEAR_2: HEALTH_METRICS_TRAINING_ENROLLMENT_GOALS_UNSET,
    COMPLETED_YEAR_3: HEALTH_METRICS_TRAINING_ENROLLMENT_GOALS_UNSET,
  },
};

/** The header switch; Enrollments is the default, and the pick is local, not in the URL. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_METRIC_OPTIONS: readonly HealthMetricsTrainingEnrollmentMetricOption[] = [
  { id: 'enrollments', label: 'Enrollments' },
  { id: 'revenue', label: 'Revenue' },
];

/** Display labels for LF Education's delivery types; an unlisted type shows as it comes. */
export const HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS: Readonly<Record<string, string>> = {
  'E-Learning': 'eLearning',
  'Certification Exam': 'Certification exams',
  'Instructor Led': 'Instructor-led',
  MicroCourse: 'Microcourses',
  Bundle: 'Bundles',
};

/**
 * The chart's segments, bottom to top, in the design's colours and with the delivery types' own labels. Other collects every
 * other type: eLearning and edX in Enrollments, eLearning and Bundle in Revenue, where edX's never-captured revenue is left out.
 */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_SEGMENTS: readonly HealthMetricsTrainingEnrollmentSegment[] = [
  {
    key: 'certification',
    label: HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS['Certification Exam'],
    color: lfxColors.blue[500],
    deliveryType: 'Certification Exam',
  },
  { key: 'microcourse', label: HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS['MicroCourse'], color: lfxColors.blue[900], deliveryType: 'MicroCourse' },
  { key: 'instructorLed', label: HEALTH_METRICS_TRAINING_DELIVERY_TYPE_LABELS['Instructor Led'], color: lfxColors.violet[500], deliveryType: 'Instructor Led' },
  { key: 'other', label: 'Other', color: lfxColors.gray[300], deliveryType: null },
];

/** The design's 220px plot and 44px columns. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_HEIGHT_PX = 220;
export const HEALTH_METRICS_TRAINING_ENROLLMENT_CHART_BAR_WIDTH_PX = 44;

/** Types left out of revenue by type: edX revenue is never captured, so its zero is coverage, not free training. */
export const HEALTH_METRICS_TRAINING_REVENUE_UNCAPTURED_TYPES: readonly string[] = ['edX'];

/** Years the chart draws, ending with the current one; the view now goes back to 2016. */
export const HEALTH_METRICS_TRAINING_TREND_YEARS = 6;

/** Read-failed / no-foundation value: no rows and no scope total, so nothing reads as zero courses. */
export const HEALTH_METRICS_TRAINING_COURSES_UNMEASURED: HealthMetricsTrainingCourses = { rows: [], totalRecords: 0, scopeTotal: null };

/** The type pills over the courses table; the first is the default. */
export const HEALTH_METRICS_TRAINING_COURSES_TYPE_OPTIONS: readonly HealthMetricsTrainingCoursesTypeOption[] = [
  { id: 'all', label: 'All' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'elearning', label: 'eLearning' },
];

/** The LF Education delivery type each narrowing pill keeps. */
export const HEALTH_METRICS_TRAINING_COURSES_TYPE_DELIVERY_TYPES = {
  certifications: 'Certification Exam',
  elearning: 'E-Learning',
} as const;

/** Rows per page; the server caps a request at `HEALTH_METRICS_TRAINING_COURSES_MAX_PAGE_SIZE`. */
export const HEALTH_METRICS_TRAINING_COURSES_PAGE_SIZE = 25;

export const HEALTH_METRICS_TRAINING_COURSES_MAX_PAGE_SIZE = 100;

/** Search text past this length is cut before it is bound. */
export const HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH = 100;

export const HEALTH_METRICS_TRAINING_COURSES_SEARCH_DEBOUNCE_MS = 200;

export const HEALTH_METRICS_TRAINING_QUERY_PARAMS = {
  coursesType: 'trnType',
  coursesSearch: 'trnSearch',
  coursesPage: 'trnPage',
} as const satisfies Record<string, keyof HealthMetricsTrainingQueryParams>;

/** A course's type pill names one course, so it reads singular where the by-type list reads plural. */
export const HEALTH_METRICS_TRAINING_COURSE_TYPE_LABELS: Readonly<Record<string, string>> = {
  'E-Learning': 'eLearning',
  'Certification Exam': 'Certification',
  'Instructor Led': 'Instructor-led',
  MicroCourse: 'Microcourse',
};

/** Type pills — applied via `[class]`, so they are safelisted in Tailwind. Certifications stand out from the rest. */
export const HEALTH_METRICS_TRAINING_COURSE_TYPE_PILL_CLASSES = {
  certification: 'bg-blue-50 text-blue-700',
  other: 'bg-gray-100 text-gray-600',
} as const;

/** Shown in place of revenue for a free course: reach, not a gap. */
export const HEALTH_METRICS_TRAINING_COURSE_FREE_LABEL = 'free';
