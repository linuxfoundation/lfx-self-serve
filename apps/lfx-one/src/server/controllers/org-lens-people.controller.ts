// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PERSON_KEY_PATTERN, SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensPeopleService } from '../services/org-lens-people.service';

/** HTTP boundary for the OrgLensPeopleService — validation, lifecycle logging, error propagation. */
export class OrgLensPeopleController {
  private readonly service: OrgLensPeopleService;

  public constructor() {
    this.service = new OrgLensPeopleService();
  }

  /** GET /api/orgs/:accountId/lens/people/all */
  public async getAllEmployees(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_all', {
      account_id: accountId,
    });

    try {
      this.assertAccountId(accountId, 'get_org_lens_people_all');

      const response = await this.service.getAllEmployees(accountId);

      logger.success(req, 'get_org_lens_people_all', startTime, {
        account_id: accountId,
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

  /** GET /api/orgs/:accountId/lens/people/:personKey/detail */
  public async getEmployeeDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const personKey = req.params['personKey'];
    const startTime = logger.startOperation(req, 'get_org_lens_people_detail', {
      account_id: accountId,
      person_key: personKey,
    });

    try {
      this.assertAccountId(accountId, 'get_org_lens_people_detail');
      this.assertPersonKey(personKey, 'get_org_lens_people_detail');

      const response = await this.service.getEmployeeDetail(accountId, personKey);

      logger.success(req, 'get_org_lens_people_detail', startTime, {
        account_id: accountId,
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

  private assertAccountId(accountId: string | undefined, operation: string): asserts accountId is string {
    if (!accountId || typeof accountId !== 'string') {
      throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', { operation });
    }
    if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(accountId)) {
      throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', { operation });
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
