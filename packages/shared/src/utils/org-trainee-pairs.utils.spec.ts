// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgTraineeDetailRow } from '../interfaces/org-people-trainees.interface';
import { countOrgTraineePairs, resolveOrgTraineePairs } from './org-trainee-pairs.utils';

function row(overrides: Partial<OrgTraineeDetailRow>): OrgTraineeDetailRow {
  return {
    personKey: 'p-1',
    status: 'Enrolled',
    courseOrCertId: 'e-1',
    courseId: 'c-1',
    courseName: 'Synthetic Course',
    foundationId: 'f-1',
    foundationName: 'Foundation One',
    projectId: 'pr-1',
    projectName: 'Project One',
    courseLevel: null,
    productType: 'Training',
    courseFormat: null,
    activityTs: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveOrgTraineePairs', () => {
  it('collapses rows into one pair per person and course, Certified winning over Enrolled', () => {
    const pairs = resolveOrgTraineePairs([row({}), row({ status: 'Certified', courseOrCertId: 'k-1' }), row({ courseId: 'c-2' })]);
    expect(pairs.map((p) => `${p.courseId}:${p.status}`)).toEqual(['c-1:Certified', 'c-2:Enrolled']);
  });

  it('resolves level, product type and course name by greatest value, ignoring nulls', () => {
    const [pair] = resolveOrgTraineePairs([
      row({ courseLevel: 'Beginner', productType: 'Training', courseName: 'A' }),
      row({ courseLevel: null, productType: 'Certification', courseName: 'B' }),
      row({ courseLevel: 'Intermediate', productType: null, courseName: 'A' }),
    ]);
    expect(pair.courseLevel).toBe('Intermediate');
    expect(pair.productType).toBe('Training');
    expect(pair.courseName).toBe('B');
  });

  it('takes foundation and project names from the row with the greatest id', () => {
    const [pair] = resolveOrgTraineePairs([
      row({ foundationId: 'f-1', foundationName: 'One', projectId: 'pr-9', projectName: 'Nine' }),
      row({ foundationId: 'f-2', foundationName: 'Two', projectId: 'pr-1', projectName: 'One' }),
      row({ foundationId: null, foundationName: 'Ignored', projectId: null, projectName: 'Ignored' }),
    ]);
    expect([pair.foundationId, pair.foundationName, pair.projectId, pair.projectName]).toEqual(['f-2', 'Two', 'pr-9', 'Nine']);
  });

  it('resolves the format to the latest non-null one by activity timestamp', () => {
    const [pair] = resolveOrgTraineePairs([
      row({ courseFormat: 'E-Learning', activityTs: '2026-02-01T00:00:00.000Z' }),
      row({ courseFormat: null, status: 'Certified', activityTs: '2026-03-01T00:00:00.000Z' }),
      row({ courseFormat: 'Instructor Led', activityTs: '2026-01-15T00:00:00.000Z' }),
    ]);
    expect(pair.courseFormat).toBe('E-Learning');
  });

  it('leaves the format null when no row has one', () => {
    expect(resolveOrgTraineePairs([row({}), row({ status: 'Certified' })])[0].courseFormat).toBeNull();
  });
});

describe('countOrgTraineePairs', () => {
  it('splits pairs into certifications, trainings completed and in progress', () => {
    const pairs = resolveOrgTraineePairs([
      row({ courseId: 'a', status: 'Certified', productType: 'Certification' }),
      row({ courseId: 'b', status: 'Certified' }),
      row({ courseId: 'c' }),
    ]);
    expect(countOrgTraineePairs(pairs)).toEqual({ coursesTaken: 3, certifications: 1, trainingsCompleted: 1, inProgress: 1 });
  });
});
