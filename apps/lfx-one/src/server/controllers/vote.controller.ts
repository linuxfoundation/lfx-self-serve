// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommentResponseInput, CreatePollCommentPrompt, CreateVoteRequest, CreateVoteResponseRequest, UpdateVoteRequest } from '@lfx-one/shared/interfaces';
import { VOTE_COMMENT_PROMPT_MAX_COUNT, VOTE_COMMENT_PROMPT_MAX_LENGTH, VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { codePointLength } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError, ServiceValidationError } from '../errors';
import { validateRequestBody, validateRequiredParameter, validateUidParameter } from '../helpers/validation.helper';
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
      const { data: votes, page_token } = await this.voteService.getVotes(req, req.query as Record<string, any>);

      logger.success(req, 'get_votes', startTime, {
        vote_count: votes.length,
        has_more_pages: !!page_token,
      });

      res.json({ data: votes, page_token });
    } catch (error) {
      next(error);
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
        vote_count: myVotes.length,
      });

      res.json(myVotes);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /votes/:uid
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

      const vote = await this.voteService.getVoteById(req, uid);

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

      const vote = await this.voteService.createVote(req, { ...voteData, poll_comment_prompts: validatedCommentPrompts });

      logger.success(req, 'create_vote', startTime, {
        uid: vote.uid,
        project_uid: vote.project_uid,
        name: vote.name,
      });

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

      const results = await this.voteService.getVoteResults(req, uid);

      logger.success(req, 'get_vote_results', startTime, {
        vote_uid: uid,
        num_poll_results: results?.poll_results?.length ?? 0,
        num_votes_cast: results?.num_votes_cast,
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

      if (payload.comment_responses !== undefined) {
        if (!Array.isArray(payload.comment_responses)) {
          throw ServiceValidationError.forField('comment_responses', 'comment_responses must be an array', validationContext);
        }

        for (const [index, response] of payload.comment_responses.entries()) {
          if (!response || typeof response !== 'object') {
            throw ServiceValidationError.forField(`comment_responses[${index}]`, 'Each comment response must be a non-null object', validationContext);
          }

          if (!response.prompt_id || typeof response.prompt_id !== 'string') {
            throw ServiceValidationError.forField(
              `comment_responses[${index}].prompt_id`,
              'prompt_id is required for each comment response',
              validationContext
            );
          }

          if (typeof response.comment_text !== 'string' || response.comment_text.trim().length === 0) {
            throw ServiceValidationError.forField(
              `comment_responses[${index}].comment_text`,
              'comment_text is required for each comment response',
              validationContext
            );
          }

          // Count code points (not UTF-16 units) so emoji/non-BMP text isn't rejected at roughly half the real allowance.
          if (codePointLength(response.comment_text) > VOTE_COMMENT_RESPONSE_MAX_LENGTH) {
            throw ServiceValidationError.forField(
              `comment_responses[${index}].comment_text`,
              `comment_text must be ${VOTE_COMMENT_RESPONSE_MAX_LENGTH} characters or fewer`,
              validationContext
            );
          }
        }
      }

      // Rebuild comment_responses from the validated fields only, so unexpected extra
      // properties on the client payload never cross the BFF boundary.
      const validatedCommentResponses: CommentResponseInput[] | undefined = payload.comment_responses?.map((response) => ({
        prompt_id: response.prompt_id,
        comment_text: response.comment_text,
      }));

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
        if (!Array.isArray(payload.user_vote_content) || payload.user_vote_content.length === 0) {
          throw ServiceValidationError.forField('user_vote_content', 'user_vote_content is required when not abstaining', validationContext);
        }

        for (const [index, answer] of payload.user_vote_content.entries()) {
          if (!answer || typeof answer !== 'object') {
            throw ServiceValidationError.forField(`user_vote_content[${index}]`, 'Each answer must be a non-null object', validationContext);
          }

          if (!answer.question_id || typeof answer.question_id !== 'string') {
            throw ServiceValidationError.forField(`user_vote_content[${index}].question_id`, 'question_id is required for each answer', validationContext);
          }

          const hasChoiceIds = Array.isArray(answer.choice_ids) && answer.choice_ids.length > 0;
          const hasRankedChoices = Array.isArray(answer.ranked_choices) && answer.ranked_choices.length > 0;

          if (!hasChoiceIds && !hasRankedChoices) {
            throw ServiceValidationError.forField(
              `user_vote_content[${index}]`,
              'Each answer must include either choice_ids or ranked_choices',
              validationContext
            );
          }
        }

        upstreamPayload = {
          vote_uid: payload.vote_uid,
          vote_response_uid: payload.vote_response_uid,
          abstain: false,
          user_vote_content: payload.user_vote_content,
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

      const vote = await this.voteService.enableVote(req, uid);

      logger.success(req, 'enable_vote', startTime, {
        vote_uid: uid,
        status: vote.status,
      });

      res.json(vote);
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
