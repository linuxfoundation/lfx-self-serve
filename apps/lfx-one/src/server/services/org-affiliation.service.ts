// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensAffiliationVerdict, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
// Deep import, never the `utils` barrel: that barrel statically pulls in `@angular/forms`, which
// throws at import time in a plain Node runtime (docs/architecture/shared/package-architecture.md, GH-2381).
import { currentEmployerFromWorkExperiences } from '@lfx-one/shared/utils/invitation.utils';
import type { Request } from 'express';

import { getEffectiveUsername } from '../utils/auth-helper';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';
import { OrganizationService } from './organization.service';

const OPERATION = 'get_org_role_grants';

/** Nothing established, and the question was not answerable — the client keeps today's copy. */
const UNKNOWN: OrgLensAffiliationVerdict = { hasEmployer: false, employerIsMember: false, lookup: 'failed' };

/** The caller has no employer on their work history; that is an answer, not an outage. */
const NO_EMPLOYER: OrgLensAffiliationVerdict = { hasEmployer: false, employerIsMember: false, lookup: 'ok' };

/**
 * #4225 — why a caller who holds no Org Lens grant holds none.
 *
 * An employee of a member company who was never granted access lands on the same "No organization
 * linked to your account" state as someone with no employer at all, and is told to add an
 * affiliation they already have — a fix that cannot work, because an affiliation has never produced
 * a grant. Telling the two apart needs one fact the client cannot read: whether the caller's own
 * employer is an LF member.
 *
 * Resolved here rather than inside the cached grant computation, exactly as the CLA-manager lookup
 * is (`OrgClaOnlyOrgsService.getRoleGrantClaManagerOrgs`), so the grant cache never holds an answer
 * from CDP or Snowflake and the grant arrays — the authoritative part — are unaffected by a failure
 * here. Grants nothing: the verdict only chooses wording.
 *
 * It asks upstream only when the caller demonstrably holds nothing and the roster answered cleanly,
 * so a caller with any grant costs neither the CDP call nor the Snowflake read.
 */
export class OrgAffiliationService {
  private readonly cdp: CdpService;
  private readonly organizations: OrganizationService;

  public constructor(cdp?: CdpService, organizations?: OrganizationService) {
    this.cdp = cdp ?? new CdpService();
    this.organizations = organizations ?? new OrganizationService();
  }

  /**
   * The affiliation verdict to merge onto `RoleGrantsResponse`, or nothing when the question does
   * not arise. Never throws: every failure is reported as `lookup: 'failed'`, which the client reads
   * as "unknown" and answers with the copy it shows today.
   *
   * Contractors are excluded because their own state (`contractor-no-grant`) already outranks this
   * one in the classifier, so resolving it for them would be work whose answer is never rendered.
   */
  public async getRoleGrantAffiliation(req: Request, grants: RoleGrantsResponse): Promise<Pick<RoleGrantsResponse, 'affiliation'>> {
    const grantedOrgCount = grants.writers.length + grants.auditors.length + grants.cascadingWriters.length + grants.cascadingAuditors.length;
    // A `partial` roster is a lower bound: zero grants there does not prove the caller holds none.
    const rosterAnswered = (grants.lookupOutcome ?? 'ok') === 'ok' && grants.staffCheck !== 'failed';
    if (!claOnlyEntryApplies(grants.isStaff, grantedOrgCount, rosterAnswered) || grants.isContractor === true) {
      return {};
    }

    const username = getEffectiveUsername(req);
    if (!username) {
      return { affiliation: UNKNOWN };
    }

    try {
      return { affiliation: await this.resolve(req, username) };
    } catch (error) {
      logger.warning(req, OPERATION, 'Affiliation lookup failed; reporting the employer verdict as unknown', {
        err: error instanceof Error ? error.message : String(error),
      });
      return { affiliation: UNKNOWN };
    }
  }

  /**
   * CDP work history names the employer; `ORG_LENS_ACCOUNT_CONTEXT` says whether the LF account
   * behind it is a member. The join is the crowd.dev organization id, which CDP returns as
   * `organizationId` and the warehouse holds as `CDEV_ORG_ID` — CDP is crowd.dev, so they are the
   * same identifier space.
   *
   * An employer with no crowd.dev id is unknowable here, not absent, so it answers `failed`: the
   * caller may well work for a member company this lookup simply cannot reach, and the two must not
   * be conflated. An employer whose id matches no row IS an answer — that organization has no LF
   * account, so it is not a member.
   */
  private async resolve(req: Request, username: string): Promise<OrgLensAffiliationVerdict> {
    const experiences = await this.cdp.getWorkExperiencesForUser(req, username);
    const employer = currentEmployerFromWorkExperiences(experiences);
    if (!employer) {
      return NO_EMPLOYER;
    }
    if (!employer.id) {
      logger.debug(req, OPERATION, 'Current employer has no CDP organization id; employer membership is unknown');
      return { hasEmployer: true, employerIsMember: false, lookup: 'failed' };
    }

    const account = await this.organizations.getOrgLensAccountContextByCdevOrgId(employer.id);
    return { hasEmployer: true, employerIsMember: account?.isMember === true, lookup: 'ok' };
  }
}
