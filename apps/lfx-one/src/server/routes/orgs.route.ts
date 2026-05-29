// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgIdentityController } from '../controllers/org-identity.controller';
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
const orgIdentityController = new OrgIdentityController();

// Spec 020 — org-selector identity & role-grants endpoints. The role-grants and
// explicit uid/sfid routes MUST be registered BEFORE the polymorphic /:id route
// and BEFORE the legacy /:accountId/lens/* routes so Express path-to-regexp
// matches the more-specific shapes first.

// GET /api/orgs/me/role-grants
router.get('/me/role-grants', (req, res, next) => orgIdentityController.getRoleGrants(req, res, next));

// GET /api/orgs/uid/:uid — canonical record by b2b_org.uid
router.get('/uid/:uid', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));

// Spec 021 — PUT /api/orgs/uid/:uid — partial-update of org profile fields (FR-008, FR-016)
router.put('/uid/:uid', (req, res, next) => orgIdentityController.updateOrg(req, res, next));

// Spec 023 — GET /api/orgs/uid/:uid/addresses — primary + billing addresses (Snowflake-backed, fail-soft on lookup misses)
// Access: auth-gated, NOT org-membership-gated (deliberate — mirrors the canonical-record route; see getOrgAddresses doc).
router.get('/uid/:uid/addresses', (req, res, next) => orgIdentityController.getOrgAddresses(req, res, next));

// GET /api/orgs/sfid/:accountId — canonical record by legacy Salesforce account id
router.get('/sfid/:accountId', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));

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

// Spec 020 — polymorphic canonical-record route (UUID-detection inside controller).
// MUST be registered LAST so the more-specific /uid/:uid, /sfid/:accountId, and
// /:accountId/lens/* routes match first under Express path-to-regexp ordering.
// GET /api/orgs/:id
router.get('/:id', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));

export default router;
