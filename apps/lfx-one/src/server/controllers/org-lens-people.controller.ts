// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMAIL_REGEX, ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_OPTIONS, PERSON_KEY_PATTERN } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, ReassignCommitteeMemberBody } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, isFilterSafeUsername, isOrgLensTimeRange, parseOrgProjectScope } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { parseOrgCommitFilters } from '../helpers/org-commit-filters.helper';
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

  /** GET /api/orgs/:orgUid/lens/people/all[?live][&range=30d|90d|365d|all][&projectScope][&commitScope][&metric] — `live` merges the stored Snowflake roster with live committee/key-contact/access sources (deduped by email); omitted ⇒ Snowflake-only. `range` windows the stored roster, and the commit filters scope it and pick the code count; omitted ⇒ the unranged roster (the reassign pickers' read, and any caller that predates the range), which the commit filters do not apply to. */
  public async getAllEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_all';
    const live = parseLiveFlag(req);

    try {
      assertOrgUid(orgUid, operation);
      // `null` (no range) is the unranged roster, not a default range.
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation);
      const filters = parseOrgCommitFilters(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        live,
        time_range: range ?? 'roster',
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
      });

      const response = live ? await this.directoryService.getLive(req, orgUid, range, filters) : await this.service.getAllEmployees(orgUid, range, filters);

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

  /** GET /api/orgs/:orgUid/lens/people/former[?range=30d|90d|365d|all][&projectScope][&commitScope][&metric] — former employees active at the account in the range and project scope (lfx-self-serve#4311, default `365d`). Never merged into the live directory. */
  public async getFormerEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_former';

    try {
      assertOrgUid(orgUid, operation);
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const filters = parseOrgCommitFilters(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: range,
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
      });

      const response = await this.service.getFormerEmployees(orgUid, range, filters);

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

  /** GET /api/orgs/:orgUid/lens/people/:personKey/detail */
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

      const response = await this.service.getEmployeeDetail(req, orgUid, personKey);

      logger.success(req, 'get_org_lens_people_detail', startTime, {
        org_uid: orgUid,
        person_key: personKey,
        board_seats: response.boardSeats.length,
        committee_seats: response.committeeSeats.length,
        code_rows: response.code.length,
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

      const result = await this.service.getCompanyEmailsByUsername(orgUid, username);

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
   * GET /api/orgs/:orgUid/lens/people/by-username/:username/detail — activity for openers that carry only an LF username.
   * A username with no single roster person is answered `null` (200), not 404: the miss is routine, and the error
   * handler would log the username-bearing path at WARN on every such drawer open.
   */
  public async getEmployeeDetailByUsername(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const username = req.params['username'];
    const operation = 'get_org_lens_people_detail_by_username';

    try {
      assertOrgUid(orgUid, operation);
      this.assertUsername(username, operation);
      const startTime = logger.startOperation(req, operation, { org_uid: orgUid });

      const response = await this.service.getEmployeeDetailByUsername(req, orgUid, username);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        resolved: response !== null,
        board_seats: response?.boardSeats.length ?? 0,
        committee_seats: response?.committeeSeats.length ?? 0,
        code_rows: response?.code.length ?? 0,
        event_rows: response?.events.length ?? 0,
        training_rows: response?.training.length ?? 0,
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

  /** GET /api/orgs/:orgUid/lens/people/trainees[?range=30d|90d|365d|all] — the range's trainees, details and filter options for the Trainees tab (LFXV2-1876, default `365d`). */
  public async getTrainees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_trainees';

    try {
      assertOrgUid(orgUid, operation);
      const range = parsePeopleTimeRange(getStringQueryParam(req, 'range'), 'range', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: range,
      });

      const response = await this.traineesService.getTrainees(orgUid, range);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: range,
        trainee_count: response.trainees.length,
        detail_count: response.details.length,
        foundation_count: response.foundationOptions.length,
        course_count: response.courseOptions.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/people/event-attendees — bundled rows + details + stats + filter options for the Event Attendees tab (LFXV2-1875). */
  public async getEventAttendees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_event_attendees', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_event_attendees');

      const response = await this.eventAttendeesService.getEventAttendees(orgUid);

      logger.success(req, 'get_org_lens_people_event_attendees', startTime, {
        org_uid: orgUid,
        attendee_count: response.attendees.length,
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

  /** GET /api/orgs/:orgUid/lens/people/contributors?timeRange=30d|90d|365d|all[&projectScope][&commitScope][&metric] — bundled rows + projects + stats + dropdown options for the Contributors tab (LFXV2-1874). */
  public async getContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_contributors';

    try {
      assertOrgUid(orgUid, operation);
      const timeRange = parsePeopleTimeRange(getStringQueryParam(req, 'timeRange'), 'timeRange', operation) ?? ORG_LENS_DEFAULT_TIME_RANGE;
      const filters = parseOrgCommitFilters(req, operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: timeRange,
        project_scope: filters.projectScope,
        commit_scope: filters.commitScope,
        metric: filters.metric,
      });

      const response = await this.contributorsService.getContributors(orgUid, timeRange, filters);

      logger.success(req, operation, startTime, {
        org_uid: orgUid,
        time_range: timeRange,
        contributor_count: response.contributors.length,
        project_count: response.projects.length,
        foundation_count: response.foundationOptions.length,
        maintainers: response.stats.maintainers,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
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

/** Validate a People time-range query param (`range` / `timeRange`): missing → `null` (each caller picks its default); invalid → 400 (mirrors `parseEntityType` / `assertHealthMetricsRange`). */
function parsePeopleTimeRange(raw: string | undefined, field: string, operation: string): OrgLensTimeRange | null {
  if (!raw) {
    return null;
  }
  const option = ORG_LENS_TIME_RANGE_OPTIONS.find((candidate) => candidate.value === raw);
  if (!option) {
    throw ServiceValidationError.forField(field, `Invalid ${field} value. Allowed: ${ORG_LENS_TIME_RANGE_OPTIONS.map((o) => o.value).join(', ')}`, {
      operation,
    });
  }
  return option.value;
}
