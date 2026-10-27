// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MIN_VIABLE_REQUEST_BUDGET_MS,
  VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT,
  VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS,
  VOTE_REMINDER_INACTIVE,
  VOTE_REMINDER_PRECHECK_FAILED,
  VOTE_REMINDER_SELECTION_STALE,
  VOTE_SUMMARY_NOT_ENDED,
  VOTE_SUMMARY_SEND_FAILED,
  VOTE_VOTERS_DRAFT,
} from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, PollStatus, VoteResponseStatus, VoteVoterStatus } from '@lfx-one/shared/enums';
import {
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteResponse,
  ExtendVoteRequest,
  IndexedVote,
  IndexedVoteResponse,
  MyVoteResponse,
  MyVotesResponse,
  PaginatedResponse,
  QueryServiceCountResponse,
  QueryServiceResponse,
  SendVoteReminderResponse,
  SendVoteSummaryResponse,
  UpdateVoteRequest,
  Vote,
  VoteListResponse,
  VoteReminderRecipient,
  VoteStatusCounts,
  VoteSummary,
  VoteParticipationVoter,
  VoteSummaryEmailContext,
  VoteSummaryRecipient,
  VoteResultsResponse,
  VoteVoter,
} from '@lfx-one/shared/interfaces';
import {
  compareVotesByRecency,
  computeIsFoundation,
  computeResultPercentage,
  countVotesByStatus,
  isVoteClosingSoon,
  normalizePollStatus,
  sortCommentResponsesByRecency,
  sortCommentResponsesByText,
} from '@lfx-one/shared/utils';
import { Request } from 'express';
import { VOTE_SUMMARY_EMAIL_CONCURRENCY } from '../constants';

import { BaseApiError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { fetchEntityProject, toEntityProjectFields } from '../helpers/entity-project-enrichment.helper';
import { pollEndpoint } from '../helpers/poll-endpoint.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { settleInBatches } from '../helpers/settle-in-batches.helper';
import { fetchCurrentUserVoteResponses, getParentVoteId } from '../helpers/vote-response.helper';
import { renderVoteSummaryEmail } from '../helpers/vote-summary-email.helper';
import { assertVoteWrite } from '../helpers/vote-write-access.helper';
import { AccessCheckService } from './access-check.service';
import { EmailService } from './email.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

/**
 * Service for handling vote/poll business logic with microservice proxy
 */
export class VoteService {
  /**
   * Enable-PUT retry cadence for the FGA replication gap (GH-1637): 600 ms between attempts,
   * paid on a 403 (the replication gap or a genuine denial, which the BFF cannot tell apart);
   * the happy path pays nothing. The loop has no attempt cap — attempt counts alone can't bound
   * wall-clock time (a slow 403 returns as late as the request timeout), so the shared
   * `enableEndToEndMaxDurationMs` deadline is the only bound. On the create+open path this grid
   * is the readiness mechanism itself (GH-2729 pivot): a pre-enable read probe was tried and
   * abandoned — a check fired before fga-sync's tuple write caches `false` for the cluster's
   * OpenFGA check-query TTL (10 s on dev) and every retry inside the TTL reads that cached
   * denial back, so the probe manufactured the very denial that defeated it (2/2 drafts in live
   * verification, 2026-09-21). Only the enable's own retries — graced past the tuple write by
   * `fgaTuplePropagationGraceMs` and bounded past the cache TTL by the deadline — open the vote
   * on this cluster.
   */
  private static readonly enableRetryDelayMs = 600;

  /**
   * Attempt-1 enable PUT budget (GH-2729 review M-1), exempt from the
   * `enableEndToEndMaxDurationMs` retry deadline: 16 s is the v2 voting-api's hardcoded
   * `WriteTimeout: 15s` (cmd/voting-api/main.go) plus a 1 s transport margin — this timer starts
   * before gateway/network transit while the server's write deadline starts after the request
   * arrives, so an exact 15 s could still abort a response completing just under the upstream
   * limit (PR #2797 review). Anything slower can never return successfully end-to-end, so the
   * first attempt gets the full slow-success window instead of the 11.7 s retry deadline — a
   * legitimate enable taking 11.7 s up to the server's 15 s ceiling would otherwise abort as a
   * 408 one timeout short, and the 16 s budget covers that full window plus transit.
   */
  private static readonly enableFirstAttemptMaxDurationMs = 16000;

  /**
   * End-to-end wall-clock cap for one `enableVote` call's retry grid (GH-1637) — attempt 1 is
   * exempt (see `enableFirstAttemptMaxDurationMs`); the deadline established before the loop
   * bounds retries only: every retry PUT receives only the remaining budget as its request
   * timeout, and each backoff sleep is truncated to the deadline. Sized at 13 s to span the dev
   * cluster's 10 s OpenFGA check-query cache TTL (GH-2729 pivot): if attempt 1 lands before
   * fga-sync's tuple write despite the grace, its denial is cached for the TTL and only a
   * post-expiry retry recomputes — one issued at ~10.2 s still gets ~2.8 s, enough for the
   * synchronous ITX enable chain (~1.4–2.7 s observed). A genuine denial pays the same grid and
   * surfaces at ~12 s. Without a cap, slow 403 denials at the API client's 30 s default could
   * take minutes to surface. A backoff that would leave less than
   * `MIN_VIABLE_REQUEST_BUDGET_MS` never issues its PUT — the observed 403 is rethrown with the
   * exhaustion warning instead, since a sub-floor attempt would abort as a 408 and mask the
   * denial the loop actually saw. (GH-2730 removed the post-PUT index poll, so the method returns
   * right after the PUT succeeds.)
   */
  private static readonly enableEndToEndMaxDurationMs = 13000;

  /**
   * Tuple-propagation grace for a just-created vote's first enable PUT (GH-2729/GH-2826): a pre-tuple
   * check caches a denial for the check-query TTL, so the enable route sleeps the grace remaining since the create-completion hint; no hint (edit flow) → no sleep.
   */
  private static readonly fgaTuplePropagationGraceMs = VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS;

  /**
   * Vote poll budget (GH-1637) for the delete index poll, at one 300 ms cadence. Create no
   * longer polls anything: the GH-2729 FGA-readiness GET probe was removed (a pre-tuple check
   * poisons OpenFGA's check-query cache against itself — see `enableRetryDelayMs`), and GH-2730
   * removed enable's post-PUT index poll (enable returns right after the PUT succeeds). The cap
   * is wall-clock, not attempt-count: `maxDurationMs` includes request duration (attempt counts
   * alone can't bound wall-clock time — each query takes as long as its request, up to the API
   * client's timeout), and each poll query receives only the remaining budget as its request
   * timeout, so an in-flight request can't overshoot the deadline. Delete caps at 8 s — inside
   * the pre-GH-1637 window (the old 5-attempt/2 s grid spent 8 s of delays plus request time).
   * The attempt count is only an iteration upper bound for fast queries; the deadline binds
   * first once queries slow. Nothing that confirmed before falls back now, while the happy path
   * resolves on the first few attempts (convergence typically lands in <2 s). Worst-case fan-out
   * is 27 requests per delete — bounded by these budgets and the blanket `apiRateLimiter`; paid
   * only while convergence lags. The delete index poll filters on `data.vote_uid` — never
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
   * Since GH-2826 split create and enable into separate client requests, the worst-case holds are
   * independent: create ≤ 16 s; enable ≤ 2 s grace sleep + 16 s attempt-1 ≈ 18 s (a hung
   * attempt-1 ends the grid via its non-retryable 408; a fast-denied attempt-1 instead leaves
   * retries the 13 s deadline, ≈ 15 s) — each comfortably under the 60 s ingress-nginx default.
   */
  private static readonly createVoteRequestTimeoutMs = 16000;

  /**
   * Upstream page size for the getVotes drain (GH-1558): the query-service's documented maximum
   * (lfx-v2-query-service design/types.go), so real vote volumes (dev's largest project: 77 votes,
   * verified 2026-09-23) drain in a single round trip and the helper's page_token loop stays cold.
   */
  private static readonly voteListUpstreamPageSize = 1000;

  /**
   * Page size for the BFF's internal offset pagination when the client omits `page_size` (GH-1558).
   */
  private static readonly voteListDefaultPageSize = 50;

  private microserviceProxy: MicroserviceProxyService;
  private projectService: ProjectService;
  private readonly accessCheckService = new AccessCheckService();
  private readonly emailService: EmailService;

  public constructor() {
    this.microserviceProxy = new MicroserviceProxyService();
    this.projectService = new ProjectService();
    this.emailService = new EmailService();
  }

  /**
   * Fetches one page of the canonically ordered vote list (GH-1558). The query-service's default
   * `name_asc` ordering is the alphabetical ordering the issue reports and it has no created_at
   * sort, so the BFF drains the full filtered upstream set, sorts with `compareVotesByRecency`
   * (active first, `creation_time` desc, `uid` tiebreak), and slices the requested page itself.
   * Client `page_size`/`page_token`/`order` never go upstream: `page_token` is the BFF's own opaque
   * `offset:<n>` cursor (clients already treat the token as opaque) and `order` is the legacy param
   * the query-service ignores. `filters`/`filters_or`/`parent`/`tags`/`name` still narrow the
   * drained set upstream, except a recognized `status:<PollStatus>` filter: that predicate runs
   * locally with the same status normalization as the summary and the status-tab counts (#3687). Ordering holds across pagination and filters.
   * Recently-opened interplay (GH-2730/GH-1558 review): a vote opened inside
   * the index-lag window still reads `disabled` in the drained set, so the status tier places it after
   * the active block and the client's `mergeRecentlyOpenedVotes` rebadge can't reposition it (or
   * surface it on page 1 when more than a page of active votes exists). Accepted: tier-2's
   * `creation_time`-desc puts a just-created vote first within its tier, the carrier TTL (30 s) bounds
   * the window, and reconciling client carrier state pre-sort would bleed optimistic UI state into
   * this endpoint's contract. `includeProject` (default true) enriches the returned slice with
   * `project_name`, `project_slug`, `is_foundation` and `parent_project_uid`; opt out when the
   * caller discards them.
   */
  public async getVotes(req: Request, query: Record<string, unknown> = {}, options: { includeProject?: boolean } = {}): Promise<VoteListResponse> {
    const { includeProject = true } = options;
    logger.debug(req, 'get_votes', 'Starting vote fetch', {
      query_params: Object.keys(query),
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { page_size: rawPageSize, page_token: rawPageToken, order: _order, closing_soon: closingSoon, ...upstreamParams } = query;
    if (closingSoon !== undefined && closingSoon !== 'true' && closingSoon !== 'false') {
      throw ServiceValidationError.forField('closing_soon', 'Expected a single true or false value', { operation: 'get_votes', service: 'vote_service' });
    }

    // Unscoped calls drain the entire vote index and re-sort per request (GH-1558 review) — every
    // first-party caller narrows, so log the unscoped path to make a stray caller visible before it
    // shows up in a latency graph. DEBUG, not WARN: the param set is caller-controlled.
    if (Object.keys(upstreamParams).length === 0) {
      logger.debug(req, 'get_votes', 'Unscoped vote list request drains the full vote index');
    }

    const scoped = await this.fetchScopedIndexedVotes(req, upstreamParams);
    const nowMs = Date.now();
    const sorted = (closingSoon === 'true' ? scoped.filter((vote) => isVoteClosingSoon(vote, nowMs)) : scoped).sort(compareVotesByRecency);

    const pageSize = this.parseVoteListPageSize(rawPageSize);
    const offset = this.parseVoteListOffset(rawPageToken);
    const page = sorted.slice(offset, offset + pageSize);
    // Enrich list rows with canonical project fields — the vote index (VoteData) carries only
    // project_uid/name, so without this, consumers deriving per-row edit links get no slug/tier.
    // Runs on the returned slice only, not the full drained set.
    const enriched = includeProject ? await this.enrichWithProjectMetadata(req, page) : page;
    // Resolve the row's vote relation, not the active project's writer flag: committee writers
    // can manage a vote too. The existing batch helper defaults failed checks to false.
    const votes = await this.accessCheckService.addAccessToResources(req, enriched, 'vote');

    const nextOffset = offset + pageSize;
    const pageToken = nextOffset < sorted.length ? `offset:${nextOffset}` : undefined;

    logger.debug(req, 'get_votes', 'Completed vote fetch', {
      drained_count: sorted.length,
      final_count: votes.length,
      has_more_pages: !!pageToken,
    });

    return { data: votes, page_token: pageToken, ...(closingSoon === 'true' && { total_records: sorted.length }) };
  }

  /** Complete management scope; no personal participation lookup or project enrichment. */
  public async getVotesSummary(req: Request, parent: string, group?: string): Promise<VoteSummary> {
    const votes = await this.fetchScopedIndexedVotes(req, { parent, ...(group && { filters: [`committee_name:${group}`] }) });
    const nowMs = Date.now();
    return {
      active_votes: votes.filter((vote) => normalizePollStatus(vote.status) === PollStatus.ACTIVE).length,
      closing_soon: votes.filter((vote) => isVoteClosingSoon(vote, nowMs)).length,
      as_of: new Date(nowMs).toISOString(),
    };
  }

  /**
   * Per-status totals for the votes table's status tabs (#3687) over the complete management scope,
   * narrowed by the same `name` search and Group filter the list sends. One drain replaces a count
   * request per tab, and bucketing with `countVotesByStatus` keeps each count equal to its tab's
   * normalized list total. No project enrichment: only `status` is read.
   */
  public async getVoteStatusCounts(req: Request, parent: string, name?: string, group?: string): Promise<VoteStatusCounts> {
    const votes = await this.fetchScopedIndexedVotes(req, { parent, ...(name && { name }), ...(group && { filters: [`committee_name:${group}`] }) });
    return countVotesByStatus(votes);
  }

  /**
   * Fetches a single upstream cursor page of votes, forwarding the caller's params verbatim — the
   * pre-GH-1558 `getVotes` behavior, kept for internal consumers only (not mounted on any route).
   * Committee-activity's vote leg needs the query-service's `sort=updated_desc` truncation order and
   * the real upstream `page_token` for its `date_to`-windowed saturation walk; the canonical
   * drain+sort in `getVotes` would silently change which rows its `fetchSize` truncation keeps.
   * `includeProject` (default true) enriches rows with `project_name`, `project_slug`,
   * `is_foundation` and `parent_project_uid`; opt out when the caller discards them.
   */
  public async getVotesUpstreamPage(
    req: Request,
    query: Record<string, unknown> = {},
    options: { includeProject?: boolean } = {}
  ): Promise<PaginatedResponse<Vote>> {
    const { includeProject = true } = options;
    logger.debug(req, 'get_votes_upstream_page', 'Starting vote fetch', {
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
    const votes = includeProject ? await this.enrichWithProjectMetadata(req, normalized) : normalized;

    logger.debug(req, 'get_votes_upstream_page', 'Completed vote fetch', {
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

    // Status filters accept legacy mixed-case statuses (as the summary and status-tab counts do);
    // an exact upstream count would miss them.
    if (this.getRecognizedStatusFilter(query)) {
      // Count is scope-wide even if a caller supplies list pagination parameters.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { page_size: _pageSize, page_token: _pageToken, ...scope } = query;
      const votes = await this.fetchScopedIndexedVotes(req, scope);
      return votes.length;
    }

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
   * Plain create — GH-2826 removed the fused open (the enable route's grace hint owns opening) and no
   * readiness probe follows (a pre-tuple check poisons the check-query cache, GH-2729). Worst-case hold: the 16 s request timeout.
   */
  public async createVote(req: Request, voteData: CreateVoteRequest): Promise<Vote> {
    const sanitizedPayload = logger.sanitize({ voteData });
    logger.debug(req, 'create_vote', 'Creating vote payload', sanitizedPayload);

    // No X-Sync header: the voting service neither declares nor honors it (verified end to end —
    // GH-1637; the header is absent from its OpenAPI spec — linuxfoundation/lfx-v2-voting-service#56).
    const newVote = await this.microserviceProxy.proxyRequest<Vote>(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData, undefined, {
      timeoutMs: VoteService.createVoteRequestTimeoutMs,
    });

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
   * Extends a vote's deadline via the dedicated extend_vote upstream endpoint — unlike updateVote,
   * this is permitted on an active vote (see linuxfoundation/lfx-v2-voting-service's extend_vote design).
   */
  public async extendVote(req: Request, voteUid: string, data: ExtendVoteRequest): Promise<Vote> {
    const sanitizedPayload = logger.sanitize({ data });
    logger.debug(req, 'extend_vote', 'Extending vote deadline', { vote_uid: voteUid, ...sanitizedPayload });

    const vote = await this.microserviceProxy.proxyRequest<Vote>(
      req,
      'LFX_V2_SERVICE',
      `/votes/${this.encodeVoteUid(voteUid)}/extend`,
      'POST',
      undefined,
      data
    );

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
   * Enables a vote. `options.createCompletedAt` is the GH-2826 grace hint: sleep the remaining tuple-propagation
   * grace (clamped to `[0, fgaTuplePropagationGraceMs]`) before attempt 1; absent/non-finite → no sleep (edit flow's tuples are long past).
   */
  public async enableVote(req: Request, voteUid: string, options: { createCompletedAt?: number } = {}): Promise<EnableVoteResponse> {
    logger.debug(req, 'enable_vote', 'Enabling vote', {
      vote_uid: voteUid,
    });

    if (options.createCompletedAt !== undefined && Number.isFinite(options.createCompletedAt)) {
      const elapsedMs = Date.now() - options.createCompletedAt;
      const sleepMs = Math.min(Math.max(0, VoteService.fgaTuplePropagationGraceMs - elapsedMs), VoteService.fgaTuplePropagationGraceMs);
      if (sleepMs > 0) {
        logger.debug(req, 'enable_vote', 'Sleeping the remaining FGA-propagation grace before the first enable PUT', {
          vote_uid: voteUid,
          grace_remaining_ms: sleepMs,
        });
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
      }
    }

    await this.enableVoteWithRetry(req, voteUid);

    // The enable PUT is synchronous upstream (ITX writes the status before responding), so the
    // vote is open once the loop succeeds — return immediately without waiting on the search
    // index (GH-2730). The votes list merges this known-open status over stale index rows
    // client-side while the index catches up.
    return { uid: voteUid, status: PollStatus.ACTIVE };
  }

  /**
   * Fetches aggregated vote results for a given vote.
   * On a vote that is not explicitly named (#3916), totals, the abstention count and comments are
   * held until the vote has ended, and comments are returned as text only, in text order. The vote
   * is loaded alongside the results so a failed lookup fails the request rather than leaking
   * un-held results.
   *
   * A caller without `vote#writer` (`options.canWrite === false`, #4330) only gets results for an
   * ended vote they were invited to and not removed from — anything else is a 403 before upstream
   * results are fetched — and always gets comments as text only, in text order.
   */
  public async getVoteResults(req: Request, voteUid: string, options: { canWrite: boolean }): Promise<VoteResultsResponse> {
    logger.debug(req, 'get_vote_results', 'Fetching vote results', { vote_uid: voteUid, can_write: options.canWrite });

    const path = `/votes/${this.encodeVoteUid(voteUid)}/results`;
    let vote: Vote;
    let results: VoteResultsResponse;
    if (options.canWrite) {
      [vote, results] = await Promise.all([
        this.getVoteById(req, voteUid),
        this.microserviceProxy.proxyRequest<VoteResultsResponse>(req, 'LFX_V2_SERVICE', path, 'GET'),
      ]);
    } else {
      vote = await this.getVoteById(req, voteUid);
      await this.assertVoterCanReadResults(req, voteUid, vote);
      results = await this.microserviceProxy.proxyRequest<VoteResultsResponse>(req, 'LFX_V2_SERVICE', path, 'GET');
    }

    // The API client maps an empty response body to null; a 200 with no payload is anomalous
    // (the upstream results contract always returns a body), so fail loudly — passing null
    // through would emit a 200 that the vote detail page renders as a genuine zero-response vote
    // ("No responses yet") instead of its error state.
    if (!results) {
      throw new MicroserviceError('Vote results response body was empty', 502, 'VOTE_RESULTS_EMPTY', {
        operation: 'get_vote_results',
        service: 'vote_service',
        path,
      });
    }

    // Fail closed: upstream always serializes the flag, so a missing value is treated as pseudo-anonymous (#3911).
    const pseudoAnonymous = vote.pseudo_anonymity !== false;
    if (pseudoAnonymous) {
      if (normalizePollStatus(vote.status) !== PollStatus.ENDED) {
        return this.toHeldVoteResults(req, voteUid, results);
      }

      // Never infer "not held" from upstream: an ended vote with questions but no per-question
      // results means upstream is still holding, and must not render as a zero-response vote.
      if (results.results_held === true || (!results.poll_results?.length && (vote.poll_questions?.length ?? 0) > 0)) {
        logger.warning(req, 'get_vote_results', 'Upstream is still holding results for an ended pseudo-anonymous vote', {
          vote_uid: voteUid,
          upstream_results_held: results.results_held === true,
        });
        return this.toHeldVoteResults(req, voteUid, results);
      }
    }

    // Aggregate bound: the upstream results contract has no pagination, so cap each prompt's responses
    // at N to keep the payload linear in prompt count rather than electorate size (defense against multi-MB
    // payloads). Named votes keep the most recent N; pseudo-anonymous votes keep the first N in comment-text
    // order. The pre-cap count is reported via total_responses so the UI can disclose truncation.
    for (const commentResult of results?.comment_results ?? []) {
      // Normalize to an array before touching length — this loop is the single aggregation point for
      // comment results, so it is the cheapest place to stay robust if `responses` is ever missing (deploy-order skew).
      const responses = commentResult.responses ?? [];
      commentResult.total_responses = responses.length;
      // A non-writer gets the same text-only payload on a named vote too (#4330): only vote managers
      // may see who wrote each comment, so the identity is stripped here rather than in the browser.
      if (pseudoAnonymous || !options.canWrite) {
        // Text only: `vote_id` equals the vote_response uid other endpoints expose, and
        // `vote_creation_time` / `abstained` (or recency order) could re-link a comment to its author.
        commentResult.responses = sortCommentResponsesByText(responses.map((response) => ({ comment_text: response.comment_text }))).slice(
          0,
          VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT
        );
        continue;
      }
      commentResult.responses =
        responses.length > VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT
          ? sortCommentResponsesByRecency(responses).slice(0, VOTE_COMMENT_RESULTS_MAX_RESPONSES_PER_PROMPT)
          : responses;
    }

    logger.debug(req, 'get_vote_results', 'Completed vote results fetch', {
      vote_uid: voteUid,
      can_write: options.canWrite,
      num_poll_results: results?.poll_results?.length ?? 0,
      num_votes_cast: results?.num_votes_cast,
      results_held: false,
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
        const responses = await fetchCurrentUserVoteResponses(req, this.microserviceProxy, { filters: [`uid:${payload.vote_response_uid}`] });
        return responses.some((row) => row.uid === payload.vote_response_uid && row.vote_status === IndexedVoteResponseStatus.RESPONDED);
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
  // Reminders (#3769)
  // ============================================

  /**
   * Lists the eligible voters who have not voted on a vote yet — the recipients a manager can
   * remind. Includes both current and legacy parent keys, returning an identity-only projection.
   * The caller must have run `assertVoteWrite` first — every vote auditor can read these rows.
   * Eligibility is indexed and eventually consistent; the send rechecks it but cannot atomically
   * exclude a ballot cast concurrently with upstream queuing.
   */
  public async getVoteReminderRecipients(req: Request, voteUid: string): Promise<VoteReminderRecipient[]> {
    logger.debug(req, 'get_vote_reminder_recipients', 'Fetching vote_response rows for reminder recipients', { vote_uid: voteUid });

    const vote = await this.getVoteById(req, voteUid);
    const deadline = Date.parse(vote.end_time);
    if (normalizePollStatus(vote.status) !== PollStatus.ACTIVE || !Number.isFinite(deadline) || deadline <= Date.now()) {
      throw new ConflictError('This vote is no longer active.', VOTE_REMINDER_INACTIVE, {
        operation: 'get_vote_reminder_recipients',
        service: 'vote_service',
      });
    }

    const rows = await this.fetchVoteResponseRows(req, voteUid);

    const seen = new Set<string>();
    const recipients = rows
      .filter(
        (row): row is IndexedVoteResponse & { uid: string } =>
          getParentVoteId(row) === voteUid &&
          row.vote_status === IndexedVoteResponseStatus.AWAITING_RESPONSE &&
          !row.vote_creation_time &&
          row.voter_removed !== true &&
          !!row.uid
      )
      .filter((row) => {
        if (seen.has(row.uid)) return false;
        seen.add(row.uid);
        return true;
      })
      .map((row) => ({
        uid: row.uid,
        user_name: row.user_name,
        user_email: row.user_email,
        user_org_name: row.user_org_name,
        user_role: row.user_role,
        user_voting_status: row.user_voting_status,
      }))
      .sort((a, b) => (a.user_name ?? '').localeCompare(b.user_name ?? ''));

    logger.debug(req, 'get_vote_reminder_recipients', 'Filtered reminder recipients', {
      vote_uid: voteUid,
      row_count: rows.length,
      recipient_count: recipients.length,
    });

    return recipients;
  }

  /**
   * Lists every invited voter on a vote, sorted by name (#3911). Named votes get each voter's
   * participation status and current ballot; votes not explicitly named get a participation-only
   * projection (#3916) with no `uid`, ballot content, abstention, submission time or contact details.
   * The caller must have run `assertVoteWrite` first — every vote auditor can read these rows.
   * Draft or unrecognized-status votes (409) are refused before any `vote_response` row is read.
   */
  public async getVoteVoters(req: Request, voteUid: string): Promise<VoteVoter[] | VoteParticipationVoter[]> {
    logger.debug(req, 'get_vote_voters', 'Fetching vote_response rows for the voter list', { vote_uid: voteUid });

    const vote = await this.getVoteById(req, voteUid);
    const status = normalizePollStatus(vote.status);
    if (status !== PollStatus.ACTIVE && status !== PollStatus.ENDED) {
      throw new ConflictError('This vote is still a draft.', VOTE_VOTERS_DRAFT, {
        operation: 'get_vote_voters',
        service: 'vote_service',
      });
    }

    const rows = await this.fetchVoteResponseRows(req, voteUid);

    const seen = new Set<string>();
    const invited = rows
      .filter((row): row is IndexedVoteResponse & { uid: string } => getParentVoteId(row) === voteUid && row.voter_removed !== true && !!row.uid)
      .filter((row) => {
        if (seen.has(row.uid)) return false;
        seen.add(row.uid);
        return true;
      });

    // Fail closed: upstream always serializes the flag, so a missing value is treated as pseudo-anonymous.
    const participationOnly = vote.pseudo_anonymity !== false;
    const byName = (a: { user_name?: string }, b: { user_name?: string }) => (a.user_name ?? '').localeCompare(b.user_name ?? '');
    const voters = participationOnly
      ? invited.map((row) => this.toVoteParticipationVoter(row)).sort(byName)
      : invited.map((row) => this.toVoteVoter(row)).sort(byName);

    logger.debug(req, 'get_vote_voters', 'Mapped vote voters', {
      vote_uid: voteUid,
      row_count: rows.length,
      voter_count: voters.length,
      participation_only: participationOnly,
    });

    return voters;
  }

  /**
   * Resends the vote email to the given recipients via POST /votes/{uid}/bulk_resend, with the
   * user's bearer token (no M2M) — the gateway enforces `vote:{uid}#writer`. The
   * caller is writer-checked before reading identities. A stale selection rejects the whole batch
   * rather than silently sending to a different set. Upstream still validates membership/state.
   */
  public async sendVoteReminders(req: Request, voteUid: string, recipientIds: string[]): Promise<SendVoteReminderResponse> {
    try {
      await assertVoteWrite(req, voteUid, 'send_vote_reminders');
      const recipients = await this.getVoteReminderRecipients(req, voteUid);
      const eligibleIds = new Set(recipients.map((recipient) => recipient.uid));
      if (recipientIds.some((id) => !eligibleIds.has(id))) {
        throw new ConflictError('The selected voters have changed. Refresh the voter list before sending.', VOTE_REMINDER_SELECTION_STALE, {
          operation: 'send_vote_reminders',
          service: 'vote_service',
        });
      }
    } catch (error) {
      // Keep the existing actionable permission, validation, rate-limit and state-conflict replies.
      if (
        error instanceof BaseApiError &&
        ([400, 403, 429].includes(error.statusCode) || error.code === VOTE_REMINDER_INACTIVE || error.code === VOTE_REMINDER_SELECTION_STALE)
      ) {
        throw error;
      }
      // Only these checks are known not to have sent anything. Never mark a bulk_resend failure this way.
      throw new MicroserviceError(
        'No reminders were sent because the pre-send checks failed. Please try again.',
        error instanceof BaseApiError ? error.statusCode : 500,
        VOTE_REMINDER_PRECHECK_FAILED,
        {
          operation: 'send_vote_reminders',
          service: 'vote_service',
          originalError: error instanceof Error ? error : undefined,
        }
      );
    }

    logger.debug(req, 'send_vote_reminders', 'Resending vote email to recipients', {
      vote_uid: voteUid,
      recipient_count: recipientIds.length,
    });

    await this.microserviceProxy.proxyRequest<void>(req, 'LFX_V2_SERVICE', `/votes/${this.encodeVoteUid(voteUid)}/bulk_resend`, 'POST', undefined, {
      recipient_ids: recipientIds,
    });

    return { recipient_count: recipientIds.length };
  }

  /**
   * Lists every invited voter on a vote, for the on-demand close summary (#3662). Unlike
   * `getVoteVoters`, not gated on `pseudo_anonymity` or ballot content — only identity fields are
   * read, and the summary email carries aggregate results only, never a ballot.
   * The caller must have run `assertVoteWrite` first — every vote auditor can read these rows.
   */
  public async getVoteSummaryRecipients(req: Request, voteUid: string): Promise<VoteSummaryRecipient[]> {
    logger.debug(req, 'get_vote_summary_recipients', 'Fetching vote_response rows for the summary recipient list', { vote_uid: voteUid });

    const rows = await this.fetchVoteResponseRows(req, voteUid);

    const seen = new Set<string>();
    const recipients = rows
      .filter((row): row is IndexedVoteResponse & { uid: string } => getParentVoteId(row) === voteUid && row.voter_removed !== true && !!row.uid)
      .filter((row) => {
        if (seen.has(row.uid)) return false;
        seen.add(row.uid);
        return true;
      })
      .map((row) => ({ uid: row.uid, user_name: row.user_name, user_email: row.user_email }))
      .sort((a, b) => (a.user_name ?? '').localeCompare(b.user_name ?? ''));

    logger.debug(req, 'get_vote_summary_recipients', 'Mapped vote summary recipients', {
      vote_uid: voteUid,
      row_count: rows.length,
      recipient_count: recipients.length,
    });

    return recipients;
  }

  /**
   * Sends the on-demand results summary to every invited voter (#3662), on demand only —
   * never scheduled or sent automatically on close (a future ticket). Only vote writers may send
   * it (`assertVoteWrite`), and it can only be sent once the vote has ended, so the results it
   * carries are final. The email body is built once from the aggregate results and sent unchanged
   * to each recipient — it never varies per voter, so it cannot disclose how any specific person
   * voted. A send failure for one recipient does not block the rest; failures are counted and
   * logged, not thrown, so a partial send still reports what it delivered — only a total failure
   * (every recipient rejected) throws, since there would otherwise be nothing to report as sent.
   */
  public async sendVoteSummary(req: Request, voteUid: string): Promise<SendVoteSummaryResponse> {
    await assertVoteWrite(req, voteUid, 'send_vote_summary');

    const vote = await this.getVoteById(req, voteUid);
    if (normalizePollStatus(vote.status) !== PollStatus.ENDED) {
      throw new ConflictError('This vote has not closed yet.', VOTE_SUMMARY_NOT_ENDED, {
        operation: 'send_vote_summary',
        service: 'vote_service',
      });
    }

    const [results, recipients] = await Promise.all([this.getVoteResults(req, voteUid), this.getVoteSummaryRecipients(req, voteUid)]);

    const rendered = renderVoteSummaryEmail(this.buildSummaryEmailContext(vote.name, results));

    const emailRecipients = recipients.filter((recipient): recipient is VoteSummaryRecipient & { user_email: string } => !!recipient.user_email);
    const seenEmails = new Set<string>();
    const uniqueRecipients = emailRecipients.filter((recipient) => {
      const email = recipient.user_email.toLowerCase();
      if (seenEmails.has(email)) return false;
      seenEmails.add(email);
      return true;
    });

    let sentCount = 0;
    let failedCount = 0;
    const outcomes = await settleInBatches(uniqueRecipients, VOTE_SUMMARY_EMAIL_CONCURRENCY, (recipient) =>
      this.emailService.sendEmail(req, { to: recipient.user_email, ...rendered })
    );
    outcomes.forEach((outcome, index) => {
      // `email_id` absent on a fulfilled reply means the email service accepted but did not actually
      // send (disabled, or the recipient was filtered) — that voter got nothing, so it counts as a
      // failure, not a send.
      if (outcome.status === 'fulfilled' && outcome.value.email_id) {
        sentCount += 1;
        return;
      }
      failedCount += 1;
      logger.warning(req, 'send_vote_summary', 'Failed to send the summary email to one recipient', {
        vote_uid: voteUid,
        recipient_uid: uniqueRecipients[index].uid,
        err: outcome.status === 'rejected' ? outcome.reason : 'Email service accepted the email without sending it',
      });
    });

    if (sentCount === 0 && uniqueRecipients.length > 0) {
      throw new MicroserviceError('The summary could not be sent to any recipients. Please try again.', 502, VOTE_SUMMARY_SEND_FAILED, {
        operation: 'send_vote_summary',
        service: 'vote_service',
      });
    }

    logger.info(req, 'send_vote_summary', 'Sent vote close summary', {
      vote_uid: voteUid,
      recipient_count: sentCount,
      failed_count: failedCount,
    });

    return { recipient_count: sentCount, failed_count: failedCount };
  }

  // ============================================
  // My Votes (Me Lens)
  // ============================================

  /**
   * Fetches votes the current user has been invited to.
   * Queries vote_response records by user_email and username using filters_or.
   */
  public async getMyVotes(req: Request): Promise<MyVotesResponse> {
    let complete = true;
    // Keep usable rows after a later-page failure, but never present them as exact counts.
    const responses = await fetchCurrentUserVoteResponses(req, this.microserviceProxy, {
      onPartial: () => {
        complete = false;
      },
    });

    // Parent-vote keying mirrors fetchPendingVotes via the shared getParentVoteId rule (GH #2985):
    // `vote_uid` with its v1 alias `poll_id` as fallback. Without the fallback a poll_id-only
    // legacy row would appear in Pending Actions but vanish here.
    const respondedVoteUids = new Set<string>();
    for (const r of responses) {
      const id = getParentVoteId(r);
      if (id && r.vote_status === IndexedVoteResponseStatus.RESPONDED) respondedVoteUids.add(id);
    }

    // Extract unique vote UIDs
    const voteUids = [...new Set(responses.map(getParentVoteId).filter((uid): uid is string => !!uid))];

    if (voteUids.length === 0) {
      return { votes: [], complete };
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
          if (!vote) {
            complete = false;
            return null;
          }
          const decorated: Vote = {
            ...vote,
            response_status: respondedVoteUids.has(uid) ? VoteResponseStatus.RESPONDED : VoteResponseStatus.AWAITING_RESPONSE,
          };
          return decorated;
        } catch (error) {
          // Stale invitations for deleted or inaccessible votes do not belong to the readable feed.
          // Only explicit upstream 403/404 responses establish that; other failures still hide exact counts.
          const notVisible = error instanceof MicroserviceError && (error.statusCode === 403 || error.statusCode === 404);
          if (!notVisible) complete = false;
          logger.warning(req, 'get_my_votes', 'Failed to fetch vote details, skipping', {
            vote_uid: uid,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return null;
        }
      })
    );

    // Canonical vote list ordering (GH-1558): active first, then creation_time desc — the same
    // comparator the project/committee list reads apply, so Me lens agrees with every other surface.
    const sorted = votes.filter((v): v is Vote => v !== null).sort(compareVotesByRecency);

    return { votes: await this.enrichWithProjectMetadata(req, sorted), complete };
  }

  /** POST /vote_responses requires the pre-allocated invitation row's UID — a fresh UUID returns 404 upstream. */
  public async getMyVoteResponse(req: Request, voteUid: string): Promise<MyVoteResponse | null> {
    // The find guard applies the shared parent-key rule (`vote_uid || poll_id` — the same key
    // the list surfaced this vote under) and requires a usable row id.
    const findMatch = (rows: IndexedVoteResponse[]): IndexedVoteResponse | undefined =>
      rows.find((r) => getParentVoteId(r) === voteUid && (!!r?.uid || !!r?.vote_id));

    // `filters` narrows on vote_uid at the index, avoiding a full-history scan per drawer open;
    // the helper's identity `filters_or` then disjuncts the user match. Both AND together.
    let match = findMatch(await fetchCurrentUserVoteResponses(req, this.microserviceProxy, { filters: [`vote_uid:${voteUid}`] }));

    // Legacy poll_id-only rows carry no `vote_uid` (GH #2985): fall back to a poll_id-scoped
    // query so a vote that surfaces in My Votes via the `getParentVoteId` fallback also resolves
    // here — otherwise the list/drawer divergence GH #2985 closed just moves one level down.
    // The query service supports a single `filters_or` group (spent on identity), so the two
    // scoped queries run sequentially. The trigger is "no match", not "no rows": a loosely
    // analyzed `vote_uid:` filter could return owned-but-foreign rows, and a non-empty
    // non-match must still fall through to the legacy key.
    if (!match) {
      match = findMatch(await fetchCurrentUserVoteResponses(req, this.microserviceProxy, { filters: [`poll_id:${voteUid}`] }));
    }

    if (!match) return null;

    // A legacy poll_id-only row carries no `vote_uid`, but `MyVoteResponse.vote_uid` is required —
    // normalize it to the validated parent key (`findMatch` guarantees `getParentVoteId(match) ===
    // voteUid`, the key the list surfaced this vote under) so the payload honors the shared
    // response contract. The cast still narrows the indexer's broader `vote_status` string
    // unchecked (pre-existing).
    const response = { ...match, vote_uid: voteUid } as MyVoteResponse;

    // Defensive: `r.uid` should always be populated by the indexer, but fall back to `vote_id`
    // (the v1 alias) if it isn't — logging the anomaly so we catch any indexer drift.
    if (!match.uid && match.vote_id) {
      logger.warning(req, 'get_my_vote_response', 'vote_response row missing uid; falling back to vote_id', { vote_uid: voteUid, vote_id: match.vote_id });
      response.uid = match.vote_id;
    }
    return response;
  }

  // ============================================
  // Private Helpers
  // ============================================

  /** Builds the summary email's content from the aggregate results: question prompts, choice text, counts and percentages — never a per-voter breakdown. */
  private buildSummaryEmailContext(voteTitle: string, results: VoteResultsResponse): VoteSummaryEmailContext {
    // Privacy-held results omit the abstention count; never email incomplete totals as final results.
    if (results.results_held === true || results.num_abstained === undefined) {
      throw new MicroserviceError('Vote results are not available for a summary yet. Please try again.', 502, 'VOTE_RESULTS_UNAVAILABLE', {
        operation: 'send_vote_summary',
        service: 'vote_service',
      });
    }

    const questions = results.poll_results.map((pollResult) => {
      const choiceTextById = new Map(pollResult.question.choices.map((choice) => [choice.choice_id, choice.choice_text]));

      // Upstream serializes both tally arrays with `omitempty` (gen/http/vote/server/types.go) — a
      // ranked-choice question can omit `generic_choice_votes` entirely, and vice versa — so default
      // both before reading `.length`/`.reduce`, matching the shared results builders in vote.utils.ts.
      const genericChoiceVotes = pollResult.generic_choice_votes ?? [];
      const rankedChoiceVotes = pollResult.ranked_choice_votes ?? [];

      if (genericChoiceVotes.length > 0) {
        return {
          prompt: pollResult.question.prompt,
          choices: genericChoiceVotes.map((choice) => ({
            text: choiceTextById.get(choice.choice_id) ?? choice.choice_id,
            vote_count: choice.vote_count,
            percentage: `${Math.round(computeResultPercentage(choice.percentage, choice.vote_count, results.num_votes_cast || 0))}%`,
          })),
        };
      }

      // Ranked-choice question: no plurality tally exists, so first-choice (rank 1) counts stand
      // in as the closest equivalent to a vote count in a plain-text summary.
      const totalFirstChoice = rankedChoiceVotes.reduce((sum, choice) => sum + (choice.rank_counts.find((rank) => rank.rank === 1)?.count ?? 0), 0);
      return {
        prompt: pollResult.question.prompt,
        choices: rankedChoiceVotes.map((choice) => {
          const firstChoiceCount = choice.rank_counts.find((rank) => rank.rank === 1)?.count ?? 0;
          return {
            text: `${choiceTextById.get(choice.choice_id) ?? choice.choice_id} (first-choice votes)`,
            vote_count: firstChoiceCount,
            percentage: totalFirstChoice > 0 ? `${Math.round((firstChoiceCount / totalFirstChoice) * 100)}%` : '0%',
          };
        }),
      };
    });

    return {
      vote_title: voteTitle,
      num_recipients: results.num_recipients,
      num_votes_cast: results.num_votes_cast,
      num_abstained: results.num_abstained,
      questions,
    };
  }

  /**
   * Non-writer results gate (#4330): the vote has ended, and the caller holds a `vote_response` row
   * for it that was not removed. Runs before upstream results are fetched, so a caller who fails it
   * never reaches the data. Mirrors the browser's `canVoterFetchVoteResults`, which never asks for
   * results outside these conditions, so a 403 here is only visible to direct API callers.
   */
  private async assertVoterCanReadResults(req: Request, voteUid: string, vote: Vote): Promise<void> {
    if (normalizePollStatus(vote.status) !== PollStatus.ENDED) {
      throw new MicroserviceError('Results are available after the vote closes.', 403, 'FORBIDDEN', {
        operation: 'get_vote_results',
        service: 'vote_service',
        path: `/votes/${this.encodeVoteUid(voteUid)}/results`,
      });
    }

    const mine = await this.getMyVoteResponse(req, voteUid);
    if (!mine || mine.voter_removed) {
      throw new MicroserviceError("You do not have access to this vote's results.", 403, 'FORBIDDEN', {
        operation: 'get_vote_results',
        service: 'vote_service',
        path: `/votes/${this.encodeVoteUid(voteUid)}/results`,
      });
    }
  }

  /**
   * The enable PUT with its bounded 403-retry loop (GH-1637), shared by the standalone enable
   * route and the speculative create+open flow (GH-2826 passes the create-completion hint so
   * `enableVote` sleeps the remaining grace before this loop's attempt 1; no read probe precedes
   * it — GH-2729 pivot). Resolves once the PUT succeeds; rethrows the observed error on
   * exhaustion or non-retryable failure.
   */
  private async enableVoteWithRetry(req: Request, voteUid: string): Promise<void> {
    // Retry the enable PUT only on a 403: the enable route is authorized on `vote:{uid}`
    // (Heimdall openfga_check), and a freshly created vote's FGA tuple lags the create POST —
    // the voting service is observed to publish the indexer message before the fga-sync one
    // (verified in lfx-v2-voting-service). On the create+open path the caller slept
    // `fgaTuplePropagationGraceMs` first, so attempt 1 usually lands after the tuple write; the
    // 13 s deadline then spans OpenFGA's 10 s check-query cache TTL, so even a too-early first
    // attempt (its denial cached for the TTL) recovers on a post-expiry retry. The loop is also
    // the bounded safety net for callers enabling a vote they did not just create. A genuine
    // permission denial gets the same bounded retry and then surfaces unchanged — the BFF cannot
    // distinguish it from the gap.
    // One wall-clock deadline covers the retry grid, so the documented 13 s cap holds even
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

    // No attempt cap: the wall-clock deadline (plus the budget-floor checks below) is the bound —
    // an attempt count can't size a slow-denial grid, and the 13 s deadline must be reachable on
    // fast denials too (a 600 ms-cadence grid needs ~20 attempts to span the check-cache TTL).
    for (let attempt = 1; ; attempt++) {
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
        // not report an opened vote as failed. The match is a substring check on ITX's exact
        // verified message (ITX main/polling.go:1865 returns {"code":"400","message":"poll is
        // already enabled"} — the code field is just the HTTP status, no stable error code exists
        // to match instead), tightened from the bare "already enabled" to reduce the set of
        // colliding messages. It is still a substring match, not an anchored one; a wording change
        // misses loudly, reverting to the pre-fix failure rather than a wrong success — fail-safe.
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
        if (!retryableForbidden || budgetLeftMs <= 0) {
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

  /** The first `status:<x>` filter clause whose value normalizes to a known `PollStatus`, or null. */
  private getRecognizedStatusFilter(query: Record<string, unknown>): PollStatus | null {
    const rawFilters = query['filters'];
    const filters = Array.isArray(rawFilters) ? rawFilters : [rawFilters];
    for (const clause of filters) {
      const status = this.parseStatusFilterClause(clause);
      if (status) return status;
    }
    return null;
  }

  private parseStatusFilterClause(clause: unknown): PollStatus | undefined {
    return typeof clause === 'string' && clause.startsWith('status:') ? normalizePollStatus(clause.slice('status:'.length)) : undefined;
  }

  /** Offset pages and totals must reject incomplete scans rather than silently undercount. */
  private async fetchScopedIndexedVotes(req: Request, upstreamParams: Record<string, unknown>): Promise<Vote[]> {
    const status = this.getRecognizedStatusFilter(upstreamParams);
    const params = { ...upstreamParams };
    if (status) {
      // Preserve every other upstream filter, but do not discard mixed-case rows before normalization.
      const rawFilters = params['filters'];
      const filters = Array.isArray(rawFilters) ? rawFilters : [rawFilters];
      const remaining = filters.filter((clause) => this.parseStatusFilterClause(clause) !== status);
      if (remaining.length) params['filters'] = remaining;
      else delete params['filters'];
    }
    const drained = await fetchAllQueryResources<IndexedVote>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVote>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          ...params,
          type: 'vote',
          page_size: VoteService.voteListUpstreamPageSize,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
    const votes = drained.map((vote) => this.normalizeIndexedVote(req, vote));
    return status ? votes.filter((vote) => normalizePollStatus(vote.status) === status) : votes;
  }

  /**
   * Drains every `vote_response` row for a vote, under both the current and legacy parent keys.
   * Shared by the reminder list and the voter list. failOnPartial: a truncated page set would
   * silently leave voters out of either list.
   */
  private async fetchVoteResponseRows(req: Request, voteUid: string): Promise<IndexedVoteResponse[]> {
    return fetchAllQueryResources<IndexedVoteResponse>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<IndexedVoteResponse>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'vote_response',
          filters_or: [`vote_uid:${voteUid}`, `poll_id:${voteUid}`],
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
  }

  /**
   * Builds the held results payload for a pseudo-anonymous vote (#3916): participation counts and
   * the deadline only. Fields are copied by allowlist so nothing else upstream returns can leak.
   */
  private toHeldVoteResults(req: Request, voteUid: string, results: VoteResultsResponse): VoteResultsResponse {
    logger.debug(req, 'get_vote_results', 'Completed vote results fetch', {
      vote_uid: voteUid,
      num_votes_cast: results.num_votes_cast,
      results_held: true,
    });

    return {
      num_recipients: results.num_recipients,
      num_votes_cast: results.num_votes_cast,
      poll_end_time: results.poll_end_time,
      ...(results.poll_end_time_timezone !== undefined && { poll_end_time_timezone: results.poll_end_time_timezone }),
      poll_results: [],
      comment_results: [],
      results_held: true,
    };
  }

  /** Maps a `vote_response` row on a named vote to the voter list's projection (#3911). */
  private toVoteVoter(row: IndexedVoteResponse & { uid: string }): VoteVoter {
    const submitted = this.isVoteResponseSubmitted(row);
    let status = VoteVoterStatus.NOT_VOTED;
    if (submitted) {
      status = row.abstained === true ? VoteVoterStatus.ABSTAINED : VoteVoterStatus.VOTED;
    }

    return {
      uid: row.uid,
      user_name: row.user_name,
      user_email: row.user_email,
      username: row.username,
      user_org_name: row.user_org_name,
      user_role: row.user_role,
      user_voting_status: row.user_voting_status,
      profile_picture: row.profile_picture,
      status,
      submitted_at: row.vote_creation_time || undefined,
      poll_answers: row.poll_answers?.map((answer) => ({
        ...answer,
        user_choice: answer.user_choice ?? [],
        ranked_user_choice: answer.ranked_user_choice ?? [],
      })),
      comment_responses: row.comment_responses,
    };
  }

  /**
   * Maps a `vote_response` row on a pseudo-anonymous vote to a participation-only row (#3916). Fields
   * are copied by allowlist: no `uid`, ballot content, abstention, submission time or contact details,
   * and an abstainer counts as `responded`.
   */
  private toVoteParticipationVoter(row: IndexedVoteResponse): VoteParticipationVoter {
    return {
      user_name: row.user_name,
      user_org_name: row.user_org_name,
      user_role: row.user_role,
      user_voting_status: row.user_voting_status,
      status: this.isVoteResponseSubmitted(row) ? 'responded' : 'pending',
    };
  }

  /**
   * A row with a submission time, or marked `responded`, has been submitted — either one alone is
   * enough, so a mismatch between them can't hide a ballot. ITX rewrites `vote_creation_time` on every ballot change.
   */
  private isVoteResponseSubmitted(row: IndexedVoteResponse): boolean {
    return !!row.vote_creation_time || row.vote_status === IndexedVoteResponseStatus.RESPONDED;
  }

  /**
   * Normalizes a vote from the query service indexer shape (vote_uid) to the
   * canonical REST shape (uid). The voting service indexes votes with `vote_uid`
   * while the REST API returns `uid` — these are the same value, different field names.
   * Canonicalizes recognized statuses so row actions agree with normalized filtering.
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
    return { ...rest, uid: uid ?? '', status: normalizePollStatus(rest.status) ?? rest.status };
  }

  // encodeURIComponent leaves `.` untouched, so reject exact dot segments — otherwise
  // the fetch URL parser normalizes `/votes/..` to `/`, reshaping the upstream path.
  private encodeVoteUid(uid: string): string {
    if (uid === '.' || uid === '..') {
      throw ServiceValidationError.forField('uid', 'Invalid vote UID', { operation: 'encode_vote_uid', service: 'vote_service' });
    }
    return encodeURIComponent(uid);
  }

  /** Client-requested page size for getVotes' internal slicing — first value wins; missing/invalid → the default; capped at the upstream max so a client can't pull an unbounded slice in one response. */
  private parseVoteListPageSize(raw: unknown): number {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, VoteService.voteListUpstreamPageSize) : VoteService.voteListDefaultPageSize;
  }

  /** Decodes getVotes' opaque `offset:<n>` page token — an omitted token starts at the first page; an explicit-but-malformed one (garbage, foreign cursor) is a 400, never a silent fallback for a bad explicit value (committee-activity's `decodePageToken` rule): silently restarting at page 1 would hand a page-2 caller page 1's rows labeled as page 2. */
  private parseVoteListOffset(raw: unknown): number {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) {
      return 0;
    }
    const match = typeof value === 'string' ? /^offset:(\d+)$/.exec(value) : null;
    if (!match) {
      throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation: 'get_votes', service: 'vote_service' });
    }
    // \d+ also passes 309+-digit tokens whose parseInt overflows float64 to Infinity (and
    // 16+-digit ones to unsafe integers) — slice() would answer those with an empty terminal
    // page instead of the malformed-token 400 this decoder promises.
    const offset = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(offset)) {
      throw ServiceValidationError.forField('page_token', 'page_token is malformed', { operation: 'get_votes', service: 'vote_service' });
    }
    return offset;
  }
}
