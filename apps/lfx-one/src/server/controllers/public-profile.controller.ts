// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { ResourceNotFoundError } from '../errors';
import { logger } from '../services/logger.service';
import { PublicProfileService } from '../services/public-profile.service';

/**
 * Controller for the public (unauthenticated) profile page data source.
 */
export class PublicProfileController {
  private publicProfileService: PublicProfileService = new PublicProfileService();

  /**
   * GET /public/api/profile/:username
   * Returns a user's public profile artifact. A missing or malformed profile is a 404. A
   * profile whose owner has made it private responds 200 with only `{ isPublic: false }` so
   * the page can render its private state without exposing any withheld data.
   */
  public async getPublicProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { username } = req.params;
    const startTime = logger.startOperation(req, 'get_public_profile', { username });

    try {
      const profile = await this.publicProfileService.getPublicProfile(req, username);

      if (!profile) {
        throw new ResourceNotFoundError('Profile', username, {
          operation: 'get_public_profile',
          service: 'public_profile_controller',
          path: req.path,
        });
      }

      logger.success(req, 'get_public_profile', startTime, { username, is_public: profile.isPublic });

      if (!profile.isPublic) {
        res.json({ isPublic: false });
        return;
      }

      res.json(profile);
    } catch (error) {
      next(error);
    }
  }
}
