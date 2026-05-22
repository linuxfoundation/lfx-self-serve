// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN, SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensMembershipsService } from '../services/org-lens-memberships.service';

/** HTTP boundary for the Org Lens Memberships endpoints — validation, lifecycle logging, error propagation. */
export class OrgLensMembershipsController {
  private readonly service: OrgLensMembershipsService;

  public constructor() {
    this.service = new OrgLensMembershipsService();
  }

  /** GET /api/orgs/:accountId/lens/memberships/active */
  public async getActiveMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_active', {
      account_id: accountId,
    });

    try {
      this.assertAccountId(accountId, 'get_org_lens_memberships_active');

      const search = getStringQueryParam(req, 'search');
      const tier = getStringQueryParam(req, 'tier');
      const renewal = getStringQueryParam(req, 'renewal');

      const response = await this.service.getActiveMemberships(accountId, search, tier, renewal);

      logger.success(req, 'get_org_lens_memberships_active', startTime, {
        account_id: accountId,
        membership_count: response.memberships.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/memberships/expired */
  public async getExpiredMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_expired', {
      account_id: accountId,
    });

    try {
      this.assertAccountId(accountId, 'get_org_lens_memberships_expired');

      const search = getStringQueryParam(req, 'search');

      const response = await this.service.getExpiredMemberships(accountId, search);

      logger.success(req, 'get_org_lens_memberships_expired', startTime, {
        account_id: accountId,
        membership_count: response.memberships.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/memberships/:foundationId */
  public async getMembershipDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const foundationId = req.params['foundationId'];
    const startTime = logger.startOperation(req, 'get_org_membership_detail', {
      account_id: accountId,
      foundation_id: foundationId,
    });

    try {
      this.assertAccountId(accountId, 'get_org_membership_detail');
      this.assertFoundationId(foundationId, 'get_org_membership_detail');

      const response = await this.service.getMembershipDetail(accountId, foundationId);

      logger.success(req, 'get_org_membership_detail', startTime, {
        account_id: accountId,
        foundation_id: foundationId,
        contact_count: response.keyContacts.reduce((acc, c) => acc + c.people.length, 0),
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:accountId/lens/memberships/discover */
  public async getDiscoverOpportunities(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_discover', {
      account_id: accountId,
    });

    try {
      this.assertAccountId(accountId, 'get_org_lens_memberships_discover');

      const response = await this.service.getDiscoverOpportunities(accountId);

      logger.success(req, 'get_org_lens_memberships_discover', startTime, {
        account_id: accountId,
        opportunity_count: response.opportunities.length,
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

  private assertFoundationId(foundationId: string | undefined, operation: string): asserts foundationId is string {
    if (!foundationId || typeof foundationId !== 'string') {
      throw ServiceValidationError.forField('foundationId', 'foundationId path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(foundationId)) {
      throw ServiceValidationError.forField('foundationId', 'Invalid foundationId format', { operation });
    }
  }
}
