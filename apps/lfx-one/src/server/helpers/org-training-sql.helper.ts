// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS } from '@lfx-one/shared/constants';

/**
 * SQL predicate keeping enrollments from the last ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS months only (today excluded).
 * The training tables keep enrollments of any age for the People › Trainees ranges; the Certifications tab and the
 * person detail apply this to ORG_PEOPLE_TRAINING_COURSE_STATUS.LAST_ENROLLED_TS on in-progress (Enrolled) courses.
 * Certificates are never windowed: callers apply this to non-certified rows only.
 * Opt-in: each call site asks for the window explicitly and its UI copy states it.
 */
export function orgTrainingEnrolledWindowPredicate(activityTsColumn = 'ACTIVITY_TS'): string {
  return `${activityTsColumn}::date >= DATEADD('MONTH', -${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS}, CURRENT_DATE()) AND ${activityTsColumn}::date < CURRENT_DATE()`;
}
