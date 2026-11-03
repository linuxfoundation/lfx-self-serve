// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS } from '@lfx-one/shared/constants';

/**
 * SQL predicate keeping ORG_PEOPLE_TRAINING enrollments from the last ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS months only (today excluded). The table
 * keeps enrollments of any age for the People › Trainees ranges; the Certifications tab and the person detail
 * reproduce the window the table used to apply upstream. `ACTIVITY_TS` is the enrollment time on enrolled rows.
 * Certified rows were never windowed: callers apply this to non-certified rows only.
 * Opt-in: each call site asks for the window explicitly and its UI copy states it.
 */
export function orgTrainingEnrolledWindowPredicate(activityTsColumn = 'ACTIVITY_TS'): string {
  return `${activityTsColumn}::date >= DATEADD('MONTH', -${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS}, CURRENT_DATE()) AND ${activityTsColumn}::date < CURRENT_DATE()`;
}
