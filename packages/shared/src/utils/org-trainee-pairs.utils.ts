// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CERTIFICATION_PRODUCT_TYPE } from '../constants/training.constants';
import type { OrgTraineePair, OrgTraineePairCounts } from '../interfaces/org-people-trainees.interface';

export function orgTraineePairCourseLabel(pair: Pick<OrgTraineePair, 'courseName' | 'courseId'>): string {
  return pair.courseName ?? pair.courseId;
}

/** Counts of pairs: certified `Certification` pairs, certified other pairs, and enrolled-only pairs. */
export function countOrgTraineePairs(pairs: readonly OrgTraineePair[]): OrgTraineePairCounts {
  const counts: OrgTraineePairCounts = { coursesTaken: pairs.length, certifications: 0, trainingsCompleted: 0, inProgress: 0 };
  for (const pair of pairs) {
    if (pair.status !== 'Certified') counts.inProgress++;
    else if (pair.productType === CERTIFICATION_PRODUCT_TYPE) counts.certifications++;
    else counts.trainingsCompleted++;
  }
  return counts;
}

export function mostRecentOrgTraineePair(pairs: readonly OrgTraineePair[]): OrgTraineePair | null {
  let best: OrgTraineePair | null = null;
  for (const pair of pairs) {
    if (best === null || compareMostRecent(pair, best) < 0) best = pair;
  }
  return best;
}

function compareMostRecent(a: OrgTraineePair, b: OrgTraineePair): number {
  if (a.lastActivityTs !== b.lastActivityTs) {
    if (a.lastActivityTs === null) return 1;
    if (b.lastActivityTs === null) return -1;
    return a.lastActivityTs > b.lastActivityTs ? -1 : 1;
  }
  const aCert = a.status === 'Certified' ? 1 : 0;
  const bCert = b.status === 'Certified' ? 1 : 0;
  if (aCert !== bCert) return bCert - aCert;
  return orgTraineePairCourseLabel(a).localeCompare(orgTraineePairCourseLabel(b), 'en-US');
}
