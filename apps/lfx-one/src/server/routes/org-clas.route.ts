// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { ConflictError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { requireOrgLensAccess } from '../middleware/require-org-lens-access.middleware';

const router = Router();
const orgClasController = new OrgClasController();

// Scoped to the CLA prefix, not the whole router, and mounted ahead of `orgsRouter` in server.ts.
// Both halves are load-bearing: this router shares the `/api/orgs` mount with `orgsRouter`, whose
// `router.use('/:orgUid/lens', requireOrgLensAccess)` matches the CLA path too. Mounted second, the
// grant lookup would run first and a disabled module would answer 403/503 instead of 409. Scoped
// broadly, mounting first would 409 every `/api/orgs` request. Children added under
// `cla-groups` inherit the gate; a future M3 path outside that prefix needs its own line here.
router.use('/:orgUid/lens/cla-groups', (_req, _res, next) => {
  if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensClaM3)) {
    return next(
      new ConflictError('Organization Lens EasyCLA is not enabled in this environment', 'FEATURE_DISABLED', {
        operation: 'org_lens_cla_module',
        service: 'org_cla_service',
      })
    );
  }
  return next();
});

router.get('/:orgUid/lens/cla-groups', requireOrgLensAccess, (req, res, next) => orgClasController.listClaGroups(req, res, next));

export default router;
