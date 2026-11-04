// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import type { OrgEventsAttribution, OrgEventsCoverageRow } from '@lfx-one/shared/interfaces';
import { effectiveOrgEventsAttribution, isObjectRowArray } from '@lfx-one/shared/utils';

import { SnowflakeService } from '../services/snowflake.service';
import { withOrgCache } from '../services/valkey.service';

/**
 * The attribution an Events read serves for a pick: `company_email` falls back to `account` for a company the summary
 * says has no company-email data (see `effectiveOrgEventsAttribution`). The flag is read from the participation summary,
 * cached per org. An account with no summary row has no participation data at all, so nothing is claimed about its
 * coverage: the pick is served as asked, with no fallback note, the same as the Overview does for an empty read.
 */
export async function readOrgEventsServedAttribution(accountId: string, attribution: OrgEventsAttribution): Promise<OrgEventsAttribution> {
  if (attribution !== 'company_email') {
    return attribution;
  }

  const rows = await withOrgCache(
    accountId,
    'events-coverage:v1',
    VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
    async () => {
      const result = await SnowflakeService.getInstance().execute<OrgEventsCoverageRow>(
        `SELECT HAS_COMPANY_EMAIL_COVERAGE
         FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION_SUMMARY
         WHERE ACCOUNT_ID = ?
         LIMIT 1`,
        [accountId]
      );
      return result.rows;
    },
    isObjectRowArray
  );

  const [coverage] = rows;
  return coverage ? effectiveOrgEventsAttribution(attribution, coverage.HAS_COMPANY_EMAIL_COVERAGE === true) : attribution;
}
