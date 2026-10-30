// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgClasController } from '../controllers/org-clas.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';
import { requireOrgLensClaAccess } from '../middleware/require-org-lens-cla-access.middleware';

// Every route below takes `requireOrgLensClaAccess`, not the lens-wide `requireOrgLensAccess`. The
// normal Org Lens read gate decides first; only when it refuses is the caller's own ACS
// `cla-manager` scope asked, and it admits only when that scope names this organization's company.
// So a CLA Manager without a `b2b_org` grant can run the EasyCLA tab and nothing else of the lens.
// "The CLA gate" below means this check. EasyCLA v4 still checks each action against ACS.
const router = Router();
const orgClasController = new OrgClasController();

router.get('/:orgUid/lens/cla-groups', requireOrgLensClaAccess, (req, res, next) => orgClasController.listClaGroups(req, res, next));

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
// session, the CLA gate on the organization, `blockDuringImpersonation` on the write, and
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
// stop a direct call. Only a deliberate caller who already passes the CLA gate can make that matter.
router.get('/:orgUid/lens/cla-groups/sign-options', requireOrgLensClaAccess, (req, res, next) => orgClasController.getSignOptions(req, res, next));
router.post('/:orgUid/lens/cla-groups/sign', requireOrgLensClaAccess, blockDuringImpersonation, (req, res, next) =>
  orgClasController.requestCorporateSignature(req, res, next)
);

// Visibility hop for Sign CLA, approval-list mutations (#1980), and manager writes (#1984). A
// read of ACS, so impersonation may call it — the UI uses the answer to withhold writes it already
// cannot perform. Declared ahead of `:signatureId` so `permissions` is not captured as a signature
// id. Not write middleware: the Sign, approval-list, and manager writes below keep the CLA gate
// plus the impersonation block.
router.post('/:orgUid/lens/cla-groups/permissions/checks', requireOrgLensClaAccess, (req, res, next) => orgClasController.checkPermission(req, res, next));

// Initial CLA Manager designee (#2780), for an agreement the organization has not signed. Both
// writes assign an ACS role and the nomination emails the named person, so an impersonated write
// would grant a role and send mail in the target's name; the impersonation block runs ahead of
// the CLA gate for the same reason as the manager writes below.
router.post('/:orgUid/lens/cla-groups/designee', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.assignDesignee(req, res, next)
);
router.post('/:orgUid/lens/cla-groups/designee/nominations', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.nominateDesignee(req, res, next)
);

router.get('/:orgUid/lens/cla-groups/:signatureId/pdf-url', requireOrgLensClaAccess, (req, res, next) => orgClasController.getPdfUrl(req, res, next));
router.get('/:orgUid/lens/cla-groups/:claGroupId/ccla-preview', requireOrgLensClaAccess, (req, res, next) => orgClasController.getCclaPreview(req, res, next));
router.get('/:orgUid/lens/cla-groups/:claGroupId/catalogue', requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.getClaGroupCatalogue(req, res, next)
);
router.get('/:orgUid/lens/cla-groups/:signatureId/approval-list', requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.getApprovalList(req, res, next)
);

// Contributor Acknowledgments (#1986). Read takes the CLA gate only, matching every other read
// on this router; the impersonated token is forwarded upstream so a support engineer sees what
// the target sees.
router.get('/:orgUid/lens/cla-groups/:signatureId/acknowledgments', requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.getContributorAcknowledgments(req, res, next)
);

// Activity log (#1987). Read takes the CLA gate only. Deliberately WIDER than the CLA-manager
// posture the write tabs use: an Org Lens reader who is not a CLA manager on this CCLA still
// reads the log (auditors, program leads). The producer's own `IsUserAuthorizedForOrganization`
// on this endpoint accepts an org-scoped caller for the same reason. The impersonated token is
// forwarded upstream so a support engineer sees what the target sees.
router.get('/:orgUid/lens/cla-groups/:signatureId/activity', requireOrgLensClaAccess, (req, res, next) => orgClasController.getActivityLog(req, res, next));

// The first write on this router (#1985), so it is the first to need `blockDuringImpersonation`.
// The reads above forward the impersonated identity to upstream deliberately; a write must not.
// Changing an approval list revokes acknowledgements and emails the affected contributors, and
// the producer records the acting user in the agreement's activity log — so an impersonated write
// would attribute a support engineer's action to the person being impersonated, in a legal audit
// trail, and send mail in their name. Ordered before the CLA gate so an impersonated caller is
// refused for impersonating rather than told they lack access they may well hold.
router.put('/:orgUid/lens/cla-groups/:signatureId/approval-list', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.updateApprovalList(req, res, next)
);

// Auto ECLA toggle (#1988). Same middleware order as the peer approval-list write above and for
// the same reason: a support engineer flipping this flag under an impersonated session would
// attribute a legally-recorded change to the person being impersonated, so the impersonation
// block runs ahead of the CLA gate. The producer's own sanctions and ACL gates run
// regardless, so a caller who somehow reached this path without them is still refused.
router.put('/:orgUid/lens/cla-groups/:signatureId/ecla-auto-create', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.updateEclaAutoCreate(req, res, next)
);

router.get('/:orgUid/lens/cla-groups/:signatureId/managers', requireOrgLensClaAccess, (req, res, next) => orgClasController.listManagers(req, res, next));
router.post('/:orgUid/lens/cla-groups/:signatureId/managers', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.addManager(req, res, next)
);
router.delete('/:orgUid/lens/cla-groups/:signatureId/managers/:lfUsername', blockDuringImpersonation, requireOrgLensClaAccess, (req, res, next) =>
  orgClasController.removeManager(req, res, next)
);

// Invalidate one contributor acknowledgment (#2807). Same middleware order as the approval-list
// write above, and for the same reason: the producer stamps the acting user on the invalidated
// signature as `invalidatedBy`, so an impersonated write would record a support engineer's action
// against the person being impersonated, permanently, on a legal audit trail. Ordered before the
// CLA gate so an impersonated caller is refused for impersonating rather than told they lack
// access they may well hold.
router.post(
  '/:orgUid/lens/cla-groups/:signatureId/acknowledgments/:acknowledgmentSignatureId/invalidate',
  blockDuringImpersonation,
  requireOrgLensClaAccess,
  (req, res, next) => orgClasController.invalidateAcknowledgment(req, res, next)
);

export default router;
