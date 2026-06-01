// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PERSON_KEY_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { logger } from '../services/logger.service';
import { OrgLensPeopleService } from '../services/org-lens-people.service';
import { OrgPeopleKeyContactsService } from '../services/org-people-key-contacts.service';
import { OrgSfidResolver } from '../services/org-sfid-resolver.service';

/** HTTP boundary for the OrgLensPeopleService — validation, lifecycle logging, error propagation. */
export class OrgLensPeopleController {
  private readonly service: OrgLensPeopleService;
  private readonly keyContactsService: OrgPeopleKeyContactsService;
  private readonly orgSfidResolver: OrgSfidResolver;

  public constructor() {
    this.service = new OrgLensPeopleService();
    this.keyContactsService = new OrgPeopleKeyContactsService();
    this.orgSfidResolver = new OrgSfidResolver();
  }

  /** GET /api/orgs/:orgUid/lens/people/all */
  public async getAllEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_all', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_people_all');

      const sfid = (await this.orgSfidResolver.resolveSfid(req, orgUid)) ?? '';
      const response = await this.service.getAllEmployees(sfid);

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

      const sfid = (await this.orgSfidResolver.resolveSfid(req, orgUid)) ?? '';
      const response = await this.service.getEmployeeDetail(sfid, personKey);

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

  private assertPersonKey(personKey: string | undefined, operation: string): asserts personKey is string {
    if (!personKey || typeof personKey !== 'string') {
      throw ServiceValidationError.forField('personKey', 'personKey path parameter is required', { operation });
    }
    if (!PERSON_KEY_PATTERN.test(personKey)) {
      throw ServiceValidationError.forField('personKey', 'Invalid personKey format', { operation });
    }
  }
}
