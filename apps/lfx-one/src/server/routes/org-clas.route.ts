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
router.get('/:orgUid/lens/cla-groups/:signatureId/approval-list', requireOrgLensAccess, (req, res, next) => orgClasController.getApprovalList(req, res, next));

// The first write on this router (#1985), so it is the first to need `blockDuringImpersonation`.
// The reads above forward the impersonated identity to upstream deliberately; a write must not.
// Changing an approval list revokes acknowledgements and emails the affected contributors, and
// the producer records the acting user in the agreement's activity log — so an impersonated write
// would attribute a support engineer's action to the person being impersonated, in a legal audit
// trail, and send mail in their name. Ordered before the grant check so an impersonated caller is
// refused for impersonating rather than told they lack a grant they may well hold.
router.put('/:orgUid/lens/cla-groups/:signatureId/approval-list', blockDuringImpersonation, requireOrgLensAccess, (req, res, next) =>
  orgClasController.updateApprovalList(req, res, next)
);

export default router;
