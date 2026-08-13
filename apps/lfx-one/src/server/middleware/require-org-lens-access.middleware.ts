// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';

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
 * keep doing so — the check is idempotent and cheap (the grant lookup is cached per caller), and
 * defence in depth is worth more here than removing a duplicate call.
 */
export async function requireOrgLensAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await assertOrgLensRead(req, req.params['orgUid'] ?? '', 'require_org_lens_access');
    next();
  } catch (error) {
    next(error);
  }
}
