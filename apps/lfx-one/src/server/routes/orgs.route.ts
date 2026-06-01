// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgIdentityController } from '../controllers/org-identity.controller';
import { OrgLensBoardCommitteeController } from '../controllers/org-lens-board-committee.controller';
import { OrgLensDocumentsController } from '../controllers/org-lens-documents.controller';
import { OrgLensFoundationsController } from '../controllers/org-lens-foundations.controller';
import { OrgLensKeyContactsController } from '../controllers/org-lens-key-contacts.controller';
import { OrgLensMembershipsController } from '../controllers/org-lens-memberships.controller';
import { OrgLensPeopleController } from '../controllers/org-lens-people.controller';

function buildOrgsRouter(): Router {
  const router = Router();
  const orgLensFoundationsController = new OrgLensFoundationsController();
  const orgLensMembershipsController = new OrgLensMembershipsController();
  const orgLensBoardCommitteeController = new OrgLensBoardCommitteeController();
  const orgLensDocumentsController = new OrgLensDocumentsController();
  const orgLensPeopleController = new OrgLensPeopleController();
  const orgLensKeyContactsController = new OrgLensKeyContactsController();
  const orgIdentityController = new OrgIdentityController();

  // Spec 020 — org-selector identity & role-grants endpoints.
  router.get('/me/role-grants', (req, res, next) => orgIdentityController.getRoleGrants(req, res, next));
  router.get('/uid/:uid', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));
  router.put('/uid/:uid', (req, res, next) => orgIdentityController.updateOrg(req, res, next));
  router.get('/uid/:uid/addresses', (req, res, next) => orgIdentityController.getOrgAddresses(req, res, next));

  // Spec 024 (uuid-only): all org-lens routes key off `:orgUid`.
  router.get('/:orgUid/lens/foundations-and-projects', (req, res, next) => orgLensFoundationsController.getFoundationsAndProjects(req, res, next));
  router.get('/:orgUid/lens/memberships/active', (req, res, next) => orgLensMembershipsController.getActiveMemberships(req, res, next));
  router.get('/:orgUid/lens/memberships/expired', (req, res, next) => orgLensMembershipsController.getExpiredMemberships(req, res, next));
  router.get('/:orgUid/lens/memberships/discover', (req, res, next) => orgLensMembershipsController.getDiscoverOpportunities(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationSlug', (req, res, next) => orgLensMembershipsController.getMembershipDetail(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/board-seats', (req, res, next) => orgLensBoardCommitteeController.getBoardSeats(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/committee-seats', (req, res, next) => orgLensBoardCommitteeController.getCommitteeSeats(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/voting-history', (req, res, next) => orgLensBoardCommitteeController.getVotingHistory(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/documents', (req, res, next) => orgLensDocumentsController.getMembershipDocuments(req, res, next));
  router.get('/:orgUid/lens/key-contacts/employees', (req, res, next) => orgLensKeyContactsController.getEmployees(req, res, next));
  router.post('/:orgUid/lens/memberships/:foundationId/key-contacts', (req, res, next) => orgLensKeyContactsController.addKeyContact(req, res, next));
  router.put('/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.replaceKeyContact(req, res, next)
  );
  router.delete('/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.removeKeyContact(req, res, next)
  );
  router.get('/:orgUid/lens/people/all', (req, res, next) => orgLensPeopleController.getAllEmployees(req, res, next));
  // Spec 005 (LFXV2-1873) — People → Key Contacts tab (org-wide, read-only). Membership-scoped reads + writes live above on orgLensKeyContactsController.
  router.get('/:orgUid/lens/people/key-contacts', (req, res, next) => orgLensPeopleController.getKeyContacts(req, res, next));
  router.get('/:orgUid/lens/people/:personKey/detail', (req, res, next) => orgLensPeopleController.getEmployeeDetail(req, res, next));

  // Must stay last so specific /uid and /:orgUid/lens routes match first.
  router.get('/:id', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));
  return router;
}

export default buildOrgsRouter();
