// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensEmployerAffiliation, WorkExperienceEntry } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

/** Guards the `IN` list: far above any real number of concurrent jobs, and bounded all the same. */
const MAX_CURRENT_EMPLOYERS = 10;

/** The same shape the query compares on, so a row can be matched back to the name that asked for it. */
function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

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
 * A caller may hold several current jobs; every one of them is checked, and `hasActiveMembership` is
 * true when any is a member, so a day job alongside a foundation role never reads as "not a member".
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
    const employerNames = OrgLensEmployerAffiliationService.currentEmployerNames(workExperiences);

    if (employerNames.length === 0) {
      return { employerName: null, accountId: null, hasActiveMembership: false };
    }

    const rows = await this.fetchEmployerMembershipRows(employerNames);
    const byName = new Map(rows.map((row) => [normalizeName(row.ACCOUNT_NAME), row]));
    // A member anywhere in the set settles it: the state exists for someone with no LF-member
    // employer at all, and a day job plus a foundation role is one person, not two answers.
    const member = rows.find((row) => row.ACTIVE_MEMBERSHIP_COUNT > 0) ?? null;
    const employerName = member ? member.ACCOUNT_NAME : employerNames[0];

    logger.debug(req, 'get_employer_affiliation', 'Resolved employer membership', {
      current_employer_count: employerNames.length,
      resolved_accounts: rows.length,
      has_member_employer: !!member,
    });

    return {
      employerName,
      accountId: (member ?? byName.get(normalizeName(employerName)))?.ACCOUNT_ID ?? null,
      hasActiveMembership: !!member,
    };
  }

  /**
   * Every employer the caller works for *now* — each entry with no end date, in profile order and
   * deduplicated. All of them, not the first: a day job alongside a foundation or board role is two
   * open-ended entries for one person, and checking only the first would tell someone their employer
   * is not a member while another current employer is.
   *
   * Deliberately not `currentEmployerFromWorkExperiences`, which falls back to the most recent ended
   * job: that fallback is right for pre-filling an invite dialog, and wrong here, where naming a
   * company someone has left is exactly the misleading copy this state exists to remove. Someone
   * between jobs has no current employer, so they keep the unchanged `no-organization` state.
   *
   * Capped so an unusual profile cannot widen the `IN` list without bound; the cap is far above any
   * real number of concurrent jobs.
   */
  private static currentEmployerNames(experiences: WorkExperienceEntry[]): string[] {
    const names = new Map<string, string>();
    for (const experience of experiences) {
      const name = experience.endDate ? '' : experience.organization?.trim();
      if (name && !names.has(normalizeName(name))) {
        names.set(normalizeName(name), name);
      }
    }
    return [...names.values()].slice(0, MAX_CURRENT_EMPLOYERS);
  }

  /**
   * The accounts these names resolve to, with each one's active-membership count. `ORDER BY` puts the
   * accounts that hold memberships first, so neither a duplicated company name nor a second current
   * employer can leave a member company behind a non-member row.
   */
  private async fetchEmployerMembershipRows(employerNames: string[]): Promise<RawEmployerMembershipRow[]> {
    const schema = resolveLfxOnePlatinumSchema();
    const placeholders = employerNames.map(() => 'UPPER(TRIM(?))').join(', ');
    const query = `
      SELECT
        c.ACCOUNT_ID AS ACCOUNT_ID,
        c.ACCOUNT_NAME AS ACCOUNT_NAME,
        COUNT(m.FOUNDATION_ID) AS ACTIVE_MEMBERSHIP_COUNT
      FROM ${schema}.ORG_LENS_ACCOUNT_CONTEXT c
      LEFT JOIN ${schema}.ORG_LENS_MEMBERSHIPS_SUMMARY m
        ON m.ACCOUNT_ID = c.ACCOUNT_ID
      WHERE UPPER(TRIM(c.ACCOUNT_NAME)) IN (${placeholders})
      GROUP BY c.ACCOUNT_ID, c.ACCOUNT_NAME
      ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC
    `;

    const result = await this.snowflakeService.execute<RawEmployerMembershipRow>(query, employerNames);
    return result.rows;
  }
}
