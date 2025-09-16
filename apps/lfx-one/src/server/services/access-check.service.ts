// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AccessCheckAccessType, AccessCheckApiRequest, AccessCheckApiResponse, AccessCheckRequest, AccessCheckResourceType } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { Logger } from '../helpers/logger';
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

    try {
      // Transform requests to the expected API format
      const apiRequests = resources.map((resource) => `${resource.resource}:${resource.id}#${resource.access}`);

      const requestPayload: AccessCheckApiRequest = {
        requests: apiRequests,
      };

      const sanitizedPayload = Logger.sanitize({
        request_count: resources.length,
        resource_types: [...new Set(resources.map((r) => r.resource))],
        access_types: [...new Set(resources.map((r) => r.access))],
      });
      req.log.info(sanitizedPayload, 'Checking access permissions');

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
      const userAccessInfo: Array<{ resourceId: string; username?: string; hasAccess: boolean }> = [];

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

      req.log.debug(
        Logger.sanitize({
          operation: 'check_access',
          request_count: resources.length,
          granted_count: Array.from(resultMap.values()).filter(Boolean).length,
          access_details: userAccessInfo,
        }),
        'Access check completed successfully'
      );

      return resultMap;
    } catch (error) {
      req.log.error(
        {
          operation: 'check_access',
          request_count: resources.length,
          error: error instanceof Error ? error.message : error,
        },
        'Access check failed, defaulting to no access'
      );

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
   * Add writer access field to multiple resources automatically
   * @param req Express request object with auth context
   * @param resources Array of resource objects with uid field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @returns Array of resources with writer field added
   */
  public async addAccessToResources<T extends { uid: string }>(
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
      id: resource.uid,
      access: accessType,
    }));

    // Perform batch access check
    const accessResults = await this.checkAccess(req, accessCheckRequests);

    // Add access field to each resource
    return resources.map((resource) => ({
      ...resource,
      [accessType]: accessResults.get(resource.uid) || false,
    }));
  }

  /**
   * Add writer access field to a single resource automatically
   * @param req Express request object with auth context
   * @param resource Single resource object with uid field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @returns Resource with writer field added
   */
  public async addAccessToResource<T extends { uid: string }>(
    req: Request,
    resource: T,
    resourceType: AccessCheckResourceType,
    accessType: AccessCheckAccessType = 'writer'
  ): Promise<T & { writer?: boolean }> {
    const hasAccess = await this.checkSingleAccess(req, {
      resource: resourceType,
      id: resource.uid,
      access: accessType,
    });

    return {
      ...resource,
      [accessType]: hasAccess,
    };
  }
}
