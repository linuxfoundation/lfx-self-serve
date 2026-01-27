// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreateVoteRequest, UpdateVoteRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { validateUidParameter } from '../helpers/validation.helper';
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

      res.json(votes);
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
          logStartTime: startTime,
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
        vote_uid: vote.vote_uid,
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
          logStartTime: startTime,
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
          logStartTime: startTime,
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
}
