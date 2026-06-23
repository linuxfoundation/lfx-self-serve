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
   */
  public async checkAccess(req: Request, resources: AccessCheckRequest[]): Promise<Map<string, boolean>> {
    if (resources.length === 0) {
      return new Map();
    }

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

      // Create result map
      const resultMap = new Map<string, boolean>();
      const userAccessInfo: { resourceId: string; username?: string; hasAccess: boolean }[] = [];

      // Map results back to resource IDs
      for (let i = 0; i < resources.length; i++) {
        const resource = resources[i];
        const resultString = response.results[i];

        // Parse the result string format: "resource:id#access@user:username\ttrue/false"
        let hasAccess = false;
        let username: string | undefined;

        if (resultString && typeof resultString === 'string') {
          // Split by tab to get the boolean part
          const parts = resultString.split('\t');
          if (parts.length >= 2) {
            hasAccess = parts[1]?.toLowerCase() === 'true';

            // Extract username from the first part: "resource:id#access@user:username"
            const accessPart = parts[0];
            const userMatch = accessPart?.match(/@user:(.+)$/);
            if (userMatch) {
              username = userMatch[1];
            }
          }
        }

        resultMap.set(resource.id, hasAccess);
        userAccessInfo.push({ resourceId: resource.id, username, hasAccess });
      }

      logger.success(req, operationName, startTime, {
        request_count: resources.length,
        granted_count: Array.from(resultMap.values()).filter(Boolean).length,
      });

      return resultMap;
    } catch (error) {
      logger.error(req, operationName, startTime, error, {
        request_count: resources.length,
        fallback_behavior: 'returning no access',
      });

      // Return map with all false values as fallback
      const fallbackMap = new Map<string, boolean>();
      for (const resource of resources) {
        fallbackMap.set(resource.id, false);
      }
      return fallbackMap;
    }
  }

  /**
   * Check access for a single resource (convenience method)
   * @param req Express request object with auth context
   * @param resource Resource to check access for
   * @returns Boolean indicating whether user has access
   */
  public async checkSingleAccess(req: Request, resource: AccessCheckRequest): Promise<boolean> {
    const results = await this.checkAccess(req, [resource]);
    return results.get(resource.id) || false;
  }

  /**
   * Check multiple access types on a single resource in one API call.
   *
   * Unlike {@link checkAccess} — which maps its results by `resource.id` only,
   * causing multiple access types for the same ID to collide (last-write-wins) —
   * this method operates on a single ID and returns a `Record` keyed by
   * `AccessCheckAccessType`, so every relation is preserved independently.
   *
   * Results are matched positionally to `accessTypes` (same order as the upstream
   * `/access-check` response), then stored as `record[accessType] = hasAccess`.
   * Fails-closed: returns all-false on upstream error.
   *
   * @param req Express request object with auth context
   * @param resourceType Resource type (e.g. 'project')
   * @param id Resource unique identifier
   * @param accessTypes Array of access types to check
   * @returns Record mapping each access type to its boolean result
   */
  public async checkMultipleAccess(
    req: Request,
    resourceType: AccessCheckResourceType,
    id: string,
    accessTypes: AccessCheckAccessType[]
  ): Promise<Record<AccessCheckAccessType, boolean>> {
    const operationName = `check_multiple_access_${resourceType}`;
    const startTime = logger.startOperation(req, operationName, {
      resource_type: resourceType,
      resource_id: id,
      access_types: accessTypes,
    });

    const fallback = Object.fromEntries(accessTypes.map((a) => [a, false])) as Record<AccessCheckAccessType, boolean>;

    if (accessTypes.length === 0) {
      return fallback;
    }

    try {
      const apiRequests = accessTypes.map((access) => `${resourceType}:${id}#${access}`);
      const requestPayload: AccessCheckApiRequest = { requests: apiRequests };

      const response = await this.microserviceProxy.proxyRequest<AccessCheckApiResponse>(
        req,
        'LFX_V2_SERVICE',
        '/access-check',
        'POST',
        undefined,
        requestPayload
      );

      if (response.results.length !== accessTypes.length) {
        throw new Error(
          `access-check result count mismatch: expected ${accessTypes.length}, received ${response.results.length}`
        );
      }

      const result = { ...fallback };

      for (let i = 0; i < accessTypes.length; i++) {
        const access = accessTypes[i];
        const resultString = response.results[i];
        let hasAccess = false;

        if (resultString && typeof resultString === 'string') {
          const parts = resultString.split('\t');
          if (parts.length >= 2) {
            hasAccess = parts[1]?.toLowerCase() === 'true';
          }
        }

        result[access] = hasAccess;
      }

      logger.success(req, operationName, startTime, {
        resource_id: id,
        granted: accessTypes.filter((a) => result[a]),
      });

      return result;
    } catch (error) {
      logger.error(req, operationName, startTime, error, {
        resource_id: id,
      });
      throw error;
    }
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
}
