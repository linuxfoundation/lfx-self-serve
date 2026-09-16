// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ID_PATTERN } from '@lfx-one/shared/constants';
import type { OrgClaPermissionAction } from '@lfx-one/shared/interfaces';
import { acsCheckAllowed, buildOrgClaAcsPermission, viewerHasCompanySignGrant } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import { getUserServiceBaseUrl } from '../helpers/api-gateway.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { logger } from './logger.service';

const SERVICE = 'org_cla_permissions';

/**
 * ACS self-permission hop for Organization Lens EasyCLA write-control visibility (#1980).
 *
 * Not write middleware. Sign POST and approval-list PUT keep the Org Lens read grant plus the
 * impersonation block; EasyCLA v4 remains enforcement. This service answers `{ allowed }` so the
 * UI can withhold a control the gateway would already refuse.
 */
export class OrgClaPermissionsService {
  public async check(req: Request, companySfid: string, action: OrgClaPermissionAction, projectSfid?: string): Promise<boolean> {
    try {
      if (action === 'approval-list-update' || projectSfid) {
        if (!projectSfid || !SALESFORCE_ID_PATTERN.test(projectSfid)) return false;
        return await this.checkPair(req, action, projectSfid, companySfid);
      }

      return await this.checkCompanySignGrant(req, companySfid);
    } catch (error: unknown) {
      logger.warning(req, 'check_org_cla_permission', 'ACS permission check failed closed', {
        action,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  private async checkPair(req: Request, action: OrgClaPermissionAction, projectSfid: string, companySfid: string): Promise<boolean> {
    const permission = buildOrgClaAcsPermission({ action, projectOrFoundationSfid: projectSfid, companySfid });
    const url = `${getUserServiceBaseUrl('check_org_cla_permission', SERVICE)}/me/permissions/checks`;
    const payload = await gatewayFetch<{ permissions?: Record<string, boolean> }>(req, url, {
      operation: 'check_org_cla_permission',
      service: SERVICE,
      errorMessage: 'Failed to check CLA permissions',
      errorCode: 'ORG_CLA_PERMISSION_CHECK_FAILED',
      method: 'POST',
      body: { permissions: [permission] },
    });

    return acsCheckAllowed(payload, permission);
  }

  private async checkCompanySignGrant(req: Request, companySfid: string): Promise<boolean> {
    const url = `${getUserServiceBaseUrl('check_org_cla_permission', SERVICE)}/me/permissions`;
    const payload = await gatewayFetch<unknown>(req, url, {
      operation: 'list_org_cla_permissions',
      service: SERVICE,
      errorMessage: 'Failed to list CLA permissions',
      errorCode: 'ORG_CLA_PERMISSION_LIST_FAILED',
    });

    return viewerHasCompanySignGrant(payload, companySfid);
  }
}
