// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CombinedProfile } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { Logger } from '../helpers/logger';
import { SupabaseService } from '../services/supabase.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

/**
 * Controller for handling profile HTTP requests
 */
export class ProfileController {
  private supabaseService: SupabaseService = new SupabaseService();

  /**
   * GET /api/profile - Get current user's combined profile
   */
  public async getCurrentUserProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_current_user_profile');

    try {
      // Get user ID from auth context
      const userId = await getUsernameFromAuth(req);

      if (!userId) {
        Logger.error(req, 'get_current_user_profile', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_current_user_profile',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      let combinedProfile: CombinedProfile | null = null;

      // Get combined profile using JOIN
      const user = await this.supabaseService.getUser(userId);

      if (!user) {
        const validationError = ServiceValidationError.forField('user_id', 'User profile not found', {
          operation: 'get_current_user_profile',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      combinedProfile = {
        user,
        profile: null,
      };

      // Get profile details
      const profile = await this.supabaseService.getProfile(user.id);

      // If no profile details exist, create them
      if (!profile) {
        await this.supabaseService.createProfileIfNotExists(user.id);
        // Refetch the combined profile with the newly created profile
        const updatedProfile = await this.supabaseService.getProfile(user.id);
        combinedProfile.profile = updatedProfile || null;
      } else {
        combinedProfile.profile = profile;
      }

      Logger.success(req, 'get_current_user_profile', startTime, {
        user_id: user.id,
        has_profile_details: !!combinedProfile.profile,
      });

      res.json(combinedProfile);
    } catch (error) {
      Logger.error(req, 'get_current_user_profile', startTime, error);
      next(error);
    }
  }

  /**
   * PATCH /api/profile/user - Update user table fields
   */
  public async updateCurrentUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'update_current_user', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      // Get user ID from auth context
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.error(req, 'update_current_user', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_current_user',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Validate request body contains valid user profile fields
      const allowedFields = ['first_name', 'last_name', 'username'];
      const updateData: any = {};

      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.includes(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        Logger.error(req, 'update_current_user', startTime, new Error('No valid fields provided for update'));

        const validationError = ServiceValidationError.forField('request_body', 'No valid fields provided for update', {
          operation: 'update_current_user',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Update user
      const updatedUser = await this.supabaseService.updateUser(username, updateData);

      Logger.success(req, 'update_current_user', startTime, {
        username: username,
        updated_fields: Object.keys(updateData),
      });

      res.json(updatedUser);
    } catch (error) {
      Logger.error(req, 'update_current_user', startTime, error);
      next(error);
    }
  }

  /**
   * PATCH /api/profile/details - Update profile details table fields
   */
  public async updateCurrentProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'update_current_profile_details', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      // Get user ID from auth context
      const userId = await getUsernameFromAuth(req);

      if (!userId) {
        Logger.error(req, 'update_current_profile_details', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_current_profile_details',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Validate request body contains valid profile detail fields
      const allowedFields = ['title', 'organization', 'country', 'state', 'city', 'address', 'zipcode', 'phone_number', 'tshirt_size'];
      const updateData: any = {};

      for (const [key, value] of Object.entries(req.body)) {
        if (allowedFields.includes(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        Logger.error(req, 'update_current_profile_details', startTime, new Error('No valid fields provided for update'));

        const validationError = ServiceValidationError.forField('request_body', 'No valid fields provided for update', {
          operation: 'update_current_profile_details',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Update profile details
      const updatedProfile = await this.supabaseService.updateProfileDetails(userId, updateData);

      Logger.success(req, 'update_current_profile_details', startTime, {
        user_id: userId,
        updated_fields: Object.keys(updateData),
      });

      res.json(updatedProfile);
    } catch (error) {
      Logger.error(req, 'update_current_profile_details', startTime, error);
      next(error);
    }
  }
}
