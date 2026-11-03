// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';

const accessCheckService = new AccessCheckService();

/**
 * Whether the caller holds `vote#writer` (`writer_guard from project or writer from committee` in the platform FGA
 * model, `charts/lfx-platform/files/model.fga` in `lfx-v2-helm`) — the relation tagged
 * `Extend a vote & resend notifications`, and the one the gateway enforces on `bulk_resend`.
 * Indexed `vote_response` rows are readable by every vote `auditor`, which is broader than
 * `writer`, so the query-service grant alone is not a manager check.
 *
 * Uses `AccessCheckService.checkSingleAccessStrict` for the same reason `assertCommitteeAccess`
 * (committee-access.internal.helper.ts) does: a resolved `false` means "not a writer", while a thrown
 * upstream failure is a 503 rather than a silent downgrade. A nonexistent `voteUid` resolves to no tuple, i.e. `false`.
 *
 * Routes that serve both managers and voters (e.g. `GET /votes/:uid/results`, #4330) use this to
 * pick the manager or voter behaviour; manager-only routes use {@link assertVoteWrite}.
 */
export async function hasVoteWrite(req: Request, voteUid: string, operation: string): Promise<boolean> {
  try {
    return await accessCheckService.checkSingleAccessStrict(req, { resource: 'vote', id: voteUid, access: 'writer' });
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
}

/**
 * Write gate for vote-manager reads and actions that would otherwise proxy through with no
 * authorization of their own (e.g. the reminder-recipients list, #3769).
 *
 * Built on {@link hasVoteWrite}: a non-writer is a 403, a failed lookup is a 503.
 *
 * Must run before any proxy call so an ungranted caller never reaches the data.
 */
export async function assertVoteWrite(req: Request, voteUid: string, operation: string): Promise<void> {
  const hasAccess = await hasVoteWrite(req, voteUid, operation);

  if (!hasAccess) {
    throw new MicroserviceError('You do not have access to manage this vote.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
      path: '/access-check',
    });
  }
}
