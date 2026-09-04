// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT } from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, VoteResponseStatus } from '@lfx-one/shared/enums';
import {
  CreateVoteRequest,
  CreateVoteResponseRequest,
  IndexedVote,
  IndexedVoteResponse,
  MyVoteResponse,
  PaginatedResponse,
  QueryServiceCountResponse,
  QueryServiceResponse,
  UpdateVoteRequest,
  Vote,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { computeIsFoundation, sortCommentResponsesByRecency } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { fetchEntityProject, toEntityProjectFields } from '../helpers/entity-project-enrichment.helper';
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
   * Fetches a single page of votes using cursor-based pagination — callers paginate via the returned page_token.
   * `includeProject` (default true) enriches rows with `project_name`, `project_slug`, `is_foundation` and `parent_project_uid`; opt out when the caller discards them.
   */
  public async getVotes(req: Request, query: Record<string, unknown> = {}, options: { includeProject?: boolean } = {}): Promise<PaginatedResponse<Vote>> {
    const { includeProject = true } = options;
    logger.debug(req, 'get_votes', 'Starting vote fetch', {
      query_params: Object.keys(query),
    });

    const params = {
      ...query,
      type: 'vote',
    };

    const { resources, page_token } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVote>>(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      params
    );

    const normalized = resources.map((resource) => this.normalizeIndexedVote(req, resource.data));
    // Enrich list rows with canonical project fields — the vote index (VoteData) carries only
    // project_uid/name, so without this, consumers deriving per-row edit links get no slug/tier.
    const votes = includeProject ? await this.enrichWithProjectMetadata(req, normalized) : normalized;

    logger.debug(req, 'get_votes', 'Completed vote fetch', {
      final_count: votes.length,
      has_more_pages: !!page_token,
    });

    return { data: votes, page_token };
  }

  /**
   * Fetches the count of votes based on query parameters
   */
  public async getVotesCount(req: Request, query: Record<string, unknown> = {}): Promise<number> {
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
   * Fetches a single vote by UID. `includeProject` enriches the payload with the vote's project fields
   * (slug/name/is_foundation) so clients can reconcile project context from the vote itself.
   */
  public async getVoteById(req: Request, voteUid: string, options: { includeProject?: boolean } = {}): Promise<Vote> {
    const { includeProject = false } = options;
    logger.debug(req, 'get_vote_by_id', 'Fetching vote by ID', {
      vote_uid: voteUid,
    });

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(voteUid)}`, 'GET');

    if (!vote || !vote.uid) {
      throw new ResourceNotFoundError('Vote', voteUid, {
        operation: 'get_vote_by_id',
        service: 'vote_service',
        path: `/votes/${this.encodeVoteUid(voteUid)}`,
      });
    }

    if (includeProject) {
      const project = await fetchEntityProject(req, this.projectService, vote.project_uid, {
        operation: 'get_vote_by_id',
        vote_uid: vote.uid,
      });
      if (project) {
        Object.assign(vote, toEntityProjectFields(project));
      }
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
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote',
          tags: voteUid,
        });
        if (resources.length > 0) {
          fetchedVote = this.normalizeIndexedVote(req, resources[0].data);
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

    const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(voteUid)}`, 'PUT', undefined, voteData);

    return vote;
  }

  /**
   * Deletes a vote directly via microservice proxy
   */
  public async deleteVote(req: Request, voteUid: string): Promise<void> {
    logger.debug(req, 'delete_vote', 'Deleting vote', {
      vote_uid: voteUid,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(voteUid)}`, 'DELETE');

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

    await this.microserviceProxy.proxyRequestWithResponse<Vote>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(voteUid)}/enable`, 'PUT');

    // Poll the query service until the indexed vote status is 'active'.
    let fetchedVote: Vote | undefined;

    const resolved = await pollEndpoint({
      req,
      operation: 'enable_vote',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote',
          tags: voteUid,
        });
        if (resources.length > 0 && resources[0].data.status === 'active') {
          fetchedVote = this.normalizeIndexedVote(req, resources[0].data);
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
   * Fetches aggregated vote results for a given vote.
   */
  public async getVoteResults(req: Request, voteUid: string): Promise<VoteResultsResponse> {
    logger.debug(req, 'get_vote_results', 'Fetching vote results', { vote_uid: voteUid });

    const results = await this.microserviceProxy.proxyRequest<VoteResultsResponse>(
      req,
      'LFX_V2_SERVICE',
      `/votes/${this.encodeVoteUid(voteUid)}/results`,
      'GET'
    );

    // The API client maps an empty response body to null; a 200 with no payload is anomalous
    // (the upstream results contract always returns a body), so fail loudly — passing null
    // through would emit a 200 that the results drawer renders as a genuine zero-response vote
    // ("No responses yet") instead of its error state.
    if (!results) {
      throw new MicroserviceError('Vote results response body was empty', 502, 'VOTE_RESULTS_EMPTY', {
        operation: 'get_vote_results',
        service: 'vote_service',
        path: `/votes/${this.encodeVoteUid(voteUid)}/results`,
      });
    }

    // Aggregate bound: the upstream results contract has no pagination, so cap each prompt's
    // responses at the most recent N to keep the payload linear in prompt count rather than
    // electorate size (defense against multi-MB payloads on large votes). The pre-cap count is
    // reported via total_responses so the UI can disclose truncation.
    for (const commentResult of results?.comment_results ?? []) {
      // Normalize to an array before touching length — this loop is the single aggregation point for
      // comment results, so it is the cheapest place to stay robust if `responses` is ever missing (deploy-order skew).
      const responses = commentResult.responses ?? [];
      commentResult.total_responses = responses.length;
      commentResult.responses =
        responses.length > VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT
          ? sortCommentResponsesByRecency(responses).slice(0, VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT)
          : responses;
    }

    logger.debug(req, 'get_vote_results', 'Completed vote results fetch', {
      vote_uid: voteUid,
      num_poll_results: results?.poll_results?.length ?? 0,
      num_votes_cast: results?.num_votes_cast,
    });

    return results;
  }

  /**
   * Submits a ballot via POST /vote_responses using the user's bearer token (no M2M),
   * then polls until the query service indexes the response as 'responded'.
   */
  public async createVoteResponse(req: Request, payload: CreateVoteResponseRequest): Promise<void> {
    logger.debug(req, 'create_vote_response', 'Submitting vote response', {
      vote_uid: payload.vote_uid,
      vote_response_uid: payload.vote_response_uid,
      abstain: payload.abstain,
      answer_count: payload.user_vote_content?.length ?? 0,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', '/vote_responses', 'POST', undefined, payload, {
      ['X-Sync']: 'true',
    });

    logger.debug(req, 'create_vote_response', 'Ballot accepted by upstream voting service, polling query service', {
      vote_uid: payload.vote_uid,
      vote_response_uid: payload.vote_response_uid,
    });

    const resolved = await pollEndpoint({
      req,
      operation: 'create_vote_response_poll',
      pollFn: async () => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVoteResponse>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'vote_response',
            filter_grants: 'direct',
            filters: [`vote_uid:${payload.vote_uid}`],
          }
        );
        return resources.some((r) => r.data.uid === payload.vote_response_uid && r.data.vote_status === IndexedVoteResponseStatus.RESPONDED);
      },
      maxRetries: 5,
      retryDelayMs: 1000,
      metadata: { vote_uid: payload.vote_uid, vote_response_uid: payload.vote_response_uid },
    });

    if (!resolved) {
      logger.warning(req, 'create_vote_response', 'Vote response not yet indexed, client may see stale state', {
        vote_uid: payload.vote_uid,
        vote_response_uid: payload.vote_response_uid,
      });
    }
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

    // vote_response uses 'user_email' not 'email'.
    const filtersOr: string[] = [];
    if (email) filtersOr.push(`user_email:${email}`);
    if (username) filtersOr.push(`username:${username}`);

    const responses = await fetchAllQueryResources<{ vote_uid: string; vote_status?: IndexedVoteResponseStatus }>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<{ vote_uid: string; vote_status?: IndexedVoteResponseStatus }>>(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        {
          type: 'vote_response',
          filters_or: filtersOr,
          ...(pageToken && { page_token: pageToken }),
        }
      )
    );

    const respondedVoteUids = new Set<string>();
    for (const r of responses) {
      if (r.vote_uid && r.vote_status === IndexedVoteResponseStatus.RESPONDED) respondedVoteUids.add(r.vote_uid);
    }

    // Extract unique vote UIDs
    const voteUids = [...new Set(responses.filter((r) => r.vote_uid).map((r) => r.vote_uid))];

    if (voteUids.length === 0) {
      return [];
    }

    logger.debug(req, 'get_my_votes', 'Found user vote responses', {
      response_count: responses.length,
      unique_vote_count: voteUids.length,
      responded_count: respondedVoteUids.size,
    });

    // Decorate each Vote with response_status so the Me-lens UI can branch cast vs view.
    const votes = await Promise.all(
      voteUids.map(async (uid): Promise<Vote | null> => {
        try {
          const vote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(uid)}`, 'GET');
          if (!vote) return vote;
          const decorated: Vote = {
            ...vote,
            response_status: respondedVoteUids.has(uid) ? VoteResponseStatus.RESPONDED : VoteResponseStatus.AWAITING_RESPONSE,
          };
          return decorated;
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

    return this.enrichWithProjectMetadata(req, sorted);
  }

  /** POST /vote_responses requires the pre-allocated invitation row's UID — a fresh UUID returns 404 upstream. */
  public async getMyVoteResponse(req: Request, voteUid: string): Promise<MyVoteResponse | null> {
    const rawUsername = await getUsernameFromAuth(req);
    const username = rawUsername ? stripAuthPrefix(rawUsername) : null;
    const email = getEffectiveEmail(req);

    if (!username && !email) return null;

    const filtersOr: string[] = [];
    if (email) filtersOr.push(`user_email:${email}`);
    if (username) filtersOr.push(`username:${username}`);

    // `filters` narrows on vote_uid at the index, avoiding a full-history scan per drawer open;
    // `filters_or` then disjuncts the user-identity match. Both AND together.
    const responses = await fetchAllQueryResources<MyVoteResponse>(req, (pageToken) =>
      this.microserviceProxy.proxyRequest<QueryServiceResponse<MyVoteResponse>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters: [`vote_uid:${voteUid}`],
        filters_or: filtersOr,
        ...(pageToken && { page_token: pageToken }),
      })
    );

    // Defensive: `r.uid` should always be populated by the indexer, but fall back to `vote_id`
    // (the v1 alias) if it isn't — logging the anomaly so we catch any indexer drift.
    const match = responses.find((r) => r?.vote_uid === voteUid && (!!r?.uid || !!r?.vote_id));
    if (match && !match.uid && match.vote_id) {
      logger.warning(req, 'get_my_vote_response', 'vote_response row missing uid; falling back to vote_id', { vote_uid: voteUid, vote_id: match.vote_id });
      return { ...match, uid: match.vote_id };
    }
    return match ?? null;
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Batch-enriches rows via the ungated query-service lookup — the gated `/projects/:uid` path 403s for
   * committee writers without a project viewer relation, leaving foundation rows without slug/tier.
   */
  private async enrichWithProjectMetadata(req: Request, votes: Vote[]): Promise<Vote[]> {
    const projectsByUid = await this.projectService.getProjectsByIds(
      req,
      votes.map((vote) => vote.project_uid)
    );

    return votes.map((vote) => {
      const project = projectsByUid.get(vote.project_uid);
      if (!project) return vote;
      return {
        ...vote,
        project_name: project.name || vote.project_name,
        project_slug: project.slug || vote.project_slug,
        is_foundation: computeIsFoundation(project),
        parent_project_uid: project.parent_uid || vote.parent_project_uid,
      };
    });
  }

  /**
   * Normalizes a vote from the query service indexer shape (vote_uid) to the
   * canonical REST shape (uid). The voting service indexes votes with `vote_uid`
   * while the REST API returns `uid` — these are the same value, different field names.
   */
  private normalizeIndexedVote(req: Request, raw: IndexedVote): Vote {
    const uid = raw.uid || raw.vote_uid;
    if (!uid) {
      logger.warning(req, 'normalize_indexed_vote', 'Indexed vote missing uid and vote_uid', {
        name: raw.name,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { vote_uid: _discard, ...rest } = raw;
    return { ...rest, uid: uid ?? '' };
  }

  // encodeURIComponent leaves `.` untouched, so reject exact dot segments — otherwise
  // the fetch URL parser normalizes `/votes/..` to `/`, reshaping the upstream path.
  private encodeVoteUid(uid: string): string {
    if (uid === '.' || uid === '..') {
      throw ServiceValidationError.forField('uid', 'Invalid vote UID', { operation: 'encode_vote_uid', service: 'vote_service' });
    }
    return encodeURIComponent(uid);
  }
}
