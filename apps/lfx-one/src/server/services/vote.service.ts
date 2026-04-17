// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateVoteRequest, QueryServiceCountResponse, QueryServiceResponse, UpdateVoteRequest, Vote, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { getEffectiveEmail, getUsernameFromAuth, stripAuthPrefix } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling vote/poll business logic with microservice proxy
 */
export class VoteService {
  private microserviceProxy: MicroserviceProxyService;
  private projectService: ProjectService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.projectService = new ProjectService();
  }

  /**
   * Fetches all votes based on query parameters
   */
  public async getVotes(req: Request, query: Record<string, any> = {}): Promise<Vote[]> {
    logger.debug(req, 'get_votes', 'Starting vote fetch', {
      query_params: Object.keys(query),
    });

    const queryFilters = { ...query };
    delete queryFilters['page_token'];
    delete queryFilters['page_size'];

    const params = {
      ...queryFilters,
      type: 'vote',
    };

    const votes = await fetchAllQueryResources<Vote>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        ...params,
        page_size: 100,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    logger.debug(req, 'get_votes', 'Completed vote fetch', {
      final_count: votes.length,
    });

    return votes;
  }

  /**
   * Fetches the count of votes based on query parameters
   */
  public async getVotesCount(req: Request, query: Record<string, any> = {}): Promise<number> {
    logger.debug(req, 'get_votes_count', 'Fetching vote count', {
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: 'vote',
    };

    const { count } = await this.microserviceProxy.proxyRequest<QueryServiceCountResponse>(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', params);

    return count;
  }

  /**
   * Fetches a single vote by UID
   */
  public async getVoteById(req: Request, voteUid: string): Promise<Vote> {
    logger.debug(req, 'get_vote_by_id', 'Fetching vote by ID', {
      vote_uid: voteUid,
    });

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'GET');

    if (!vote || !vote.uid) {
      throw new ResourceNotFoundError('Vote', voteUid, {
        operation: 'get_vote_by_id',
        service: 'vote_service',
        path: `/votes/${voteUid}`,
      });
    }

    logger.debug(req, 'get_vote_by_id', 'Completed vote fetch', {
      vote_uid: voteUid,
    });

    return vote;
  }

  /**
   * Creates a new vote/poll
   */
  public async createVote(req: Request, voteData: CreateVoteRequest): Promise<Vote> {
    const sanitizedPayload = logger.sanitize({ voteData });
    logger.debug(req, 'create_vote', 'Creating vote payload', sanitizedPayload);

    const newVote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData, {
      ['X-Sync']: 'true',
    });

    // After creating, poll the query service until the vote is indexed.
    // The query service uses eventual consistency, so the vote may not appear immediately.
    const voteUid = newVote.uid;
    let fetchedVote: Vote | undefined;

    const resolved = await pollEndpoint({
      req,
      operation: 'create_vote',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote',
          tags: voteUid,
        });
        if (resources.length > 0) {
          fetchedVote = resources[0].data;
          return true;
        }
        return false;
      },
      metadata: { vote_uid: voteUid },
    });

    if (resolved && fetchedVote) {
      return fetchedVote;
    }

    logger.warning(req, 'create_vote', 'Vote not yet indexed in query service, returning POST response', { vote_uid: voteUid });
    return newVote;
  }

  /**
   * Updates a vote directly via microservice proxy
   */
  public async updateVote(req: Request, voteUid: string, voteData: UpdateVoteRequest): Promise<Vote> {
    const sanitizedPayload = logger.sanitize({ voteData });
    logger.debug(req, 'update_vote', 'Updating vote payload', sanitizedPayload);

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'PUT', undefined, voteData);

    return vote;
  }

  /**
   * Deletes a vote directly via microservice proxy
   */
  public async deleteVote(req: Request, voteUid: string): Promise<void> {
    logger.debug(req, 'delete_vote', 'Deleting vote', {
      vote_uid: voteUid,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'DELETE');

    // Poll the query service until the vote is removed from the index
    await pollEndpoint({
      req,
      operation: 'delete_vote',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote',
          tags: voteUid,
        });
        return resources.length === 0;
      },
      metadata: { vote_uid: voteUid },
    });
  }

  /**
   * Enables a vote (changes status from disabled to active)
   */
  public async enableVote(req: Request, voteUid: string): Promise<Vote> {
    logger.debug(req, 'enable_vote', 'Enabling vote', {
      vote_uid: voteUid,
    });

    await this.microserviceProxy.proxyRequestWithResponse<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}/enable`, 'PUT');

    // Poll the query service until the indexed vote status is 'active'.
    let fetchedVote: Vote | undefined;

    const resolved = await pollEndpoint({
      req,
      operation: 'enable_vote',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote',
          tags: voteUid,
        });
        if (resources.length > 0 && resources[0].data.status === 'active') {
          fetchedVote = resources[0].data;
          return true;
        }
        return false;
      },
      metadata: { vote_uid: voteUid },
      maxRetries: 7,
    });

    if (resolved && fetchedVote) {
      logger.debug(req, 'enable_vote', 'Vote enabled and indexed', {
        vote_uid: voteUid,
        status: fetchedVote.status,
      });
      return fetchedVote;
    }

    logger.warning(req, 'enable_vote', 'Vote not yet indexed as active, returning minimal response', { vote_uid: voteUid });
    return { uid: voteUid, status: 'active' } as Vote;
  }

  /**
   * Fetches aggregated vote results for a given vote
   */
  public async getVoteResults(req: Request, voteUid: string): Promise<VoteResultsResponse> {
    logger.debug(req, 'get_vote_results', 'Fetching vote results', { vote_uid: voteUid });

    const results = await this.microserviceProxy.proxyRequest<VoteResultsResponse>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}/results`, 'GET');

    logger.debug(req, 'get_vote_results', 'Completed vote results fetch', {
      vote_uid: voteUid,
      num_poll_results: results.poll_results?.length ?? 0,
      num_votes_cast: results.num_votes_cast,
    });

    return results;
  }

  // ============================================
  // My Votes (Me Lens)
  // ============================================

  /**
   * Fetches votes the current user has been invited to.
   * Queries vote_response records by user_email and username using filters_or.
   */
  public async getMyVotes(req: Request): Promise<Vote[]> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    logger.debug(req, 'get_my_votes', 'Fetching votes for current user', {
      username,
      has_email: !!email,
    });

    if (!username && !email) {
      return [];
    }

    // Build filters_or array — note: vote_response uses 'user_email' not 'email'
    const filtersOr: string[] = [];
    if (email) {
      filtersOr.push(`user_email:${email}`);
    }
    if (username) {
      filtersOr.push(`username:${username}`);
    }

    // Query vote_response records using filters_or (OR logic on data fields)
    const responses = await fetchAllQueryResources<{ vote_uid: string }>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<{ vote_uid: string }>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        page_size: 100,
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Extract unique vote UIDs
    const voteUids = [...new Set(responses.filter((r) => r.vote_uid).map((r) => r.vote_uid))];

    if (voteUids.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_votes', 'Found user vote responses', {
      response_count: responses.length,
      unique_vote_count: voteUids.length,
    });

    // Fetch vote details in parallel via the voting microservice
    const votes = await Promise.all(
      voteUids.map(async (uid) => {
        try {
          return await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${uid}`, 'GET');
        } catch (error) {
          logger.warning(req, 'get_my_votes', 'Failed to fetch vote details, skipping', {
            vote_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      })
    );

    // Sort: active votes first, then by end_time descending
    const sorted = votes
      .filter((v): v is Vote => v !== null)
      .sort((a, b) => {
        const aActive = a.status === 'active' ? 0 : 1;
        const bActive = b.status === 'active' ? 0 : 1;
        if (aActive !== bActive) {
          return aActive - bActive;
        }
        return new Date(b.end_time).getTime() - new Date(a.end_time).getTime();
      });

    return this.projectService.enrichWithProjectData(req, sorted);
  }
}
