// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';

const roleGrants = new OrgRoleGrantsService();
const accessCheck = new AccessCheckService();

/**
 * Outcome of the Org Lens edit decision. `unverifiable` means an upstream could not answer, which
 * callers must keep distinct from `denied`: a transient outage is not a lost permission. `path` names
 * the failed upstream only when it is known.
 */
export type OrgLensEditDecision =
  | { kind: 'allowed' }
  | { kind: 'denied' }
  | { kind: 'unverifiable'; path?: '/query/resources' | '/access-check'; error?: unknown };

/**
 * #3136 — may the caller edit this organization? The write-side counterpart of `assertOrgLensRead`.
 *
 * Edits follow `writer` on the organization. The caller's own roster is consulted first (a direct or
 * roll-up-derived admin grant, LFXV2-3029); a caller the roster does not list is then asked of the
 * authorizer directly — `b2b_org:<uid>#writer` — so a company-wide writer team (`global_org_admin`)
 * resolves through the relation the platform defines rather than a BFF-side team list. `auditor`
 * never qualifies, so read-only company-wide teams (`lf-staff`) stay read-only.
 *
 * Decision order:
 *   1. roster lists the caller as an editor of this org   → allowed
 *   2. authorizer answered `true`                         → allowed
 *   3. authorizer threw                                   → unverifiable, `/access-check`
 *   4. roster threw                                       → unverifiable, `/query/resources`
 *   5. roster loaded but `degraded`                       → unverifiable (cause not attributable)
 *   6. otherwise                                          → denied
 *
 * Never throws; each caller maps the decision to its own contract (a 403/503 write gate, or a
 * fail-closed boolean for UX affordances).
 */
export async function resolveOrgLensEdit(req: Request, orgUid: string, operation: string): Promise<OrgLensEditDecision> {
  const username = getEffectiveUsername(req);
  if (!username) {
    return { kind: 'denied' };
  }

  let rosterError: unknown;
  let degraded = false;
  try {
    const grants = await roleGrants.getRoleGrants(req, username);
    if (OrgRoleGrantsService.hasEditorAccess(grants, orgUid)) {
      return { kind: 'allowed' };
    }
    degraded = grants.degraded;
  } catch (error) {
    // Recorded, not returned: the authorizer below may still confirm the caller.
    rosterError = error;
    logger.warning(req, operation, 'Role-grants lookup failed; asking the authorizer for Org Lens edit access', {
      org_uid: orgUid,
      err: error instanceof Error ? error.message : String(error),
    });
  }

  // Strict, so an authorizer outage is reported as unverifiable rather than read as "denied".
  const writer: { allowed: boolean } | { failed: unknown } = await accessCheck
    .checkSingleAccessStrict(req, { resource: 'b2b_org', id: orgUid, access: 'writer' })
    .then(
      (allowed) => ({ allowed }),
      (failed: unknown) => ({ failed })
    );
  if ('allowed' in writer && writer.allowed) {
    return { kind: 'allowed' };
  }
  if ('failed' in writer) {
    logger.warning(req, operation, 'Authorizer check failed; cannot verify Org Lens edit access', {
      org_uid: orgUid,
      err: writer.failed instanceof Error ? writer.failed.message : String(writer.failed),
    });
    return { kind: 'unverifiable', path: '/access-check', error: writer.failed };
  }

  if (rosterError !== undefined) {
    return { kind: 'unverifiable', path: '/query/resources', error: rosterError };
  }
  if (degraded) {
    // The authorizer said no, so this is a caller the roster may have under-resolved — not verifiable either way.
    logger.warning(req, operation, 'Role-grants lookup degraded; cannot rule out an inherited editor grant', { org_uid: orgUid });
    return { kind: 'unverifiable' };
  }
  return { kind: 'denied' };
}
