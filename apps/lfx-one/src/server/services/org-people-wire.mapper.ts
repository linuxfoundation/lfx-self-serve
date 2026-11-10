// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAllEmployeeCompanyEmailStatus,
  OrgAllEmployeeCountedRow,
  OrgAllEmployeeRow,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeesCountedResponse,
  OrgAllEmployeesResponse,
  OrgCommitFilters,
  OrgCompanyEmailKeys,
  OrgTeamMemberKeys,
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
    commitsCount: row.commitsCount,
    mergedCommitsCount: row.mergedCommitsCount,
    codeActivitiesCount: row.codeActivitiesCount,
    eventsCount: row.eventsCount,
    coursesCount: row.coursesCount,
    engagedFoundationIds: row.engagedFoundationIds,
    ...(row.isFormer ? { isFormer: true } : {}),
    ...(row.isUnclassified ? { isUnclassified: true } : {}),
  };
}

/**
 * Project a counted row onto the wire shape: `commitsCount` becomes the count the commit filters pick
 * (lfx-self-serve#4164), `codeActivitiesCount` rides along for the measure-independent active and code tiles, and the
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
    commitsCount: selectedCodeCount(row, filters),
    codeActivitiesCount: row.codeActivitiesCount,
    eventsCount: row.eventsCount,
    coursesCount: row.coursesCount,
    engagedFoundationIds: row.engagedFoundationIds,
    ...(row.isFormer ? { isFormer: true } : {}),
    ...(row.isUnclassified ? { isUnclassified: true } : {}),
  };
}

/**
 * Project a counted payload onto the wire envelope for the request's filters; the tiles are counted over the projected
 * rows, so they cover the people the table lists. Under the Team members filter's `exclude` (lfx-self-serve#4685) a CDP
 * team member's code counts are removed first, on LFX Insights' code-only rule: someone with a seat, an event or a
 * course stays listed without their code, and someone whose only signal was code is dropped. An unavailable flag
 * serves everyone and says so.
 */
export function toWireResponse(
  response: OrgAllEmployeesCountedResponse,
  filters: OrgCommitFilters,
  teamMembers: OrgTeamMemberKeys = NO_TEAM_MEMBERS
): OrgAllEmployeesResponse {
  const excluded = teamMembers.excluded;
  const counted = excluded === null ? response.rows : response.rows.flatMap((row) => (excluded.has(row.personKey) ? withoutCode(row) : [row]));
  const rows = counted.map((row) => toWireRow(row, filters));
  return {
    accountId: response.accountId,
    rows,
    stats: computeOrgAllEmployeeStats(rows),
    foundations: response.foundations,
    ...(teamMembers.unavailable ? { teamMembersUnavailable: true as const } : {}),
  };
}

/**
 * Stamp each All Employees row with what the person drawer's company-email lookup answers for it, from the account's
 * company-email keys: a stored row with a warehouse person key `has` an address when its key or its LF username is in
 * the keys, else `none` on file; a live-only row (looked up by username) `has` one when its username is, else
 * `unconfirmed`; a `cdp:` row is always `unconfirmed`, as the drawer answers it without any lookup. `null` keys (the
 * read failed) leave every row unannotated.
 */
export function withCompanyEmailStatus(response: OrgAllEmployeesResponse, keys: OrgCompanyEmailKeys | null): OrgAllEmployeesResponse {
  if (!keys) {
    return response;
  }
  const personKeys = new Set(keys.personKeys);
  const usernames = new Set(keys.usernames);
  const statusOf = (row: OrgAllEmployeeRow): OrgAllEmployeeCompanyEmailStatus => {
    if (row.personKey.startsWith('cdp:')) return 'unconfirmed';
    const username = row.lfUsername?.trim().toLowerCase();
    if (username && usernames.has(username)) return 'has';
    if (row.personKey.startsWith('live-')) return 'unconfirmed';
    return personKeys.has(row.personKey) ? 'has' : 'none';
  };
  return { ...response, rows: response.rows.map((row) => ({ ...row, companyEmailStatus: statusOf(row) })) };
}

const NO_TEAM_MEMBERS: OrgTeamMemberKeys = { excluded: null, unavailable: false };

/**
 * A team member's row with its code counts removed, or nothing when code was their only engagement. A live source
 * (a board or committee seat, a key-contact role, Org Lens access) is engagement too, counted or not.
 */
function withoutCode(row: OrgAllEmployeeCountedRow): OrgAllEmployeeCountedRow[] {
  const liveEngagement = row.sources.some((source) => source !== 'snowflake');
  if (!liveEngagement && row.seatsCount === 0 && row.eventsCount === 0 && row.coursesCount === 0) {
    return [];
  }
  return [{ ...row, commitsCount: 0, mergedCommitsCount: 0, codeActivitiesCount: 0 }];
}

function selectedCodeCount(row: OrgAllEmployeeCountedRow, filters: OrgCommitFilters): number {
  if (filters.metric === 'code') {
    return row.codeActivitiesCount;
  }
  return filters.commitScope === 'merged' ? row.mergedCommitsCount : row.commitsCount;
}
