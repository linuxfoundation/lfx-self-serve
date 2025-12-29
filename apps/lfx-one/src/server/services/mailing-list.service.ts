// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CreateGroupsIOServiceRequest,
  CreateMailingListRequest,
  GroupsIOMailingList,
  GroupsIOService,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateGroupsIOServiceRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling mailing list business logic
 * Supports Groups.io provider with extensible design for future providers
 */
export class MailingListService {
  private accessCheckService: AccessCheckService;
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.etagService = new ETagService();
    this.microserviceProxy = new MicroserviceProxyService();
  }

  // ============================================
  // Groups.io Service Methods
  // ============================================

  /**
   * Fetches all Groups.io services based on query parameters
   */
  public async getServices(req: Request, query: Record<string, unknown> = {}): Promise<GroupsIOService[]> {
    const params = {
      ...query,
      type: 'groupsio_service',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOService>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    const services = resources.map((resource) => resource.data);

    // Add writer access field to all services
    return await this.accessCheckService.addAccessToResources(req, services, 'groupsio_service');
  }

  /**
   * Fetches the count of Groups.io services based on query parameters
   */
  public async getServicesCount(req: Request, query: Record<string, unknown> = {}): Promise<number> {
    const params = {
      ...query,
      type: 'groupsio_service',
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single Groups.io service by ID
   */
  public async getServiceById(req: Request, serviceId: string): Promise<GroupsIOService> {
    const params = {
      type: 'groupsio_service',
      tags: `service_uid:${serviceId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOService>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Groups.io Service', serviceId, {
        operation: 'get_service_by_id',
        service: 'mailing_list_service',
        path: `/groupsio/services/${serviceId}`,
      });
    }

    const service = resources[0].data;

    // Add writer access field to the service
    return await this.accessCheckService.addAccessToResource(req, service, 'groupsio_service');
  }

  /**
   * Creates a new Groups.io service
   */
  public async createService(req: Request, data: CreateGroupsIOServiceRequest): Promise<GroupsIOService> {
    const newService = await this.microserviceProxy.proxyRequest<GroupsIOService>(req, 'LFX_V2_SERVICE', '/groupsio/services', 'POST', { v: '1' }, data);

    logger.debug(req, 'create_groupsio_service', 'Groups.io service created successfully', {
      service_uid: newService.uid,
      project_uid: newService.project_uid,
    });

    return newService;
  }

  /**
   * Updates an existing Groups.io service using ETag for concurrency control
   */
  public async updateService(req: Request, serviceId: string, data: UpdateGroupsIOServiceRequest): Promise<GroupsIOService> {
    // Step 1: Fetch service with ETag
    const { etag } = await this.etagService.fetchWithETag<GroupsIOService>(req, 'LFX_V2_SERVICE', `/groupsio/services/${serviceId}`, 'update_groupsio_service');

    // Step 2: Update service with ETag
    const updatedService = await this.etagService.updateWithETag<GroupsIOService>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/services/${serviceId}`,
      etag,
      data,
      'update_groupsio_service'
    );

    logger.debug(req, 'update_groupsio_service', 'Groups.io service updated successfully', {
      service_uid: serviceId,
    });

    return updatedService;
  }

  /**
   * Deletes a Groups.io service using ETag for concurrency control
   */
  public async deleteService(req: Request, serviceId: string): Promise<void> {
    // Step 1: Fetch service with ETag
    const { etag } = await this.etagService.fetchWithETag<GroupsIOService>(req, 'LFX_V2_SERVICE', `/groupsio/services/${serviceId}`, 'delete_groupsio_service');

    // Step 2: Delete service with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/groupsio/services/${serviceId}`, etag, 'delete_groupsio_service');

    logger.debug(req, 'delete_groupsio_service', 'Groups.io service deleted successfully', {
      service_uid: serviceId,
    });
  }

  // ============================================
  // Mailing List Methods
  // ============================================

  /**
   * Fetches all mailing lists based on query parameters
   */
  public async getMailingLists(req: Request, query: Record<string, unknown> = {}): Promise<GroupsIOMailingList[]> {
    const params = {
      ...query,
      type: 'groupsio_mailing_list',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    let mailingLists = resources.map((resource) => resource.data);

    // Enrich with service data
    mailingLists = await this.enrichWithServices(req, mailingLists);

    // Add writer access field to all mailing lists
    return await this.accessCheckService.addAccessToResources(req, mailingLists, 'groupsio_mailing_list');
  }

  /**
   * Fetches the count of mailing lists based on query parameters
   */
  public async getMailingListsCount(req: Request, query: Record<string, unknown> = {}): Promise<number> {
    const params = {
      ...query,
      type: 'groupsio_mailing_list',
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single mailing list by ID
   */
  public async getMailingListById(req: Request, mailingListId: string): Promise<GroupsIOMailingList> {
    const params = {
      type: 'groupsio_mailing_list',
      tags: `mailing_list_uid:${mailingListId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Mailing List', mailingListId, {
        operation: 'get_mailing_list_by_id',
        service: 'mailing_list_service',
        path: `/groupsio/mailing-lists/${mailingListId}`,
      });
    }

    // Enrich with service data (single item as array for reuse)
    const enriched = await this.enrichWithServices(req, [resources[0].data]);
    const mailingList = enriched[0];

    // Add writer access field to the mailing list
    return await this.accessCheckService.addAccessToResource(req, mailingList, 'groupsio_mailing_list');
  }

  /**
   * Creates a new mailing list
   */
  public async createMailingList(req: Request, data: CreateMailingListRequest): Promise<GroupsIOMailingList> {
    const newMailingList = await this.microserviceProxy.proxyRequest<GroupsIOMailingList>(
      req,
      'LFX_V2_SERVICE',
      '/groupsio/mailing-lists',
      'POST',
      { v: '1' },
      data
    );

    logger.debug(req, 'create_mailing_list', 'Mailing list created successfully', {
      mailing_list_uid: newMailingList.uid,
      service_uid: newMailingList.service_uid,
    });

    return newMailingList;
  }

  /**
   * Updates an existing mailing list using ETag for concurrency control
   */
  public async updateMailingList(req: Request, mailingListId: string, data: Partial<CreateMailingListRequest>): Promise<GroupsIOMailingList> {
    // Step 1: Fetch mailing list with ETag
    const { etag } = await this.etagService.fetchWithETag<GroupsIOMailingList>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}`,
      'update_mailing_list'
    );

    // Step 2: Update mailing list with ETag
    const updatedMailingList = await this.etagService.updateWithETag<GroupsIOMailingList>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}`,
      etag,
      data,
      'update_mailing_list'
    );

    logger.debug(req, 'update_mailing_list', 'Mailing list updated successfully', {
      mailing_list_uid: mailingListId,
    });

    return updatedMailingList;
  }

  /**
   * Deletes a mailing list using ETag for concurrency control
   */
  public async deleteMailingList(req: Request, mailingListId: string): Promise<void> {
    // Step 1: Fetch mailing list with ETag
    const { etag } = await this.etagService.fetchWithETag<GroupsIOMailingList>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}`,
      'delete_mailing_list'
    );

    // Step 2: Delete mailing list with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/groupsio/mailing-lists/${mailingListId}`, etag, 'delete_mailing_list');

    logger.debug(req, 'delete_mailing_list', 'Mailing list deleted successfully', {
      mailing_list_uid: mailingListId,
    });
  }

  // ============================================
  // Private Enrichment Methods
  // ============================================

  /**
   * Enriches mailing lists with service details
   * @description Fetches service data for mailing lists based on service_uid
   */
  private async enrichWithServices(req: Request, mailingLists: GroupsIOMailingList[]): Promise<GroupsIOMailingList[]> {
    // Get unique service UIDs from all mailing lists
    const uniqueServiceUids = [...new Set(mailingLists.filter((ml) => ml.service_uid).map((ml) => ml.service_uid))];

    if (uniqueServiceUids.length === 0) {
      return mailingLists;
    }

    logger.debug(req, 'enrich_mailing_list_services', 'Enriching mailing lists with service data', {
      unique_service_count: uniqueServiceUids.length,
      mailing_list_count: mailingLists.length,
    });

    // Fetch services in parallel
    const serviceMap = new Map<string, GroupsIOService | undefined>();
    await Promise.all(
      uniqueServiceUids.map(async (uid) => {
        try {
          const params = {
            type: 'groupsio_service',
            tags: `service_uid:${uid}`,
          };

          const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOService>>(
            req,
            'LFX_V2_SERVICE',
            '/query/resources',
            'GET',
            params
          );

          if (resources && resources.length > 0) {
            serviceMap.set(uid, resources[0].data);
          } else {
            serviceMap.set(uid, undefined);
          }
        } catch {
          logger.warning(req, 'enrich_mailing_list_services', 'Service fetch failed; continuing without service data', {
            service_uid: uid,
          });
          serviceMap.set(uid, undefined);
        }
      })
    );

    // Add service to each mailing list
    return mailingLists.map((ml) => {
      if (!ml.service_uid) {
        return ml;
      }

      const service = serviceMap.get(ml.service_uid);
      if (!service) {
        return ml;
      }

      return {
        ...ml,
        service,
      };
    });
  }
}
