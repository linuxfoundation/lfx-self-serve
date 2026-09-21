// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MIN_VIABLE_REQUEST_BUDGET_MS, VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT } from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, PollStatus, VoteResponseStatus } from '@lfx-one/shared/enums';
import {
  ApiRequestOptions,
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteResponse,
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
  /**
   * Enable-PUT retry grid for the FGA replication gap (GH-1637): bounded at 3 attempts, 600 ms
   * apart — paid on a 403 (the replication gap or a genuine denial, which the BFF cannot tell
   * apart); the happy path pays nothing. Attempt counts and fixed sleeps alone can't bound
   * wall-clock time (a slow 403 returns as late as the request timeout), so the loop runs under
   * the shared `enableEndToEndMaxDurationMs` deadline.
   */
  private static readonly enableMaxAttempts = 3;
  private static readonly enableRetryDelayMs = 600;

  /**
   * Attempt-1 enable PUT budget (GH-2729 review M-1), exempt from the
   * `enableEndToEndMaxDurationMs` retry deadline: 16 s is the v2 voting-api's hardcoded
   * `WriteTimeout: 15s` (cmd/voting-api/main.go) plus a 1 s transport margin — this timer starts
   * before gateway/network transit while the server's write deadline starts after the request
   * arrives, so an exact 15 s could still abort a response completing just under the upstream
   * limit (PR #2797 review). A slower enable can never return successfully end-to-end, so the
   * first attempt gets the full slow-success window instead of the 11.7 s retry deadline (a
   * legitimate 11.7–15 s enable would otherwise abort as a 408 one timeout short of the server's
   * own ceiling).
   */
  private static readonly enableFirstAttemptMaxDurationMs = 16000;

  /**
   * End-to-end wall-clock cap for one `enableVote` call's retry grid (GH-1637) — attempt 1 is
   * exempt (see `enableFirstAttemptMaxDurationMs`); the deadline established before the loop
   * bounds retries only: every retry PUT receives only the remaining budget as its request
   * timeout, and each backoff sleep is truncated to the deadline. Kept at 11.7 s (the pre-GH-2730
   * poll-window-plus-backoff sum) as a harmless upper bound: without it, three slow 403 denials
   * at the API client's 30 s default could take ~90 s to surface. A backoff that would leave less
   * than `MIN_VIABLE_REQUEST_BUDGET_MS` never issues its PUT — the observed 403 is rethrown with
   * the exhaustion warning instead, since a sub-floor attempt would abort as a 408 and mask the
   * denial the loop actually saw. (GH-2730 removed the post-PUT index poll, so the method returns
   * right after the PUT succeeds.)
   */
  private static readonly enableEndToEndMaxDurationMs = 11700;

  /**
   * Vote poll budget (GH-1637), shared by create/delete at one 300 ms cadence — create probes the
   * FGA-gated resource GET on this same grid rather than the index, because FGA tuple readiness
   * (not index visibility) is the precondition for the enable PUT that follows create+open
   * (GH-2729); the index-specific notes below apply to delete only — GH-2730 removed enable's
   * post-PUT index poll (enable returns right after the PUT succeeds). The cap is wall-clock, not
   * attempt-count: `maxDurationMs` includes request duration (attempt counts alone can't bound
   * wall-clock time — each query takes as long as its request, up to the API client's timeout),
   * and each poll query receives only the remaining budget as its request timeout, so an
   * in-flight request can't overshoot the deadline. Create and delete cap at 8 s — inside the
   * pre-GH-1637 window (the old 5-attempt/2 s grid spent 8 s of delays plus request time). The
   * attempt counts are only iteration upper bounds for fast queries; the deadline binds first
   * once queries slow. Nothing that confirmed before falls back now, while the happy path
   * resolves on the first few attempts (convergence typically lands in <2 s). Worst-case fan-out
   * is 27 requests per vote write for the probe alone, or 31 for a fused create+open (1 POST +
   * 27 probes + 3 enable PUTs) — bounded by these budgets, the blanket `apiRateLimiter`, and the
   * per-user `voteWriteRateLimiter` (GH-2729 review m-10); paid only while convergence lags. The
   * delete index poll filters on `data.vote_uid` — never
   * `tags`: vote documents are indexed without a vote-uid tag, so `tags` can never match a vote
   * by uid. A `tags` regression makes delete (predicate `resources.length === 0`) resolve
   * instantly without confirming removal.
   */
  private static readonly voteIndexPollMaxAttempts = 27;
  private static readonly voteIndexPollRetryDelayMs = 300;
  private static readonly voteIndexPollMaxDurationMs = 8000;

  /**
   * Create-POST request timeout (GH-2729 review m-7): 16 s is the v2 voting-api's hardcoded
   * `WriteTimeout: 15s` (cmd/voting-api/main.go) plus a 1 s transport margin — this timer starts
   * before gateway/network transit while the server's write deadline starts after the request
   * arrives, so an exact 15 s could still abort a response completing just under the upstream
   * limit (PR #2797 review); beyond that margin a slower create can never return successfully
   * end-to-end, so the API client's 30 s default would only outwait the server's own ceiling.
   * Worst-case fused create+open hold = 16 s create + 8 s probe + 16 s enable attempt-1 ≈ 40 s,
   * under the 60 s ingress-nginx default; the three budgets stay independent by design —
   * documenting the sum is the fix.
   */
  private static readonly createVoteRequestTimeoutMs = 16000;

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
   * `requestOptions` forwards per-request `ApiRequestOptions` (e.g. a poll loop's `timeoutMs`) to the
   * upstream GET.
   */
  public async getVoteById(req: Request, voteUid: string, options: { includeProject?: boolean; requestOptions?: ApiRequestOptions } = {}): Promise<Vote> {
    const { includeProject = false, requestOptions } = options;
    logger.debug(req, 'get_vote_by_id', 'Fetching vote by ID', {
      vote_uid: voteUid,
    });

    const vote = await this.microserviceProxy.proxyRequest<Vote>(
      req,
      'LFX_V2_SERVICE',
      `/votes/${this.encodeVoteUid(voteUid)}`,
      'GET',
      undefined,
      undefined,
      undefined,
      requestOptions
    );

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
   * Creates a new vote/poll. With `options.open` (GH-2731) the vote is also opened in the same
   * call: after the FGA-readiness probe resolves, the enable PUT runs inline and the returned
   * vote carries `status: 'active'`; if the enable fails, the created vote is returned in its
   * real (disabled) status — the draft exists and can be opened later from the list. Worst-case
   * fused create+open hold is ~40 s (16 s create + 8 s probe + 16 s enable attempt-1 — the three
   * budgets are independent by design), under the 60 s ingress-nginx default.
   */
  public async createVote(req: Request, voteData: CreateVoteRequest, options: { open?: boolean } = {}): Promise<Vote> {
    const { open = false } = options;
    const sanitizedPayload = logger.sanitize({ voteData });
    logger.debug(req, 'create_vote', 'Creating vote payload', sanitizedPayload);

    // No X-Sync header: the voting service neither declares nor honors it (verified end to end —
    // GH-1637; the header is absent from its OpenAPI spec — linuxfoundation/lfx-v2-voting-service#56).
    const newVote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData, undefined, {
      timeoutMs: VoteService.createVoteRequestTimeoutMs,
    });

    // After creating, poll the FGA-gated resource GET until the vote's OpenFGA tuple has
    // replicated: tuple readiness (not index visibility) is the precondition for the enable PUT
    // that follows create+open, and the GET 403s at the gateway until the tuple lands (GH-2729).
    // FGA-tuple readiness ≠ index visibility: a just-created vote can still be briefly absent
    // from index-backed lists (indexer convergence lag, typically <2 s). Accepted (GH-2729 review
    // m-3): the pre-GH-1637 index poll never delivered the intended existence guarantee anyway —
    // its broken `tags:` predicate exhausted 100% of the time and always fell back to the POST
    // response.
    const voteUid = newVote.uid;
    let fetchedVote: Vote | undefined;
    // Captured inside the probe so an anomalous mid-poll failure (5xx, transport) is rethrown
    // after pollEndpoint returns: the helper's contract deliberately converts any pollFn throw
    // into `false`, which would otherwise mask a backend outage as ordinary "not yet fetchable"
    // exhaustion. Request timeouts (408) are NOT captured — each probe attempt's timeout is the
    // remaining budget itself, so a 408 can only coincide with budget exhaustion, an ordinary
    // outcome that keeps the graceful fallback below.
    let probeError: unknown;

    // The probe shares the voteIndexPoll* fine grid — see those constants for the budget rationale.
    const resolved = await pollEndpoint({
      req,
      operation: 'create_vote',
      pollFn: async ({ remainingMs }) => {
        try {
          fetchedVote = await this.getVoteById(req, voteUid, { requestOptions: { timeoutMs: remainingMs } });
          return true;
        } catch (error) {
          // A 403 means the tuple has not replicated yet — keep polling. A post-create 404 is
          // indistinguishable from DynamoDB read lag (ITX's GetItem is eventually consistent —
          // pkg/database/dynamo.go), so it keeps polling too rather than forfeiting the rest of
          // the budget to a transient miss. Anything else (5xx) is anomalous once the POST has
          // succeeded: rethrow so polling stops immediately. Note `getVoteById`'s own
          // ResourceNotFoundError (the 200-with-empty-body anomaly) extends BaseApiError, not
          // MicroserviceError — it still rethrows here; that is deliberate.
          if (error instanceof MicroserviceError && (error.statusCode === 403 || error.statusCode === 404)) {
            return false;
          }
          if (!(error instanceof MicroserviceError && error.statusCode === 408)) {
            probeError = error;
          }
          throw error;
        }
      },
      maxRetries: VoteService.voteIndexPollMaxAttempts,
      retryDelayMs: VoteService.voteIndexPollRetryDelayMs,
      maxDurationMs: VoteService.voteIndexPollMaxDurationMs,
      metadata: { vote_uid: voteUid },
    });

    // An anomalous probe failure (5xx etc.) surfaces as itself — never as the benign
    // "not yet fetchable" fallback, and never into an enable attempt on a vote whose readiness
    // was never confirmed (pollEndpoint swallowed the throw by contract; rethrow it here).
    if (probeError !== undefined) {
      throw probeError;
    }

    let createdVote = newVote;
    if (resolved && fetchedVote) {
      createdVote = fetchedVote;
    } else {
      logger.warning(req, 'create_vote', 'Vote not yet fetchable after create, returning POST response', { vote_uid: voteUid });
    }

    if (!open) {
      return createdVote;
    }

    // open=true requires the probe resolved at FGA-tuple readiness (the enable PUT's
    // precondition): an unconfirmed vote must not be treated as openable (GH-2729) — return the
    // created draft for the frontend's recoverable warning path rather than PUT an enable that
    // can only 403-retry against the same unconfirmed precondition.
    if (!resolved) {
      return createdVote;
    }

    // open=true (GH-2731): the probe resolved at FGA-tuple readiness — the enable PUT's
    // precondition — so the inline enable should succeed on the first attempt; the bounded
    // 403-retry loop covers the residual race (probe resolution → PUT in flight).
    try {
      await this.enableVoteWithRetry(req, voteUid);
    } catch (error) {
      // Partial failure: the vote exists as a draft — return it in its real status (HTTP 201)
      // rather than synthesizing an error for a create that succeeded; the frontend branches on
      // vote.status to show the recoverable "created as draft" warning. (A 403-exhaustion already
      // logged its distinguishable warning inside the loop.)
      logger.warning(req, 'create_vote', 'Vote created but enable failed, returning the created vote in its current status', {
        vote_uid: voteUid,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return createdVote;
    }

    return { ...createdVote, status: PollStatus.ACTIVE };
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

    // Poll the query service until the vote is removed from the index, on the shared fine grid —
    // see voteIndexPoll* for the budget rationale and the filters-on-vote_uid (never tags) invariant.
    await pollEndpoint({
      req,
      operation: 'delete_vote',
      pollFn: async ({ remainingMs }) => {
        const { resources } = await this.microserviceProxy.proxyRequest<QueryServiceResponse<Vote>>(
          req,
          'LFX_V2_SERVICE',
          '/query/resources',
          'GET',
          {
            type: 'vote',
            filters: [`vote_uid:${voteUid}`],
          },
          undefined,
          undefined,
          { timeoutMs: remainingMs }
        );
        return resources.length === 0;
      },
      maxRetries: VoteService.voteIndexPollMaxAttempts,
      retryDelayMs: VoteService.voteIndexPollRetryDelayMs,
      maxDurationMs: VoteService.voteIndexPollMaxDurationMs,
      metadata: { vote_uid: voteUid },
    });
  }

  /**
   * Enables a vote (changes status from disabled to active)
   */
  public async enableVote(req: Request, voteUid: string): Promise<EnableVoteResponse> {
    logger.debug(req, 'enable_vote', 'Enabling vote', {
      vote_uid: voteUid,
    });

    await this.enableVoteWithRetry(req, voteUid);

    // The enable PUT is synchronous upstream (ITX writes the status before responding), so the
    // vote is open once the loop succeeds — return immediately without waiting on the search
    // index (GH-2730). The votes list merges this known-open status over stale index rows
    // client-side while the index catches up.
    return { uid: voteUid, status: PollStatus.ACTIVE };
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

    // No X-Sync header: the voting service neither declares nor honors it (verified end to end —
    // GH-1637; the header is absent from its OpenAPI spec — linuxfoundation/lfx-v2-voting-service#56).
    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', '/vote_responses', 'POST', undefined, payload);

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
   * The enable PUT with its bounded 403-retry loop (GH-1637), extracted so `createVote`'s
   * open=true path runs the identical loop inline (GH-2731). Resolves once the PUT succeeds;
   * rethrows the observed error on exhaustion or non-retryable failure.
   */
  private async enableVoteWithRetry(req: Request, voteUid: string): Promise<void> {
    // Retry the enable PUT only on a 403: the enable route is authorized on `vote:{uid}`
    // (Heimdall openfga_check), and a freshly created vote's FGA tuple lags the create POST —
    // the voting service is observed to publish the indexer message before the fga-sync one
    // (verified in lfx-v2-voting-service). The create poll resolving at FGA-readiness (GH-2729)
    // closes that gap on the create+open path; this loop remains as the bounded safety net for
    // the residual race (poll resolution → PUT in flight) and for callers enabling a vote they
    // did not just create. A genuine permission denial gets the same bounded retry and then
    // surfaces unchanged — the BFF cannot distinguish it from the gap.
    // One wall-clock deadline covers the retry grid, so the documented 11.7 s cap holds even
    // when a 403 is slow to return — attempt 1 is exempt (fixed 16 s slow-success budget, see
    // `enableFirstAttemptMaxDurationMs`); every retry PUT gets only the remaining budget as its
    // request timeout and each backoff sleep is truncated to the deadline.
    const deadline = Date.now() + VoteService.enableEndToEndMaxDurationMs;

    // Distinguishable exhaustion signal for security monitoring: a denied-and-exhausted
    // pattern is visible independent of the benign-race framing — the BFF cannot tell
    // the two apart (see the loop comment above). apiErrorHandler logs the rethrow when it
    // propagates (createVote's open path catches it into the created-draft return instead).
    const logExhaustedForbidden = (attempts: number) =>
      logger.warning(
        req,
        'enable_vote',
        'Enable PUT still 403 after bounded retries, surfacing — genuine denial and FGA replication lag are indistinguishable',
        { vote_uid: voteUid, attempts }
      );

    for (let attempt = 1; attempt <= VoteService.enableMaxAttempts; attempt++) {
      try {
        await this.microserviceProxy.proxyRequestWithResponse<Vote>(
          req,
          'LFX_V2_SERVICE',
          `/votes/${this.encodeVoteUid(voteUid)}/enable`,
          'PUT',
          undefined,
          undefined,
          undefined,
          { timeoutMs: attempt === 1 ? VoteService.enableFirstAttemptMaxDurationMs : Math.max(deadline - Date.now(), 1) }
        );
        break;
      } catch (error) {
        // ITX answers any non-disabled poll with 400 "poll is already enabled" — including an ended
        // one, indistinguishable here without a refetch (cosmetic cost: a success toast on an
        // already-ended vote; the list renders the server's status, which the carrier only overlays
        // while the index row is still disabled). Enable is semantically idempotent, so the signature
        // is success: a double-open or a 408-after-PutPoll (response lost after the write landed) must
        // not report an opened vote as failed. The match is anchored to ITX's exact verified
        // message (lfx-itx-service polling.go returns {"code":"400","message":"poll is already
        // enabled"} — the code field is just the HTTP status, no stable error code exists to match
        // instead) rather than a bare substring, so an unrelated 400 can never be swallowed as
        // success; a wording change misses loudly, reverting to the pre-fix failure — fail-safe.
        const alreadyEnabled = error instanceof MicroserviceError && error.statusCode === 400 && error.message.includes('poll is already enabled');
        if (alreadyEnabled) {
          logger.debug(req, 'enable_vote', 'Enable PUT answered "already enabled" — treating as success (enable is idempotent)', {
            vote_uid: voteUid,
            attempt,
          });
          return;
        }
        const retryableForbidden = error instanceof MicroserviceError && error.statusCode === 403;
        const budgetLeftMs = deadline - Date.now();
        if (!retryableForbidden || attempt === VoteService.enableMaxAttempts || budgetLeftMs <= 0) {
          if (retryableForbidden) {
            logExhaustedForbidden(attempt);
          }
          throw error;
        }
        const delayMs = Math.min(VoteService.enableRetryDelayMs, budgetLeftMs);
        // Re-check what the backoff leaves before looping: a remainder under the minimum viable
        // request budget dooms the next PUT to a sub-round-trip timeout whose 408 would replace
        // the 403 actually observed — and skip the exhaustion warning, since a 408 is not
        // `retryableForbidden`. Emit the signal and rethrow the 403 rather than issue a request
        // that cannot complete.
        if (budgetLeftMs - delayMs < MIN_VIABLE_REQUEST_BUDGET_MS) {
          logExhaustedForbidden(attempt);
          throw error;
        }
        logger.debug(req, 'enable_vote', 'Enable PUT returned 403, retrying to allow for possible FGA replication lag', {
          vote_uid: voteUid,
          attempt,
          next_retry_ms: delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        // The sleep itself can resume late under event-loop load — same floor as the pre-sleep
        // check above, re-verified against what the backoff actually left.
        if (deadline - Date.now() < MIN_VIABLE_REQUEST_BUDGET_MS) {
          logExhaustedForbidden(attempt);
          throw error;
        }
      }
    }
  }

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
