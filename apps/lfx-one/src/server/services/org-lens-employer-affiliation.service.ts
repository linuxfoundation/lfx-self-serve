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

/**
 * Legal-form suffixes dropped before an employer name is compared to a Salesforce account name. A
 * profile says "Acme"; Salesforce says "Acme LLC". Without this, that member company misses its own
 * account and its employee is told their employer is not a member — the wrong copy, stated definitively.
 *
 * Only these, and only one of them, and only at the end: a trailing legal form is the one part of a
 * company name that is routinely written or omitted at will. Anything more aggressive starts merging
 * genuinely different companies, and a wrong *member* answer silently hides this state.
 */
const LEGAL_FORM_SUFFIXES = [
  'INC',
  'INCORPORATED',
  'LLC',
  'LLP',
  'LTD',
  'LIMITED',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'GMBH',
  'AG',
  'SA',
  'SAS',
  'SPA',
  'BV',
  'NV',
  'PLC',
  'PTY',
  'OY',
  'AB',
  'AS',
  'KK',
  'SRL',
  'SL',
];

/**
 * The shape both sides of the comparison are reduced to: upper-cased, punctuation dropped, one
 * trailing legal form removed, spaces squeezed out. `matchKeyExpression` is the SQL twin of this —
 * the two must stay in step, or a match silently fails and a member company reads as a non-member.
 */
function employerMatchKey(name: string): string {
  const words = name
    .toUpperCase()
    // Dots, commas, apostrophes and slashes join what they sit between, so "S.A." and the Nordic
    // "A/S" are each one word; every other separator splits it ("Acme-Corp" is two). This only
    // decides whether a trailing legal form is seen as its own word — the final step squeezes spaces
    // out either way — so a joiner is the safe choice: it can find a suffix a splitter would miss.
    .replace(/[.,'/]+/g, '')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .trim()
    .split(/ +/)
    .filter(Boolean);
  if (words.length > 1 && LEGAL_FORM_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join('');
}

/** The SQL twin of {@link employerMatchKey}, applied to an account-name column. */
function matchKeyExpression(column: string): string {
  const words = `REGEXP_REPLACE(REGEXP_REPLACE(UPPER(${column}), '[.,''/]+', ''), '[^A-Z0-9 ]+', ' ')`;
  return `REGEXP_REPLACE(REGEXP_REPLACE(TRIM(${words}), ' +(${LEGAL_FORM_SUFFIXES.join('|')})$', ''), ' +', '')`;
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
 * (LF member directories list it). No roster, no people, no membership detail, and no account id: the
 * matched account's identifier never leaves this service, since nothing renders it and self-declared
 * employment is not permission to learn it.
 *
 * A caller may hold several current jobs; every one of them is checked, and `hasActiveMembership` is
 * true when any is a member, so a day job alongside a foundation role never reads as "not a member".
 *
 * Resolution is by account name, because the only employer identifier a profile carries is a CDP
 * organization id and no platinum relation maps CDP org ids to Salesforce accounts
 * (`ACCOUNT_TO_CDEV_ORG_MAPPING` maps Crowd.dev org ids, which is a different identifier). Names are
 * compared on {@link employerMatchKey} rather than literally, so a trailing legal form written on one
 * side and not the other ("Acme" / "Acme LLC") still finds the account. A name that matches no account
 * at all answers `hasActiveMembership: false` — an employer with a membership always has a Salesforce
 * account — and where several accounts match, the one with memberships wins, so neither a duplicate
 * nor a second current employer can downgrade a member company to the non-member copy.
 *
 * The key is built from Latin letters and digits, so a name written entirely in another script
 * reduces to nothing and matches no account. That caller keeps their employer and is told it is not
 * a member — the same answer any unmatched name gets, and wrong in the same way for the same reason.
 *
 * TODO(#4314 follow-up): replace the name match with a domain/identifier resolution once member-service
 * exposes an org lookup the BFF can call for an arbitrary employer. That closes both this and the
 * script limitation above, which is why neither is worth a wider fuzzy match in the meantime.
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
      return { employerName: null, hasActiveMembership: false };
    }

    // A name with no Latin characters reduces to an empty key, which would match any account whose
    // own name is all punctuation. Such a name is kept as an affiliation but never asked about; the
    // caller is then told their employer is not a member, which is the same answer any unmatched
    // name gets. See the resolution note in this class's doc comment.
    const matchKeys = [...new Set(employerNames.map(employerMatchKey).filter(Boolean))];
    const rows = matchKeys.length > 0 ? await this.fetchEmployerMembershipRows(matchKeys) : [];
    // A member anywhere in the set settles it: the state exists for someone with no LF-member
    // employer at all, and a day job plus a foundation role is one person, not two answers.
    const member = rows.find((row) => row.ACTIVE_MEMBERSHIP_COUNT > 0) ?? null;
    // Always the caller's own spelling, never the account's: `employerName` is read back to them in
    // their own sentence, and a field that means the profile name on one answer and the Salesforce
    // name on another is a contract the next consumer cannot rely on. The member row is mapped back
    // through the key it was found by.
    const memberKey = member ? employerMatchKey(member.ACCOUNT_NAME) : null;
    const employerName = (memberKey && employerNames.find((name) => employerMatchKey(name) === memberKey)) || employerNames[0];

    logger.debug(req, 'get_employer_affiliation', 'Resolved employer membership', {
      current_employer_count: employerNames.length,
      resolved_accounts: rows.length,
      has_member_employer: !!member,
    });

    return {
      employerName,
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
      if (!name) {
        continue;
      }
      // Deduplicate on the match key where there is one, and on the name itself where there is not.
      // A name that reduces to an empty key — one written entirely in a non-Latin script — is still
      // an affiliation: dropping it here would answer `employerName: null` and send someone who does
      // have an employer back to the "add an affiliation" copy, the loop this state exists to end.
      const key = employerMatchKey(name) || name.toUpperCase();
      if (!names.has(key)) {
        names.set(key, name);
      }
    }
    return [...names.values()].slice(0, MAX_CURRENT_EMPLOYERS);
  }

  /**
   * The accounts these {@link employerMatchKey} keys resolve to, with each one's active-membership
   * count. The account side is reduced to the same key in SQL, so "Acme" finds "Acme LLC". `ORDER BY` puts the accounts
   * that hold memberships first, so neither a duplicated company name nor a second current employer
   * can leave a member company behind a non-member row.
   */
  private async fetchEmployerMembershipRows(matchKeys: string[]): Promise<RawEmployerMembershipRow[]> {
    const schema = resolveLfxOnePlatinumSchema();
    const placeholders = matchKeys.map(() => '?').join(', ');
    const query = `
      SELECT
        c.ACCOUNT_ID AS ACCOUNT_ID,
        c.ACCOUNT_NAME AS ACCOUNT_NAME,
        COUNT(m.FOUNDATION_ID) AS ACTIVE_MEMBERSHIP_COUNT
      FROM ${schema}.ORG_LENS_ACCOUNT_CONTEXT c
      LEFT JOIN ${schema}.ORG_LENS_MEMBERSHIPS_SUMMARY m
        ON m.ACCOUNT_ID = c.ACCOUNT_ID
      WHERE ${matchKeyExpression('c.ACCOUNT_NAME')} IN (${placeholders})
      GROUP BY c.ACCOUNT_ID, c.ACCOUNT_NAME
      ORDER BY ACTIVE_MEMBERSHIP_COUNT DESC
    `;

    const result = await this.snowflakeService.execute<RawEmployerMembershipRow>(query, matchKeys);
    return result.rows;
  }
}
