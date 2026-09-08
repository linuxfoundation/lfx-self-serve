// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import { requireOrgLensAccess } from '../middleware/require-org-lens-access.middleware';

const router = Router();
const orgClasController = new OrgClasController();

router.get('/:orgUid/lens/cla-groups', requireOrgLensAccess, (req, res, next) => orgClasController.listClaGroups(req, res, next));

// Corporate CLA signing hand-off (#1983). Declared ahead of the `:signatureId` routes below so
// the literal segments are not captured as a signature id.
//
// Picking the CLA Group is a read and stays available while impersonating. Opening the signing
// session is guarded, and for the plainest form of the reason the read-only rule exists: it
// creates a signature record and a DocuSign envelope against a company's legal position, with no
// caller identity in the payload — the signatory is whoever the token names, which under
// impersonation is the wrong person and cannot be corrected afterwards.
//
// No server-side environment gate on either route, including the write. The module's only gate is
// the LaunchDarkly `org-lens-cla-m3-enabled` flag, which hides the route and the nav but does not
// close the BFF; what protects these two is the Org Lens grant, and on the write the
// impersonation guard and the CLA service's own signing-authority check. An env gate here was
// removed deliberately for costing a GitOps round-trip per rollout while withholding nothing.
router.get('/:orgUid/lens/cla-groups/sign-options', requireOrgLensAccess, (req, res, next) => orgClasController.getSignOptions(req, res, next));
router.post('/:orgUid/lens/cla-groups/sign', requireOrgLensAccess, blockDuringImpersonation, (req, res, next) =>
  orgClasController.requestCorporateSignature(req, res, next)
);

router.get('/:orgUid/lens/cla-groups/:signatureId/pdf-url', requireOrgLensAccess, (req, res, next) => orgClasController.getPdfUrl(req, res, next));

export default router;
