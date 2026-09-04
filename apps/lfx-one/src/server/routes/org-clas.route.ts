// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { requireOrgLensAccess } from '../middleware/require-org-lens-access.middleware';

const router = Router();
const orgClasController = new OrgClasController();

router.get('/:orgUid/lens/cla-groups', requireOrgLensAccess, (req, res, next) => orgClasController.listClaGroups(req, res, next));

export default router;
