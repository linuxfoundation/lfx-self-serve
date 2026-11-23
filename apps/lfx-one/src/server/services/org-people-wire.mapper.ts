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
  OrgLfUsernameCompanyEmailStatuses,
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
    keyContactRoles: row.keyContactRoles,
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
    keyContactRoles: row.keyContactRoles,
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
 * company-email keys: a stored row is read by its person key only, so it `has` an address when that key is in the
 * keys, else `none` on file; a `cdp:` row is always `unconfirmed`, as the drawer answers it without any lookup; a
 * live-only row is read by its username, so it `has` one when the username's lookup finds one, `none` when the username
 * names one roster person (or, from `lfUsernames`, one LF account) without any, else `unconfirmed`. A live-only row
 * without a username is read by the key-contact records at its address, so it `has` one when its address is in
 * `keyContactAddresses`, else `unconfirmed`. `lfUsernames` answers the usernames {@link uncoveredLiveUsernames} lists and
 * `keyContactAddresses` the addresses {@link liveKeyContactAddresses} lists; `null` leaves those rows `unconfirmed`.
 * `null` keys (the read failed) leave every row unannotated.
 */
export function withCompanyEmailStatus(
  response: OrgAllEmployeesResponse,
  keys: OrgCompanyEmailKeys | null,
  lfUsernames: OrgLfUsernameCompanyEmailStatuses | null = null,
  keyContactAddresses: readonly string[] | null = null
): OrgAllEmployeesResponse {
  if (!keys) {
    return response;
  }
  const personKeys = new Set(keys.personKeys);
  const usernames = new Set([...keys.usernames, ...(lfUsernames?.usernames ?? [])]);
  const noneUsernames = new Set([...keys.noneUsernames, ...(lfUsernames?.noneUsernames ?? [])]);
  const keyContactHolders = new Set(keyContactAddresses ?? []);
  const statusOf = (row: OrgAllEmployeeRow): OrgAllEmployeeCompanyEmailStatus => {
    if (row.personKey.startsWith('cdp:')) return 'unconfirmed';
    if (!row.personKey.startsWith('live-')) return personKeys.has(row.personKey) ? 'has' : 'none';
    const username = row.lfUsername?.trim().toLowerCase();
    if (username && usernames.has(username)) return 'has';
    if (username && noneUsernames.has(username)) return 'none';
    if (!username && keyContactHolders.has((row.email ?? '').trim().toLowerCase())) return 'has';
    return 'unconfirmed';
  };
  return { ...response, rows: response.rows.map((row) => ({ ...row, companyEmailStatus: statusOf(row) })) };
}

/**
 * The addresses of the live-only rows without an LF username that list key-contact roles: people the directory keyed on
 * their address, whom the drawer reads by the key-contact records at it. Only these are read for the filter.
 */
export function liveKeyContactAddresses(response: OrgAllEmployeesResponse): string[] {
  const addresses = new Set<string>();
  for (const row of response.rows) {
    const address = (row.email ?? '').trim().toLowerCase();
    if (row.personKey.startsWith('live-') && !row.lfUsername?.trim() && row.keyContactRoles.length > 0 && address) addresses.add(address);
  }
  return [...addresses];
}

/**
 * The normalized LF usernames of the live-only rows the company-email keys answer neither way: people off the warehouse
 * roster, whom the drawer reads by their LF account. Only these are read for the filter, so the read is bounded to the
 * uncovered live-only usernames in this roster response.
 */
export function uncoveredLiveUsernames(response: OrgAllEmployeesResponse, keys: OrgCompanyEmailKeys): string[] {
  const covered = new Set([...keys.usernames, ...keys.noneUsernames]);
  const uncovered = new Set<string>();
  for (const row of response.rows) {
    const username = row.personKey.startsWith('live-') ? row.lfUsername?.trim().toLowerCase() : undefined;
    if (username && !covered.has(username)) uncovered.add(username);
  }
  return [...uncovered];
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
