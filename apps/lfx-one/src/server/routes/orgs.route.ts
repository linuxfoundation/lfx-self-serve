// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgLensBoardCommitteeController } from '../controllers/org-lens-board-committee.controller';
import { OrgLensDocumentsController } from '../controllers/org-lens-documents.controller';
import { OrgLensFoundationsController } from '../controllers/org-lens-foundations.controller';
import { OrgLensMembershipsController } from '../controllers/org-lens-memberships.controller';
import { OrgLensPeopleController } from '../controllers/org-lens-people.controller';

const router = Router();

const orgLensFoundationsController = new OrgLensFoundationsController();
const orgLensMembershipsController = new OrgLensMembershipsController();
const orgLensBoardCommitteeController = new OrgLensBoardCommitteeController();
const orgLensDocumentsController = new OrgLensDocumentsController();
const orgLensPeopleController = new OrgLensPeopleController();

// GET /api/orgs/:accountId/lens/foundations-and-projects
router.get('/:accountId/lens/foundations-and-projects', (req, res, next) => orgLensFoundationsController.getFoundationsAndProjects(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/active
router.get('/:accountId/lens/memberships/active', (req, res, next) => orgLensMembershipsController.getActiveMemberships(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/expired
router.get('/:accountId/lens/memberships/expired', (req, res, next) => orgLensMembershipsController.getExpiredMemberships(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/discover
router.get('/:accountId/lens/memberships/discover', (req, res, next) => orgLensMembershipsController.getDiscoverOpportunities(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/:foundationId
// MUST be registered AFTER the more-specific /active /expired /discover routes so they match first (Express ordering)
router.get('/:accountId/lens/memberships/:foundationId', (req, res, next) => orgLensMembershipsController.getMembershipDetail(req, res, next));

// Spec 016 — Board & Committee tab: three new dedicated SSR endpoints (FR-009).
// These have one more path segment than the catch-all above, so Express's path-to-regexp
// routes them correctly regardless of order; registering here for readability.
// GET /api/orgs/:accountId/lens/memberships/:foundationId/board-seats
router.get('/:accountId/lens/memberships/:foundationId/board-seats', (req, res, next) => orgLensBoardCommitteeController.getBoardSeats(req, res, next));
// GET /api/orgs/:accountId/lens/memberships/:foundationId/committee-seats
router.get('/:accountId/lens/memberships/:foundationId/committee-seats', (req, res, next) => orgLensBoardCommitteeController.getCommitteeSeats(req, res, next));
// GET /api/orgs/:accountId/lens/memberships/:foundationId/voting-history
router.get('/:accountId/lens/memberships/:foundationId/voting-history', (req, res, next) => orgLensBoardCommitteeController.getVotingHistory(req, res, next));

// GET /api/orgs/:accountId/lens/memberships/:foundationId/documents
router.get('/:accountId/lens/memberships/:foundationId/documents', (req, res, next) => orgLensDocumentsController.getMembershipDocuments(req, res, next));

// GET /api/orgs/:accountId/lens/people/all
router.get('/:accountId/lens/people/all', (req, res, next) => orgLensPeopleController.getAllEmployees(req, res, next));
// GET /api/orgs/:accountId/lens/people/:personKey/detail
router.get('/:accountId/lens/people/:personKey/detail', (req, res, next) => orgLensPeopleController.getEmployeeDetail(req, res, next));

export default router;
