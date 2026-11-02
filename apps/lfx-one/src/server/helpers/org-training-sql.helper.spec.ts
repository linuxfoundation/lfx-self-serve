// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { orgTrainingEnrolledWindowPredicate } from './org-training-sql.helper';

describe('orgTrainingEnrolledWindowPredicate', () => {
  it('keeps the 12-month predicate text unchanged', () => {
    expect(orgTrainingEnrolledWindowPredicate()).toBe("ACTIVITY_TS::date >= DATEADD('MONTH', -12, CURRENT_DATE()) AND ACTIVITY_TS::date < CURRENT_DATE()");
  });

  it('derives the window from the shared constant and honours the column', () => {
    expect(ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS).toBe(12);
    expect(orgTrainingEnrolledWindowPredicate('t.ACTIVITY_TS')).toContain(`-${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS},`);
    expect(orgTrainingEnrolledWindowPredicate('t.ACTIVITY_TS')).toMatch(/^t\.ACTIVITY_TS::date >= .* AND t\.ACTIVITY_TS::date < CURRENT_DATE\(\)$/);
  });
});
