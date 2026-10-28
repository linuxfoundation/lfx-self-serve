// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { B2B_ORG_CLA_ADMIN_RELATION } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';

const OPERATION = 'check_org_cla_admin';

/**
 * #3793 — whether the authorizer grants the caller `b2b_org:<uid>#cla_admin` on one organization:
 * a CLA Manager's direct grant on their own company, which opens the EasyCLA section only. Asked for
 * exactly the organization in the request; the relation does not cascade, so no parent, sibling or
 * child is ever asked on its behalf.
 *
 * Answers `false` when the check fails or does not resolve. While the ACS `cla-manager` scopes remain
 * a qualification (`OrgClaManagerScopesService`), they decide that caller's outcome, so a failure here
 * must not turn into an outage. `AccessCheckService` has already logged the failure at error, so this
 * adds only a debug line. The relation must be deployed before this ships: without it every check
 * fails, and every one of those failures is logged as an error. Once the scopes are removed this
 * failure has to become a 503 instead.
 *
 * Memoized per request and organization, so the route gate and the address resolver share one check.
 */
export class OrgClaAdminService {
  private static readonly byRequest = new WeakMap<Request, Map<string, Promise<boolean>>>();

  private readonly accessCheck: AccessCheckService;

  public constructor(accessCheck?: AccessCheckService) {
    this.accessCheck = accessCheck ?? new AccessCheckService();
  }

  public holds(req: Request, orgUid: string): Promise<boolean> {
    let byOrg = OrgClaAdminService.byRequest.get(req);
    if (!byOrg) {
      byOrg = new Map();
      OrgClaAdminService.byRequest.set(req, byOrg);
    }
    let pending = byOrg.get(orgUid);
    if (!pending) {
      pending = this.check(req, orgUid);
      byOrg.set(orgUid, pending);
    }
    return pending;
  }

  private async check(req: Request, orgUid: string): Promise<boolean> {
    try {
      return await this.accessCheck.checkSingleAccessStrict(req, { resource: 'b2b_org', id: orgUid, access: B2B_ORG_CLA_ADMIN_RELATION });
    } catch (error) {
      logger.debug(req, OPERATION, 'cla_admin check did not resolve; leaving the decision to the CLA manager scopes', {
        org_uid: orgUid,
        err: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
