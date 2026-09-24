// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE, ORG_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { assertOrgLensRead } from './org-lens-read-access.helper';

const accessCheck = new AccessCheckService();
const roleGrants = new OrgRoleGrantsService();

/**
 * Read gate for org-scoped Snowflake analytics keyed by a caller-supplied account id.
 *
 * The analytics lane reads `ANALYTICS.PLATINUM_LFX_ONE.*` with the BFF's own credentials, so the
 * account id only filters rows — it never authorizes them (ADR-0038). The caller must hold read
 * permission on that organization: `assertOrgLensRead`, the same gate as every Org Lens read (org
 * grant, inherited grant, or `b2b_org#auditor`, which covers key-contact promotion and LF team
 * membership). Personas never grant access here — they shape presentation only.
 *
 * Only the canonical 18-char SFID is accepted (`ORG_ACCOUNT_ID_PATTERN`, 400 on the `accountId`
 * field otherwise), so the id authorized here is byte-for-byte the id the handler queries.
 * Failure semantics are `assertOrgLensRead`'s: 403 when the caller has no access, 503 when it
 * could not be verified.
 */
export async function assertOrgAnalyticsRead(req: Request, accountId: string, operation: string): Promise<void> {
  if (!ORG_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw ServiceValidationError.forField('accountId', 'Invalid organization account id format', { operation });
  }

  await assertOrgLensRead(req, accountId, operation);
}

/**
 * The subset of `accountIds` the caller may read, in request order — the batch form of
 * `assertOrgLensRead`, with the same two independent sources of access:
 *
 * 1. The caller's grant roster (`getAccessAwareOrgs`, cached per caller). A resolved entry is
 *    authoritative on its own, even when the roll-up is `degraded`.
 * 2. `b2b_org#auditor` from the authorizer for every id the roster did not resolve (LF team,
 *    cascade, key-contact promotion), asked in ONE batched strict call so a caller cannot turn the
 *    batch into one upstream round-trip per id.
 *
 * Non-canonical ids are dropped. An authorizer failure, or an id neither source admits while the
 * roster could not be fully loaded, fails the whole call closed (503) — never a silent "no access".
 */
export async function filterReadableAccountIds(req: Request, accountIds: string[], operation: string): Promise<string[]> {
  const canonical = accountIds.filter((accountId) => ORG_ACCOUNT_ID_PATTERN.test(accountId));
  const username = getEffectiveUsername(req);
  if (canonical.length === 0 || !username) {
    return [];
  }

  const unavailable = (path?: string, error?: unknown): MicroserviceError =>
    new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      ...(path ? { path } : {}),
      originalError: error instanceof Error ? error : undefined,
    });

  const readable = new Set<string>();
  // True when the roster gave no trustworthy signal (failed) or only a lower bound (degraded).
  let rosterUnverified = false;
  try {
    const { resolved, upstreamFailed, degraded } = await roleGrants.getAccessAwareOrgs(req, username);
    rosterUnverified = upstreamFailed || degraded;
    if (!upstreamFailed) {
      for (const accountId of canonical) {
        if (resolved.has(accountId)) readable.add(accountId);
      }
    }
  } catch {
    rosterUnverified = true;
  }

  const remaining = canonical.filter((accountId) => !readable.has(accountId));
  if (remaining.length > 0) {
    let granted: Map<string, boolean>;
    try {
      granted = await accessCheck.checkAccessStrict(
        req,
        remaining.map((id) => ({ resource: 'b2b_org', id, access: 'auditor' }))
      );
    } catch (error) {
      throw unavailable('/access-check', error);
    }
    for (const accountId of remaining) {
      if (granted.get(`${accountId}#auditor`) === true) readable.add(accountId);
    }
  }

  // A denial is only verified when the roster loaded completely; otherwise it could be a grant we missed.
  if (rosterUnverified && readable.size < canonical.length) {
    throw unavailable('/query/resources');
  }

  return canonical.filter((accountId) => readable.has(accountId));
}
