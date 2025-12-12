// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  Committee,
  CommitteeCreateData,
  CommitteeMember,
  CommitteeSettingsData,
  CommitteeUpdateData,
  CreateCommitteeMemberRequest,
  QueryServiceCountResponse,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { AccessCheckService } from './access-check.service';
import { ETagService } from './etag.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling committee business logic
 */
export class CommitteeService {
  private accessCheckService: AccessCheckService;
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.accessCheckService = new AccessCheckService();
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
  }

  /**
   * Fetches all committees based on query parameters
   */
  public async getCommittees(req: Request, query: Record<string, any> = {}): Promise<Committee[]> {
    const params = {
      ...query,
      type: 'committee',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    let committees = resources.map((resource) => resource.data);

    // Get member count for each committee
    committees = await Promise.all(
      committees.map(async (committee) => {
        const memberCount = await this.getCommitteeMembersCount(req, committee.uid);
        return {
          ...committee,
          total_members: memberCount,
        };
      })
    );

    // Add writer access field to all committees
    return await this.accessCheckService.addAccessToResources(req, committees, 'committee');
  }

  /**
   * Fetches the count of committees based on query parameters
   */
  public async getCommitteesCount(req: Request, query: Record<string, any> = {}): Promise<number> {
    const params = {
      ...query,
      type: 'committee',
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single committee by ID
   */
  public async getCommitteeById(req: Request, committeeId: string): Promise<Committee> {
    const params = {
      type: 'committee',
      tags: `committee_uid:${committeeId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Committee>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Committee', committeeId, {
        operation: 'get_committee_by_id',
        service: 'committee_service',
        path: `/committees/${committeeId}`,
      });
    }

    const committee = resources[0].data;

    // Add writer access field to the committee
    return await this.accessCheckService.addAccessToResource(req, committee, 'committee');
  }

  /**
   * Creates a new committee with optional settings
   */
  public async createCommittee(req: Request, data: CommitteeCreateData): Promise<Committee> {
    // Extract settings fields
    const { business_email_required, is_audit_enabled, ...committeeData } = data;

    // Step 1: Create committee
    const newCommittee = await this.microserviceProxy.proxyRequest<Committee>(req, 'LFX_V2_SERVICE', '/committees', 'POST', {}, committeeData);

    // Step 2: Update settings if provided
    if (business_email_required !== undefined || is_audit_enabled !== undefined) {
      try {
        await this.updateCommitteeSettings(req, newCommittee.uid, { business_email_required, is_audit_enabled });
      } catch {
        logger.warning(req, 'create_committee_settings', 'Failed to update committee settings, but committee was created successfully', {
          committee_uid: newCommittee.uid,
        });
      }
    }

    return {
      ...newCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
    };
  }

  /**
   * Updates an existing committee using ETag for concurrency control
   */
  public async updateCommittee(req: Request, committeeId: string, data: CommitteeUpdateData): Promise<Committee> {
    // Extract settings fields
    const { business_email_required, is_audit_enabled, ...committeeData } = data;

    // Step 1: Fetch committee with ETag
    const { etag } = await this.etagService.fetchWithETag<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'update_committee');

    // Step 2: Update committee with ETag
    const updatedCommittee = await this.etagService.updateWithETag<Committee>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}`,
      etag,
      committeeData,
      'update_committee'
    );

    // Step 3: Update settings if provided
    if (business_email_required !== undefined || is_audit_enabled !== undefined) {
      try {
        await this.updateCommitteeSettings(req, committeeId, { business_email_required, is_audit_enabled });
      } catch {
        logger.warning(req, 'update_committee_settings', 'Failed to update committee settings, but committee was updated successfully', {
          committee_uid: committeeId,
        });
      }
    }

    return {
      ...updatedCommittee,
      ...(business_email_required !== undefined && { business_email_required }),
      ...(is_audit_enabled !== undefined && { is_audit_enabled }),
    };
  }

  /**
   * Deletes a committee using ETag for concurrency control
   */
  public async deleteCommittee(req: Request, committeeId: string): Promise<void> {
    // Step 1: Fetch committee with ETag
    const { etag } = await this.etagService.fetchWithETag<Committee>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, 'delete_committee');

    // Step 2: Delete committee with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}`, etag, 'delete_committee');
  }

  /**
   * Fetches all members for a specific committee
   */
  public async getCommitteeMembers(req: Request, committeeId: string, query: Record<string, any> = {}): Promise<CommitteeMember[]> {
    const params = {
      ...query,
      type: 'committee_member',
      tags: `committee_uid:${committeeId}`,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      `/query/resources`,
      'GET',
      params
    );

    return resources.map((resource) => resource.data);
  }

  /**
   * Fetches count of all members for a specific committee
   */
  public async getCommitteeMembersCount(req: Request, committeeId: string, query: Record<string, any> = {}): Promise<number> {
    logger.debug(req, 'get_committee_members_count', 'Fetching committee members count', {
      committee_uid: committeeId,
      query,
    });

    const params = {
      ...query,
      type: 'committee_member',
      tags: `committee_uid:${committeeId}`,
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', `/query/resources/count`, 'GET', params);

    return count;
  }

  /**
   * Fetches a single committee member by ID
   */
  public async getCommitteeMemberById(req: Request, committeeId: string, memberId: string): Promise<CommitteeMember> {
    const params = {
      type: 'committee_member',
      parent: `committee_member:${memberId}`,
      committee_uid: committeeId,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    if (!resources || resources.length === 0) {
      throw new ResourceNotFoundError('Committee member', memberId, {
        operation: 'get_committee_member_by_id',
        service: 'committee_service',
        path: `/committees/${committeeId}/members/${memberId}`,
      });
    }

    return resources[0].data;
  }

  /**
   * Creates a new committee member
   */
  public async createCommitteeMember(req: Request, committeeId: string, data: CreateCommitteeMemberRequest): Promise<CommitteeMember> {
    const newMember = await this.microserviceProxy.proxyRequest<CommitteeMember>(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/members`, 'POST', {}, data);

    logger.debug(req, 'create_committee_member', 'Committee member created successfully', {
      committee_uid: committeeId,
      member_uid: newMember.uid,
    });

    return newMember;
  }

  /**
   * Updates an existing committee member using ETag for concurrency control
   */
  public async updateCommitteeMember(
    req: Request,
    committeeId: string,
    memberId: string,
    data: Partial<CreateCommitteeMemberRequest>
  ): Promise<CommitteeMember> {
    // Validate committee exists first
    await this.getCommitteeById(req, committeeId);

    // Step 1: Fetch member with ETag
    const { etag } = await this.etagService.fetchWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      'update_committee_member'
    );

    // Step 2: Update member with ETag
    const updatedMember = await this.etagService.updateWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      etag,
      data,
      'update_committee_member'
    );

    logger.debug(req, 'update_committee_member', 'Committee member updated successfully', {
      committee_uid: committeeId,
      member_uid: memberId,
    });

    return updatedMember;
  }

  /**
   * Deletes a committee member using ETag for concurrency control
   */
  public async deleteCommitteeMember(req: Request, committeeId: string, memberId: string): Promise<void> {
    // Validate committee exists first
    await this.getCommitteeById(req, committeeId);

    // Step 1: Fetch member with ETag
    const { etag } = await this.etagService.fetchWithETag<CommitteeMember>(
      req,
      'LFX_V2_SERVICE',
      `/committees/${committeeId}/members/${memberId}`,
      'delete_committee_member'
    );

    // Step 2: Delete member with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/members/${memberId}`, etag, 'delete_committee_member');

    logger.debug(req, 'delete_committee_member', 'Committee member deleted successfully', {
      committee_uid: committeeId,
      member_uid: memberId,
    });
  }

  /**
   * Fetches committee memberships for a specific user filtered by committee category
   * Used to determine user persona based on committee membership
   * @param req - Express request object
   * @param username - Username to filter by
   * @param userEmail - User email to filter by (as fallback)
   * @param category - Committee category to filter (currently supports: 'Board', 'Maintainers')
   */
  public async getCommitteeMembersByCategory(req: Request, username: string, userEmail: string, category: string): Promise<CommitteeMember[]> {
    const params = {
      v: '1',
      type: 'committee_member',
      tags_all: [`username:${username}`, `committee_category:${category}`],
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    const userMemberships = resources.map((resource) => resource.data);

    logger.debug(req, 'get_committee_members_by_category', 'Committee memberships retrieved', {
      username,
      category,
      memberships_count: userMemberships.length,
    });

    return userMemberships;
  }

  /**
   * Updates committee settings (business_email_required, is_audit_enabled)
   */
  private async updateCommitteeSettings(req: Request, committeeId: string, settings: CommitteeSettingsData): Promise<void> {
    const settingsData = {
      ...(settings.business_email_required !== undefined && {
        business_email_required: settings.business_email_required,
      }),
      ...(settings.is_audit_enabled !== undefined && {
        is_audit_enabled: settings.is_audit_enabled,
      }),
    };

    await this.microserviceProxy.proxyRequest(req, 'LFX_V2_SERVICE', `/committees/${committeeId}/settings`, 'PUT', {}, settingsData);

    logger.debug(req, 'update_committee_settings', 'Committee settings updated successfully', {
      committee_uid: committeeId,
      settings_data: settingsData,
    });
  }
}
