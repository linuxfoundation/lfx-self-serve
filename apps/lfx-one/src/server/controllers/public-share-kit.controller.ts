// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHARE_KIT_SLUG_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ContentUnavailableError, ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { ShareKitService } from '../services/share-kit.service';

/** Controller for the public event share kit (#6058). Content is repo-owned and loaded at startup. */
export class PublicShareKitController {
  public constructor(private readonly shareKitService: ShareKitService = new ShareKitService()) {}

  /**
   * GET /public/api/events/:eventSlug/share-kit — 404 for an unknown slug, 500 when the slug's
   * content file failed validation. Member-only fields are never included (see #6061).
   */
  public getShareKit(req: Request, res: Response, next: NextFunction): void {
    const { eventSlug } = req.params;
    const startTime = logger.startOperation(req, 'get_public_share_kit', { event_slug: eventSlug });

    try {
      if (!SHARE_KIT_SLUG_PATTERN.test(eventSlug)) {
        throw new ResourceNotFoundError('Share kit', undefined, { operation: 'get_public_share_kit', service: 'public_share_kit_controller', path: req.path });
      }
      if (this.shareKitService.isInvalid(eventSlug)) {
        throw new ContentUnavailableError('Share kit', eventSlug, {
          operation: 'get_public_share_kit',
          service: 'public_share_kit_controller',
          path: req.path,
        });
      }

      const shareKit = this.shareKitService.getShareKit(eventSlug);
      if (!shareKit) {
        throw new ResourceNotFoundError('Share kit', eventSlug, { operation: 'get_public_share_kit', service: 'public_share_kit_controller', path: req.path });
      }

      logger.success(req, 'get_public_share_kit', startTime, { event_slug: eventSlug });
      // Repo-owned content that only changes on deploy; short shared caching keeps crawlers cheap.
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(shareKit);
    } catch (error) {
      next(error);
    }
  }
}
