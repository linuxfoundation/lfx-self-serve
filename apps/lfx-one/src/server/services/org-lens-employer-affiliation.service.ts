// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { currentEmployerFromWorkExperiences } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

interface RawEmployerMembershipRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  ACTIVE_MEMBERSHIP_COUNT: number;
}

/**
 * #4314 — answers "who does this caller work for, and is that company an LF member?" for the Org Lens
 * empty states. Deliberately outside the Org Lens read gate: the whole point is to explain a *missing*
 * grant, so a caller with none must be able to ask.
 *
 * It reveals nothing the caller does not already hold — their own employer's name comes from their own
 * profile, and the answer is one boolean about that company's membership, which is public information
 * (LF member directories list it). No roster, no people, no membership detail.
 *
 * Resolution is by account name, because the only employer identifier a profile carries is a CDP
 * organization id and no platinum relation maps CDP org ids to Salesforce accounts
 * (`ACCOUNT_TO_CDEV_ORG_MAPPING` maps Crowd.dev org ids, which is a different identifier). A name that
 * matches no Salesforce account answers `hasActiveMembership: false` — an employer with a membership
 * always has an account — and where several accounts share a name the one with memberships wins, so a
 * duplicate can never downgrade a member company to the non-member copy.
 *
 * TODO(#4314 follow-up): replace the name match with a domain/identifier resolution once member-service
 * exposes an org lookup the BFF can call for an arbitrary employer.
 */
export class OrgLensEmployerAffiliationService {
  private snowflakeService: SnowflakeService;
  private cdpService: CdpService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
    this.cdpService = new CdpService();
  }

  public async getEmployerAffiliation(req: Request, lfid: string): Promise<OrgLensEmployerAffiliation> {
    const workExperiences = await this.cdpService.getWorkExperiencesForUser(req, lfid);
    const employer = currentEmployerFromWorkExperiences(workExperiences);
    const employerName = employer?.name?.trim() || null;

    if (!employerName) {
      return { employerName: null, accountId: null, hasActiveMembership: false };
    }

    const row = await this.fetchEmployerMembershipRow(employerName);

    logger.debug(req, 'get_employer_affiliation', 'Resolved employer membership', {
      has_employer: true,
      resolved_account: !!row,
      active_memberships: row?.ACTIVE_MEMBERSHIP_COUNT ?? 0,
    });

    return {
      employerName,
      accountId: row?.ACCOUNT_ID ?? null,
      hasActiveMembership: (row?.ACTIVE_MEMBERSHIP_COUNT ?? 0) > 0,
    };
  }

  /**
   * The account a name resolves to, with its active-membership count. `ORDER BY` puts an account that
   * holds memberships first so a duplicated company name cannot answer "non-member" for a member.
   */
  private async fetchEmployerMembershipRow(employerName: string): Promise<RawEmployerMembershipRow | null> {
    const schema = resolveLfxOnePlatinumSchema();
    const query = `
      SELECT
        c.ACCOUNT_ID AS ACCOUNT_ID,
        c.ACCOUNT_NAME AS ACCOUNT_NAME,
        COUNT(m.FOUNDATION_ID) AS ACTIVE_MEMBERSHIP_COUNT
      FROM ${schema}.ORG_LENS_ACCOUNT_CONTEXT c
      LEFT JOIN ${schema}.ORG_LENS_MEMBERSHIPS_SUMMARY m
        ON m.ACCOUNT_ID = c.ACCOUNT_ID
      WHERE UPPER(TRIM(c.ACCOUNT_NAME)) = UPPER(TRIM(?))
      GROUP BY c.ACCOUNT_ID, c.ACCOUNT_NAME
      ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC
      LIMIT 1
    `;

    const result = await this.snowflakeService.execute<RawEmployerMembershipRow>(query, [employerName]);
    return result.rows[0] ?? null;
  }
}
