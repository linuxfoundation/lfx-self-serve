// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ChangelogService } from '../services/changelog.service';
import { logger } from '../services/logger.service';

export class ChangelogController {
  private readonly changelogService = new ChangelogService();

  public async getUnseenCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_changelog_unseen');

    try {
      const result = await this.changelogService.getUnseenCount(req);

      logger.success(req, 'get_changelog_unseen', startTime, {
        unseen_count: result.data.unseenCount,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async markViewed(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'mark_changelog_viewed');

    try {
      const result = await this.changelogService.markViewed(req);

      logger.success(req, 'mark_changelog_viewed', startTime, {
        product_id: result.data.productId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
