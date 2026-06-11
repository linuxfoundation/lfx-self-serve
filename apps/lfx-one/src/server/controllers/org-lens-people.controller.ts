// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMAIL_REGEX, ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE, PERSON_KEY_PATTERN } from '@lfx-one/shared/constants';
import type { OrgContributorTimeRange, ReassignCommitteeMemberBody } from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensPeopleService } from '../services/org-lens-people.service';
import { OrgPeopleCommitteeMembersService } from '../services/org-people-committee-members.service';
import { OrgPeopleContributorsService } from '../services/org-people-contributors.service';
import { OrgPeopleEventAttendeesService } from '../services/org-people-event-attendees.service';
import { OrgPeopleKeyContactsService } from '../services/org-people-key-contacts.service';
import { OrgPeopleTraineesService } from '../services/org-people-trainees.service';

const VALID_CONTRIBUTOR_TIME_RANGES: ReadonlySet<OrgContributorTimeRange> = new Set(['30d', '90d', '12mo', 'all']);

/** HTTP boundary for the OrgLensPeopleService — validation, lifecycle logging, error propagation. */
export class OrgLensPeopleController {
  private readonly service: OrgLensPeopleService;
  private readonly keyContactsService: OrgPeopleKeyContactsService;
  private readonly traineesService: OrgPeopleTraineesService;
  private readonly eventAttendeesService: OrgPeopleEventAttendeesService;
  private readonly contributorsService: OrgPeopleContributorsService;
  private readonly committeeMembersService: OrgPeopleCommitteeMembersService;

  public constructor() {
    this.service = new OrgLensPeopleService();
    this.keyContactsService = new OrgPeopleKeyContactsService();
    this.traineesService = new OrgPeopleTraineesService();
    this.eventAttendeesService = new OrgPeopleEventAttendeesService();
    this.contributorsService = new OrgPeopleContributorsService();
    this.committeeMembersService = new OrgPeopleCommitteeMembersService();
  }

  /** GET /api/orgs/:orgUid/lens/people/all */
  public async getAllEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_all', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_all');

      const response = await this.service.getAllEmployees(orgUid);

      logger.success(req, 'get_org_lens_people_all', startTime, {
        org_uid: orgUid,
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

      const response = await this.service.getEmployeeDetail(orgUid, personKey);

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

  /** GET /api/orgs/:orgUid/lens/people/trainees — bundled rows + details + stats + filter options for the Trainees tab (LFXV2-1876). */
  public async getTrainees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_trainees', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_trainees');

      const response = await this.traineesService.getTrainees(orgUid);

      logger.success(req, 'get_org_lens_people_trainees', startTime, {
        org_uid: orgUid,
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

  /** GET /api/orgs/:orgUid/lens/people/contributors?timeRange=30d|90d|12mo|all — bundled rows + projects + stats + dropdown options for the Contributors tab (LFXV2-1874). */
  public async getContributors(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const operation = 'get_org_lens_people_contributors';

    try {
      assertOrgUid(orgUid, operation);
      const timeRange = parseContributorTimeRange(getStringQueryParam(req, 'timeRange'), operation);
      const startTime = logger.startOperation(req, operation, {
        org_uid: orgUid,
        time_range: timeRange,
      });

      const response = await this.contributorsService.getContributors(orgUid, timeRange);

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

/** Validate `timeRange`: missing → `12mo` default; invalid → 400 (mirrors `parseEntityType` / `assertHealthMetricsRange`). */
function parseContributorTimeRange(raw: string | undefined, operation: string): OrgContributorTimeRange {
  if (!raw) {
    return ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE;
  }
  if (!VALID_CONTRIBUTOR_TIME_RANGES.has(raw as OrgContributorTimeRange)) {
    throw ServiceValidationError.forField('timeRange', `Invalid timeRange value. Allowed: ${[...VALID_CONTRIBUTOR_TIME_RANGES].join(', ')}`, { operation });
  }
  return raw as OrgContributorTimeRange;
}
