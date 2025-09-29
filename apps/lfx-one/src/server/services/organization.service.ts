// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OrganizationSuggestion, OrganizationSuggestionsResponse } from '@lfx-one/shared';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

export class OrganizationService {
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /**
   * Search for organizations using the microservice proxy
   * @param req - Express request object (needed for authentication)
   * @param query - The search query
   * @returns Promise of organization suggestions
   */
  public async searchOrganizations(req: Request, query: string): Promise<OrganizationSuggestion[]> {
    const params = {
      v: 1,
      query,
    };

    const response = await this.microserviceProxy.proxyRequest<OrganizationSuggestionsResponse>(req, 'LFX_V2_SERVICE', '/query/orgs/suggest', 'GET', params);

    return response.suggestions || [];
  }
}
