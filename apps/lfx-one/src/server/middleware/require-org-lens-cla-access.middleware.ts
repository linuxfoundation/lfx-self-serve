// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';

import { assertOrgLensClaRead } from '../helpers/org-lens-cla-access.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';

/**
 * The read gate for the Org Lens EasyCLA routes (`org-clas.route.ts`): `requireOrgLensAccess`'s
 * rule, widened to a CLA Manager on this organization's company (see `assertOrgLensClaRead`).
 *
 * Mounted only on that router, which `server.ts` mounts ahead of `orgsRouter` so its routes answer
 * before the shared `/:orgUid/lens` guard runs. A path this router does not own still falls through
 * to that guard, so the widening reaches no other lens route.
 */
export async function requireOrgLensClaAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const orgUid = req.params['orgUid'];
    assertOrgUid(orgUid, 'require_org_lens_cla_access');
    await assertOrgLensClaRead(req, orgUid, 'require_org_lens_cla_access');
    next();
  } catch (error) {
    next(error);
  }
}
