// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EVENT_SHARE_KIT_FLAG, SHARE_KIT_ANONYMOUS_FLAG_CONTEXT, SHARE_KIT_SLUG_PATTERN } from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import { ContentUnavailableError, ResourceNotFoundError } from '../errors';
import { LaunchDarklyServerService } from '../services/launchdarkly-server.service';
import { logger } from '../services/logger.service';
import { ShareKitService } from '../services/share-kit.service';
import { getEffectiveUsername } from '../utils/auth-helper';

/** Controller for the public event share kit (#6058). Content is repo-owned and loaded at startup. */
export class PublicShareKitController {
  public constructor(
    private readonly shareKitService: ShareKitService = new ShareKitService(),
    private readonly flags: LaunchDarklyServerService = LaunchDarklyServerService.getInstance()
  ) {}

  /**
   * GET /public/api/events/:eventSlug/share-kit — 404 for an unknown slug or while `EVENT_SHARE_KIT_FLAG`
   * is off for the visitor, 500 when the slug's content file failed validation. Member-only fields are
   * never included (see #6061).
   */
  public async getShareKit(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { eventSlug } = req.params;
    const startTime = logger.startOperation(req, 'get_public_share_kit', { event_slug: eventSlug });

    try {
      // Not cacheable unless it ends as a kit served to a signed-out visitor (below): a 404 from the flag or an unknown
      // slug must not be kept by a browser or proxy past the moment the kit is turned on.
      res.setHeader('Cache-Control', 'private, no-store');
      const signedIn = !!getEffectiveUsername(req);
      // Signed-in visitors are targeted by LFID username (staff first); everyone else shares one context.
      const enabled = await this.flags.isFlagEnabled(req, EVENT_SHARE_KIT_FLAG, false, signedIn ? undefined : SHARE_KIT_ANONYMOUS_FLAG_CONTEXT);
      // The answer can differ per visitor while the flag is targeted, so shared caches must keep them apart.
      res.setHeader('Vary', 'Cookie');
      if (!enabled) {
        logger.debug(req, 'get_public_share_kit', 'Share kit flag is off for this visitor', { event_slug: eventSlug, signed_in: signedIn });
        throw new ResourceNotFoundError('Share kit', eventSlug, { operation: 'get_public_share_kit', service: 'public_share_kit_controller', path: req.path });
      }
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
      // Repo-owned content that only changes on deploy; short shared caching keeps crawlers cheap. A signed-in
      // visitor may be let in by flag targeting that a signed-out one is not, so theirs stays out of shared caches.
      if (!signedIn) {
        res.setHeader('Cache-Control', 'public, max-age=300');
      }
      res.json(shareKit);
    } catch (error) {
      next(error);
    }
  }
}
