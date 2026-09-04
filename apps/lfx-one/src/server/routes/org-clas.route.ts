// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { ConflictError } from '../errors';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { requireOrgLensAccess } from '../middleware/require-org-lens-access.middleware';

const router = Router();
const orgClasController = new OrgClasController();

// Mounted on the router rather than the one route, so every M3 child added later inherits the
// kill switch. The client `org-lens-cla-m3-enabled` flag only hides the page; without this a
// direct call reaches the module with the dark launch still off.
router.use((_req, _res, next) => {
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
