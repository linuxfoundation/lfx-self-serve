// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAllEmployeeRow, OrgAllEmployeeStats } from '../interfaces';

/**
 * The 5 All Employees stat cards, counted over the rows the table shows so the headline matches it.
 * `activeInOss` counts only people with at least one engagement signal (governance / code / event /
 * training) — the stored model's Definition-2 meaning — so access-only rows merged in for the roster
 * don't inflate the "Employees Active in Open Source" headline. Governance counts a seat count OR a live
 * board/committee provenance — the provenance fallback also catches any seat that arrived without a
 * resolvable count.
 */
export function computeOrgAllEmployeeStats(rows: readonly OrgAllEmployeeRow[]): OrgAllEmployeeStats {
  let activeInOss = 0;
  let inGovernance = 0;
  let codeContributors = 0;
  let eventAttendees = 0;
  let trainees = 0;
  for (const row of rows) {
    const inGov = row.seatsCount > 0 || row.sources.includes('board') || row.sources.includes('committee');
    const hasCode = row.commitsCount > 0;
    const hasEvents = row.eventsCount > 0;
    const hasTraining = row.coursesCount > 0;
    if (inGov) inGovernance++;
    if (hasCode) codeContributors++;
    if (hasEvents) eventAttendees++;
    if (hasTraining) trainees++;
    if (inGov || hasCode || hasEvents || hasTraining) activeInOss++;
  }
  return { activeInOss, inGovernance, codeContributors, eventAttendees, trainees };
}
