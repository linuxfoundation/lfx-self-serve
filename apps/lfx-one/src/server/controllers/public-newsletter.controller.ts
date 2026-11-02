// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN, NEWSLETTER_SHARE_PREVIEW_UID_PATTERN } from '@lfx-one/shared/constants';
import { NewsletterSharePreview } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterService } from '../services/newsletter.service';
import { ProjectService } from '../services/project.service';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Public (signed-out) link preview of a newsletter permalink (#4940). Social crawlers such as
 * LinkedIn's fetch `/newsletters/:projectSlug/:id` without a session; the reader page renders its
 * Open Graph tags from this endpoint. It answers with the subject only, and only for a sent issue —
 * never the body, the foundation, or anything about a draft. An unknown slug, an unknown issue and an
 * unsent issue are the same 404, so the endpoint does not reveal which drafts exist.
 */
export class PublicNewsletterController {
  public constructor(
    private readonly newsletterService: NewsletterService = new NewsletterService(),
    private readonly projectService: ProjectService = new ProjectService()
  ) {}

  /** GET /public/api/newsletters/:projectSlug/:newsletterUid/preview */
  public async getSharePreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_newsletter_share_preview';
    const { projectSlug, newsletterUid } = req.params;
    const startTime = logger.startOperation(req, operation, { project_slug: projectSlug, newsletter_uid: newsletterUid });

    try {
      const notFound = (): ResourceNotFoundError =>
        new ResourceNotFoundError('Newsletter', newsletterUid ?? '', { operation, service: 'public_newsletter_controller', path: req.path });

      // Both params become upstream path segments; anything else is simply not a newsletter.
      if (!NEWSLETTER_SHARE_PREVIEW_SLUG_PATTERN.test(projectSlug ?? '') || !NEWSLETTER_SHARE_PREVIEW_UID_PATTERN.test(newsletterUid ?? '')) {
        throw notFound();
      }

      // NATS slug lookup needs no token; the newsletter read uses an M2M token scoped to this one call,
      // because the visitor has no session.
      const project = await this.projectService.getProjectIdBySlug(req, projectSlug, { unavailableAsMissing: false });
      if (!project.exists) throw notFound();

      const m2mToken = await generateM2MToken(req);
      const newsletter = await this.newsletterService.getNewsletter(req, project.uid, newsletterUid, { bearerToken: m2mToken });
      if (newsletter.status !== 'sent' || newsletter.project_uid !== project.uid) throw notFound();

      const preview: NewsletterSharePreview = { subject: newsletter.subject };
      logger.success(req, operation, startTime, { project_uid: project.uid, newsletter_uid: newsletterUid });
      res.json(preview);
    } catch (error) {
      next(error);
    }
  }
}
