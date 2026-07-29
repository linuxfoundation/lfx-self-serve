// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';

const accessCheckService = new AccessCheckService();

/**
 * Read gate for committee-scoped analytics that bypass the FGA-enforced committee-service proxy
 * every other committee route relies on (this endpoint reads Snowflake directly). `:uid` is the
 * analytics filter, never the authorization — mirrors `assertOrgLensRead`'s rationale — so the
 * caller's grant is resolved independently before any Snowflake query runs.
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` (not `checkSingleAccess`) because the latter
 * swallows upstream failures into `false`, making a transient access-check outage indistinguishable
 * from a genuine denial. Strict resolution preserves the 403 (confirmed no grant) vs 503 (couldn't
 * verify) split — both fail closed, the split is about signal accuracy, not safety.
 *
 * A nonexistent `committeeUid` also resolves to no `viewer` tuple, i.e. 403, same as a real
 * committee the caller can't see — deliberate, avoids a separate existence check.
 *
 * Must run before any cache read or Snowflake query so an ungranted caller never reaches the data.
 */
export async function assertCommitteeRead(req: Request, committeeUid: string, operation: string): Promise<void> {
  const forbidden = (): MicroserviceError =>
    new MicroserviceError('You do not have access to this committee.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
    });

  const unavailable = (error?: unknown): MicroserviceError =>
    new MicroserviceError("Couldn't verify your access to this committee right now. Please try again.", 503, 'ACCESS_CHECK_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
      originalError: error instanceof Error ? error : undefined,
    });

  let hasAccess: boolean;
  try {
    hasAccess = await accessCheckService.checkSingleAccessStrict(req, { resource: 'committee', id: committeeUid, access: 'viewer' });
  } catch (error) {
    logger.warning(req, operation, 'Access-check lookup failed; cannot verify committee read access', {
      committee_uid: committeeUid,
      err: error instanceof Error ? error.message : String(error),
    });
    throw unavailable(error);
  }

  if (!hasAccess) {
    throw forbidden();
  }
}
