// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_EMPLOYMENT,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  EMAIL_REGEX,
  ORG_EMPLOYMENT_OPTIONS,
  ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGES,
  ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE,
  PERSON_KEY_PATTERN,
} from '@lfx-one/shared/constants';
import type { OrgAllEmployeesResponse, OrgEmploymentFilter, OrgLensTimeRange, OrgProjectScope, ReassignCommitteeMemberBody } from '@lfx-one/shared/interfaces';
import {
  agreedUsername,
  isFilterSafeIdentifier,
  isFilterSafeUsername,
  isKeyContactRecordId,
  isOrgLensTimeRange,
  normalizeLegacyOrgLensTimeRange,
  parseOrgEmploymentFilter,
  parseOrgProjectScope,
} from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgLensRead } from '../helpers/org-lens-read-access.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { parseOptionalOrgCommitFilters, parseOrgCommitFilters, parseOrgScope, parseOrgTeamMembers } from '../helpers/org-commit-filters.helper';
import { parseOrgEventsFilters } from '../helpers/org-events-filters.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensPeopleService } from '../services/org-lens-people.service';
import { OrgPeopleBoardMembersService } from '../services/org-people-board-members.service';
import { OrgPeopleDirectoryService } from '../services/org-people-directory.service';
import { OrgPeopleCommitteeMembersService } from '../services/org-people-committee-members.service';
import { OrgPeopleContributorsService } from '../services/org-people-contributors.service';
import { OrgPeopleEventAttendeesService } from '../services/org-people-event-attendees.service';
import { OrgPeopleKeyContactsService } from '../services/org-people-key-contacts.service';
import { OrgPeopleTraineesService } from '../services/org-people-trainees.service';
import { withCompanyEmailStatus } from '../services/org-people-wire.mapper';

/** HTTP boundary for the OrgLensPeopleService — validation, lifecycle logging, error propagation. */
export class OrgLensPeopleController {
  private readonly service: OrgLensPeopleService;
  private readonly directoryService: OrgPeopleDirectoryService;
  private readonly keyContactsService: OrgPeopleKeyContactsService;
  private readonly traineesService: OrgPeopleTraineesService;
  private readonly eventAttendeesService: OrgPeopleEventAttendeesService;
  private readonly contributorsService: OrgPeopleContributorsService;
  private readonly committeeMembersService: OrgPeopleCommitteeMembersService;
  private readonly boardMembersService: OrgPeopleBoardMembersService;

  public constructor() {
    this.service = new OrgLensPeopleService();
    this.directoryService = new OrgPeopleDirectoryService();
    this.keyContactsService = new OrgPeopleKeyContactsService();
    this.traineesService = new OrgPeopleTraineesService();
    this.eventAttendeesService = new OrgPeopleEventAttendeesService();
    this.contributorsService = new OrgPeopleContributorsService();
    this.committeeMembersService = new OrgPeopleCommitteeMembersService();
    this.boardMembersService = new OrgPeopleBoardMembersService();
  }

  /** GET /api/orgs/:orgUid/lens/people/all[?live][&range=30d|90d|365d|730d|all][&projectScope][&commitScope][&metric][&teamMembers=include|exclude][&orgScope=insights|all] — `live` merges the stored Snowflake roster with live committee/key-contact/access sources, matching people on their verified LF username and on email only for records without one (key contacts always match on email); omitted ⇒ Snowflake-only. `range` windows the stored roster, and the commit filters scope it and pick the code count; omitted ⇒ the unranged roster (the reassign pickers' read, and any caller that predates the range), which the commit filters do not apply to. `teamMembers=exclude` (the default) removes CDP team members' code; people with other engagement stay listed (lfx-self-serve#4685). `orgScope=insights` (the default) counts only the Insights organization's code (lfx-self-serve-ops#1219); the unranged roster is not scoped. */
  public async getAllEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_all';
    const live = parseLiveFlag(req);

    try {
      assertOrgUid(orgUid, operation);
      // `null` (no range) is the unranged roster, not a default range.
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation);
      const filters = parseOrgCommitFilters(req, operation);
      const teamMembers = parseOrgTeamMembers(req, operation);
      const orgScope = parseOrgScope(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        live,
        time_range: range ?? 'roster',
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
        team_members: teamMembers,
        org_scope: orgScope,
      });

      // The summary behind the Event Attendees tile and the company-email keys do not depend on the roster, so the reads run together.
      const rosterRead = live
        ? this.directoryService.getLive(req, orgUid, range, filters, teamMembers, orgScope)
        : this.service.getAllEmployees(orgUid, range, filters, teamMembers, orgScope);
      const [roster, eventAttendeesTotal, companyEmailKeys] = await Promise.all([
        rosterRead,
        this.readEventAttendeesTotal(req, orgUid, range, filters.projectScope),
        this.service.getCompanyEmailKeys(req, orgUid),
      ]);
      const response = withCompanyEmailStatus(this.withEventAttendeesTotal(roster, eventAttendeesTotal), companyEmailKeys);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        live,
        time_range: range ?? 'roster',
        row_count: response.rows.length,
        foundation_count: response.foundations.length,
        active_in_oss: response.stats.activeInOss,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/former[?range=30d|90d|365d|730d|all][&projectScope][&commitScope][&metric][&teamMembers=include|exclude][&orgScope=insights|all] — the people off the current roster active at the account in the range and project scope (default: the Org Lens default range): former employees (`isFormer`, lfx-self-serve#4311) and people with code credited to the account but no employment row (`isUnclassified`, lfx-self-serve#4730). Never merged into the live directory. */
  public async getFormerEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_former';

    try {
      assertOrgUid(orgUid, operation);
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const filters = parseOrgCommitFilters(req, operation);
      const teamMembers = parseOrgTeamMembers(req, operation);
      const orgScope = parseOrgScope(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: range,
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
        team_members: teamMembers,
        org_scope: orgScope,
      });

      const [roster, companyEmailKeys] = await Promise.all([
        this.service.getFormerEmployees(orgUid, range, filters, teamMembers, orgScope),
        this.service.getCompanyEmailKeys(req, orgUid),
      ]);
      const response = withCompanyEmailStatus(roster, companyEmailKeys);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: range,
        row_count: response.rows.length,
        foundation_count: response.foundations.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/:personKey/detail[?range=30d|90d|365d|730d|all][&projectScope][&commitScope][&metric][&teamMembers][&orgScope] —
   * `range` is the window the Maintainer pills follow (default: the Org Lens default range). The commit filters are the calling page's (the
   * drawer's opener or the All Employees expanded row; lfx-self-serve#4404): with any of them the Code projects and total count that page's row in `range`; with none,
   * every commit of the trailing 12 months. With them, `teamMembers` (default exclude) is that page's pick: under
   * `exclude` a CDP team member's code view is empty (lfx-self-serve#4685), and `orgScope` (default insights) is that page's
   * organization scope (lfx-self-serve-ops#1219). With them, an unknown `teamMembers` or `orgScope` value is a 400;
   * without them both are ignored.
   */
  public async getEmployeeDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const personKey = req.params['personKey'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_detail', {
      org_uid: orgUid,
      person_key: personKey,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_detail');
      this.assertPersonKey(personKey, 'get_org_lens_people_detail');
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', 'get_org_lens_people_detail') ?? ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE;
      const codeFilters = parseOptionalOrgCommitFilters(req, 'get_org_lens_people_detail');
      // The opener's Team members pick rides with its code filters (lfx-self-serve#4685); a code-free open counts everyone.
      const teamMembers = codeFilters ? parseOrgTeamMembers(req, 'get_org_lens_people_detail') : 'include';
      // The organization scope rides with them too (lfx-self-serve-ops#1219); a code-free open counts every organization.
      const orgScope = codeFilters ? parseOrgScope(req, 'get_org_lens_people_detail') : 'all';

      const response = await this.service.getEmployeeDetail(req, orgUid, personKey, range, codeFilters, teamMembers, orgScope);

      logger.success(req, 'get_org_lens_people_detail', startTime, {
        org_uid: orgUid,
        person_key: personKey,
        board_seats: response.boardSeats.length,
        committee_seats: response.committeeSeats.length,
        code_rows: response.code.length,
        code_view: codeFilters !== null,
        event_rows: response.events.length,
        training_rows: response.training.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/:personKey/company-emails[?range=&projectScope=] — company-affiliated addresses
   * for a person key, served apart from `/detail` so the drawer renders activity without waiting on the slower address
   * read. `range` and `projectScope` name the live directory the drawer was opened from; a live-only person resolves
   * against it first. They only steer a cache read, so an invalid or partial pair is ignored rather than rejected.
   */
  public async getCompanyEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const personKey = req.params['personKey'];
    const operation = 'get_org_lens_people_company_emails';

    try {
      assertOrgUid(orgUid, operation);
      this.assertPersonKey(personKey, operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid, person_key: personKey });

      const range = getStringQueryParam(req, 'range');
      const projectScope = parseOrgProjectScope(getStringQueryParam(req, 'projectScope'));
      const directoryView = isOrgLensTimeRange(range) && projectScope ? { range, projectScope } : null;
      const result = await this.service.getCompanyEmails(req, orgUid, personKey, directoryView);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        person_key: personKey,
        company_email_count: result.companyEmails.length,
        company_emails_status: result.companyEmailsStatus,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/by-username/:username/company-emails — company-affiliated
   * addresses for the governance surfaces, keyed on LF username and never on an address.
   */
  public async getCompanyEmailsByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const username = req.params['username'];
    const operation = 'get_org_lens_people_company_emails_by_username';

    try {
      assertOrgUid(orgUid, operation);
      this.assertUsername(username, operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

      const result = await this.service.getCompanyEmailsByUsername(req, orgUid, username);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        company_email_count: result.companyEmails.length,
        company_emails_status: result.companyEmailsStatus,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/by-key-contact/company-emails?ids=<record ids> — company addresses for a key
   * contact the drawer opens without a person key: the addresses on their corporate key-contact records (`ids`: 1–50
   * comma-separated Salesforce record ids), merged with their LF username's. Both the username and the records' current
   * contact emails are derived here from the org's key-contact assignments, never taken from the client (the request
   * logger records the query string): a record address is shown only while it is still the email of the contact the
   * record names now, as a record can be reassigned to someone else under the same id. When that read fails no record
   * address is shown. Never keyed on an address. An invalid or empty id list is a 400; any other query param is ignored.
   */
  public async getCompanyEmailsByKeyContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_company_emails_by_key_contact';

    try {
      assertOrgUid(orgUid, operation);
      const keyContactIds = parseKeyContactIds(getStringQueryParam(req, 'ids'), operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid, key_contact_count: keyContactIds.length });

      const { username, currentEmails } = await this.resolveKeyContactIdentity(req, orgUid, keyContactIds, operation);
      const result = await this.service.getCompanyEmailsByKeyContacts(req, orgUid, keyContactIds, username, currentEmails);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        with_username: username !== null,
        current_email_count: currentEmails.size,
        company_email_count: result.companyEmails.length,
        record_only_email_count: result.keyContactRecordEmails?.length ?? 0,
        company_emails_status: result.companyEmailsStatus,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/by-username/:username/detail[?range=][&projectScope][&commitScope][&metric][&teamMembers][&orgScope] — activity for
   * openers that carry only an LF username; `range` and the commit filters as for the person-key detail. A username with no single roster person is answered `null` (200),
   * not 404: the miss is routine, and the error handler would log the username-bearing path at WARN on every such drawer open.
   */
  public async getEmployeeDetailByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const username = req.params['username'];
    const operation = 'get_org_lens_people_detail_by_username';

    try {
      assertOrgUid(orgUid, operation);
      this.assertUsername(username, operation);
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation) ?? ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE;
      const codeFilters = parseOptionalOrgCommitFilters(req, operation);
      const teamMembers = codeFilters ? parseOrgTeamMembers(req, operation) : 'include';
      const orgScope = codeFilters ? parseOrgScope(req, operation) : 'all';
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

      const response = await this.service.getEmployeeDetailByUsername(req, orgUid, username, range, codeFilters, teamMembers, orgScope);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        resolved: response !== null,
        board_seats: response?.boardSeats.length ?? 0,
        committee_seats: response?.committeeSeats.length ?? 0,
        code_rows: response?.code.length ?? 0,
        code_view: codeFilters !== null,
        event_rows: response?.events.length ?? 0,
        training_rows: response?.training.length ?? 0,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/:personKey/key-contacts — the key contact roles one person holds,
   * for the drawer's Key Contacts tab. A person key is not a key-contact key, so identity is assembled
   * here: the roster's username for that key, which is the stronger match, plus the same company-address
   * lookup the header uses. Both are resolved server-side — a username passed in by the client would
   * travel in the URL, which the request logger records.
   */
  public async getPersonKeyContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const personKey = req.params['personKey'];
    const operation = 'get_org_lens_people_person_key_contacts';

    try {
      assertOrgUid(orgUid, operation);
      this.assertPersonKey(personKey, operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid, person_key: personKey });

      const [identity, username] = await Promise.all([
        this.service.getCompanyEmails(req, orgUid, personKey),
        this.service.resolveUsernameByPersonKey(req, orgUid, personKey),
      ]);
      const response = await this.keyContactsService.getKeyContactsForPerson(req, orgUid, {
        username,
        emails: identity.companyEmailsStatus === 'resolved' ? identity.companyEmails : [],
        emailsStatus: identity.companyEmailsStatus,
      });

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        person_key: personKey,
        status: response.status,
        assignment_count: response.assignments.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/orgs/:orgUid/lens/people/by-username/:username/key-contacts — the same read for openers that
   * carry only an LF username. The username alone cannot rule out the assignments upstream records without
   * one, so when it matches nothing the address status decides whether that is an unidentified person or a
   * retryable failure; it never becomes a verified "holds no roles".
   */
  public async getPersonKeyContactsByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const username = req.params['username'];
    const operation = 'get_org_lens_people_person_key_contacts_by_username';

    try {
      assertOrgUid(orgUid, operation);
      this.assertUsername(username, operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

      const identity = await this.service.getCompanyEmailsByUsername(req, orgUid, username);
      const response = await this.keyContactsService.getKeyContactsForPerson(req, orgUid, {
        username,
        emails: identity.companyEmailsStatus === 'resolved' ? identity.companyEmails : [],
        emailsStatus: identity.companyEmailsStatus,
      });

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        status: response.status,
        assignment_count: response.assignments.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/key-contacts — org-wide read for the People tab. Membership-scoped reads + writes live on OrgLensKeyContactsController (spec 024). */
  public async getKeyContacts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_key_contacts', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_key_contacts');

      const response = await this.keyContactsService.getKeyContacts(req, orgUid);

      logger.success(req, 'get_org_lens_people_key_contacts', startTime, {
        org_uid: orgUid,
        assignment_count: response.assignments.length,
        individual_count: response.stats.individualCount,
        foundations_covered: response.stats.foundationsCovered,
        unfilled_required_role_count: response.stats.unfilledRequiredRoleCount,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/committee-members — org-wide non-Board committee-member roster + stats (spec 027). */
  public async getCommitteeMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_people_committee_members', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_people_committee_members');

      const response = await this.committeeMembersService.getCommitteeMembers(req, orgUid);

      logger.success(req, 'get_org_people_committee_members', startTime, {
        org_uid: orgUid,
        assignment_count: response.assignments.length,
        individual_count: response.stats.individualCount,
        committee_count: response.stats.committeeCount,
        foundations_covered: response.stats.foundationsCovered,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/orgs/:orgUid/lens/people/committee-members/:seatId/reassign — reassign one Membership-Entitlement seat (spec 027 US3/US4). */
  public async reassignCommitteeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const seatId = req.params['seatId'];
    const startTime = logger.startOperation(req, 'reassign_committee_member', {
      org_uid: orgUid,
      seat_id: seatId,
    });

    try {
      assertOrgUid(orgUid, 'reassign_committee_member');
      this.assertSeatId(seatId, 'reassign_committee_member');
      const body = this.assertReassignBody(req.body, 'reassign_committee_member');

      const response = await this.committeeMembersService.reassignSeat(req, orgUid, seatId, body);

      logger.success(req, 'reassign_committee_member', startTime, {
        org_uid: orgUid,
        seat_id: seatId,
        committee_uid: body.committeeUid,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/board-members — org-wide Board-only roster + stats. */
  public async getBoardMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_people_board_members', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_people_board_members');

      const response = await this.boardMembersService.getBoardMembers(req, orgUid);

      logger.success(req, 'get_org_people_board_members', startTime, {
        org_uid: orgUid,
        assignment_count: response.assignments.length,
        total_board_members: response.stats.totalBoardMembers,
        voting_count: response.stats.votingCount,
        non_voting_count: response.stats.nonVotingCount,
        foundations_covered: response.stats.foundationsCovered,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/orgs/:orgUid/lens/people/board-members/:seatId/reassign — reassign one Membership-Entitlement board seat. */
  public async reassignBoardMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const seatId = req.params['seatId'];
    const startTime = logger.startOperation(req, 'reassign_board_member', {
      org_uid: orgUid,
      seat_id: seatId,
    });

    try {
      assertOrgUid(orgUid, 'reassign_board_member');
      this.assertSeatId(seatId, 'reassign_board_member');
      const body = this.assertReassignBody(req.body, 'reassign_board_member');

      const response = await this.boardMembersService.reassignSeat(req, orgUid, seatId, body);

      logger.success(req, 'reassign_board_member', startTime, {
        org_uid: orgUid,
        seat_id: seatId,
        committee_uid: body.committeeUid,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/trainees[?range=30d|90d|365d|730d|all] — the range's trainees, current employees' course rows and outside learners for the Trainees tab (LFXV2-1876, default: the Org Lens default range); the cards come from /training/stats and the dropdowns from /training/filter-options. */
  public async getTrainees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_trainees';

    try {
      assertOrgUid(orgUid, operation);
      // Memoized per request: the route gate already ran it. The qualification decides whether the shared Valkey entry may serve this caller.
      const qualification = await assertOrgLensRead(req, orgUid, operation);
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: range,
      });

      const response = await this.traineesService.getTrainees(orgUid, range, qualification);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: range,
        trainee_count: response.trainees.length,
        outside_learner_count: response.outsideLearners.length,
        detail_count: response.details.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/event-attendees?range&participation — person × event rows + summary + filter options for the Event Attendees tab (LFXV2-1875, lfx-self-serve#4598). */
  public async getEventAttendees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_event_attendees', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_event_attendees');

      const { range, participation } = parseOrgEventsFilters(req, 'get_org_lens_people_event_attendees');
      const response = await this.eventAttendeesService.getEventAttendees(orgUid, { range, participation });

      logger.success(req, 'get_org_lens_people_event_attendees', startTime, {
        org_uid: orgUid,
        attendee_count: response.summary.attendeesCount,
        detail_count: response.details.length,
        foundation_count: response.foundationOptions.length,
        event_count: response.eventOptions.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/contributors?timeRange=30d|90d|365d|730d|all[&projectScope][&commitScope][&metric][&employment=current|former|all][&teamMembers=include|exclude][&orgScope=insights|all] — bundled rows + projects + stats + dropdown options for the Contributors tab (LFXV2-1874); `employment` omitted ⇒ everyone (lfx-self-serve#4627); `teamMembers` omitted ⇒ CDP team members excluded, the default (lfx-self-serve#4685); `orgScope` omitted ⇒ the Insights organization only (lfx-self-serve-ops#1219). */
  public async getContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_contributors';

    try {
      assertOrgUid(orgUid, operation);
      const timeRange = parsePeopleTimeRange(getStringQueryParam(req, 'timeRange'), 'timeRange', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const filters = parseOrgCommitFilters(req, operation);
      const employment = parseContributorsEmployment(getStringQueryParam(req, 'employment'), operation);
      const teamMembers = parseOrgTeamMembers(req, operation);
      const orgScope = parseOrgScope(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: timeRange,
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
        employment,
        team_members: teamMembers,
        org_scope: orgScope,
      });

      const response = await this.contributorsService.getContributors(orgUid, timeRange, filters, employment, teamMembers, orgScope);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: timeRange,
        contributor_count: response.contributors.length,
        project_count: response.projects.length,
        foundation_count: response.foundationOptions.length,
        maintainer_roles: response.stats.maintainerRoles,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * The All Employees Event Attendees tile is the number the People -> Event Attendees tab shows as Attendees at its defaults
   * (Employee match, registered or attended; lfx-self-serve#4598, #5158, #5315): the same warehouse summary row, through the same reader and
   * cache entry, so the two cannot drift. Events are LF constructs, so the Non-LF project scope keeps the listed-employee count
   * (`undefined`), as does the unranged roster read. A summary that cannot be read gives `null`, which marks the tile unavailable
   * instead of counting something else; it never fails the roster, and it never rejects.
   */
  private async readEventAttendeesTotal(
    req: Request,
    orgUid: string,
    range: OrgLensTimeRange | null,
    projectScope: OrgProjectScope
  ): Promise<number | null | undefined> {
    if (range === null || projectScope === 'non_lf') {
      return undefined;
    }
    try {
      const { attendeesCount } = await this.eventAttendeesService.readSummary(orgUid, range, DEFAULT_ORG_EVENTS_PARTICIPATION);
      return attendeesCount;
    } catch (error) {
      logger.warning(req, 'get_org_lens_people_all', 'Event attendee summary read failed, the tile is marked unavailable', {
        err: error,
        org_uid: orgUid,
      });
      return null;
    }
  }

  private withEventAttendeesTotal(response: OrgAllEmployeesResponse, eventAttendeesTotal: number | null | undefined): OrgAllEmployeesResponse {
    if (eventAttendeesTotal === undefined) {
      return response;
    }
    return eventAttendeesTotal === null
      ? { ...response, eventAttendeesTotal }
      : { ...response, eventAttendeesTotal, stats: { ...response.stats, eventAttendees: eventAttendeesTotal } };
  }

  /**
   * Who the org's key-contact assignments with these record ids name now (the per-caller cached read the Key Contacts
   * tab has already warmed): the lower-cased contact emails of the assignments found, which bind the record addresses
   * to the record's current holder, and the LF username they agree on — `null` when they agree on none or when any
   * requested id has no assignment (agreement over a subset would let an email-grouped opener reach one member's LF
   * addresses — the DR-010 guard). A failed read (logged, counts only) answers no emails and no username.
   */
  private async resolveKeyContactIdentity(
    req: Request,
    orgUid: string,
    keyContactIds: readonly string[],
    operation: string
  ): Promise<{ username: string | null; currentEmails: ReadonlySet<string> }> {
    try {
      const ids = new Set(keyContactIds);
      const { assignments } = await this.keyContactsService.getKeyContacts(req, orgUid);
      const held = assignments.filter((assignment) => ids.has(assignment.contactUid));
      const currentEmails = new Set(held.map((assignment) => assignment.email?.trim().toLowerCase() ?? '').filter(Boolean));
      const everyIdHeld = new Set(held.map((assignment) => assignment.contactUid)).size === ids.size;
      return { username: everyIdHeld ? agreedUsername(held.map((assignment) => assignment.username)) : null, currentEmails };
    } catch (error) {
      logger.warning(req, operation, 'key contacts read failed; showing no record addresses', {
        org_uid: orgUid,
        key_contact_count: keyContactIds.length,
        err: error,
      });
      return { username: null, currentEmails: new Set() };
    }
  }

  private assertPersonKey(personKey: string | undefined, operation: string): asserts personKey is string {
    if (!personKey || typeof personKey !== 'string') {
      throw ServiceValidationError.forField('personKey', 'personKey path parameter is required', { operation });
    }
    if (!PERSON_KEY_PATTERN.test(personKey)) {
      throw ServiceValidationError.forField('personKey', 'Invalid personKey format', { operation });
    }
  }

  /** Username-shaped check, not the identifier one: real LF usernames contain dots the stricter pattern rejects. */
  private assertUsername(username: string | undefined, operation: string): asserts username is string {
    if (!username || !isFilterSafeUsername(username)) {
      throw ServiceValidationError.forField('username', 'username path parameter is required and must be a valid username', { operation });
    }
  }

  /** Validate the seat id before it is interpolated into the upstream committee-service path (400, not an upstream 5xx). Mirrors OrgLensBoardCommitteeController.assertSeatId. */
  private assertSeatId(seatId: string | undefined, operation: string): asserts seatId is string {
    if (!seatId || !isFilterSafeIdentifier(seatId)) {
      throw ServiceValidationError.forField('seatId', 'seatId path parameter is required and must be a valid identifier', { operation });
    }
  }

  /** Validate + normalize the reassign body (committeeUid filter-safe; email lowercased + regex-checked). Mirrors OrgLensBoardCommitteeController.assertReassignBody. */
  private assertReassignBody(body: unknown, operation: string): ReassignCommitteeMemberBody {
    const b = (body ?? {}) as Partial<ReassignCommitteeMemberBody>;
    const committeeUid = typeof b.committeeUid === 'string' ? b.committeeUid.trim() : '';
    const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : '';
    const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : '';
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';

    if (!committeeUid || !email || !firstName || !lastName) {
      throw ServiceValidationError.forField('body', 'committeeUid, firstName, lastName and email are required', { operation });
    }
    if (!isFilterSafeIdentifier(committeeUid)) {
      throw ServiceValidationError.forField('committeeUid', 'committeeUid must be a valid identifier', { operation });
    }
    if (!EMAIL_REGEX.test(email)) {
      throw ServiceValidationError.forField('email', 'email must be a valid email address', { operation });
    }
    return { committeeUid, firstName, lastName, email };
  }
}

/** Truthy `?live` flag: present with no value, `true`, or `1` enable the merged live directory. Anything else (absent/`false`/`0`) keeps the Snowflake-only path. */
function parseLiveFlag(req: Request): boolean {
  // `qs` types a repeated param (`?live=true&live=true`) as an array; normalize to the last value so a
  // duplicated flag still enables live mode instead of being silently treated as false.
  const value = req.query['live'];
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === undefined) return false;
  return raw === '' || raw === 'true' || raw === '1';
}

/**
 * Validate a People time-range query param (`range` / `timeRange`): missing → `null` (each caller picks its default);
 * the legacy `12mo` → `365d`; any other unknown value → 400 (mirrors `parseEntityType` / `assertHealthMetricsRange`).
 */
function parsePeopleTimeRange(raw: string | undefined, field: string, operation: string): OrgLensTimeRange | null {
  if (!raw) {
    return null;
  }
  const range = normalizeLegacyOrgLensTimeRange(raw);
  if (!isOrgLensTimeRange(range)) {
    throw ServiceValidationError.forField(field, `Invalid ${field} value. Allowed: ${ORG_LENS_TIME_RANGES.join(', ')}`, { operation });
  }
  return range;
}

/** Validate the Contributors `employment` query param: missing → everyone; an unknown value → 400 (mirrors {@link parseOrgCommitFilters}). */
function parseContributorsEmployment(raw: string | undefined, operation: string): OrgEmploymentFilter {
  if (!raw) {
    return DEFAULT_ORG_EMPLOYMENT;
  }
  const employment = parseOrgEmploymentFilter(raw);
  if (employment === null) {
    throw ServiceValidationError.forField(
      'employment',
      `Invalid employment value. Allowed: ${ORG_EMPLOYMENT_OPTIONS.map((option) => option.value).join(', ')}`,
      {
        operation,
      }
    );
  }
  return employment;
}

/**
 * Validate the key-contact company-email `ids` query param: comma-separated 18-character Salesforce record ids,
 * deduplicated, 1 to {@link ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS} of them; anything else is a 400.
 */
function parseKeyContactIds(raw: string | undefined, operation: string): string[] {
  const ids = [...new Set((raw ?? '').split(',').map((id) => id.trim()))];
  if (!raw || ids.length > ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS || !ids.every(isKeyContactRecordId)) {
    throw ServiceValidationError.forField('ids', `ids must be 1-${ORG_KEY_CONTACT_EMAIL_LOOKUP_MAX_IDS} comma-separated Salesforce record ids`, { operation });
  }
  return ids;
}
