// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterService } from '../services/newsletter.service';

/**
 * Public newsletter controller — the unauthenticated "View Online" surface for
 * a sent newsletter edition.
 *
 * This route is mounted under `/public/api/newsletters` and classified `auth:
 * 'public'` in auth.middleware.ts, so `req.bearerToken` is never set on
 * requests that reach here. Access is entirely gated by the Go service
 * (project_uid match + status=sent, else 404) — this controller does not
 * perform any authorization of its own, matching the narrow, deliberately
 * unauthenticated `PublicNewsletterView` projection it returns.
 */
export class PublicNewsletterController {
  private newsletterService: NewsletterService = new NewsletterService();

  /**
   * GET /public/api/newsletters/:projectUid/:newsletterUid
   */
  public async getPublicView(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const newsletterUid = this.requireNewsletterUid(req);
      const startTime = logger.startOperation(req, 'newsletter_public_view', { project_uid: projectUid, newsletter_id: newsletterUid });

      const view = await this.newsletterService.getPublicView(req, projectUid, newsletterUid);
      logger.success(req, 'newsletter_public_view', startTime, { project_uid: projectUid, newsletter_id: newsletterUid });
      // Explicitly project to the public allow-list. `PublicNewsletterView` is a
      // compile-time type only — it does not strip excess runtime properties, so
      // forwarding the raw upstream object could leak `id`, `committee_uids`,
      // `ed_reply_email`, `created_by`, or `version` if the upstream response
      // ever widens. Build the response field-by-field on this unauthenticated
      // surface.
      res.json({
        subject: view.subject,
        body_html: view.body_html,
        project_name: view.project_name,
        sent_at: view.sent_at,
      });
    } catch (error) {
      next(error);
    }
  }

  private requireProjectUid(req: Request): string {
    const projectUid = String(req.params['projectUid'] || '').trim();
    if (!projectUid) {
      throw ServiceValidationError.forField('projectUid', 'projectUid path parameter is required', {
        operation: 'public_newsletter_controller',
        service: 'public_newsletter_controller',
        path: req.path,
      });
    }
    return projectUid;
  }

  private requireNewsletterUid(req: Request): string {
    const newsletterUid = String(req.params['newsletterUid'] || '').trim();
    if (!isUuid(newsletterUid)) {
      throw ServiceValidationError.forField('newsletterUid', 'newsletterUid path parameter must be a UUID', {
        operation: 'public_newsletter_controller',
        service: 'public_newsletter_controller',
        path: req.path,
      });
    }
    return newsletterUid;
  }
}
