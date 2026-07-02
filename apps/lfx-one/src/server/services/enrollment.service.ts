// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { LINUX_COM_ADDON_PRODUCT_ID, TLF_INDIVIDUAL_SUPPORTER } from '@lfx-one/shared/constants';
import { EnrollmentMembership, IndividualEnrollment, RawMembership } from '@lfx-one/shared/interfaces';
import { Request } from 'express';
import { MicroserviceError } from '../errors';

import { getApiGatewayBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';

const ENROLLMENT_SERVICE = 'enrollment_service';
const VALID_STATUSES = new Set<EnrollmentMembership['Status']>(['Active', 'Purchased', 'Expired']);

export class EnrollmentService {
  public async getIndividualEnrollments(req: Request): Promise<IndividualEnrollment[]> {
    const baseUrl = getApiGatewayBaseUrl('get_individual_enrollments', ENROLLMENT_SERVICE);
    const url = `${baseUrl}/member-service/v2/me/memberships?productID=${TLF_INDIVIDUAL_SUPPORTER.productId}&status=Purchased,Active,Expired&membershipType=Individual`;

    logger.debug(req, 'get_individual_enrollments', 'Fetching individual memberships from member-service');

    // During impersonation, req.apiGatewayToken is the impersonator's — resolve `/me` as the target
    // by passing the target's LFX v2 bearer token instead (same override updateAutoRenew uses).
    const impersonating = isImpersonating(req);

    let data: { Data?: RawMembership[]; data?: RawMembership[] } | null;
    try {
      data = await gatewayFetch<{ Data?: RawMembership[]; data?: RawMembership[] }>(req, url, {
        operation: 'get_individual_enrollments',
        service: ENROLLMENT_SERVICE,
        errorMessage: 'Individual memberships fetch failed',
        errorCode: 'INDIVIDUAL_MEMBERSHIPS_FETCH_FAILED',
        bearerToken: impersonating ? req.bearerToken : undefined,
      });
    } catch (error) {
      // While impersonating, degrade to the standard (unenrolled) product card rather than surfacing
      // an error — the target's membership isn't reachable if the member-service rejects the token.
      if (impersonating) {
        logger.warning(req, 'get_individual_enrollments', 'Target enrollment fetch failed during impersonation; showing standard card', {
          err: error,
        });
        return [{ ...TLF_INDIVIDUAL_SUPPORTER, membership: null }];
      }
      throw error;
    }

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

  /**
   * Whether the user has purchased the Lifetime Linux.com Email Alias add-on.
   *
   * The add-on is modeled as "lifetime" (EndDate = 2099, no auto-renew), so we
   * check for the presence of an Active/Purchased record rather than an expiry
   * window. Used to gate the Linux.com email tab between `not_purchased` and the
   * (un)claimed states.
   */
  public async hasLinuxComAddon(req: Request): Promise<boolean> {
    const baseUrl = getApiGatewayBaseUrl('get_linux_addon_membership', ENROLLMENT_SERVICE);
    const url = `${baseUrl}/member-service/v2/me/memberships?productID=${LINUX_COM_ADDON_PRODUCT_ID}&status=Purchased,Active&membershipType=Individual`;

    logger.debug(req, 'get_linux_addon_membership', 'Checking Linux.com add-on purchase from member-service');

    // Impersonation-aware: resolve `/me` as the target via their bearer token (see getIndividualEnrollments).
    const impersonating = isImpersonating(req);

    let data: { Data?: RawMembership[]; data?: RawMembership[] } | null;
    try {
      data = await gatewayFetch<{ Data?: RawMembership[]; data?: RawMembership[] }>(req, url, {
        operation: 'get_linux_addon_membership',
        service: ENROLLMENT_SERVICE,
        errorMessage: 'Linux.com add-on membership fetch failed',
        errorCode: 'LINUX_ADDON_MEMBERSHIP_FETCH_FAILED',
        bearerToken: impersonating ? req.bearerToken : undefined,
      });
    } catch (error) {
      // While impersonating, the target's add-on isn't reachable if the member-service rejects the
      // token — treat as not purchased so the Linux.com card renders a clean read-only state rather
      // than the retry panel. Non-impersonation failures propagate to the caller as before.
      if (impersonating) {
        logger.warning(req, 'get_linux_addon_membership', 'Target add-on fetch failed during impersonation; treating as not purchased', { err: error });
        return false;
      }
      throw error;
    }

    const rawMemberships: RawMembership[] = data?.Data ?? data?.data ?? [];
    return rawMemberships.some((m) => m.Product?.ID === LINUX_COM_ADDON_PRODUCT_ID && VALID_STATUSES.has(m.Status as EnrollmentMembership['Status']));
  }

  public async updateAutoRenew(req: Request, membershipId: string, autoRenew: boolean): Promise<void> {
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
