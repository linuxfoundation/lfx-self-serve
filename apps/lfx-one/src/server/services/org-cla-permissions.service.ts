// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ID_PATTERN } from '@lfx-one/shared/constants';
import type { OrgClaPermissionAction } from '@lfx-one/shared/interfaces';
import { acsCheckAllowed, buildOrgClaAcsPermission } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';

const SERVICE = 'org_cla_permissions';

/**
 * ACS self-permission hop for Organization Lens EasyCLA write-control visibility (#1980).
 *
 * Not write middleware. Sign POST and approval-list PUT keep the Org Lens read grant plus the
 * impersonation block; EasyCLA v4 remains enforcement. This service answers `{ allowed }` so the
 * UI can refuse attestation Continue without walking to a 403. Pair only — there is no
 * company-level Sign inventory. Picker Continue and Start are navigation and do not call this.
 *
 * Every action except Sign also asks about the CLA Group's foundation pair when one is given.
 * EasyCLA grants `cla-manager` on the foundation alone when it is signed at foundation level, and
 * its write authorization accepts that grant for the covered project, but an ACS check on the
 * covered project does not match it. Either pair allowing is an allow.
 */
export class OrgClaPermissionsService {
  public async check(req: Request, companySfid: string, action: OrgClaPermissionAction, projectSfid?: string, foundationSfid?: string): Promise<boolean> {
    try {
      if (!projectSfid || !SALESFORCE_ID_PATTERN.test(projectSfid)) return false;
      const pairs = [projectSfid];
      if (action !== 'sign' && foundationSfid && foundationSfid !== projectSfid && SALESFORCE_ID_PATTERN.test(foundationSfid)) {
        pairs.push(foundationSfid);
      }
      return await this.checkPairs(req, action, pairs, companySfid);
    } catch (error: unknown) {
      logger.warning(req, 'check_org_cla_permission', 'ACS permission check failed closed', {
        action,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  private async checkPairs(req: Request, action: OrgClaPermissionAction, projectOrFoundationSfids: string[], companySfid: string): Promise<boolean> {
    const permissions = projectOrFoundationSfids.map((projectOrFoundationSfid) => buildOrgClaAcsPermission({ action, projectOrFoundationSfid, companySfid }));
    const url = `${getUserServiceBaseUrl('check_org_cla_permission', SERVICE)}/me/permissions/checks`;
    const payload = await gatewayFetch<Record<string, boolean>>(req, url, {
      operation: 'check_org_cla_permission',
      service: SERVICE,
      errorMessage: 'Failed to check CLA permissions',
      errorCode: 'ORG_CLA_PERMISSION_CHECK_FAILED',
      method: 'POST',
      body: permissions,
      // This hop is callable while impersonating, so ACS must answer as the target. Without the
      // override it uses the impersonator's token and the UI would show or hide writes for the
      // wrong person (same pattern as the org-cla list read).
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    });

    return permissions.some((permission) => acsCheckAllowed(payload, permission));
  }
}
