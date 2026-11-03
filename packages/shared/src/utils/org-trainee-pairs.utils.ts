// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTraineeDetailRow, OrgTraineePair, OrgTraineePairCounts } from '../interfaces/org-people-trainees.interface';

/** Product type of the `Certification` products; every other product type is a `Training`. */
const CERTIFICATION_PRODUCT_TYPE = 'Certification';

/**
 * Groups detail rows into person-course pairs, as the BFF's stats do: a pair is Certified when any of its rows is a
 * certificate (Certified wins over Enrolled), and its product type is the greatest one across its rows (`MAX`).
 */
export function groupOrgTraineePairs(details: readonly OrgTraineeDetailRow[]): OrgTraineePair[] {
  const pairs = new Map<string, OrgTraineePair>();
  for (const row of details) {
    const key = `${row.personKey}|${row.courseId}`;
    const pair = pairs.get(key);
    if (!pair) {
      pairs.set(key, { personKey: row.personKey, courseId: row.courseId, status: row.status, productType: row.productType });
      continue;
    }
    if (row.status === 'Certified') pair.status = 'Certified';
    if (row.productType !== null && (pair.productType === null || row.productType > pair.productType)) pair.productType = row.productType;
  }
  return [...pairs.values()];
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
