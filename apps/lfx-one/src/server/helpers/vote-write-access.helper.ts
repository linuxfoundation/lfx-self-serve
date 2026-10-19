// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';

const accessCheckService = new AccessCheckService();

/**
 * Write gate for vote-manager reads and actions that would otherwise proxy through with no
 * authorization of their own (e.g. the reminder-recipients list, #3769).
 *
 * Checks `vote#writer` (`writer_guard from project or writer from committee` in the platform FGA
 * model, `charts/lfx-platform/files/model.fga` in `lfx-v2-helm`) — the relation tagged
 * `Extend a vote & resend notifications`, and the one the gateway enforces on `bulk_resend`.
 * Indexed `vote_response` rows are readable by every vote `auditor`, which is broader than
 * `writer`, so the query-service grant alone is not a manager check.
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` for the same reason `assertCommitteeAccess`
 * (committee-access.internal.helper.ts) does: a resolved `false` is a 403, a thrown upstream
 * failure is a 503. A nonexistent `voteUid` resolves to no tuple, i.e. 403.
 *
 * Must run before any proxy call so an ungranted caller never reaches the data.
 */
export async function assertVoteWrite(req: Request, voteUid: string, operation: string): Promise<void> {
  let hasAccess: boolean;
  try {
    hasAccess = await accessCheckService.checkSingleAccessStrict(req, { resource: 'vote', id: voteUid, access: 'writer' });
  } catch (error) {
    logger.warning(req, operation, 'Access-check lookup failed; cannot verify vote write access', {
      vote_uid: voteUid,
      err: error,
    });
    throw new MicroserviceError("Couldn't verify your access to this vote right now. Please try again.", 503, 'ACCESS_CHECK_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
      originalError: error instanceof Error ? error : undefined,
    });
  }

  if (!hasAccess) {
    throw new MicroserviceError('You do not have access to manage this vote.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
    });
  }
}
