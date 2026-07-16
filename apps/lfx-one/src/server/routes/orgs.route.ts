// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { OrgIdentityController } from '../controllers/org-identity.controller';
import { OrgLensAccessController } from '../controllers/org-lens-access.controller';
import { OrgLensBoardCommitteeController } from '../controllers/org-lens-board-committee.controller';
import { OrgLensContributionsController } from '../controllers/org-lens-contributions.controller';
import { OrgLensDocumentsController } from '../controllers/org-lens-documents.controller';
import { OrgLensEventsController } from '../controllers/org-lens-events.controller';
import { OrgLensFoundationsController } from '../controllers/org-lens-foundations.controller';
import { OrgLensKeyContactsController } from '../controllers/org-lens-key-contacts.controller';
import { OrgLensMembershipsController } from '../controllers/org-lens-memberships.controller';
import { OrgLensPeopleController } from '../controllers/org-lens-people.controller';
import { OrgLensProjectDetailController } from '../controllers/org-lens-project-detail.controller';
import { OrgLensProjectsController } from '../controllers/org-lens-projects.controller';
import { OrgLensTrainingController } from '../controllers/org-lens-training.controller';

function buildOrgsRouter(): Router {
  const router = Router();
  const orgLensFoundationsController = new OrgLensFoundationsController();
  const orgLensEventsController = new OrgLensEventsController();
  const orgLensMembershipsController = new OrgLensMembershipsController();
  const orgLensBoardCommitteeController = new OrgLensBoardCommitteeController();
  const orgLensDocumentsController = new OrgLensDocumentsController();
  const orgLensPeopleController = new OrgLensPeopleController();
  const orgLensKeyContactsController = new OrgLensKeyContactsController();
  const orgLensAccessController = new OrgLensAccessController();
  const orgLensTrainingController = new OrgLensTrainingController();
  const orgLensContributionsController = new OrgLensContributionsController();
  const orgLensProjectsController = new OrgLensProjectsController();
  const orgLensProjectDetailController = new OrgLensProjectDetailController();
  const orgIdentityController = new OrgIdentityController();

  // Spec 020 — org-selector identity & role-grants endpoints.
  router.get('/me/role-grants', (req, res, next) => orgIdentityController.getRoleGrants(req, res, next));
  router.get('/uid/:uid', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));
  router.put('/uid/:uid', (req, res, next) => orgIdentityController.updateOrg(req, res, next));
  router.get('/uid/:uid/addresses', (req, res, next) => orgIdentityController.getOrgAddresses(req, res, next));

  // Spec 002: all org-lens routes key off the org account id (18-char SFID). The param is still named
  // `:orgUid` for backward compatibility; the value space is the SFID (validated by assertOrgUid).
  router.get('/:orgUid/lens/foundations-and-projects', (req, res, next) => orgLensFoundationsController.getFoundationsAndProjects(req, res, next));
  // Spec (LFXV2-1898) — Events page keys off the Salesforce accountId (not the b2b_org uuid), so these routes
  // intentionally use `:accountId`. /events is an exact path and won't capture /events/summary or the per-event
  // /attendees and /speakers paths, so ordering isn't strictly required; they're grouped here for readability.
  router.get('/:accountId/lens/events/summary', (req, res, next) => orgLensEventsController.getOrgEventsSummary(req, res, next));
  router.get('/:accountId/lens/events/:eventId/attendees', (req, res, next) => orgLensEventsController.getEventAttendees(req, res, next));
  router.get('/:accountId/lens/events/:eventId/speakers', (req, res, next) => orgLensEventsController.getEventSpeakers(req, res, next));
  router.get('/:accountId/lens/events', (req, res, next) => orgLensEventsController.getOrgEvents(req, res, next));
  router.get('/:orgUid/lens/memberships/active', (req, res, next) => orgLensMembershipsController.getActiveMemberships(req, res, next));
  router.get('/:orgUid/lens/memberships/expired', (req, res, next) => orgLensMembershipsController.getExpiredMemberships(req, res, next));
  router.get('/:orgUid/lens/memberships/discover', (req, res, next) => orgLensMembershipsController.getDiscoverOpportunities(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationSlug', (req, res, next) => orgLensMembershipsController.getMembershipDetail(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/seats', (req, res, next) => orgLensBoardCommitteeController.getSeats(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/voting-history', (req, res, next) => orgLensBoardCommitteeController.getVotingHistory(req, res, next));
  router.patch('/:orgUid/lens/memberships/:foundationId/committee-seats/:seatId/reassign', (req, res, next) =>
    orgLensBoardCommitteeController.reassignSeat(req, res, next)
  );
  // Spec 026 — org-wide people picker (key contacts + committee members) for the Reassign modal.
  router.get('/:orgUid/lens/employees', (req, res, next) => orgLensBoardCommitteeController.getEmployees(req, res, next));
  router.get('/:orgUid/lens/memberships/:foundationId/documents', (req, res, next) => orgLensDocumentsController.getMembershipDocuments(req, res, next));
  router.get('/:orgUid/lens/key-contacts/employees', (req, res, next) => orgLensKeyContactsController.getEmployees(req, res, next));
  router.post('/:orgUid/lens/memberships/:foundationId/key-contacts', (req, res, next) => orgLensKeyContactsController.addKeyContact(req, res, next));
  router.put('/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.replaceKeyContact(req, res, next)
  );
  router.delete('/:orgUid/lens/memberships/:foundationId/key-contacts/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.removeKeyContact(req, res, next)
  );
  // LFXV2-2067 — slug-keyed proxies for the People → Key Contacts tab; skip the sfid→foundation_id bridge.
  router.get('/:orgUid/lens/key-contacts/membership/:foundationSlug', (req, res, next) =>
    orgLensKeyContactsController.getKeyContactCatalogBySlug(req, res, next)
  );
  router.post('/:orgUid/lens/key-contacts/membership/:foundationSlug', (req, res, next) => orgLensKeyContactsController.addKeyContactBySlug(req, res, next));
  router.put('/:orgUid/lens/key-contacts/membership/:foundationSlug/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.replaceKeyContactBySlug(req, res, next)
  );
  router.delete('/:orgUid/lens/key-contacts/membership/:foundationSlug/:contactUid', (req, res, next) =>
    orgLensKeyContactsController.removeKeyContactBySlug(req, res, next)
  );
  router.get('/:orgUid/lens/people/all', (req, res, next) => orgLensPeopleController.getAllEmployees(req, res, next));
  // Spec 005 (LFXV2-1873) — People → Key Contacts tab (org-wide, read-only). Membership-scoped reads + writes live above on orgLensKeyContactsController.
  router.get('/:orgUid/lens/people/key-contacts', (req, res, next) => orgLensPeopleController.getKeyContacts(req, res, next));
  // Spec 027 — People → Committee tab (org-wide committee members). Registered BEFORE the `/:personKey/detail`
  // matcher below so 'committee-members' isn't consumed as a personKey.
  router.get('/:orgUid/lens/people/committee-members', (req, res, next) => orgLensPeopleController.getCommitteeMembers(req, res, next));
  router.patch('/:orgUid/lens/people/committee-members/:seatId/reassign', (req, res, next) => orgLensPeopleController.reassignCommitteeMember(req, res, next));
  // People → Board tab (org-wide Board-only members). Registered BEFORE the `/:personKey/detail`
  // matcher below so 'board-members' isn't consumed as a personKey.
  router.get('/:orgUid/lens/people/board-members', (req, res, next) => orgLensPeopleController.getBoardMembers(req, res, next));
  router.patch('/:orgUid/lens/people/board-members/:seatId/reassign', (req, res, next) => orgLensPeopleController.reassignBoardMember(req, res, next));
  // LFXV2-1876 — People → Trainees tab. Keep above the `/:personKey/detail` matcher so 'trainees' isn't consumed as a personKey.
  router.get('/:orgUid/lens/people/trainees', (req, res, next) => orgLensPeopleController.getTrainees(req, res, next));
  // LFXV2-1875 — People → Event Attendees tab. Same guard rationale as above ('event-attendees' must not be consumed as a personKey).
  router.get('/:orgUid/lens/people/event-attendees', (req, res, next) => orgLensPeopleController.getEventAttendees(req, res, next));
  // LFXV2-1874 — People → Contributors tab. Same guard rationale as above ('contributors' must not be consumed as a personKey).
  router.get('/:orgUid/lens/people/contributors', (req, res, next) => orgLensPeopleController.getContributors(req, res, next));
  router.get('/:orgUid/lens/people/:personKey/detail', (req, res, next) => orgLensPeopleController.getEmployeeDetail(req, res, next));

  // Spec 025 — People → Org Lens Access tab (list + manager-only role change / remove).
  router.get('/:orgUid/lens/access/users', (req, res, next) => orgLensAccessController.getUsers(req, res, next));
  router.post('/:orgUid/lens/access/users', (req, res, next) => orgLensAccessController.addUser(req, res, next));
  router.put('/:orgUid/lens/access/users/:email', (req, res, next) => orgLensAccessController.changeRole(req, res, next));
  router.delete('/:orgUid/lens/access/users/:email', (req, res, next) => orgLensAccessController.removeUser(req, res, next));

  // LFXV2-1895 — Org Lens Training & Certifications stat strip.
  router.get('/:orgUid/lens/training/stats', (req, res, next) => orgLensTrainingController.getTrainingStats(req, res, next));
  // LFXV2-1896 — Certifications tab table + drill-down rosters. The more-specific
  // :courseId/employees route MUST be registered before the list route so Express matches it first.
  router.get('/:orgUid/lens/training/certifications/:courseId/employees', (req, res, next) =>
    orgLensTrainingController.getCertificationEmployees(req, res, next)
  );
  router.get('/:orgUid/lens/training/certifications', (req, res, next) => orgLensTrainingController.getOrgCertifications(req, res, next));
  // LFXV2-1897 — Trainings tab table + drill-down rosters.
  router.get('/:orgUid/lens/training/trainings/:courseId/employees', (req, res, next) => orgLensTrainingController.getTrainingEmployees(req, res, next));
  router.get('/:orgUid/lens/training/trainings', (req, res, next) => orgLensTrainingController.getOrgTrainings(req, res, next));

  // LFXV2-1894 — Org Lens Code Contributions page (KPI strip + repositories table + commits feed).
  router.get('/:orgUid/lens/contributions', (req, res, next) => orgLensContributionsController.getContributions(req, res, next));

  // The literal /projects/search route MUST be registered before the /projects/:projectSlug matcher
  // below, so 'search' isn't consumed as a project slug.
  router.get('/:orgUid/lens/projects/search', (req, res, next) => orgLensProjectsController.searchProjects(req, res, next));
  router.get('/:orgUid/lens/projects', (req, res, next) => orgLensProjectsController.getProjects(req, res, next));
  // LFXV2-1885 — Org Lens Project Detail sub-page.
  router.get('/:orgUid/lens/projects/:projectSlug/hero', (req, res, next) => orgLensProjectDetailController.getHeroBlock(req, res, next));
  router.get('/:orgUid/lens/projects/:projectSlug/influence', (req, res, next) => orgLensProjectDetailController.getInfluenceBlock(req, res, next));
  router.get('/:orgUid/lens/projects/:projectSlug/trend', (req, res, next) => orgLensProjectDetailController.getTrendBlock(req, res, next));
  router.get('/:orgUid/lens/projects/:projectSlug/leaderboard/technical', (req, res, next) => orgLensProjectDetailController.getTechnicalBoard(req, res, next));
  router.get('/:orgUid/lens/projects/:projectSlug/leaderboard/ecosystem', (req, res, next) => orgLensProjectDetailController.getEcosystemBoard(req, res, next));
  // LFXV2-1885 DN9 — per-card drawer roster (server-side paginated), fetched lazily on drawer open.
  router.get('/:orgUid/lens/projects/:projectSlug/cards/:cardKey/roster', (req, res, next) => orgLensProjectDetailController.getCardRoster(req, res, next));
  router.get('/:orgUid/lens/projects/:projectSlug/cards/:cardKey', (req, res, next) => orgLensProjectDetailController.getCardDrawer(req, res, next));
  router.get('/:orgUid/lens/workspaces', (req, res, next) => orgLensProjectsController.getWorkspaces(req, res, next));
  router.post('/:orgUid/lens/workspaces', (req, res, next) => orgLensProjectsController.createWorkspace(req, res, next));
  router.put('/:orgUid/lens/workspaces/:workspaceId', (req, res, next) => orgLensProjectsController.renameWorkspace(req, res, next));
  router.delete('/:orgUid/lens/workspaces/:workspaceId', (req, res, next) => orgLensProjectsController.deleteWorkspace(req, res, next));
  router.post('/:orgUid/lens/workspaces/:workspaceId/projects', (req, res, next) => orgLensProjectsController.addProjectsToWorkspace(req, res, next));
  router.delete('/:orgUid/lens/workspaces/:workspaceId/projects/:slug', (req, res, next) =>
    orgLensProjectsController.removeProjectFromWorkspace(req, res, next)
  );

  // Must stay last so specific /uid and /:orgUid/lens routes match first.
  router.get('/:id', (req, res, next) => orgIdentityController.getCanonicalRecord(req, res, next));
  return router;
}

export default buildOrgsRouter();
