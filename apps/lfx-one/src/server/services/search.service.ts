// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMember, MeetingRegistrant, QueryServiceResponse, UserSearchParams, UserSearchResponse, UserSearchResult } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling search operations across different resource types
 */
export class SearchService {
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
  }

  /**
   * Searches for users across meeting registrants and committee members
   */
  public async searchUsers(req: Request, params: UserSearchParams): Promise<UserSearchResponse> {
    const queryParams = {
      v: 1,
      ...(params.name ? { name: params.name } : {}),
      ...(params.tags ? { tags: params.tags } : {}),
      type: params.type,
      limit: params.limit || 50,
      offset: params.offset || 0,
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<MeetingRegistrant | CommitteeMember>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      queryParams
    );

    // Transform the resources to UserSearchResult format
    const results: UserSearchResult[] = resources.map((resource) => {
      const data = resource.data;

      if (params.type === 'meeting_registrant') {
        const registrant = data as MeetingRegistrant;
        return {
          uid: registrant.uid,
          email: registrant.email,
          first_name: registrant.first_name,
          last_name: registrant.last_name,
          job_title: registrant.job_title,
          organization: registrant.org_name
            ? {
                name: registrant.org_name,
                website: null,
              }
            : null,
          committee: null,
          type: 'meeting_registrant',
          username: registrant.username,
        };
      }
      const member = data as CommitteeMember;
      return {
        uid: member.uid,
        email: member.email,
        first_name: member.first_name,
        last_name: member.last_name,
        job_title: member.job_title || null,
        organization: member.organization
          ? {
              name: member.organization.name,
              website: member.organization.website || null,
            }
          : null,
        committee: {
          uid: member.committee_uid,
          name: member.committee_name,
        },
        type: 'committee_member',
        username: member.username || null,
      };
    });

    return {
      results,
      total: results.length,
      has_more: results.length === queryParams.limit,
    };
  }
}
