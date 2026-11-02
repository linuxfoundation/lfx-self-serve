// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN } from '@lfx-one/shared/constants';
import { isUuid } from '@lfx-one/shared/utils/string.utils';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterService } from '../services/newsletter.service';

/**
 * Public (signed-out) link preview of a newsletter permalink (#4940). Link-preview crawlers such as
 * LinkedIn's fetch `/newsletters/:projectSlug/:id` without a session; the signed-out share-preview page
 * (`NewsletterSharePreviewComponent`) renders its Open Graph tags from this endpoint. It answers with
 * the subject of a sent issue only. Malformed params, an unknown slug, an unknown issue, an unsent issue
 * and any upstream refusal are all the same local 404, so the endpoint reveals nothing about drafts.
 */
export class PublicNewsletterController {
  public constructor(private readonly newsletterService: NewsletterService = new NewsletterService()) {}

  /** GET /public/api/newsletters/:projectSlug/:newsletterUid/preview */
  public async getSharePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_newsletter_share_preview';
    const { projectSlug, newsletterUid } = req.params;
    const startTime = logger.startOperation(req, operation, { project_slug: projectSlug, newsletter_uid: newsletterUid });

    try {
      // A fixed resource id: this anonymous endpoint never echoes caller-supplied text into its error.
      const notFound = new ResourceNotFoundError('Newsletter', 'share-preview', { operation, service: 'public_newsletter_controller' });

      // Both params become upstream lookup keys; anything else is simply not a newsletter.
      if (!NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN.test(projectSlug ?? '') || !isUuid(newsletterUid ?? '')) throw notFound;

      const preview = await this.newsletterService.getSharePreview(req, projectSlug, newsletterUid);
      if (!preview) throw notFound;

      logger.success(req, operation, startTime, { newsletter_uid: newsletterUid });
      res.json(preview);
    } catch (error) {
      next(error);
    }
  }
}
