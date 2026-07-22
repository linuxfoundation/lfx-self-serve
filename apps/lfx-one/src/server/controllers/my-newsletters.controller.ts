// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MyNewslettersService } from '../services/my-newsletters.service';

/**
 * Recipient-facing newsletter archive controller.
 * Lists and fetches sent newsletters targeting committees the user belongs to.
 * User-scoped (no project context required).
 */
export class MyNewslettersController {
  private myNewslettersService: MyNewslettersService = new MyNewslettersService();

  /**
   * GET /api/newsletters/my-newsletters?page_token=...
   * List recipient archive: sent newsletters for committees the user belongs to.
   */
  public async listArchive(req: Request, res: Response, next: NextFunction): Promise<void> {
    const pageToken = (req.query['page_token'] as string) || undefined;

    const startTime = logger.startOperation(req, 'list_my_newsletters', {
      has_page_token: !!pageToken,
    });

    try {
      const result = await this.myNewslettersService.listArchive(req, pageToken);
      logger.success(req, 'list_my_newsletters', startTime, {
        newsletter_count: result.newsletters.length,
        has_next_page: !!result.next_page_token,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/newsletters/my-newsletters/:newsletterUid
   * Fetch a specific newsletter from the recipient archive with full body_html.
   */
  public async getArchiveDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const newsletterUid = req.params['newsletterUid'];

    // Validate newsletter UID is a UUID
    if (!newsletterUid || !isUuid(newsletterUid)) {
      throw ServiceValidationError.fromFieldErrors({ newsletter_uid: 'Invalid newsletter UID format' }, 'Invalid newsletter UID', {
        operation: 'get_my_newsletter_detail',
        path: req.path,
      });
    }

    const startTime = logger.startOperation(req, 'get_my_newsletter_detail', {
      newsletter_uid: newsletterUid,
    });

    try {
      const newsletter = await this.myNewslettersService.getArchiveDetail(req, newsletterUid);
      logger.success(req, 'get_my_newsletter_detail', startTime, {
        newsletter_id: newsletter.id,
        has_body_html: !!newsletter.body_html,
      });
      res.json(newsletter);
    } catch (error) {
      next(error);
    }
  }
}
