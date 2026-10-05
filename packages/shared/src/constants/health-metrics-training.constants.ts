// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
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
    label: 'Enrollment & revenue',
    heading: 'Enrollment & revenue',
    description: 'Training is the third revenue stream and the widest top-of-funnel the foundation has — most enrollments are people who are not members yet.',
    footnote:
      'Certification exams and free eLearning are counted separately on purpose — one is revenue, the other is reach, and averaging them tells you neither.',
    footnoteCaution: false,
    headingBadge: 'Provisional',
  },
  {
    key: 'courses',
    label: 'Courses',
    heading: 'Courses',
    description: 'Individual courses and certifications by enrollment. Free courses show no revenue — that is reach, not a gap.',
    footnote:
      'Enrollment counts come from LF Education. Revenue is provisional and excludes corporate training agreements, which are tracked per member organization.',
    footnoteCaution: false,
    headingBadge: 'Provisional',
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX = 'sec-trn-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_TRAINING_DATA_SECTIONS = ['enroll', 'courses'] as const satisfies readonly HealthMetricsTrainingSectionKey[];

/** Note under the sub-nav items, linking to the Members directory's per-organization training. */
export const HEALTH_METRICS_TRAINING_SUB_NAV_CROSS_REFERENCE: HealthMetricsL2CrossReference = {
  text: 'Corporate training purchases appear per organization in',
  linkLabel: 'Members',
  route: 'members',
  fragment: 'list',
};

/** The project selector does not narrow Training, so the page says so above its sections. */
export const HEALTH_METRICS_TRAINING_SCOPE_NOTE = 'Training figures are foundation-wide. The project selector does not narrow them.';

/** The state that replaces the shell when the foundation has no training programme. */
export const HEALTH_METRICS_TRAINING_NO_PROGRAMME = {
  title: 'No training activity yet',
  body: 'Enrollments and certifications appear here once this foundation offers training through LF Education.',
  hint: 'Set up a training programme with LF Education to start tracking enrollment and revenue.',
} as const;

/** Rendered for a figure or a change that is not measured, so a gap never reads as zero. */
export const HEALTH_METRICS_TRAINING_NOT_AVAILABLE = 'not available';

/** A period with nothing measured. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_PERIOD_UNMEASURED: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: null, certifications: null, revenueUsd: null },
  baseline: null,
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
};

/** The toggle above the by-type bars. */
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

/** Types whose zero on a measure is structural: Bundle is a purchase container, edX revenue is never captured. */
export const HEALTH_METRICS_TRAINING_STRUCTURAL_ZERO_TYPES: Readonly<Record<HealthMetricsTrainingEnrollmentMetric, readonly string[]>> = {
  enrollments: ['Bundle'],
  revenue: ['edX'],
};

/** Fill for the by-type bars — applied via `[class]`, so it is safelisted in Tailwind. */
export const HEALTH_METRICS_TRAINING_ENROLLMENT_BAR_CLASS = 'bg-blue-600';

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

/** A course's type pill names one course, so it reads singular where the by-type bars read plural. */
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
