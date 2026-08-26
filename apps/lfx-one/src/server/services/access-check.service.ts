// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AccessCheckAccessType,
  AccessCheckApiRequest,
  AccessCheckApiResponse,
  AccessCheckRequest,
  AccessCheckResourceType,
  ApiRequestOptions,
} from '@lfx-one/shared/interfaces';
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
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Map keyed by "id#access" to their access status (e.g. "meeting-1#organizer")
   */
  public async checkAccess(req: Request, resources: AccessCheckRequest[], options?: ApiRequestOptions): Promise<Map<string, boolean>> {
    if (resources.length === 0) {
      return new Map();
    }

    const { operationName, startTime } = this.beginCheckOperation(req, resources);

    try {
      return await this.performCheck(req, resources, operationName, startTime, options);
    } catch (error) {
      logger.error(req, operationName, startTime, error, {
        request_count: resources.length,
        fallback_behavior: 'returning no access',
      });

      // Return map with all false values as fallback
      const fallbackMap = new Map<string, boolean>();
      for (const resource of resources) {
        fallbackMap.set(`${resource.id}#${resource.access}`, false);
      }
      return fallbackMap;
    }
  }

  /**
   * Check access permissions for multiple resources, letting upstream failures propagate instead
   * of degrading to "no access". For callers that must distinguish "resolved: no access" (403)
   * from "couldn't verify" (503) — `checkAccess`'s fallback collapses that distinction.
   * @param req Express request object with auth context
   * @param resources Array of resources to check access for
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Map keyed by "id#access" to their access status
   */
  public async checkAccessStrict(req: Request, resources: AccessCheckRequest[], options?: ApiRequestOptions): Promise<Map<string, boolean>> {
    if (resources.length === 0) {
      return new Map();
    }

    const { operationName, startTime } = this.beginCheckOperation(req, resources);
    try {
      return await this.performCheck(req, resources, operationName, startTime, options);
    } catch (error) {
      // Unlike checkAccess, this rethrows rather than degrading — but still logs, so a failed
      // strict check leaves the same terminal error record as any other failed operation instead
      // of a started-but-never-finished one.
      logger.error(req, operationName, startTime, error, { request_count: resources.length });
      throw error;
    }
  }

  /**
   * Check access for a single resource (convenience method)
   * @param req Express request object with auth context
   * @param resource Resource to check access for
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Boolean indicating whether user has access
   */
  public async checkSingleAccess(req: Request, resource: AccessCheckRequest, options?: ApiRequestOptions): Promise<boolean> {
    const results = await this.checkAccess(req, [resource], options);
    return results.get(`${resource.id}#${resource.access}`) || false;
  }

  /**
   * Check access for a single resource, propagating upstream failures. See `checkAccessStrict`.
   * @param req Express request object with auth context
   * @param resource Resource to check access for
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Boolean indicating whether user has access
   */
  public async checkSingleAccessStrict(req: Request, resource: AccessCheckRequest, options?: ApiRequestOptions): Promise<boolean> {
    const results = await this.checkAccessStrict(req, [resource], options);
    return results.get(`${resource.id}#${resource.access}`) || false;
  }

  /**
   * Add writer access field to multiple resources automatically
   * @param req Express request object with auth context
   * @param resources Array of resource objects with uid or id field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Array of resources with writer field added
   */
  public async addAccessToResources<T extends { uid: string } | { id: string }>(
    req: Request,
    resources: T[],
    resourceType: AccessCheckResourceType,
    accessType: AccessCheckAccessType = 'writer',
    options?: ApiRequestOptions
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
    const accessResults = await this.checkAccess(req, accessCheckRequests, options);

    // Add access field to each resource
    return resources.map((resource) => ({
      ...resource,
      [accessType]: accessResults.get(`${this.getResourceId(resource)}#${accessType}`) || false,
    }));
  }

  /**
   * Add writer access field to a single resource automatically
   * @param req Express request object with auth context
   * @param resource Single resource object with uid or id field
   * @param resourceType Type of resource (project, meeting, committee)
   * @param accessType Type of access to check (default: writer)
   * @param options Optional per-call overrides (e.g. explicit bearer token)
   * @returns Resource with writer field added
   */
  public async addAccessToResource<T extends { uid: string } | { id: string }>(
    req: Request,
    resource: T,
    resourceType: AccessCheckResourceType,
    accessType: AccessCheckAccessType = 'writer',
    options?: ApiRequestOptions
  ): Promise<T & { writer?: boolean }> {
    const resourceId = this.getResourceId(resource);
    logger.debug(req, 'add_access_to_resource', 'Adding access to resource', {
      resource_type: resourceType,
      resource_id: resourceId,
      access_type: accessType,
    });

    const hasAccess = await this.checkSingleAccess(
      req,
      {
        resource: resourceType,
        id: resourceId,
        access: accessType,
      },
      options
    );

    return {
      ...resource,
      [accessType]: hasAccess,
    };
  }

  private getResourceId(resource: { uid: string } | { id: string }): string {
    return 'uid' in resource ? resource.uid : resource.id;
  }

  private beginCheckOperation(req: Request, resources: AccessCheckRequest[]): { operationName: string; startTime: number } {
    const resourceTypes = [...new Set(resources.map((r) => r.resource))];
    const operationName = `check_access_permissions_${resourceTypes.join('_')}`;
    const startTime = logger.startOperation(req, operationName, {
      request_count: resources.length,
      resource_types: resourceTypes,
      access_types: [...new Set(resources.map((r) => r.access))],
    });
    return { operationName, startTime };
  }

  /**
   * Performs the access-check request/response round trip with no error handling — callers decide
   * whether to degrade (`checkAccess`) or propagate (`checkAccessStrict`).
   */
  private async performCheck(
    req: Request,
    resources: AccessCheckRequest[],
    operationName: string,
    startTime: number,
    options?: ApiRequestOptions
  ): Promise<Map<string, boolean>> {
    // Transform requests to the expected API format
    const apiRequests = resources.map((resource) => `${resource.resource}:${resource.id}#${resource.access}`);

    const requestPayload: AccessCheckApiRequest = {
      requests: apiRequests,
    };

    // Make the API request. options?.bearerToken (when set) opts the call out of req.bearerToken
    // for parallel-safe fan-out — see ApiRequestOptions.
    const response = await this.microserviceProxy.proxyRequest<AccessCheckApiResponse>(
      req,
      'LFX_V2_SERVICE',
      '/access-check',
      'POST',
      undefined,
      requestPayload,
      undefined,
      options
    );

    // Parse each result string into a lookup keyed by the "resource:id#access" tuple it
    // reports on, rather than trusting positional (array-index) alignment with `resources`.
    // The upstream response can reorder or dedupe entries, so index-based pairing can silently
    // attribute one resource's answer to a different resource.
    const resultByTuple = new Map<string, { hasAccess: boolean }>();
    for (const resultString of response.results) {
      if (!resultString || typeof resultString !== 'string') {
        continue;
      }

      // Format: "resource:id#access@user:username\ttrue/false"
      const parts = resultString.split('\t');
      if (parts.length < 2) {
        continue;
      }

      const accessPart = parts[0];
      const hasAccess = parts[1]?.toLowerCase() === 'true';
      // The tuple this line reports on excludes the "@user:username" suffix; only its position
      // (via userMatch.index) is needed to strip it — the username itself has no reader.
      const userMatch = accessPart?.match(/@user:(.+)$/);
      const tuple = userMatch ? accessPart.slice(0, userMatch.index) : accessPart;

      resultByTuple.set(tuple, { hasAccess });
    }

    // Map results back to resource IDs by re-deriving the same tuple each request sent
    const resultMap = new Map<string, boolean>();

    for (const resource of resources) {
      const tuple = `${resource.resource}:${resource.id}#${resource.access}`;
      const result = resultByTuple.get(tuple);

      // Fail closed when the upstream response omits this tuple
      resultMap.set(`${resource.id}#${resource.access}`, result?.hasAccess ?? false);
    }

    logger.success(req, operationName, startTime, {
      request_count: resources.length,
      granted_count: Array.from(resultMap.values()).filter(Boolean).length,
    });

    return resultMap;
  }
}
