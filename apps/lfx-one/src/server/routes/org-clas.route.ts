// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import { requireOrgLensAccess } from '../middleware/require-org-lens-access.middleware';

const router = Router();
const orgClasController = new OrgClasController();

router.get('/:orgUid/lens/cla-groups', requireOrgLensAccess, (req, res, next) => orgClasController.listClaGroups(req, res, next));
router.get('/:orgUid/lens/cla-groups/:signatureId/pdf-url', requireOrgLensAccess, (req, res, next) => orgClasController.getPdfUrl(req, res, next));

router.get('/:orgUid/lens/cla-groups/:signatureId/managers', requireOrgLensAccess, (req, res, next) => orgClasController.listManagers(req, res, next));
router.post('/:orgUid/lens/cla-groups/:signatureId/managers', requireOrgLensAccess, blockDuringImpersonation, (req, res, next) =>
  orgClasController.addManager(req, res, next)
);
router.delete('/:orgUid/lens/cla-groups/:signatureId/managers/:lfUsername', requireOrgLensAccess, blockDuringImpersonation, (req, res, next) =>
  orgClasController.removeManager(req, res, next)
);

export default router;
