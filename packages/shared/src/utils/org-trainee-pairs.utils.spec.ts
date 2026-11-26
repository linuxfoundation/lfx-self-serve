// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgTraineePair } from '../interfaces/org-people-trainees.interface';
import { countOrgTraineePairs, mostRecentOrgTraineePair, orgTraineePairCourseLabel } from './org-trainee-pairs.utils';

function pair(overrides: Partial<OrgTraineePair>): OrgTraineePair {
  return {
    personKey: 'p-1',
    courseId: 'c-1',
    status: 'Enrolled',
    productType: 'Training',
    courseName: 'Synthetic Course',
    courseLevel: null,
    courseFormat: null,
    foundationId: 'f-1',
    foundationName: 'Foundation One',
    projectId: 'pr-1',
    projectName: 'Project One',
    lastActivityTs: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('orgTraineePairCourseLabel', () => {
  it('shows the warehouse name, and the course id only when the pair has none', () => {
    expect(orgTraineePairCourseLabel({ courseName: 'Real Name', courseId: 'c-9' })).toBe('Real Name');
    expect(orgTraineePairCourseLabel({ courseName: null, courseId: 'c-9' })).toBe('c-9');
  });
});

describe('countOrgTraineePairs', () => {
  it('counts a certified Certification as a certification, any other certified pair as a training completed, and an uncertified pair as in progress', () => {
    const pairs = [
      pair({ courseId: 'a', status: 'Certified', productType: 'Certification' }),
      pair({ courseId: 'b', status: 'Certified', productType: 'Training' }),
      pair({ courseId: 'c', status: 'Certified', productType: null }),
      pair({ courseId: 'd', status: 'Enrolled', productType: 'Certification' }),
      pair({ courseId: 'e', status: 'Enrolled', productType: 'Training' }),
    ];

    expect(countOrgTraineePairs(pairs)).toEqual({ coursesTaken: 5, certifications: 1, trainingsCompleted: 2, inProgress: 2 });
  });

  it('counts nothing for no pairs', () => {
    expect(countOrgTraineePairs([])).toEqual({ coursesTaken: 0, certifications: 0, trainingsCompleted: 0, inProgress: 0 });
  });
});

describe('mostRecentOrgTraineePair', () => {
  it('picks the pair with the latest activity', () => {
    const latest = pair({ courseId: 'b', lastActivityTs: '2026-03-01T00:00:00.000Z' });
    expect(mostRecentOrgTraineePair([pair({ courseId: 'a' }), latest, pair({ courseId: 'c', lastActivityTs: null })])).toBe(latest);
  });

  it('on a tie, prefers a certified pair, then the course label A–Z', () => {
    const ts = '2026-02-01T00:00:00.000Z';
    const certified = pair({ courseId: 'z', courseName: 'Zeta', status: 'Certified', lastActivityTs: ts });
    const alpha = pair({ courseId: 'a', courseName: 'Alpha', lastActivityTs: ts });
    const beta = pair({ courseId: 'b', courseName: 'Beta', lastActivityTs: ts });

    expect(mostRecentOrgTraineePair([alpha, certified, beta])).toBe(certified);
    expect(mostRecentOrgTraineePair([beta, alpha])).toBe(alpha);
  });

  it('is null for no pairs', () => {
    expect(mostRecentOrgTraineePair([])).toBeNull();
  });
});
