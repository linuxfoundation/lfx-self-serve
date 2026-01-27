// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateVoteRequest, QueryServiceResponse, UpdateVoteRequest, Vote } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ResourceNotFoundError } from '../errors';
import { ETagService } from './etag.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Service for handling vote/poll business logic with microservice proxy
 */
export class VoteService {
  private etagService: ETagService;
  private microserviceProxy: MicroserviceProxyService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.etagService = new ETagService();
  }

  /**
   * Fetches all votes based on query parameters
   * Uses query service which returns Vote entities
   */
  public async getVotes(req: Request, query: Record<string, any> = {}): Promise<Vote[]> {
    logger.debug(req, 'get_votes', 'Starting vote fetch', {
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: 'vote',
    };

    const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', params);

    logger.debug(req, 'get_votes', 'Fetched resources from query service', {
      count: resources.length,
    });

    const votes: Vote[] = resources.map((resource) => resource.data);

    logger.debug(req, 'get_votes', 'Completed vote fetch', {
      final_count: votes.length,
    });

    return votes;
  }

  /**
   * Fetches a single vote by UID
   */
  public async getVoteById(req: Request, voteUid: string): Promise<Vote> {
    logger.debug(req, 'get_vote_by_id', 'Fetching vote by ID', {
      vote_uid: voteUid,
    });

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'GET');

    if (!vote || !vote.vote_uid) {
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

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData, {
      ['X-Sync']: 'true',
    });

    return vote;
  }

  /**
   * Updates a vote using ETag for concurrency control
   */
  public async updateVote(req: Request, voteUid: string, voteData: UpdateVoteRequest): Promise<Vote> {
    // Step 1: Fetch vote with ETag
    const { etag } = await this.etagService.fetchWithETag<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'update_vote');

    const sanitizedPayload = logger.sanitize({ voteData });
    logger.debug(req, 'update_vote', 'Updating vote payload', sanitizedPayload);

    // Step 2: Update vote with ETag
    const vote = await this.etagService.updateWithETag<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, etag, voteData, 'update_vote');

    return vote;
  }

  /**
   * Deletes a vote using ETag for concurrency control
   */
  public async deleteVote(req: Request, voteUid: string): Promise<void> {
    logger.debug(req, 'delete_vote', 'Deleting vote with ETag', {
      vote_uid: voteUid,
    });

    // Step 1: Fetch vote with ETag
    const { etag } = await this.etagService.fetchWithETag<Vote>(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, 'delete_vote');

    logger.debug(req, 'delete_vote', 'Fetched ETag for deletion', {
      vote_uid: voteUid,
    });

    // Step 2: Delete vote with ETag
    await this.etagService.deleteWithETag(req, 'LFX_V2_SERVICE', `/votes/${voteUid}`, etag, 'delete_vote');
  }
}
