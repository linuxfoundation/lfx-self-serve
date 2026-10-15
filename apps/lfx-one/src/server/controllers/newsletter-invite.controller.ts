// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_INVITE_COUNTED_LOCALS_KEY, NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE } from '@lfx-one/shared/constants';
import { NewsletterInviteRequest } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { isServiceValidationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterInviteService } from '../services/newsletter-invite.service';

/**
 * Me-lens My Newsletters by foundation and the member-benefit coworker invite (#3483). HTTP
 * boundary only: the rules live in `NewsletterInviteService`.
 */
export class NewsletterInviteController {
  private readonly inviteService: NewsletterInviteService;

  public constructor(inviteService?: NewsletterInviteService) {
    this.inviteService = inviteService ?? new NewsletterInviteService();
  }

  /** GET /api/newsletters/my-foundations */
  public async getMyNewsletterFoundations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_my_newsletter_foundations');

    try {
      const body = await this.inviteService.getMyNewsletterFoundations(req);

      res.set('Cache-Control', 'private, no-store');
      logger.success(req, 'get_my_newsletter_foundations', startTime, {
        foundation_count: body.foundations.length,
        complete: body.complete,
        inviter_eligible: body.inviter.eligible,
      });
      res.json(body);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/newsletters/foundations/:foundationUid/invites — rate-limited and blocked while impersonating by the route. */
  public async sendInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'send_newsletter_invite', { foundation_uid: req.params['foundationUid'] });

    try {
      const foundationUid = this.requireUuid(req, 'foundationUid', 'send_newsletter_invite');
      const body = req.body as Partial<NewsletterInviteRequest> | undefined;
      const result = await this.inviteService.sendInvite(req, foundationUid, body?.email ?? '');

      logger.success(req, 'send_newsletter_invite', startTime, { foundation_uid: foundationUid });
      res.status(201).json(result);
    } catch (error) {
      if (!this.isInviteInputError(error)) res.locals[NEWSLETTER_INVITE_COUNTED_LOCALS_KEY] = true;
      next(error);
    }
  }

  /** GET /api/newsletters/groups/:committeeUid/join-status — side-effect free. */
  public async getJoinStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_newsletter_group_join_status', { committee_uid: req.params['committeeUid'] });

    try {
      const committeeUid = this.requireUuid(req, 'committeeUid', 'get_newsletter_group_join_status');
      const status = await this.inviteService.getJoinStatus(req, committeeUid);

      res.set('Cache-Control', 'private, no-store');
      logger.success(req, 'get_newsletter_group_join_status', startTime, {
        committee_uid: committeeUid,
        state: status.state,
        ...(status.denied_reason && { denied_reason: status.denied_reason }),
      });
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/newsletters/groups/:committeeUid/join — blocked while impersonating by the route. */
  public async joinGroup(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'join_newsletter_group_by_invite', { committee_uid: req.params['committeeUid'] });

    try {
      const committeeUid = this.requireUuid(req, 'committeeUid', 'join_newsletter_group_by_invite');
      const result = await this.inviteService.joinGroup(req, committeeUid);

      logger.success(req, 'join_newsletter_group_by_invite', startTime, { committee_uid: committeeUid, status: result.status });
      res.status(result.status === 'added' ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  }

  /** A malformed address or a personal mailbox — the only refusals that do not spend the invite budget. */
  private isInviteInputError(error: unknown): boolean {
    if (!isServiceValidationError(error)) return false;
    const code = error.validationErrors[0]?.code;
    return code === 'FIELD_VALIDATION_ERROR' || code === NEWSLETTER_INVITE_PERSONAL_EMAIL_ERROR_CODE;
  }

  private requireUuid(req: Request, param: string, operation: string): string {
    const value = req.params[param];
    if (!value || !isUuid(value)) {
      throw ServiceValidationError.forField(param, `Invalid ${param}`, { operation, path: req.path });
    }
    return value;
  }
}
