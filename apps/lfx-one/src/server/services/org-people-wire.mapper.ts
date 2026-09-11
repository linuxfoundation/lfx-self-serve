// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAllEmployeeRow, OrgAllEmployeeRowInternal, OrgAllEmployeesInternalResponse, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';

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
