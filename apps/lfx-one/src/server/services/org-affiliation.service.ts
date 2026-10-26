// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ORG_AFFILIATION_EMPLOYER_MEMBERSHIP_UNKNOWN,
  ORG_AFFILIATION_LOOKUP_TIMEOUT_MS,
  ORG_AFFILIATION_NO_EMPLOYER,
  ORG_AFFILIATION_OPERATION,
  ORG_AFFILIATION_UNKNOWN,
} from '@lfx-one/shared/constants';
import type { OrgLensAffiliationVerdict, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
// Deep import, never the `utils` barrel: that barrel statically pulls in `@angular/forms`, which
// throws at import time in a plain Node runtime (docs/architecture/shared/package-architecture.md, GH-2381).
import { currentEmployerFromWorkExperiences } from '@lfx-one/shared/utils/invitation.utils';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { getEffectiveUsername } from '../utils/auth-helper';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';
import { claOnlyEntryApplies } from './org-cla-only-orgs.service';
import { OrganizationService } from './organization.service';

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
      return { affiliation: ORG_AFFILIATION_UNKNOWN };
    }

    try {
      return { affiliation: await this.withDeadline(this.resolve(req, username)) };
    } catch (error) {
      // `err: error`, not `error.message`: the serializer keeps the type, status/code and stack that
      // timeout-vs-CDP-vs-warehouse triage depends on (docs/architecture/backend/logging-monitoring.md).
      logger.warning(req, ORG_AFFILIATION_OPERATION, 'Affiliation lookup failed; reporting the employer verdict as unknown', { err: error });
      return { affiliation: ORG_AFFILIATION_UNKNOWN };
    }
  }

  /**
   * Caps the whole lookup at {@link ORG_AFFILIATION_LOOKUP_TIMEOUT_MS}, following
   * `OrganizationService.withCdpTimeout`.
   *
   * This enrichment is optional — it only picks between two empty-state wordings — but it rides the
   * page-blocking role-grants request, so without a deadline a slow CDP or warehouse would hold the
   * Org Lens page on its skeleton for every grant-less caller, and for CLA-only callers whose page
   * never reads the verdict. Expiry is reported as the ordinary unknown verdict by the caller's
   * catch, so the timeout degrades to today's copy rather than to an error.
   *
   * The underlying request is not cancelled; it is simply no longer waited on.
   */
  private withDeadline(lookup: Promise<OrgLensAffiliationVerdict>): Promise<OrgLensAffiliationVerdict> {
    return new Promise<OrgLensAffiliationVerdict>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new MicroserviceError(`Affiliation lookup exceeded ${ORG_AFFILIATION_LOOKUP_TIMEOUT_MS}ms budget`, 504, 'AFFILIATION_LOOKUP_TIMEOUT', {
              operation: ORG_AFFILIATION_OPERATION,
              service: 'org_affiliation_service',
            })
          ),
        ORG_AFFILIATION_LOOKUP_TIMEOUT_MS
      );
      lookup.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(
            error instanceof Error
              ? error
              : new MicroserviceError(`Affiliation lookup rejected: ${String(error)}`, 500, 'AFFILIATION_LOOKUP_FAILED', {
                  operation: ORG_AFFILIATION_OPERATION,
                  service: 'org_affiliation_service',
                })
          );
        }
      );
    });
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
    const experiences = await this.cdp.getWorkExperiencesForKnownUser(req, username);
    // Only ongoing employment counts. `currentEmployerFromWorkExperiences` falls back to the most
    // recent *past* job when every entry has an end date — right for the invitation flow it was
    // written for, wrong here: this copy tells the reader to ask an administrator at the company,
    // which is no help to someone who left it. A caller with only former employers holds no
    // affiliation for our purposes and keeps the unchanged copy.
    const employer = currentEmployerFromWorkExperiences(experiences.filter((entry) => !entry.endDate));
    if (!employer) {
      return ORG_AFFILIATION_NO_EMPLOYER;
    }
    if (!employer.id) {
      logger.debug(req, ORG_AFFILIATION_OPERATION, 'Current employer has no CDP organization id; employer membership is unknown');
      return ORG_AFFILIATION_EMPLOYER_MEMBERSHIP_UNKNOWN;
    }

    try {
      const account = await this.organizations.getOrgLensAccountContextByCdevOrgId(employer.id);
      return { hasEmployer: true, employerIsMember: account?.isMember === true, lookup: 'ok' };
    } catch (error) {
      // The employer is already known, so report that much: `ORG_AFFILIATION_UNKNOWN` would log `hasEmployer: false`
      // for a caller whose employer we had in hand, which misreads as "no affiliation" during triage.
      logger.warning(req, ORG_AFFILIATION_OPERATION, 'Employer membership lookup failed; reporting membership as unknown', { err: error });
      return ORG_AFFILIATION_EMPLOYER_MEMBERSHIP_UNKNOWN;
    }
  }
}
