// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AccessCheckAccessType } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';

const accessCheckService = new AccessCheckService();

/**
 * Shared implementation behind `assertCommitteeRead` (committee-read-access.helper.ts) and
 * `assertCommitteeWrite` (committee-write-access.helper.ts) — both gate a committee-scoped
 * request that would otherwise proxy through with no authorization of its own, differing only
 * in which FGA relation they check. See each caller's own docstring for why it checks the
 * relation it does; this module only holds the mechanics both share (CodeRabbit review: the
 * two gates duplicated identical forbidden/unavailable construction and try/catch handling).
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` (not `checkSingleAccess`) because the latter
 * swallows upstream failures into `false`, making a transient access-check outage
 * indistinguishable from a genuine denial. Strict resolution distinguishes a *thrown* upstream
 * failure (503) from a resolved `false` (403) — both fail closed, the split is about signal
 * accuracy, not safety. This is incomplete, not absolute: `performCheck` itself resolves `false`
 * (not a throw) when the access-check response omits the requested tuple entirely — e.g. a
 * truncated or malformed `results` array — so that case still surfaces here as a
 * confident-looking 403 rather than a 503, same as it would through `checkSingleAccess`.
 *
 * A nonexistent `committeeUid` also resolves to no tuple for the requested relation, i.e. 403,
 * same as a real committee the caller can't reach — deliberate, avoids a separate existence
 * check. This follows from how OpenFGA's Check API works: it evaluates a relationship graph and
 * answers `false` when no path exists, never requiring the object to be pre-registered, so an
 * unknown object ID is not a distinct error case upstream.
 *
 * Must run before any proxy call, cache read, or Snowflake query so an ungranted caller never
 * reaches the data or upstream service.
 */
export async function assertCommitteeAccess(
  req: Request,
  committeeUid: string,
  operation: string,
  access: AccessCheckAccessType,
  verb: 'read' | 'write'
): Promise<void> {
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
    hasAccess = await accessCheckService.checkSingleAccessStrict(req, { resource: 'committee', id: committeeUid, access });
  } catch (error) {
    logger.warning(req, operation, `Access-check lookup failed; cannot verify committee ${verb} access`, {
      committee_uid: committeeUid,
      err: error,
    });
    throw unavailable(error);
  }

  if (!hasAccess) {
    throw forbidden();
  }
}
