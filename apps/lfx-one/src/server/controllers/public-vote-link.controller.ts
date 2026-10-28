// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_LINK_TOKEN_MAX_LENGTH } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { VoteService } from '../services/vote.service';

const VALIDATION_CONTEXT = { service: 'public_vote_link_controller' } as const;

/**
 * Login-free vote link proxy (#4363). The token in the request body is a credential: handlers forward the body
 * unchanged, never log it, never put it in operation metadata, and never cache the response.
 */
export class PublicVoteLinkController {
  private readonly voteService = new VoteService();

  /** POST /public/api/votes/link-ballot */
  public async getLinkBallot(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_vote_link_ballot');

    try {
      this.assertBody(req, 'get_vote_link_ballot');

      const ballot = await this.voteService.getVoteLinkBallot(req, req.body);

      logger.success(req, 'get_vote_link_ballot', startTime);

      res.set('Cache-Control', 'private, no-store');
      res.json(ballot);
    } catch (error) {
      next(error);
    }
  }

  /** POST /public/api/votes/link-responses */
  public async submitLinkResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.forwardResponse(req, res, next, 'POST', 'submit_vote_link_response');
  }

  /** PUT /public/api/votes/link-responses */
  public async updateLinkResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
    await this.forwardResponse(req, res, next, 'PUT', 'update_vote_link_response');
  }

  private async forwardResponse(req: Request, res: Response, next: NextFunction, method: 'POST' | 'PUT', operation: string): Promise<void> {
    const startTime = logger.startOperation(req, operation);

    try {
      this.assertBody(req, operation);

      await this.voteService.submitVoteLinkResponse(req, method, req.body);

      logger.success(req, operation, startTime);

      res.set('Cache-Control', 'private, no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /** The body must be a JSON object with a bounded string `vote_token`; everything else is validated upstream. */
  private assertBody(req: Request, operation: string): void {
    const token: unknown = req.body?.vote_token;
    if (typeof token !== 'string' || token.length === 0 || token.length > VOTE_LINK_TOKEN_MAX_LENGTH) {
      throw ServiceValidationError.forField('vote_token', 'vote_token is required', { ...VALIDATION_CONTEXT, operation });
    }
  }
}
