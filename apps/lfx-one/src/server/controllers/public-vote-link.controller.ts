// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { VOTE_LINK_TOKEN_MAX_LENGTH } from '@lfx-one/shared/constants';
import { VoteLinkResponseRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { buildValidatedCommentResponses, buildValidatedVoteAnswers } from '../helpers/vote-response-validation.helper';
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
      const voteToken = this.readToken(req, 'get_vote_link_ballot');

      const ballot = await this.voteService.getVoteLinkBallot(req, { vote_token: voteToken });

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
      const body = this.buildResponseBody(req, operation);

      await this.voteService.submitVoteLinkResponse(req, method, body);

      logger.success(req, operation, startTime);

      res.set('Cache-Control', 'private, no-store');
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /** The body must be a JSON object with a bounded string `vote_token`. */
  private readToken(req: Request, operation: string): string {
    const token: unknown = req.body?.vote_token;
    if (typeof token !== 'string' || token.length === 0 || token.length > VOTE_LINK_TOKEN_MAX_LENGTH) {
      throw ServiceValidationError.forField('vote_token', 'vote_token is required', { ...VALIDATION_CONTEXT, operation });
    }
    return token;
  }

  /**
   * This public surface is anonymous, so the body is validated and rebuilt from allowlisted fields before it is forwarded:
   * boolean `abstain`, well-formed answers when not abstaining, comment responses within the length limit, and no extra
   * properties. The ballot itself is still identified only by the token.
   */
  private buildResponseBody(req: Request, operation: string): VoteLinkResponseRequest {
    const context = { ...VALIDATION_CONTEXT, operation };
    const voteToken = this.readToken(req, operation);
    const { abstain, user_vote_content: answers, comment_responses: comments } = req.body as Record<string, unknown>;

    if (typeof abstain !== 'boolean') {
      throw ServiceValidationError.forField('abstain', 'abstain is required and must be a boolean', context);
    }

    return {
      vote_token: voteToken,
      abstain,
      ...(abstain ? {} : { user_vote_content: buildValidatedVoteAnswers(answers, context) }),
      // Omitting comment_responses keeps existing comments upstream; an empty array clears them.
      ...(comments === undefined ? {} : { comment_responses: buildValidatedCommentResponses(comments, context) }),
    };
  }
}
