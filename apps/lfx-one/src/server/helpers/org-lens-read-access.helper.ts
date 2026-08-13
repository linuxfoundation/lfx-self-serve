// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';

const roleGrants = new OrgRoleGrantsService();

/**
 * Read gate for Org Lens analytics that expose organization-level aggregates.
 *
 * `:orgUid` is the analytics filter, never the authorization (ADR-0038) — authentication alone does
 * not establish that the caller may read *this* org's data, so the caller's grant is resolved
 * independently. Any resolved role qualifies: writer, direct auditor, and the auditor a cascading
 * parent grant confers on a child org are all read-equivalent here.
 *
 * Mirrors `OrgLensAccessService.assertCanManage` in separating "we checked and you don't have it"
 * (403) from "we couldn't check" (503): a transient query-service outage answering 403 would tell
 * users they lost access they still hold. Both directions fail closed, so the distinction is about
 * the accuracy of the signal, not about safety.
 *
 * Must run before any cache read or Snowflake query so an ungranted caller never reaches the data.
 */
export async function assertOrgLensRead(req: Request, orgUid: string, operation: string): Promise<void> {
  const forbidden = (): MicroserviceError =>
    new MicroserviceError('You do not have access to Org Lens data for this organization.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/query/resources',
    });

  const unavailable = (error?: unknown): MicroserviceError =>
    new MicroserviceError("Couldn't verify your access to this organization right now. Please try again.", 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/query/resources',
      originalError: error instanceof Error ? error : undefined,
    });

  const username = getEffectiveUsername(req);
  if (!username) {
    throw forbidden();
  }

  let hasGrant = false;
  let degraded = false;
  let isStaff = false;
  try {
    const { resolved, upstreamFailed, isStaff: staff } = await roleGrants.getAccessAwareOrgs(req, username);
    // `getAccessAwareOrgs` degrades to an empty grant map on upstream failure instead of throwing,
    // so an unverified lookup is indistinguishable from "no grants" unless this flag is checked.
    degraded = upstreamFailed;
    isStaff = staff;
    hasGrant = resolved.has(orgUid);
    if (degraded) {
      logger.warning(req, operation, 'Role-grants lookup degraded; cannot verify Org Lens read access', { org_uid: orgUid });
    }
  } catch (error) {
    logger.warning(req, operation, 'Role-grants lookup failed; cannot verify Org Lens read access', {
      org_uid: orgUid,
      err: error instanceof Error ? error.message : String(error),
    });
    throw unavailable(error);
  }

  // LF staff hold `auditor` on every b2b_org, so the per-org grant lookup is not the question for
  // them. Checked before the degraded branch because the two resolutions are independent upstream
  // calls: a roster outage must not withhold access the staff grant already established. Placing the
  // entitlement here rather than in each controller is what makes it uniform across every view that
  // gates through this helper.
  if (isStaff) {
    return;
  }

  // Thrown after the try, not inside it, so a deliberate 403/503 isn't caught above and re-mapped
  // to a generic "lookup failed" 503.
  if (degraded) {
    throw unavailable();
  }
  if (!hasGrant) {
    throw forbidden();
  }
}
