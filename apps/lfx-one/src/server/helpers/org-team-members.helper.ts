// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CDP_TEAM_MEMBER_COLUMN, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgTeamMemberKeys, OrgTeamMembersFilter, SnowflakeQueryOptions } from '@lfx-one/shared/interfaces';

import { logger } from '../services/logger.service';
import type { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';
import { isInvalidIdentifierError } from './snowflake-error.helper';

/**
 * SQL predicate dropping CDP team members under `exclude` (empty under `include`); `column` is the model's person-level
 * IS_CDP_TEAM_MEMBER flag. Only a row flagged TRUE is dropped: an unknown (NULL) flag keeps the row, so a model that
 * leaves the flag NULL never silently empties the default view.
 */
export function orgTeamMembersPredicate(teamMembers: OrgTeamMembersFilter, column = 'is_cdp_team_member'): string {
  return teamMembers === 'exclude' ? `AND NOT COALESCE(${column}, FALSE)` : '';
}

/**
 * Query options for a read that filters on the flag: until lf-dbt has built the column, Snowflake rejects it as an
 * invalid identifier, which is expected during the rollout and must not count toward the circuit breaker. `column` is
 * the identifier the `exclude` read depends on: the flag, or a model's count without team members.
 */
export function orgTeamMembersQueryOptions(teamMembers: OrgTeamMembersFilter, column = ORG_CDP_TEAM_MEMBER_COLUMN): SnowflakeQueryOptions | undefined {
  return teamMembers === 'exclude' ? { expectInvalidIdentifier: column } : undefined;
}

/**
 * Runs `read` for the pick; when `exclude` meets a missing `column` (the flag by default) it logs, runs `read` again
 * with `include` and reports `teamMembersUnavailable`, so a view keeps loading (with team members counted) instead of
 * failing. Callers must not cache an unavailable answer. Any other error rejects.
 */
export async function readWithOrgTeamMembersFallback<T>(
  teamMembers: OrgTeamMembersFilter,
  operation: string,
  read: (teamMembers: OrgTeamMembersFilter) => Promise<T>,
  column = ORG_CDP_TEAM_MEMBER_COLUMN
): Promise<{ value: T; teamMembersUnavailable: boolean }> {
  try {
    return { value: await read(teamMembers), teamMembersUnavailable: false };
  } catch (error) {
    if (teamMembers !== 'exclude' || !isInvalidIdentifierError(error, column)) {
      throw error;
    }
    logger.warning(undefined, operation, 'Team-member flag is not in the warehouse yet; serving team members included', { err: error });
    return { value: await read('include'), teamMembersUnavailable: true };
  }
}

/**
 * Person keys of the account's CDP team members, which `exclude` leaves out of a People tab's code-based numbers
 * (lfx-self-serve#4685); `include` reads nothing. IS_CDP_TEAM_MEMBER is person-level (the same on every row of a
 * person in every Org Lens model), so the union of the People models covers anyone either tab lists, maintainer roles
 * included. Cached once per account: the list does not depend on the range or scope. While the column is missing the
 * answer is `unavailable` (team members included) and is never cached.
 */
export async function readOrgTeamMemberPersonKeys(
  snowflakeService: SnowflakeService,
  accountId: string,
  teamMembers: OrgTeamMembersFilter
): Promise<OrgTeamMemberKeys> {
  if (teamMembers === 'include') {
    return { excluded: null, unavailable: false };
  }
  const keys = await withOrgCache<string[] | null>(
    accountId,
    'people-team-members:v1',
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const query = `
        SELECT PERSON_KEY FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY WHERE ACCOUNT_ID = ? AND IS_CDP_TEAM_MEMBER
        UNION
        SELECT PERSON_KEY FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES WHERE ACCOUNT_ID = ? AND IS_CDP_TEAM_MEMBER
        UNION
        SELECT PERSON_KEY FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL WHERE ACCOUNT_ID = ? AND IS_CDP_TEAM_MEMBER
      `;
      try {
        return (
          await snowflakeService.execute<{ PERSON_KEY: string }>(query, [accountId, accountId, accountId], orgTeamMembersQueryOptions(teamMembers))
        ).rows.map((row) => row.PERSON_KEY);
      } catch (error) {
        if (!isInvalidIdentifierError(error, ORG_CDP_TEAM_MEMBER_COLUMN)) throw error;
        logger.warning(undefined, 'read_org_team_members', 'Team-member flag is not in the warehouse yet; serving team members included', { err: error });
        return null;
      }
    },
    isStringList,
    (value) => value !== null
  );
  return keys === null ? { excluded: null, unavailable: true } : { excluded: new Set(keys), unavailable: false };
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
