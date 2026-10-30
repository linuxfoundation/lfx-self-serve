// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CommentResponseInput,
  CreatePollCommentPrompt,
  CreateVoteRequest,
  CreateVoteResponseRequest,
  EnableVoteRequest,
  ExtendVoteRequest,
  SendVoteReminderRequest,
  UpdateVoteRequest,
} from '@lfx-one/shared/interfaces';
import { VOTE_COMMENT_PROMPT_MAX_COUNT, VOTE_COMMENT_PROMPT_MAX_LENGTH, VOTE_CREATE_COMPLETED_AT_HEADER } from '@lfx-one/shared/constants';
import { codePointLength } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { validateArrayParameter, validateRequestBody, validateRequiredParameter, validateUidParameter } from '../helpers/validation.helper';
import { buildValidatedCommentResponses, buildValidatedVoteAnswers } from '../helpers/vote-response-validation.helper';
import { assertVoteWrite, hasVoteWrite } from '../helpers/vote-write-access.helper';
import { logger } from '../services/logger.service';
import { VoteService } from '../services/vote.service';

/**
 * Controller for handling vote/poll HTTP requests
 */
export class VoteController {
  private voteService: VoteService = new VoteService();

  /**
   * GET /votes
   */
  public async getVotes(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_votes', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const { data: votes, page_token, total_records } = await this.voteService.getVotes(req, req.query);

      logger.success(req, 'get_votes', startTime, {
        vote_count: votes.length,
        has_more_pages: !!page_token,
      });

      res.json({ data: votes, page_token, ...(total_records !== undefined && { total_records }) });
    } catch (error) {
      next(error);
    }
  }

  /** GET /votes/summary — only project parent and optional committee name affect totals. */
  public async getVotesSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_votes_summary');
    try {
      const context = { operation: 'get_votes_summary', service: 'vote_controller' };
      const unsupported = Object.keys(req.query).find((key) => key !== 'parent' && key !== 'group');
      if (unsupported) throw ServiceValidationError.forField(unsupported, 'Unsupported summary parameter', context);
      const { parent, group } = req.query;
      if (typeof parent !== 'string' || !/^project:[^\s:]+$/.test(parent)) {
        throw ServiceValidationError.forField('parent', 'Expected one nonempty project:<uid> parent', context);
      }
      if (group !== undefined && (typeof group !== 'string' || !group.trim())) {
        throw ServiceValidationError.forField('group', 'Expected one nonempty group name', context);
      }
      const summary = await this.voteService.getVotesSummary(req, parent, group?.trim());
      logger.success(req, 'get_votes_summary', startTime, { active_votes: summary.active_votes, closing_soon: summary.closing_soon });
      res.json(summary);
    } catch (error) {
      return next(error);
    }
  }

  /** GET /votes/status-counts — per-status tab totals; only project parent, name search and committee name affect them. */
  public async getVoteStatusCounts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_vote_status_counts');
    try {
      const context = { operation: 'get_vote_status_counts', service: 'vote_controller' };
      const unsupported = Object.keys(req.query).find((key) => key !== 'parent' && key !== 'name' && key !== 'group');
      if (unsupported) throw ServiceValidationError.forField(unsupported, 'Unsupported status-counts parameter', context);
      const { parent, name, group } = req.query;
      if (typeof parent !== 'string' || !/^project:[^\s:]+$/.test(parent)) {
        throw ServiceValidationError.forField('parent', 'Expected one nonempty project:<uid> parent', context);
      }
      if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        throw ServiceValidationError.forField('name', 'Expected one nonempty search term', context);
      }
      if (group !== undefined && (typeof group !== 'string' || !group.trim())) {
        throw ServiceValidationError.forField('group', 'Expected one nonempty group name', context);
      }
      const counts = await this.voteService.getVoteStatusCounts(req, parent, name?.trim(), group?.trim());
      logger.success(req, 'get_vote_status_counts', startTime, { ...counts });
      res.json(counts);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /votes/count
   */
  public async getVotesCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_votes_count', {
      query_params: logger.sanitize(req.query as Record<string, any>),
    });

    try {
      const count = await this.voteService.getVotesCount(req, req.query as Record<string, any>);

      logger.success(req, 'get_votes_count', startTime, {
        count,
      });

      res.json({ count });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/my-votes
   */
  public async getMyVotes(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_votes');

    try {
      const myVotes = await this.voteService.getMyVotes(req);

      logger.success(req, 'get_my_votes', startTime, {
        vote_count: myVotes.votes.length,
        complete: myVotes.complete,
      });

      // Preserve the array contract for already-open browsers; new clients explicitly opt in.
      res.json(req.query['include_status'] === 'true' ? myVotes : myVotes.votes);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/:uid
   * `?include_writer=true` additively decorates `writer` (vote#writer). Opt-in so polling and every pre-existing caller skip the FGA lookup.
   */
  public async getVoteById(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_vote_by_id', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_vote_by_id',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const vote = await this.voteService.getVoteById(req, uid, { includeProject: true, includeWriter: req.query['include_writer'] === 'true' });

      logger.success(req, 'get_vote_by_id', startTime, {
        vote_uid: uid,
        project_uid: vote.project_uid,
        name: vote.name,
      });

      res.json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes
   */
  public async createVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const voteData: CreateVoteRequest = req.body;
    const startTime = logger.startOperation(req, 'create_vote', {
      project_uid: voteData?.project_uid,
      name: voteData?.name,
      end_time: voteData?.end_time,
      // Null-safe: express.json() leaves req.body undefined for non-JSON requests, and
      // JSON.stringify(undefined).length would throw before validateRequestBody can return a 400.
      body_size: JSON.stringify(req.body)?.length ?? 0,
    });

    try {
      const validationContext = { operation: 'create_vote', service: 'vote_controller' } as const;

      if (!validateRequestBody(voteData, req, next, validationContext)) {
        return;
      }

      const validatedCommentPrompts = this.validateCommentPrompts(voteData.poll_comment_prompts, validationContext);

      // No client-disconnect abort (matches every BFF write endpoint): a navigate-away leaves the
      // create completing server-side — the vote lands created and is recoverable from the list.
      // Accepted per GH-2729 review m-8.

      const vote = await this.voteService.createVote(req, { ...voteData, poll_comment_prompts: validatedCommentPrompts });

      logger.success(req, 'create_vote', startTime, {
        uid: vote.uid,
        project_uid: vote.project_uid,
        name: vote.name,
      });

      // Stamp the create-completion time (GH-2826): the client echoes it as the enable route's grace
      // hint so a just-created vote's first enable PUT waits out the tuple-propagation remainder.
      res.setHeader(VOTE_CREATE_COMPLETED_AT_HEADER, Date.now().toString());
      res.status(201).json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /votes/:uid
   */
  public async updateVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const voteData: UpdateVoteRequest = req.body;
    const startTime = logger.startOperation(req, 'update_vote', {
      vote_uid: uid,
      // Null-safe: express.json() leaves req.body undefined for non-JSON requests, and
      // JSON.stringify(undefined).length would throw before validateRequestBody can return a 400.
      body_size: JSON.stringify(req.body)?.length ?? 0,
    });

    try {
      const validationContext = { operation: 'update_vote', service: 'vote_controller' } as const;

      if (!validateUidParameter(uid, req, next, validationContext)) {
        return;
      }

      if (!validateRequestBody(voteData, req, next, validationContext)) {
        return;
      }

      const validatedCommentPrompts = this.validateCommentPrompts(voteData.poll_comment_prompts, validationContext);

      const vote = await this.voteService.updateVote(req, uid, { ...voteData, poll_comment_prompts: validatedCommentPrompts });

      logger.success(req, 'update_vote', startTime, {
        vote_uid: uid,
        project_uid: vote.project_uid,
        name: vote.name,
      });

      res.json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes/:uid/extend
   */
  public async extendVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const data: ExtendVoteRequest = req.body;
    const startTime = logger.startOperation(req, 'extend_vote', { vote_uid: uid });

    try {
      const validationContext = { operation: 'extend_vote', service: 'vote_controller' } as const;

      if (!validateUidParameter(uid, req, next, validationContext)) {
        return;
      }

      if (!validateRequestBody(data, req, next, validationContext)) {
        return;
      }

      if (!validateRequiredParameter(data.end_time, 'end_time', req, next, validationContext)) {
        return;
      }

      if (!validateRequiredParameter(data.end_time_timezone, 'end_time_timezone', req, next, validationContext)) {
        return;
      }

      if (typeof data.end_time !== 'string') {
        next(ServiceValidationError.forField('end_time', 'end_time must be a string', validationContext));
        return;
      }

      if (typeof data.end_time_timezone !== 'string') {
        next(ServiceValidationError.forField('end_time_timezone', 'end_time_timezone must be a string', validationContext));
        return;
      }

      const vote = await this.voteService.extendVote(req, uid, data);

      logger.success(req, 'extend_vote', startTime, {
        vote_uid: uid,
        end_time: vote.end_time,
      });

      res.json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes/:uid/end — ends an active vote now (vote#writer only). Logs the vote uid only; the gateway records the
   * principal upstream, and the OIDC subject is a username here, so it is never logged.
   */
  public async endVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'end_vote', { vote_uid: uid });

    try {
      if (!validateUidParameter(uid, req, next, { operation: 'end_vote', service: 'vote_controller' })) {
        return;
      }

      const vote = await this.voteService.endVote(req, uid);

      logger.success(req, 'end_vote', startTime, { vote_uid: uid });

      res.json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /votes/:uid
   */
  public async deleteVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'delete_vote', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'delete_vote',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      await this.voteService.deleteVote(req, uid);

      logger.success(req, 'delete_vote', startTime, {
        vote_uid: uid,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/:uid/results
   * Vote writers get today's results; everyone else goes through the service's non-writer gate (#4330).
   */
  public async getVoteResults(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_vote_results', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_vote_results',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const canWrite = await hasVoteWrite(req, uid, 'get_vote_results');
      const results = await this.voteService.getVoteResults(req, uid, { canWrite });

      logger.success(req, 'get_vote_results', startTime, {
        vote_uid: uid,
        can_write: canWrite,
        num_poll_results: results?.poll_results?.length ?? 0,
        num_votes_cast: results?.num_votes_cast,
        results_held: results?.results_held === true,
      });

      res.json(results);
    } catch (error) {
      next(error);
    }
  }

  /** GET /votes/:uid/my-response — pre-allocated vote_response row whose uid the cast drawer uses as vote_response_uid on submit. */
  public async getMyVoteResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_my_vote_response', { vote_uid: uid });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_my_vote_response',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const response = await this.voteService.getMyVoteResponse(req, uid);

      if (!response) {
        // Mirrors SurveyController.getMyResponse — structured 404 lets clients distinguish "no invitation" from upstream failure.
        return next(
          new ResourceNotFoundError('Vote response', uid, {
            operation: 'get_my_vote_response',
            service: 'vote_controller',
            path: `/votes/${uid}/my-response`,
          })
        );
      }

      logger.success(req, 'get_my_vote_response', startTime, { vote_uid: uid, found: true });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes/responses
   */
  public async createVoteResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
    const payload: CreateVoteResponseRequest = req.body;
    const startTime = logger.startOperation(req, 'create_vote_response', {
      vote_uid: payload?.vote_uid,
      vote_response_uid: payload?.vote_response_uid,
      abstain: payload?.abstain,
    });

    try {
      const validationContext = { operation: 'create_vote_response', service: 'vote_controller' } as const;

      if (!validateRequestBody(payload, req, next, validationContext)) {
        return;
      }

      if (!validateRequiredParameter(payload.vote_uid, 'vote_uid', req, next, validationContext)) {
        return;
      }

      if (!validateRequiredParameter(payload.vote_response_uid, 'vote_response_uid', req, next, validationContext)) {
        return;
      }

      if (typeof payload.abstain !== 'boolean') {
        throw ServiceValidationError.forField('abstain', 'abstain is required and must be a boolean', validationContext);
      }

      // Validated and rebuilt from allowlisted fields so unexpected extra properties on the client payload never cross the BFF boundary.
      const validatedCommentResponses: CommentResponseInput[] | undefined =
        payload.comment_responses === undefined ? undefined : buildValidatedCommentResponses(payload.comment_responses, validationContext);

      // Build the upstream payload immutably: when abstaining we drop user_vote_content entirely;
      // when not abstaining we validate each answer and forward the original content. comment_responses
      // is independent of abstain — a voter can abstain and still leave comments — so it's forwarded on both branches.
      let upstreamPayload: CreateVoteResponseRequest;

      if (payload.abstain) {
        upstreamPayload = {
          vote_uid: payload.vote_uid,
          vote_response_uid: payload.vote_response_uid,
          abstain: true,
          comment_responses: validatedCommentResponses,
        };
      } else {
        const validatedAnswers = buildValidatedVoteAnswers(payload.user_vote_content, validationContext);

        upstreamPayload = {
          vote_uid: payload.vote_uid,
          vote_response_uid: payload.vote_response_uid,
          abstain: false,
          user_vote_content: validatedAnswers,
          comment_responses: validatedCommentResponses,
        };
      }

      await this.voteService.createVoteResponse(req, upstreamPayload);

      logger.success(req, 'create_vote_response', startTime, {
        vote_uid: upstreamPayload.vote_uid,
        vote_response_uid: upstreamPayload.vote_response_uid,
        abstain: upstreamPayload.abstain,
        status_code: 204,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  /** GET /votes/:uid/my-ballot — the caller's own submitted ballot for read-only review and "Your ballot" (#4331). */
  public async getMyVoteBallot(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_my_vote_ballot', { vote_uid: uid });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_my_vote_ballot',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const ballot = await this.voteService.getMyVoteBallot(req, uid);

      if (!ballot) {
        return next(
          new ResourceNotFoundError('Vote ballot', uid, {
            operation: 'get_my_vote_ballot',
            service: 'vote_controller',
            path: `/votes/${uid}/my-ballot`,
          })
        );
      }

      logger.success(req, 'get_my_vote_ballot', startTime, { vote_uid: uid, found: true });
      res.json(ballot);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /votes/:uid/enable
   */
  public async enableVote(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'enable_vote', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'enable_vote',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const body = req.body as EnableVoteRequest | undefined;
      const hint = body?.create_completed_at;
      const createCompletedAt = typeof hint === 'number' && Number.isFinite(hint) ? hint : undefined;

      const vote = await this.voteService.enableVote(req, uid, { createCompletedAt });

      logger.success(req, 'enable_vote', startTime, {
        vote_uid: uid,
        status: vote.status,
      });

      res.json(vote);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/:uid/reminder-recipients — eligible voters who have not voted yet (#3769).
   * Gated on `vote#writer` before any query-service read: every vote auditor can read the
   * underlying `vote_response` rows, so the index grant alone is not a manager check.
   */
  public async getVoteReminderRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_vote_reminder_recipients', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_vote_reminder_recipients',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      await assertVoteWrite(req, uid, 'get_vote_reminder_recipients');

      const recipients = await this.voteService.getVoteReminderRecipients(req, uid);

      logger.success(req, 'get_vote_reminder_recipients', startTime, {
        vote_uid: uid,
        recipient_count: recipients.length,
      });

      res.json(recipients);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/:uid/voters — every invited voter with their status, plus their current ballot on a
   * named vote (#3911) or participation only on a pseudo-anonymous vote (#3916).
   * Gated on `vote#writer` before any read: every vote auditor can read the underlying
   * `vote_response` rows. The service refuses drafts before reading them.
   */
  public async getVoteVoters(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'get_vote_voters', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'get_vote_voters',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      await assertVoteWrite(req, uid, 'get_vote_voters');

      const voters = await this.voteService.getVoteVoters(req, uid);

      logger.success(req, 'get_vote_voters', startTime, {
        vote_uid: uid,
        voter_count: voters.length,
      });

      res.json(voters);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes/:uid/reminders — resends the vote email to the selected recipients (#3769).
   * The service writer-checks before re-reading eligible non-voters; a stale selection rejects
   * the whole batch. Upstream additionally validates membership and active state.
   */
  public async sendVoteReminders(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const payload: SendVoteReminderRequest = req.body;
    const startTime = logger.startOperation(req, 'send_vote_reminders', {
      vote_uid: uid,
      recipient_count: Array.isArray(payload?.recipient_ids) ? payload.recipient_ids.length : undefined,
    });

    try {
      const validationContext = { operation: 'send_vote_reminders', service: 'vote_controller' } as const;

      if (!validateUidParameter(uid, req, next, validationContext)) {
        return;
      }

      if (!validateRequestBody(payload, req, next, validationContext)) {
        return;
      }

      if (!validateArrayParameter(payload.recipient_ids, 'recipient_ids', req, next, validationContext)) {
        return;
      }

      if (payload.recipient_ids.some((id) => typeof id !== 'string' || id.trim() === '')) {
        throw ServiceValidationError.forField('recipient_ids', 'recipient_ids must contain only non-empty strings', validationContext);
      }

      const recipientIds = [...new Set(payload.recipient_ids)];

      const result = await this.voteService.sendVoteReminders(req, uid, recipientIds);

      logger.success(req, 'send_vote_reminders', startTime, {
        vote_uid: uid,
        recipient_count: result.recipient_count,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/votes/:uid/send-ballots — emails a personalized ballot link to every non-responder (#4363).
   * The service writer-checks and re-resolves recipients; the client sends no body. Logs counts only.
   */
  public async sendVoteBallots(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'send_vote_ballots', { vote_uid: uid });

    try {
      if (!validateUidParameter(uid, req, next, { operation: 'send_vote_ballots', service: 'vote_controller' })) {
        return;
      }

      const result = await this.voteService.sendVoteBallots(req, uid);

      logger.success(req, 'send_vote_ballots', startTime, {
        vote_uid: uid,
        sent: result.sent,
        skipped: result.skipped,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /votes/:uid/summary — sends the on-demand close summary to every invited voter (#3662).
   * On demand only, never scheduled. The service writer-checks, then refuses a vote that hasn't
   * ended yet; the summary carries aggregate results only, never a per-voter ballot.
   */
  public async sendVoteSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { uid } = req.params;
    const startTime = logger.startOperation(req, 'send_vote_summary', {
      vote_uid: uid,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'send_vote_summary',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const result = await this.voteService.sendVoteSummary(req, uid);

      logger.success(req, 'send_vote_summary', startTime, {
        vote_uid: uid,
        recipient_count: result.recipient_count,
        failed_count: result.failed_count,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Validates poll_comment_prompts shape and caps, then rebuilds each entry from validated fields only.
   *  Throws ServiceValidationError (unlike the validate* helpers, which call next() and return false) —
   *  callers must invoke this inside the handler's try block so the catch routes it to next(). Same
   *  throw-inside-try idiom as analytics.controller.ts. */
  private validateCommentPrompts(
    prompts: CreatePollCommentPrompt[] | undefined,
    validationContext: { operation: string; service: string }
  ): CreatePollCommentPrompt[] | undefined {
    if (prompts === undefined) {
      return undefined;
    }

    if (!Array.isArray(prompts)) {
      throw ServiceValidationError.forField('poll_comment_prompts', 'poll_comment_prompts must be an array', validationContext);
    }

    if (prompts.length > VOTE_COMMENT_PROMPT_MAX_COUNT) {
      throw ServiceValidationError.forField(
        'poll_comment_prompts',
        `poll_comment_prompts must contain ${VOTE_COMMENT_PROMPT_MAX_COUNT} or fewer prompts`,
        validationContext
      );
    }

    for (const [index, entry] of prompts.entries()) {
      if (!entry || typeof entry !== 'object') {
        throw ServiceValidationError.forField(`poll_comment_prompts[${index}]`, 'Each comment prompt must be a non-null object', validationContext);
      }

      if (typeof entry.prompt !== 'string' || entry.prompt.trim().length === 0) {
        throw ServiceValidationError.forField(`poll_comment_prompts[${index}].prompt`, 'prompt is required and must be non-blank', validationContext);
      }

      // Count code points (not UTF-16 units) so emoji/non-BMP text isn't rejected at roughly half the real allowance.
      if (codePointLength(entry.prompt) > VOTE_COMMENT_PROMPT_MAX_LENGTH) {
        throw ServiceValidationError.forField(
          `poll_comment_prompts[${index}].prompt`,
          `prompt must be ${VOTE_COMMENT_PROMPT_MAX_LENGTH} characters or fewer`,
          validationContext
        );
      }
    }

    // Rebuild from the validated fields only, so unexpected extra properties never cross the BFF boundary.
    // Trim to match the client mapper (mapCommentPromptsToApiFormat) so direct API callers cannot store padded text.
    return prompts.map((entry) => ({ prompt: entry.prompt.trim() }));
  }
}
