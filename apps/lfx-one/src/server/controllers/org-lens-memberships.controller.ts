// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensMembershipsService } from '../services/org-lens-memberships.service';

const ACCOUNT_ID_PATTERN = /^001[A-Za-z0-9]{12,15}$/;

export class OrgLensMembershipsController {
  private readonly service: OrgLensMembershipsService;

  public constructor() {
    this.service = new OrgLensMembershipsService();
  }

  public async getActiveMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_active', {
      account_id: accountId,
    });

    try {
      if (!accountId || typeof accountId !== 'string') {
        throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', {
          operation: 'get_org_lens_memberships_active',
        });
      }

      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', {
          operation: 'get_org_lens_memberships_active',
        });
      }

      const search = req.query['search'] as string | undefined;
      const tier = req.query['tier'] as string | undefined;
      const renewal = req.query['renewal'] as string | undefined;

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

  public async getExpiredMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_expired', {
      account_id: accountId,
    });

    try {
      if (!accountId || typeof accountId !== 'string') {
        throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', {
          operation: 'get_org_lens_memberships_expired',
        });
      }

      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', {
          operation: 'get_org_lens_memberships_expired',
        });
      }

      const search = req.query['search'] as string | undefined;

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

  public async getDiscoverOpportunities(req: Request, res: Response, next: NextFunction): Promise<void> {
    const accountId = req.params['accountId'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_discover', {
      account_id: accountId,
    });

    try {
      if (!accountId || typeof accountId !== 'string') {
        throw ServiceValidationError.forField('accountId', 'accountId path parameter is required', {
          operation: 'get_org_lens_memberships_discover',
        });
      }

      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        throw ServiceValidationError.forField('accountId', 'Invalid Salesforce accountId format', {
          operation: 'get_org_lens_memberships_discover',
        });
      }

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
}
