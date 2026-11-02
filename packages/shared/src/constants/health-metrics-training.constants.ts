// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_L2_EMPTY_SOURCES } from './health-metrics-l2.constants';
import type { HealthMetricsL2Blank, HealthMetricsL2Range, HealthMetricsL2Section } from '../interfaces/health-metrics-l2.interface';
import type {
  HealthMetricsTrainingCourses,
  HealthMetricsTrainingCoursesTypeOption,
  HealthMetricsTrainingEnrollment,
  HealthMetricsTrainingEnrollmentMetric,
  HealthMetricsTrainingEnrollmentMetricOption,
  HealthMetricsTrainingEnrollmentPeriod,
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
    description: 'Training is the third revenue stream and the widest top-of-funnel the foundation has — most enrollments are people who are not members yet.',
    footnote: [
      {
        text: 'Certification exams and free eLearning are counted separately on purpose — one is revenue, the other is reach, and averaging them tells you neither.',
      },
    ],
    footnoteCaution: false,
    headingBadge: 'Provisional',
  },
  {
    key: 'courses',
    empty: { icon: 'fa-light fa-graduation-cap', source: HEALTH_METRICS_L2_EMPTY_SOURCES.courses },
    label: 'Courses',
    heading: 'Courses',
    description: 'Individual courses and certifications by enrollment. Free courses show no revenue — that is reach, not a gap.',
    footnote: [
      {
        text: 'Enrollment counts come from LF Education. Revenue is provisional and excludes corporate training agreements, which are tracked per member organization.',
      },
    ],
    footnoteCaution: false,
    headingBadge: 'Provisional',
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
  goals: { enrollments: null, revenueUsd: null, enrollmentsProgressYtd: null, revenueProgressYtd: null },
};

/** The toggle above the by-type list. */
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

/** Types left out of revenue by type: edX revenue is never captured, so its zero is coverage, not free training. */
export const HEALTH_METRICS_TRAINING_REVENUE_UNCAPTURED_TYPES: readonly string[] = ['edX'];

/** Years the enrollment trend draws, ending with the current one; the view now goes back to 2016. */
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
