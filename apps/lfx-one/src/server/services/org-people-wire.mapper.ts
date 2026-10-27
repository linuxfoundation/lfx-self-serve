// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAllEmployeeCountedRow,
  OrgAllEmployeeRow,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeesCountedResponse,
  OrgAllEmployeesResponse,
  OrgCommitFilters,
} from '@lfx-one/shared/interfaces';
import { computeOrgAllEmployeeStats } from '@lfx-one/shared/utils';

/**
 * Project an in-memory merge row onto the stored (cached) shape. The merge-only field (`emails`)
 * carries every address that contributed to the row — personal, other-employer, and
 * unrelated-foundation addresses included — and the UI reads none of it, so it stays
 * server-side. Every code count is kept so one stored entry serves every commit filter.
 *
 * Explicit allowlist, not a rest-spread denylist: a field added to the internal row later is
 * dropped by default instead of leaking, and a required field added to the stored row fails to
 * compile until it is listed here (optional additions must be listed by hand).
 */
export function toStoredRow(row: OrgAllEmployeeRowInternal): OrgAllEmployeeCountedRow {
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
    keyContactRoles: row.keyContactRoles,
    commitsCount: row.commitsCount,
    mergedCommitsCount: row.mergedCommitsCount,
    codeActivitiesCount: row.codeActivitiesCount,
    eventsCount: row.eventsCount,
    coursesCount: row.coursesCount,
    engagedFoundationIds: row.engagedFoundationIds,
    ...(row.isFormer ? { isFormer: true } : {}),
  };
}

/**
 * Project a counted row onto the wire shape: `commitsCount` becomes the count the commit filters pick
 * (lfx-self-serve#4164), `codeActivitiesCount` rides along for the measure-independent active tile, and the
 * merged count stays server-side. Same allowlist rule as {@link toStoredRow}.
 */
export function toWireRow(row: OrgAllEmployeeCountedRow, filters: OrgCommitFilters): OrgAllEmployeeRow {
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
    keyContactRoles: row.keyContactRoles,
    commitsCount: selectedCodeCount(row, filters),
    codeActivitiesCount: row.codeActivitiesCount,
    eventsCount: row.eventsCount,
    coursesCount: row.coursesCount,
    engagedFoundationIds: row.engagedFoundationIds,
    ...(row.isFormer ? { isFormer: true } : {}),
  };
}

/** Project a counted payload onto the wire envelope for the request's filters; the tiles are counted over the projected rows, so they follow the count the table shows. */
export function toWireResponse(response: OrgAllEmployeesCountedResponse, filters: OrgCommitFilters): OrgAllEmployeesResponse {
  const rows = response.rows.map((row) => toWireRow(row, filters));
  return {
    accountId: response.accountId,
    rows,
    stats: computeOrgAllEmployeeStats(rows),
    foundations: response.foundations,
  };
}

function selectedCodeCount(row: OrgAllEmployeeCountedRow, filters: OrgCommitFilters): number {
  if (filters.metric === 'code') {
    return row.codeActivitiesCount;
  }
  return filters.commitScope === 'merged' ? row.mergedCommitsCount : row.commitsCount;
}
