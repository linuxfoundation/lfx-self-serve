// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAllEmployeeRow,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeesInternalResponse,
  OrgAllEmployeesResponse,
  OrgAllEmployeeStats,
} from '@lfx-one/shared/interfaces';

/**
 * Project an in-memory merge row onto the wire shape. The merge-only field (`emails`)
 * carries every address that contributed to the row — personal, other-employer, and
 * unrelated-foundation addresses included — and the UI reads none of it, so it stays
 * server-side.
 *
 * Explicit allowlist, not a rest-spread denylist: a field added to the internal row later is
 * dropped by default instead of leaking, and a required field added to the wire row fails to
 * compile until it is listed here (optional additions must be listed by hand).
 */
export function toWireRow(row: OrgAllEmployeeRowInternal): OrgAllEmployeeRow {
  return {
    personKey: row.personKey,
    lfid: row.lfid,
    lfUsername: row.lfUsername,
    cdpMemberId: row.cdpMemberId,
    name: row.name,
    firstName: row.firstName,
    lastName: row.lastName,
    title: row.title,
    email: row.email,
    accessBadge: row.accessBadge,
    avatarUrl: row.avatarUrl,
    sources: row.sources,
    seatsCount: row.seatsCount,
    boardSeatsCount: row.boardSeatsCount,
    committeeSeatsCount: row.committeeSeatsCount,
    commitsCount: row.commitsCount,
    eventsCount: row.eventsCount,
    coursesCount: row.coursesCount,
    engagedFoundationIds: row.engagedFoundationIds,
    ...(row.isFormer ? { isFormer: true } : {}),
  };
}

/** Project a pre-strip merge payload onto the wire envelope. Stats and foundations carry no merge-only fields. */
export function toWireResponse(response: OrgAllEmployeesInternalResponse): OrgAllEmployeesResponse {
  return {
    accountId: response.accountId,
    rows: response.rows.map(toWireRow),
    stats: response.stats,
    foundations: response.foundations,
  };
}

/**
 * Recompute the 5 stat cards over the merged rows so the headline matches the visible table.
 * `activeInOss` counts only people with at least one engagement signal (governance / code / event /
 * training) — matching the stored model's Definition-2 meaning — so access-only rows merged in for the
 * roster don't inflate the "Employees Active in Open Source" headline. Governance counts a seat count OR
 * a live board/committee provenance — the provenance fallback also catches any seat that arrived without a
 * resolvable count.
 */
export function computeStats(rows: OrgAllEmployeeRow[]): OrgAllEmployeeStats {
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
