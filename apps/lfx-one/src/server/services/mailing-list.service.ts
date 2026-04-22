// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MailingListMemberDeliveryMode, MailingListMemberModStatus } from '@lfx-one/shared/enums';
import {
  CreateGroupsIOServiceRequest,
  CreateMailingListMemberRequest,
  CreateMailingListRequest,
  GroupsIOMailingList,
  GroupsIOService,
  MailingListMember,
  MyMailingList,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateGroupsIOServiceRequest,
  UpdateMailingListMemberRequest,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint, pollUntilIndexed } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling mailing list business logic
 * Supports Groups.io provider with extensible design for future providers
 */
export class MailingListService {
  private accessCheckService: AccessCheckService;
  private microserviceProxy: MicroserviceProxyService;
  private projectService: ProjectService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.projectService = new ProjectService();
  }

  // ============================================
  // Groups.io Service Methods
  // ============================================

  /**
   * Fetches all Groups.io services based on query parameters
   */
  public async getServices(req: Request, query: Record<string, unknown> = {}): Promise<GroupsIOService[]> {
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'groupsio_service',
    };

    const services = await fetchAllQueryResources<GroupsIOService>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOService>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

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
    const newService = await this.microserviceProxy.proxyRequest<GroupsIOService>(req, 'LFX_V2_SERVICE', '/groupsio/services', 'POST', undefined, data);

    logger.debug(req, 'create_groupsio_service', 'Groups.io service created successfully', {
      service_uid: newService.uid,
      project_uid: newService.project_uid,
    });

    // Poll the query service until the service is indexed
    const indexed = await this.pollUntilResourceIndexed<GroupsIOService>(req, 'create_groupsio_service', 'groupsio_service', 'service_uid', newService.uid, {
      service_uid: newService.uid,
    });

    if (!indexed) {
      logger.warning(req, 'create_groupsio_service', 'Service not yet indexed in query service, returning POST response', { service_uid: newService.uid });
    }
    return await this.accessCheckService.addAccessToResource(req, indexed ?? newService, 'groupsio_service');
  }

  /**
   * Updates an existing Groups.io service
   */
  public async updateService(req: Request, serviceId: string, data: UpdateGroupsIOServiceRequest): Promise<GroupsIOService> {
    const updatedService = await this.microserviceProxy.proxyRequest<GroupsIOService>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/services/${serviceId}`,
      'PUT',
      undefined,
      data
    );

    logger.debug(req, 'update_groupsio_service', 'Groups.io service updated successfully', {
      service_uid: serviceId,
    });

    // Poll the query service until the updated service is indexed
    const indexed = await this.pollUntilResourceIndexed<GroupsIOService>(req, 'update_groupsio_service', 'groupsio_service', 'service_uid', serviceId, {
      service_uid: serviceId,
    });

    return indexed ?? updatedService;
  }

  /**
   * Deletes a Groups.io service
   */
  public async deleteService(req: Request, serviceId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/groupsio/services/${serviceId}`, 'DELETE');

    logger.debug(req, 'delete_groupsio_service', 'Groups.io service deleted successfully', {
      service_uid: serviceId,
    });

    // Poll the query service until the service is removed from the index
    await this.pollUntilResourceRemoved(req, 'delete_groupsio_service', 'groupsio_service', 'service_uid', serviceId, {
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
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'groupsio_mailing_list',
    };

    let mailingLists = await fetchAllQueryResources<GroupsIOMailingList>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

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
      tags: `groupsio_mailing_list_uid:${mailingListId}`,
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
      undefined,
      data
    );

    logger.debug(req, 'create_mailing_list', 'Mailing list created successfully', {
      mailing_list_uid: newMailingList.uid,
      service_uid: newMailingList.service_uid,
    });

    // Poll the query service until the mailing list is indexed
    const indexed = await this.pollUntilResourceIndexed<GroupsIOMailingList>(
      req,
      'create_mailing_list',
      'groupsio_mailing_list',
      'groupsio_mailing_list_uid',
      newMailingList.uid,
      { mailing_list_uid: newMailingList.uid }
    );

    if (!indexed) {
      logger.warning(req, 'create_mailing_list', 'Mailing list not yet indexed in query service, returning POST response', {
        mailing_list_uid: newMailingList.uid,
      });
    }
    return await this.accessCheckService.addAccessToResource(req, indexed ?? newMailingList, 'groupsio_mailing_list');
  }

  /**
   * Updates an existing mailing list
   */
  public async updateMailingList(req: Request, mailingListId: string, data: Partial<CreateMailingListRequest>): Promise<GroupsIOMailingList> {
    const updatedMailingList = await this.microserviceProxy.proxyRequest<GroupsIOMailingList>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}`,
      'PUT',
      undefined,
      data
    );

    logger.debug(req, 'update_mailing_list', 'Mailing list updated successfully', {
      mailing_list_uid: mailingListId,
    });

    // Poll the query service until the updated mailing list is indexed
    const indexed = await this.pollUntilResourceIndexed<GroupsIOMailingList>(
      req,
      'update_mailing_list',
      'groupsio_mailing_list',
      'groupsio_mailing_list_uid',
      mailingListId,
      { mailing_list_uid: mailingListId }
    );

    return indexed ?? updatedMailingList;
  }

  /**
   * Deletes a mailing list
   */
  public async deleteMailingList(req: Request, mailingListId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/groupsio/mailing-lists/${mailingListId}`, 'DELETE');

    logger.debug(req, 'delete_mailing_list', 'Mailing list deleted successfully', {
      mailing_list_uid: mailingListId,
    });

    // Poll the query service until the mailing list is removed from the index
    await this.pollUntilResourceRemoved(req, 'delete_mailing_list', 'groupsio_mailing_list', 'groupsio_mailing_list_uid', mailingListId, {
      mailing_list_uid: mailingListId,
    });
  }

  // ============================================
  // My Mailing Lists (Me Lens)
  // ============================================

  /**
   * Fetches mailing lists the current user is a member of.
   * Queries by both email and username to ensure complete coverage.
   */
  public async getMyMailingLists(req: Request): Promise<MyMailingList[]> {
    // Get user identity from auth context
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    logger.debug(req, 'get_my_mailing_lists', 'Fetching mailing lists for current user', {
      username,
      has_email: !!email,
    });

    if (!username && !email) {
      return [];
    }

    // Query groupsio_member records by both email and username in parallel (with full pagination)
    const memberQueries: Promise<MailingListMember[]>[] = [];

    if (email) {
      memberQueries.push(
        fetchAllQueryResources<MailingListMember>(req, (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<MailingListMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            v: '1',
            type: 'groupsio_member',
            tags_all: [`email:${email}`],
            ...(pageToken && { page_token: pageToken }),
          })
        )
      );
    }

    if (username) {
      memberQueries.push(
        fetchAllQueryResources<MailingListMember>(req, (pageToken) =>
          this.microserviceProxy.proxyRequest<QueryServiceResponse<MailingListMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
            v: '1',
            type: 'groupsio_member',
            tags_all: [`username:${username}`],
            ...(pageToken && { page_token: pageToken }),
          })
        )
      );
    }

    const results = await Promise.all(memberQueries);

    // Deduplicate members by uid (a member might match both email and username)
    const memberMap = new Map<string, MailingListMember>();
    for (const members of results) {
      for (const member of members) {
        memberMap.set(member.uid, member);
      }
    }

    const allMembers = Array.from(memberMap.values());

    if (allMembers.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_mailing_lists', 'Found user memberships', {
      username,
      has_email: !!email,
      membership_count: allMembers.length,
    });

    // Build a map of mailing_list_uid → member details for quick lookup
    const membershipMap = new Map<string, { delivery_mode: MailingListMemberDeliveryMode; mod_status: MailingListMemberModStatus; member_uid: string }>();
    for (const m of allMembers) {
      membershipMap.set(m.mailing_list_uid, {
        delivery_mode: m.delivery_mode || MailingListMemberDeliveryMode.NORMAL,
        mod_status: m.mod_status || MailingListMemberModStatus.NONE,
        member_uid: m.uid,
      });
    }

    // Fetch mailing list details for each membership in parallel
    const mailingListUids = Array.from(membershipMap.keys());
    const mailingLists = await Promise.all(
      mailingListUids.map(async (uid) => {
        try {
          const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<GroupsIOMailingList>>(
            req,
            'LFX_V2_SERVICE',
            '/query/resources',
            'GET',
            {
              type: 'groupsio_mailing_list',
              tags: `groupsio_mailing_list_uid:${uid}`,
            }
          );

          if (!resources || resources.length === 0) {
            return null;
          }

          const mailingList = resources[0].data;
          const membership = membershipMap.get(uid)!;
          return {
            ...mailingList,
            my_delivery_mode: membership.delivery_mode,
            my_mod_status: membership.mod_status,
            my_member_uid: membership.member_uid,
          } as MyMailingList;
        } catch (error) {
          logger.warning(req, 'get_my_mailing_lists', 'Failed to enrich mailing list membership, skipping', {
            mailing_list_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      })
    );

    const result = mailingLists.filter((ml): ml is MyMailingList => ml !== null);

    // Enrich the committees array with committee names. The groupsio_mailing_list index
    // emits committees as { uid } only, so the Linked Groups column on the Me-lens table
    // was rendering empty tags. One batched committee-service query fills in the names.
    await this.enrichCommitteeNames(req, result);

    // Enrich with service data for correct email display in UI
    const enrichedWithServices = (await this.enrichWithServices(req, result)) as MyMailingList[];

    // Enrich with project data (name, slug, logo, etc.)
    return this.projectService.enrichWithProjectData(req, enrichedWithServices);
  }

  // ============================================
  // Mailing List Member Methods
  // ============================================

  /**
   * Fetches all members for a mailing list using query service
   */
  public async getMembers(req: Request, mailingListId: string, query: Record<string, unknown> = {}): Promise<MailingListMember[]> {
    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'groupsio_member',
      tags: `mailing_list_uid:${mailingListId}`,
    };

    const members = await fetchAllQueryResources<MailingListMember>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MailingListMember>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Add writer access field to all members
    return await this.accessCheckService.addAccessToResources(req, members, 'groupsio_member');
  }

  /**
   * Fetches the count of members for a mailing list
   */
  public async getMembersCount(req: Request, mailingListId: string, query: Record<string, unknown> = {}): Promise<number> {
    const params = {
      ...query,
      type: 'groupsio_member',
      tags: `mailing_list_uid:${mailingListId}`,
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single member by ID
   */
  public async getMemberById(req: Request, mailingListId: string, memberId: string): Promise<MailingListMember> {
    const member = await this.microserviceProxy.proxyRequest<MailingListMember>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}/members/${memberId}`,
      'GET'
    );

    // Add writer access field to the member
    return await this.accessCheckService.addAccessToResource(req, member, 'groupsio_member');
  }

  /**
   * Creates a new member in a mailing list
   */
  public async createMember(req: Request, mailingListId: string, data: CreateMailingListMemberRequest): Promise<MailingListMember> {
    const newMember = await this.microserviceProxy.proxyRequest<MailingListMember>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}/members`,
      'POST',
      undefined,
      data
    );

    logger.debug(req, 'create_mailing_list_member', 'Mailing list member created successfully', {
      mailing_list_uid: mailingListId,
      member_uid: newMember.uid,
    });

    // Poll the query service until the member is indexed
    const indexed = await this.pollUntilResourceIndexed<MailingListMember>(req, 'create_mailing_list_member', 'groupsio_member', 'member_uid', newMember.uid, {
      mailing_list_uid: mailingListId,
      member_uid: newMember.uid,
    });

    if (!indexed) {
      logger.warning(req, 'create_mailing_list_member', 'Member not yet indexed in query service, returning POST response', { member_uid: newMember.uid });
    }
    return await this.accessCheckService.addAccessToResource(req, indexed ?? newMember, 'groupsio_member');
  }

  /**
   * Updates an existing member
   */
  public async updateMember(req: Request, mailingListId: string, memberId: string, data: UpdateMailingListMemberRequest): Promise<MailingListMember> {
    const updatedMember = await this.microserviceProxy.proxyRequest<MailingListMember>(
      req,
      'LFX_V2_SERVICE',
      `/groupsio/mailing-lists/${mailingListId}/members/${memberId}`,
      'PUT',
      undefined,
      data
    );

    logger.debug(req, 'update_mailing_list_member', 'Mailing list member updated successfully', {
      mailing_list_uid: mailingListId,
      member_uid: memberId,
    });

    // Poll the query service until the updated member is indexed
    const indexed = await this.pollUntilResourceIndexed<MailingListMember>(req, 'update_mailing_list_member', 'groupsio_member', 'member_uid', memberId, {
      mailing_list_uid: mailingListId,
      member_uid: memberId,
    });

    return indexed ?? updatedMember;
  }

  /**
   * Deletes a member
   */
  public async deleteMember(req: Request, mailingListId: string, memberId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/groupsio/mailing-lists/${mailingListId}/members/${memberId}`, 'DELETE');

    logger.debug(req, 'delete_mailing_list_member', 'Mailing list member deleted successfully', {
      mailing_list_uid: mailingListId,
      member_uid: memberId,
    });

    // Poll the query service until the member is removed from the index
    await this.pollUntilResourceRemoved(req, 'delete_mailing_list_member', 'groupsio_member', 'member_uid', memberId, {
      mailing_list_uid: mailingListId,
      member_uid: memberId,
    });
  }

  // ============================================
  // Private Polling Helpers
  // ============================================

  private async pollUntilResourceIndexed<T>(
    req: Request,
    operation: string,
    type: string,
    tagKey: string,
    tagValue: string,
    metadata: Record<string, unknown>
  ): Promise<T | null> {
    return pollUntilIndexed<T>({
      req,
      operation,
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<T>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type,
          tags: `${tagKey}:${tagValue}`,
        });
        return resources.length > 0 ? resources[0].data : null;
      },
      metadata,
    });
  }

  private async pollUntilResourceRemoved(
    req: Request,
    operation: string,
    type: string,
    tagKey: string,
    tagValue: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const removed = await pollEndpoint({
      req,
      operation,
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<unknown>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type,
          tags: `${tagKey}:${tagValue}`,
        });
        return resources.length === 0;
      },
      metadata,
    });

    if (!removed) {
      logger.warning(req, operation, 'Resource not yet removed from query index', metadata);
    }
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

  /**
   * Enriches mailing-list committee references with committee names. Collects all unique
   * committee UIDs across the given lists and fetches them in one batched query-service call
   * (chunked at 100 UIDs), then mutates each list's `committees` entries in place with the
   * resolved name. On fetch failure, names are left unset — callers render a fallback.
   */
  private async enrichCommitteeNames(req: Request, lists: MyMailingList[]): Promise<void> {
    const uniqueCommitteeUids = Array.from(
      new Set(
        lists
          .flatMap((ml) => ml.committees ?? [])
          .map((c) => c?.uid)
          .filter((uid): uid is string => !!uid)
      )
    );
    if (uniqueCommitteeUids.length === 0) return;

    // URL-length guard — 100 UIDs per batch keeps query strings under ~5KB.
    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < uniqueCommitteeUids.length; i += BATCH_SIZE) {
      batches.push(uniqueCommitteeUids.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      batches.map((batch) =>
        fetchAllQueryResources<{ uid: string; name: string }>(
          req,
          (pageToken) =>
            this.microserviceProxy.proxyRequest<QueryServiceResponse<{ uid: string; name: string }>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
              v: '1',
              type: 'committee',
              filters_or: batch.map((uid) => `uid:${uid}`),
              page_size: 500,
              ...(pageToken && { page_token: pageToken }),
            }),
          { failOnPartial: true }
        ).catch((error) => {
          logger.warning(req, 'enrich_committee_names', 'Batched committee fetch failed, names left unset', {
            batch_size: batch.length,
            error: error instanceof Error ? error.message : String(error),
          });
          return [] as { uid: string; name: string }[];
        })
      )
    );

    const nameByUid = new Map<string, string>();
    for (const committee of batchResults.flat()) {
      if (committee?.uid && committee?.name) {
        nameByUid.set(committee.uid, committee.name);
      }
    }

    if (nameByUid.size === 0) return;

    for (const ml of lists) {
      if (!ml.committees || ml.committees.length === 0) continue;
      ml.committees = ml.committees.map((c) => {
        const name = c?.uid ? nameByUid.get(c.uid) : undefined;
        return name ? { ...c, name } : c;
      });
    }

    logger.debug(req, 'enrich_committee_names', 'Committee names attached to mailing lists', {
      unique_committees: uniqueCommitteeUids.length,
      resolved: nameByUid.size,
    });
  }
}
