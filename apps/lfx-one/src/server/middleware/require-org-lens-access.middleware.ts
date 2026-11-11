// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_ROLL_UP_READ_METHODS } from '@lfx-one/shared/constants';
import { isOrgRollUpSegment } from '@lfx-one/shared/utils/org-lens-url.utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { resolveOrgLensRollUp } from '../helpers/org-lens-roll-up.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';

/**
 * Applies the Org Lens read gate to every `/api/orgs/:orgUid/lens/*` route.
 *
 * `assertOrgLensRead` already encodes the rule and its failure semantics; until now it was called
 * by three handlers (meetings, ROI, groups) and the rest of the family relied on the `:orgUid` in
 * the URL to scope the response. That identifier is supplied by the caller, so it filtered the data
 * without authorizing it, and any authenticated user could read any organization's roster.
 *
 * Mounting the gate on the shared prefix rather than repeating it per handler is the point: a new
 * lens endpoint is covered the moment it is added. The three handlers that already call the helper
 * keep doing so — the check is memoized per request, so the second call replays the first answer
 * without another upstream round-trip, and defence in depth is worth more here than removing a
 * duplicate call.
 */
export async function requireOrgLensAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgUid = req.params['orgUid'];
    if (isOrgRollUpSegment(orgUid)) {
      if (!ORG_LENS_ROLL_UP_READ_METHODS.has(req.method)) {
        throw ServiceValidationError.forField('orgUid', 'A family roll-up is read-only; choose a single organization to make changes', {
          operation: 'require_org_lens_access',
        });
      }
      await resolveOrgLensRollUp(req, orgUid, 'require_org_lens_access');
      next();
      return;
    }
    assertOrgUid(orgUid, 'require_org_lens_access');
    await assertOrgLensRead(req, orgUid, 'require_org_lens_access');
    next();
  } catch (error) {
    next(error);
  }
}
