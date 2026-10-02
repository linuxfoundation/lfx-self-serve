// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsTrainingSectionKey } from '../interfaces/health-metrics-training.interface';

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
  },
  {
    key: 'courses',
    label: 'Courses',
    heading: 'Courses',
    description: 'Individual courses and certifications by enrollment. Free courses show no revenue — that is reach, not a gap.',
    footnote:
      'Enrollment counts come from LF Education. Revenue is provisional and excludes corporate training agreements, which are tracked per member organization.',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_TRAINING_SECTION_ID_PREFIX = 'sec-trn-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_TRAINING_DATA_SECTIONS = [] as const satisfies readonly HealthMetricsTrainingSectionKey[];

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
