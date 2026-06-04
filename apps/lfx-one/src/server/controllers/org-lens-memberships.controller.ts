// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_ID_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { OrgLensMembershipsService } from '../services/org-lens-memberships.service';

/** HTTP boundary for the Org Lens Memberships endpoints — validation, lifecycle logging, error propagation. */
export class OrgLensMembershipsController {
  private readonly service: OrgLensMembershipsService;

  public constructor() {
    this.service = new OrgLensMembershipsService();
  }

  /** GET /api/orgs/:orgUid/lens/memberships/active */
  public async getActiveMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_active', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_memberships_active');

      const search = getStringQueryParam(req, 'search');
      const tier = getStringQueryParam(req, 'tier');
      const renewal = getStringQueryParam(req, 'renewal');

      const response = await this.service.getActiveMemberships(orgUid, search, tier, renewal);

      logger.success(req, 'get_org_lens_memberships_active', startTime, {
        org_uid: orgUid,
        membership_count: response.memberships.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/memberships/expired */
  public async getExpiredMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_expired', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_memberships_expired');

      const search = getStringQueryParam(req, 'search');

      const response = await this.service.getExpiredMemberships(orgUid, search);

      logger.success(req, 'get_org_lens_memberships_expired', startTime, {
        org_uid: orgUid,
        membership_count: response.memberships.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/memberships/:foundationSlug */
  public async getMembershipDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const foundationSlug = req.params['foundationSlug'];
    const startTime = logger.startOperation(req, 'get_org_membership_detail', {
      org_uid: orgUid,
      foundation_slug: foundationSlug,
    });

    try {
      assertOrgUid(orgUid, 'get_org_membership_detail');
      this.assertFoundationSlug(foundationSlug, 'get_org_membership_detail');

      // Spec 002: orgUid is the SFID; the service's uid (query-service tag) and sfid (Snowflake) args are now the same value.
      const response = await this.service.getMembershipDetail(req, orgUid, orgUid, foundationSlug);

      logger.success(req, 'get_org_membership_detail', startTime, {
        org_uid: orgUid,
        foundation_slug: foundationSlug,
        foundation_found: response.foundation !== null,
        contact_count: response.keyContacts.reduce((acc, c) => acc + c.people.length, 0),
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/orgs/:orgUid/lens/memberships/discover */
  public async getDiscoverOpportunities(req: Request, res: Response, next: NextFunction): Promise<void> {
    const orgUid = req.params['orgUid'];
    const startTime = logger.startOperation(req, 'get_org_lens_memberships_discover', {
      org_uid: orgUid,
    });

    try {
      assertOrgUid(orgUid, 'get_org_lens_memberships_discover');

      const response = await this.service.getDiscoverOpportunities(orgUid);

      logger.success(req, 'get_org_lens_memberships_discover', startTime, {
        org_uid: orgUid,
        opportunity_count: response.opportunities.length,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  // FOUNDATION_ID_PATTERN is the general SSR path-param validator (`[A-Za-z0-9-]{1,64}`); it also
  // covers the foundation slug shape, so it is reused here for the slug-keyed detail route.
  private assertFoundationSlug(foundationSlug: string | undefined, operation: string): asserts foundationSlug is string {
    if (!foundationSlug || typeof foundationSlug !== 'string') {
      throw ServiceValidationError.forField('foundationSlug', 'foundationSlug path parameter is required', { operation });
    }
    if (!FOUNDATION_ID_PATTERN.test(foundationSlug)) {
      throw ServiceValidationError.forField('foundationSlug', 'Invalid foundationSlug format', { operation });
    }
  }
}
