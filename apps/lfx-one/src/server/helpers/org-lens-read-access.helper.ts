// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';

const roleGrants = new OrgRoleGrantsService();
const accessCheck = new AccessCheckService();

/**
 * How a caller cleared the gate. Both values mean "allowed" — the distinction matters only to
 * callers that share one resolved result across requesters (GH-1809).
 *
 * `org-grant` is a grant resolved on *this* org, matching the question the upstream check asks.
 * `auditor-entitlement` is the authorizer answering `b2b_org:<uid>#auditor` for a caller with no
 * roster grant here — LF team membership, a hierarchy cascade the roster did not surface, or a
 * key-contact promotion. Sharing a resolved result lets a caller be served without reaching
 * upstream, so upstream stops being the deciding authority for that request. Callers that share
 * must therefore serve the shared copy only on `org-grant`, keeping every other caller on the
 * direct path.
 */
export type OrgLensReadQualification = 'org-grant' | 'auditor-entitlement';

const qualificationByRequest = new WeakMap<Request, Map<string, Promise<OrgLensReadQualification>>>();

/**
 * Read gate for Org Lens analytics that expose organization-level aggregates.
 *
 * `:orgUid` is the analytics filter, never the authorization (ADR-0038) — authentication alone does
 * not establish that the caller may read *this* org's data, so the caller's grant is resolved
 * independently. Any resolved role qualifies: writer, direct auditor, and the auditor a cascading
 * parent grant confers on a child org are all read-equivalent here. A caller the roster does not
 * list is then asked of the authorizer directly — `b2b_org:<uid>#auditor` — so LF team membership,
 * the parent cascade and key-contact promotion all resolve through the one relation the platform
 * defines, instead of a BFF-side team list mirroring it (spec 044 / DR-001).
 *
 * Decision order. The roster is consulted first; the authorizer is asked only when the roster did
 * not resolve this org, since its answer cannot change an `org-grant` outcome:
 *   1. roster resolved this org and the roster loaded    → `org-grant`
 *   2. authorizer answered `true`                         → `auditor-entitlement`
 *   3. authorizer threw                                   → 503, path `/access-check`
 *   4. roster threw                                       → 503, path `/query/resources`
 *   5. roster loaded with `upstreamFailed` or `degraded`  → 503, path only when `upstreamFailed`
 *   6. otherwise                                          → 403
 * Neither upstream's failure short-circuits the other's answer: a roster outage must not withhold
 * access the authorizer already confirmed, and an authorizer outage must not 503 a caller the
 * roster lists. `path` on a 503 is claimed only for a known failed upstream — an incomplete
 * roll-up (`degraded`) collapses several causes, so naming one there misroutes outage telemetry.
 * The roster is cached per caller, so the sequencing costs the ungranted path one (usually
 * cached) roster read; issuing both speculatively would cost every granted read an uncached
 * authorizer round-trip whose answer is discarded.
 *
 * Mirrors `OrgLensAccessService.assertCanManage` in separating "we checked and you don't have it"
 * (403) from "we couldn't check" (503): a transient outage answering 403 would tell users they
 * lost access they still hold. Both directions fail closed.
 *
 * Memoized per request and org: the route middleware and a handler that also asserts both hit
 * the same promise, so one request performs one roster lookup and one authorizer call, and a
 * denial is replayed rather than re-queried.
 *
 * Must run before any cache read or Snowflake query so an ungranted caller never reaches the data.
 * Returns how the caller qualified; throwing is the only way this function denies.
 */
export async function assertOrgLensRead(req: Request, orgUid: string, operation: string): Promise<OrgLensReadQualification> {
  let byOrg = qualificationByRequest.get(req);
  if (!byOrg) {
    byOrg = new Map();
    qualificationByRequest.set(req, byOrg);
  }
  let qualification = byOrg.get(orgUid);
  if (!qualification) {
    qualification = resolveOrgLensRead(req, orgUid, operation);
    byOrg.set(orgUid, qualification);
  }
  return qualification;
}

async function resolveOrgLensRead(req: Request, orgUid: string, operation: string): Promise<OrgLensReadQualification> {
  const forbidden = (): MicroserviceError =>
    new MicroserviceError('You do not have access to Org Lens data for this organization.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
    });

  const unavailable = (error?: unknown, path?: string): MicroserviceError =>
    new MicroserviceError("Couldn't verify your access to this organization right now. Please try again.", 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      ...(path ? { path } : {}),
      originalError: error instanceof Error ? error : undefined,
    });

  const username = getEffectiveUsername(req);
  if (!username) {
    throw forbidden();
  }

  let hasGrant = false;
  // Nothing in the answer is trustworthy — the grant roster itself never loaded.
  let lookupFailed = false;
  let rosterError: unknown;
  // The answer is a trustworthy *lower bound* — direct grants loaded, but some inherited ones may
  // be missing. Deliberately kept separate from `lookupFailed`: they justify different decisions.
  let rollUpIncomplete = false;
  try {
    const { resolved, upstreamFailed, degraded } = await roleGrants.getAccessAwareOrgs(req, username);
    // `getAccessAwareOrgs` degrades to an empty/partial grant map instead of throwing, so an
    // unverified lookup is indistinguishable from "no grants" unless these flags are checked.
    lookupFailed = upstreamFailed;
    rollUpIncomplete = degraded;
    hasGrant = resolved.has(orgUid);
    if (lookupFailed || rollUpIncomplete) {
      logger.warning(req, operation, 'Role-grants lookup degraded; cannot verify Org Lens read access', { org_uid: orgUid });
    }
  } catch (error) {
    // Recorded, not thrown: the authorizer answer below may still admit the caller.
    lookupFailed = true;
    rosterError = error;
    logger.warning(req, operation, 'Role-grants lookup failed; cannot verify Org Lens read access', {
      org_uid: orgUid,
      err: error instanceof Error ? error.message : String(error),
    });
  }

  // A resolved entry is authoritative on its own: a direct grant comes from the caller's own
  // accepted settings row, and an inherited one was confirmed by the authorizer. `rollUpIncomplete`
  // says *other* organizations may be missing from the map, which must not veto one that is
  // present. `lookupFailed` still vetoes: there the map carries no signal at all.
  if (hasGrant && !lookupFailed) {
    return 'org-grant';
  }

  // Strict, so an authorizer outage is a retriable 503, never a silent `false` that reads as
  // "denied". Settled into a value so the failure branch below is a return, not a rethrow.
  const auditor: { allowed: boolean } | { failed: unknown } = await accessCheck
    .checkSingleAccessStrict(req, { resource: 'b2b_org', id: orgUid, access: 'auditor' })
    .then(
      (allowed) => ({ allowed }),
      (failed: unknown) => ({ failed })
    );
  if ('allowed' in auditor && auditor.allowed) {
    return 'auditor-entitlement';
  }
  if ('failed' in auditor) {
    logger.warning(req, operation, 'Authorizer check failed; cannot verify Org Lens read access', {
      org_uid: orgUid,
      err: auditor.failed instanceof Error ? auditor.failed.message : String(auditor.failed),
    });
    throw unavailable(auditor.failed, '/access-check');
  }

  if (rosterError !== undefined) {
    throw unavailable(rosterError, '/query/resources');
  }
  if (lookupFailed || rollUpIncomplete) {
    throw unavailable(undefined, lookupFailed ? '/query/resources' : undefined);
  }
  throw forbidden();
}
