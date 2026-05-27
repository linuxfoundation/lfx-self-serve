// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ROLE_GRANTS_HARD_CAP } from '@lfx-one/shared/constants';
import { B2bOrgSettingsDoc, QueryServiceResponse, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import { isFilterSafeUsername } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { isMockOrgItemsEnabled } from '../utils/mock-org-items.util';
import orgSelectorMock from './fixtures/org-selector.mock.json';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/** Loads caller role grants from b2b_org_settings (FR-018a "what can I see" pattern, contracts/bff-org-role-grants.md). */
export class OrgRoleGrantsService {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  public async getRoleGrants(req: Request, username: string): Promise<RoleGrantsResponse> {
    const loadedAt = new Date().toISOString();

    if (isMockOrgItemsEnabled()) {
      logger.debug(req, 'get_org_role_grants_mock', 'Returning fixture role grants', { mock: true });
      const grants = orgSelectorMock.roleGrants as { writers: string[]; auditors: string[] };
      return { writers: grants.writers, auditors: grants.auditors, username, loaded_at: loadedAt };
    }

    // Fail closed on usernames outside the filter-safe allowlist — defends against filter-injection
    // via a malformed OIDC claim. Encoding here is deliberately NOT applied: ApiClientService.getFullUrl
    // builds the query via URLSearchParams.append which already percent-encodes once.
    if (!isFilterSafeUsername(username)) {
      logger.warning(req, 'get_org_role_grants', 'Refusing role-grants lookup for username outside filter-safe allowlist', {
        username_length: username.length,
      });
      return { writers: [], auditors: [], username, loaded_at: loadedAt };
    }

    try {
      const response = await this.microserviceProxy.proxyRequest<QueryServiceResponse<B2bOrgSettingsDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'b2b_org_settings',
        filters_or: [`writers.username:${username}`, `auditors.username:${username}`],
        per_page: ORG_ROLE_GRANTS_HARD_CAP,
      });

      return this.reduceToFlatArrays(response, username, loadedAt);
    } catch (error) {
      logger.warning(req, 'get_org_role_grants', 'Upstream failure — returning empty grants', { err: error });
      return { writers: [], auditors: [], username, loaded_at: loadedAt };
    }
  }

  /** Flattens nested settings-docs to two disjoint uid arrays, enforcing the writer-wins invariant. */
  private reduceToFlatArrays(response: QueryServiceResponse<B2bOrgSettingsDoc> | null, username: string, loadedAt: string): RoleGrantsResponse {
    const writers: string[] = [];
    const auditors: string[] = [];

    for (const resource of response?.resources ?? []) {
      const orgUid = resource.id;
      if (!orgUid) continue;

      const isWriter = (resource.data?.writers ?? []).some((entry) => entry?.username === username);
      if (isWriter) {
        writers.push(orgUid);
        continue;
      }

      const isAuditor = (resource.data?.auditors ?? []).some((entry) => entry?.username === username);
      if (isAuditor) {
        auditors.push(orgUid);
      }
    }

    return { writers, auditors, username, loaded_at: loadedAt };
  }
}
