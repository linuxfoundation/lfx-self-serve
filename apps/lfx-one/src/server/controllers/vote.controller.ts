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
      const { data, page_token } = await this.voteService.getVotes(req, req.query as Record<string, any>);

      logger.success(req, 'get_votes', startTime, {
        vote_count: data.length,
        has_more_pages: !!page_token,
      });

      res.json({ data, page_token });
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
