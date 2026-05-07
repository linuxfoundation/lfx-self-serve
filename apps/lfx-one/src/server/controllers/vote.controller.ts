// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateVoteRequest, CreateVoteResponseRequest, UpdateVoteRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
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
      const votes = await this.voteService.getVotes(req, req.query as Record<string, any>);

      logger.success(req, 'get_votes', startTime, {
        vote_count: votes.length,
      });

      res.json({ data: votes });
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
      body_size: JSON.stringify(req.body).length,
    });

    try {
      const vote = await this.voteService.createVote(req, voteData);

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
      body_size: JSON.stringify(req.body).length,
    });

    try {
      if (
        !validateUidParameter(uid, req, next, {
          operation: 'update_vote',
          service: 'vote_controller',
        })
      ) {
        return;
      }

      const vote = await this.voteService.updateVote(req, uid, voteData);

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
        num_poll_results: results.poll_results?.length ?? 0,
        num_votes_cast: results.num_votes_cast,
      });

      res.json(results);
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

      // Build the upstream payload immutably: when abstaining we drop user_vote_content entirely;
      // when not abstaining we validate each answer and forward the original content.
      let upstreamPayload: CreateVoteResponseRequest;

      if (payload.abstain) {
        upstreamPayload = {
          vote_uid: payload.vote_uid,
          vote_response_uid: payload.vote_response_uid,
          abstain: true,
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

        upstreamPayload = payload;
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
}
