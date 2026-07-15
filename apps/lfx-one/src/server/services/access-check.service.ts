// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AccessCheckAccessType, AccessCheckApiRequest, AccessCheckApiResponse, AccessCheckRequest, AccessCheckResourceType } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for checking user access permissions on resources
 */
export class AccessCheckService {
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /**
   * Check access permissions for multiple resources
   * @param req Express request object with auth context
   * @param resources Array of resources to check access for
   * @returns Map of resource IDs to their access status
   *
   * NOTE: results are keyed by resource `id`, so multiple relations on the same id collapse to a
   * single entry (last write wins). When probing several relations on ONE resource, use
   * {@link checkAccessOrdered} instead, which preserves one result per request.
   */
  public async checkAccess(req: Request, resources: AccessCheckRequest[]): Promise<Map<string, boolean>> {
    if (resources.length === 0) {
      return new Map();
    }

    const results = await this.performAccessCheck(req, resources);

    const resultMap = new Map<string, boolean>();
    resources.forEach((resource, i) => resultMap.set(resource.id, results[i]));
    return resultMap;
  }

  /**
   * Check access permissions for multiple resource/relation tuples in a single upstream call,
   * returning results positionally (aligned to the input array). Unlike {@link checkAccess}, this
   * does not key by resource id, so it safely distinguishes multiple relations on the same resource
   * (e.g. `marketing_auditor` and `campaign_manager` on one project uid). Fails closed: on upstream
   * error every entry is `false`.
   * @param req Express request object with auth context
   * @param resources Array of resource/relation tuples to check
   * @returns Boolean array in the same order as `resources`
   */
  public async checkAccessOrdered(req: Request, resources: AccessCheckRequest[]): Promise<boolean[]> {
    if (resources.length === 0) {
      return [];
    }

    return this.performAccessCheck(req, resources);
  }

  /**
   * Check access for a single resource (convenience method)
   * @param req Express request object with auth context
   * @param resource Resource to check access for
   * @returns Boolean indicating whether user has access
   */
  public async checkSingleAccess(req: Request, resource: AccessCheckRequest): Promise<boolean> {
    const [hasAccess] = await this.performAccessCheck(req, [resource]);
    return hasAccess ?? false;
  }

  /**
   * Add writer access field to multiple resources automatically
   * @param req Express request object with auth context
   * @param resources Array of resource objects with uid or id field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @returns Array of resources with writer field added
   */
  public async addAccessToResources<T extends { uid: string } | { id: string }>(
    req: Request,
    resources: T[],
    resourceType: AccessCheckResourceType,
    accessType: AccessCheckAccessType = 'writer'
  ): Promise<(T & { writer?: boolean })[]> {
    if (resources.length === 0) {
      return resources;
    }

    // Create access check requests for all resources
    const accessCheckRequests: AccessCheckRequest[] = resources.map((resource) => ({
      resource: resourceType,
      id: this.getResourceId(resource),
      access: accessType,
    }));

    // Perform batch access check
    const accessResults = await this.checkAccess(req, accessCheckRequests);

    // Add access field to each resource
    return resources.map((resource) => ({
      ...resource,
      [accessType]: accessResults.get(this.getResourceId(resource)) || false,
    }));
  }

  /**
   * Add writer access field to a single resource automatically
   * @param req Express request object with auth context
   * @param resource Single resource object with uid or id field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @returns Resource with writer field added
   */
  public async addAccessToResource<T extends { uid: string } | { id: string }>(
    req: Request,
    resource: T,
    resourceType: AccessCheckResourceType,
    accessType: AccessCheckAccessType = 'writer'
  ): Promise<T & { writer?: boolean }> {
    const resourceId = this.getResourceId(resource);
    logger.debug(req, 'add_access_to_resource', 'Adding access to resource', {
      resource_type: resourceType,
      resource_id: resourceId,
      access_type: accessType,
    });

    const hasAccess = await this.checkSingleAccess(req, {
      resource: resourceType,
      id: resourceId,
      access: accessType,
    });

    return {
      ...resource,
      [accessType]: hasAccess,
    };
  }

  private getResourceId(resource: { uid: string } | { id: string }): string {
    return 'uid' in resource ? resource.uid : resource.id;
  }

  /**
   * Shared core for the access-check variants: issues the batched `/access-check` request and parses
   * the tab-delimited results positionally (`"resource:id#access@user:username\ttrue/false"`).
   * Fails closed — any upstream error resolves every entry to `false` — so callers never throw on a
   * transient failure.
   */
  private async performAccessCheck(req: Request, resources: AccessCheckRequest[]): Promise<boolean[]> {
    const resourceTypes = [...new Set(resources.map((r) => r.resource))];
    const operationName = `check_access_permissions_${resourceTypes.join('_')}`;
    const startTime = logger.startOperation(req, operationName, {
      request_count: resources.length,
      resource_types: resourceTypes,
      access_types: [...new Set(resources.map((r) => r.access))],
    });

    try {
      // Transform requests to the expected API format
      const apiRequests = resources.map((resource) => `${resource.resource}:${resource.id}#${resource.access}`);

      const requestPayload: AccessCheckApiRequest = {
        requests: apiRequests,
      };

      // Make the API request
      const response = await this.microserviceProxy.proxyRequest<AccessCheckApiResponse>(
        req,
        'LFX_V2_SERVICE',
        '/access-check',
        'POST',
        undefined,
        requestPayload
      );

      // Parse each result positionally: "resource:id#access@user:username\ttrue/false"
      const results = resources.map((_, i) => {
        const resultString = response.results[i];
        if (resultString && typeof resultString === 'string') {
          const parts = resultString.split('\t');
          if (parts.length >= 2) {
            return parts[1]?.toLowerCase() === 'true';
          }
        }
        return false;
      });

      logger.success(req, operationName, startTime, {
        request_count: resources.length,
        granted_count: results.filter(Boolean).length,
      });

      return results;
    } catch (error) {
      logger.error(req, operationName, startTime, error, {
        request_count: resources.length,
        fallback_behavior: 'returning no access',
      });

      // Fail closed — deny every requested tuple on a transient upstream failure.
      return resources.map(() => false);
    }
  }
}
