// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgTeamMembersFilter } from '@lfx-one/shared/interfaces';

import type { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';

/** SQL predicate dropping CDP team members under `exclude` (empty under `include`); `column` is the model's person-level IS_CDP_TEAM_MEMBER flag. */
export function orgTeamMembersPredicate(teamMembers: OrgTeamMembersFilter, column = 'is_cdp_team_member'): string {
  return teamMembers === 'exclude' ? `AND NOT ${column}` : '';
}

/**
 * Person keys of the account's CDP team members, which `exclude` drops from a People tab (lfx-self-serve#4685), or
 * `null` under `include`, which reads nothing. IS_CDP_TEAM_MEMBER is person-level (the same on every row of a person
 * in every Org Lens model), so the union of the People models covers anyone either tab lists. Cached once per
 * account: the list does not depend on the range or scope.
 */
export async function readOrgTeamMemberPersonKeys(
  snowflakeService: SnowflakeService,
  accountId: string,
  teamMembers: OrgTeamMembersFilter
): Promise<ReadonlySet<string> | null> {
  if (teamMembers === 'include') {
    return null;
  }
  const keys = await withOrgCache(
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
      const { rows } = await snowflakeService.execute<{ PERSON_KEY: string }>(query, [accountId, accountId, accountId]);
      return rows.map((row) => row.PERSON_KEY);
    },
    isStringList
  );
  return new Set(keys);
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
