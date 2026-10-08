// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NewsletterSignupRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { logger } from '../services/logger.service';
import { NewsletterSignupService } from '../services/newsletter-signup.service';

/**
 * Anonymous per-Newsletter-group signup (`/public/api/projects/:projectSlug/newsletter-signup/:groupUid`).
 */
export class PublicNewsletterSignupController {
  private newsletterSignupService: NewsletterSignupService = new NewsletterSignupService();

  /** GET — project + group details the signup page renders. */
  public async getSignupInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { projectSlug, groupUid } = req.params;
    const startTime = logger.startOperation(req, 'get_newsletter_signup_info', { project_slug: projectSlug, committee_uid: groupUid });

    try {
      const info = await this.newsletterSignupService.getSignupInfo(req, projectSlug, groupUid);

      logger.success(req, 'get_newsletter_signup_info', startTime, { project_slug: projectSlug, committee_uid: groupUid });
      res.json(info);
    } catch (error) {
      next(error);
    }
  }

  /** POST — subscribes the email to the Newsletter group. */
  public async subscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { projectSlug, groupUid } = req.params;
    const startTime = logger.startOperation(req, 'subscribe_newsletter_signup', { project_slug: projectSlug, committee_uid: groupUid });

    try {
      const body = (req.body ?? {}) as Partial<NewsletterSignupRequest>;
      const result = await this.newsletterSignupService.subscribe(req, projectSlug, groupUid, body.email);

      logger.success(req, 'subscribe_newsletter_signup', startTime, { project_slug: projectSlug, committee_uid: groupUid });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
