// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTraineeDetailRow, OrgTraineePair, OrgTraineePairCounts } from '../interfaces/org-people-trainees.interface';

/** Product type of the `Certification` products; every other product type is a `Training`. */
const CERTIFICATION_PRODUCT_TYPE = 'Certification';

/** Greatest non-null string (`MAX` semantics: nulls ignored, plain string comparison). */
function maxString(current: string | null, next: string | null): string | null {
  if (next === null) return current;
  return current === null || next > current ? next : current;
}

/** Greatest non-null id and the name carried by that same row (`MAX_BY(name, id)`). */
function maxById(current: { id: string | null; name: string | null }, id: string | null, name: string | null): { id: string | null; name: string | null } {
  if (id === null) return current;
  return current.id === null || id > current.id ? { id, name } : current;
}

/**
 * Resolves each (person, course) pair's attributes from ALL of its in-range rows, exactly as the BFF's stats do, so the
 * filters can then be applied to the pair as a whole: Certified wins over Enrolled; product type, course name and level
 * are the greatest across rows (`MAX`, nulls ignored); foundation and project names come from the row with the greatest
 * id (`MAX_BY`); the format is the latest non-null one by activity timestamp.
 */
export function resolveOrgTraineePairs(details: readonly OrgTraineeDetailRow[]): OrgTraineePair[] {
  const pairs = new Map<string, OrgTraineePair>();
  const formatTs = new Map<string, string>();
  for (const row of details) {
    const key = `${row.personKey}|${row.courseId}`;
    const pair = pairs.get(key);
    if (!pair) {
      pairs.set(key, {
        personKey: row.personKey,
        courseId: row.courseId,
        status: row.status,
        productType: row.productType,
        courseName: row.courseName,
        courseLevel: row.courseLevel,
        courseFormat: row.courseFormat,
        foundationId: row.foundationId,
        foundationName: row.foundationName,
        projectId: row.projectId,
        projectName: row.projectName,
      });
      if (row.courseFormat !== null) formatTs.set(key, row.activityTs);
      continue;
    }
    if (row.status === 'Certified') pair.status = 'Certified';
    pair.productType = maxString(pair.productType, row.productType);
    pair.courseName = maxString(pair.courseName, row.courseName) as string;
    pair.courseLevel = maxString(pair.courseLevel, row.courseLevel);

    const foundation = maxById({ id: pair.foundationId, name: pair.foundationName }, row.foundationId, row.foundationName);
    pair.foundationId = foundation.id;
    pair.foundationName = foundation.name;
    const project = maxById({ id: pair.projectId, name: pair.projectName }, row.projectId, row.projectName);
    pair.projectId = project.id;
    pair.projectName = project.name;

    const seenTs = formatTs.get(key);
    if (row.courseFormat !== null && (seenTs === undefined || row.activityTs > seenTs)) {
      pair.courseFormat = row.courseFormat;
      formatTs.set(key, row.activityTs);
    }
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
