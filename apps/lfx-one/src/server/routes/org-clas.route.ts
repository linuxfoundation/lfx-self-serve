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
// Neither route carries a server-side environment gate, including the write, and the LaunchDarkly
// `org-lens-cla-m3-enabled` flag is not one either: it is an Angular `canMatch` guard, so it hides
// the route and the nav in the browser and leaves the BFF mounted. These two are protected by the
// session, the Org Lens grant on the organization, `blockDuringImpersonation` on the write, and
// the CLA service's own signing-authority and trade-compliance checks.
//
// A server-side flag check on the write was considered when this landed and deliberately not
// added. It is not an authorization boundary: the same corporate signature can be requested by the
// same caller through the ACS-authorized EasyCLA v4 API and through the Corporate CLA Console, so
// a check here withholds no capability — and it would cost a GitOps round-trip and a pod roll per
// rollout, which is why the env gate was removed with the detail page in the first place.
//
// The consequence to know, because it is operational rather than theoretical: the flag is not a
// complete kill switch for this path. Turning it off stops the UI reaching the route; it does not
// stop a direct call. Only a deliberate caller who already holds the grant can make that matter.
router.get('/:orgUid/lens/cla-groups/sign-options', requireOrgLensAccess, (req, res, next) => orgClasController.getSignOptions(req, res, next));
router.post('/:orgUid/lens/cla-groups/sign', requireOrgLensAccess, blockDuringImpersonation, (req, res, next) =>
  orgClasController.requestCorporateSignature(req, res, next)
);

router.get('/:orgUid/lens/cla-groups/:signatureId/pdf-url', requireOrgLensAccess, (req, res, next) => orgClasController.getPdfUrl(req, res, next));

export default router;
