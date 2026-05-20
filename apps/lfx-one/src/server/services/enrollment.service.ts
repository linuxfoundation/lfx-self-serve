// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { TLF_INDIVIDUAL_SUPPORTER } from '@lfx-one/shared/constants';
import { EnrollmentMembership, IndividualEnrollment, RawMembership } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { MicroserviceError } from '../errors';

import { getApiGatewayBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { getUsernameFromAuth, usernameMatches } from '../utils/auth-helper';
import { logger } from './logger.service';

const DEMO_USER = 'johnlf2727';
const ENROLLMENT_SERVICE = 'enrollment_service';
const VALID_STATUSES = new Set<EnrollmentMembership['Status']>(['Active', 'Purchased', 'Expired']);

const DEMO_ENROLLMENTS: IndividualEnrollment[] = [
  {
    ...TLF_INDIVIDUAL_SUPPORTER,
    membership: {
      Status: 'Expired',
      AutoRenew: false,
      PurchaseDate: '2020-06-09',
      EndDate: '2021-06-09',
      Price: 0,
      ID: '02i2M00000QTirbQAD',
      ExtPaymentType: '836366',
    },
  },
];

export class EnrollmentService {
  public async getIndividualEnrollments(req: Request): Promise<IndividualEnrollment[]> {
    const username = await getUsernameFromAuth(req);

    if (username && usernameMatches(username, DEMO_USER)) {
      logger.debug(req, 'get_individual_enrollments', 'Returning demo data for test user');
      return DEMO_ENROLLMENTS;
    }

    const baseUrl = getApiGatewayBaseUrl('get_individual_enrollments', ENROLLMENT_SERVICE);
    const url = `${baseUrl}/member-service/v2/me/memberships?productID=${TLF_INDIVIDUAL_SUPPORTER.productId}&status=Purchased,Active,Expired&membershipType=Individual`;

    logger.debug(req, 'get_individual_enrollments', 'Fetching individual memberships from member-service');

    const data = await gatewayFetch<{ Data?: RawMembership[]; data?: RawMembership[] }>(req, url, {
      operation: 'get_individual_enrollments',
      service: ENROLLMENT_SERVICE,
      errorMessage: 'Individual memberships fetch failed',
      errorCode: 'INDIVIDUAL_MEMBERSHIPS_FETCH_FAILED',
    });

    const rawMemberships: RawMembership[] = data?.Data ?? data?.data ?? [];

    const membershipMap = new Map<string, EnrollmentMembership>();
    for (const m of rawMemberships) {
      const productId = m.Product?.ID;
      if (!productId || !VALID_STATUSES.has(m.Status as EnrollmentMembership['Status'])) continue;
      const existing = membershipMap.get(productId);
      const existingTs = existing ? Date.parse(existing.PurchaseDate) : NaN;
      const candidateTs = Date.parse(m.PurchaseDate ?? '');
      const shouldReplace = !existing || (isNaN(existingTs) && !isNaN(candidateTs)) || (!isNaN(existingTs) && !isNaN(candidateTs) && existingTs < candidateTs);
      if (shouldReplace) {
        membershipMap.set(productId, {
          Status: m.Status as EnrollmentMembership['Status'],
          AutoRenew: m.AutoRenew ?? false,
          PurchaseDate: m.PurchaseDate ?? '',
          EndDate: m.EndDate ?? '',
          Price: m.Price ?? 0,
          ID: m.ID ?? '',
          ExtPaymentType: m.ExtPaymentID ? m.ExtPaymentID.split(':')[0] : '',
        });
      }
    }

    logger.debug(req, 'get_individual_enrollments', 'Fetched individual memberships', { count: rawMemberships.length });

    return [
      {
        ...TLF_INDIVIDUAL_SUPPORTER,
        membership: membershipMap.get(TLF_INDIVIDUAL_SUPPORTER.productId) ?? null,
      },
    ];
  }

  public async updateAutoRenew(req: Request, membershipId: string, autoRenew: boolean): Promise<void> {
    const username = await getUsernameFromAuth(req);

    if (username && usernameMatches(username, DEMO_USER)) {
      logger.debug(req, 'update_individual_enrollment_auto_renew', 'Skipping update for demo user');
      return;
    }

    if (!req.bearerToken) {
      throw new MicroserviceError('User bearer token not available', 401, 'BEARER_TOKEN_UNAVAILABLE', {
        operation: 'update_individual_enrollment_auto_renew',
        service: ENROLLMENT_SERVICE,
      });
    }

    const baseUrl = getApiGatewayBaseUrl('update_individual_enrollment_auto_renew', ENROLLMENT_SERVICE);
    const url = `${baseUrl}/member-service/v2/memberships/${encodeURIComponent(membershipId)}`;

    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      AutoRenew: autoRenew,
      NumberOfYearsRequired: autoRenew ? 1 : 0,
      ...(autoRenew ? {} : { CancellationDate: today, CancellationReason: 'By User' }),
    };

    logger.debug(req, 'update_individual_enrollment_auto_renew', 'Updating membership auto-renew', { membershipId, autoRenew });

    await gatewayFetch<null>(req, url, {
      operation: 'update_individual_enrollment_auto_renew',
      service: ENROLLMENT_SERVICE,
      errorMessage: 'Membership auto-renew update failed',
      errorCode: 'MEMBERSHIP_AUTO_RENEW_UPDATE_FAILED',
      method: 'PATCH',
      body: payload,
      bearerToken: req.bearerToken,
    });
  }
}
