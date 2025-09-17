// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AddEmailRequest, CombinedProfile, UpdateEmailPreferencesRequest } from '@lfx-one/shared/interfaces';
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

  /**
   * GET /api/profile/emails - Get current user's email management data
   */
  public async getUserEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_user_emails');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.error(req, 'get_user_emails', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_user_emails',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const userId = await this.supabaseService.getUser(username);

      if (!userId) {
        Logger.error(req, 'get_user_emails', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'get_user_emails',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const emailData = await this.supabaseService.getEmailManagementData(userId.id);

      Logger.success(req, 'get_user_emails', startTime, {
        user_id: userId.id,
        email_count: emailData.emails.length,
        has_preferences: !!emailData.preferences,
      });

      res.json(emailData);
    } catch (error) {
      Logger.error(req, 'get_user_emails', startTime, error);
      next(error);
    }
  }

  /**
   * POST /api/profile/emails - Add new email for current user
   */
  public async addUserEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'add_user_email', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.error(req, 'add_user_email', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        Logger.error(req, 'add_user_email', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const { email }: AddEmailRequest = req.body;

      if (!email || typeof email !== 'string') {
        Logger.error(req, 'add_user_email', startTime, new Error('Invalid email address'));

        const validationError = ServiceValidationError.forField('email', 'Valid email address is required', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        Logger.error(req, 'add_user_email', startTime, new Error('Invalid email format'));

        const validationError = ServiceValidationError.forField('email', 'Invalid email format', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const newEmail = await this.supabaseService.addUserEmail(user.id, email);

      Logger.success(req, 'add_user_email', startTime, {
        user_id: user.id,
        email_id: newEmail.id,
        email: newEmail.email,
      });

      res.status(201).json(newEmail);
    } catch (error) {
      Logger.error(req, 'add_user_email', startTime, error);
      if (error instanceof Error && error.message.includes('already in use')) {
        const validationError = ServiceValidationError.forField('email', error.message, {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * DELETE /api/profile/emails/:emailId - Delete user email
   */
  public async deleteUserEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'delete_user_email', {
      email_id: req.params['emailId'],
    });

    try {
      const username = await getUsernameFromAuth(req);
      const emailId = req.params['emailId'];

      if (!username) {
        Logger.error(req, 'delete_user_email', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      if (!emailId) {
        Logger.error(req, 'delete_user_email', startTime, new Error('Email ID is required'));

        const validationError = ServiceValidationError.forField('email_id', 'Email ID is required', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        Logger.error(req, 'delete_user_email', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.supabaseService.deleteUserEmail(emailId, user.id);

      Logger.success(req, 'delete_user_email', startTime, {
        user_id: user.id,
        email_id: emailId,
      });

      res.status(204).send();
    } catch (error) {
      Logger.error(req, 'delete_user_email', startTime, error);
      if (error instanceof Error && (error.message.includes('Cannot delete') || error.message.includes('last email'))) {
        const validationError = ServiceValidationError.forField('email_id', error.message, {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * PUT /api/profile/emails/:emailId/primary - Set email as primary
   */
  public async setPrimaryEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'set_primary_email', {
      email_id: req.params['emailId'],
    });

    try {
      const username = await getUsernameFromAuth(req);
      const emailId = req.params['emailId'];

      if (!username) {
        Logger.error(req, 'set_primary_email', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      if (!emailId) {
        Logger.error(req, 'set_primary_email', startTime, new Error('Email ID is required'));

        const validationError = ServiceValidationError.forField('email_id', 'Email ID is required', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        Logger.error(req, 'set_primary_email', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.supabaseService.setPrimaryEmail(user.id, emailId);

      Logger.success(req, 'set_primary_email', startTime, {
        user_id: user.id,
        email_id: emailId,
      });

      res.status(200).json({ message: 'Primary email updated successfully' });
    } catch (error) {
      Logger.error(req, 'set_primary_email', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/profile/email-preferences - Get user email preferences
   */
  public async getEmailPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'get_email_preferences');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.error(req, 'get_email_preferences', startTime, new Error('User not authenticated or user ID not found'));
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        Logger.error(req, 'get_email_preferences', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const preferences = await this.supabaseService.getEmailPreferences(user.id);

      Logger.success(req, 'get_email_preferences', startTime, {
        user_id: user.id,
        has_preferences: !!preferences,
      });

      res.json(preferences);
    } catch (error) {
      Logger.error(req, 'get_email_preferences', startTime, error);
      next(error);
    }
  }

  /**
   * PUT /api/profile/email-preferences - Update user email preferences
   */
  public async updateEmailPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Logger.start(req, 'update_email_preferences', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        Logger.error(req, 'update_email_preferences', startTime, new Error('User not authenticated or user ID not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        Logger.error(req, 'update_email_preferences', startTime, new Error('User not found'));

        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'update_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const preferences: UpdateEmailPreferencesRequest = req.body;
      const allowedFields = ['meeting_email_id', 'notification_email_id', 'billing_email_id'];
      const updateData: any = {};

      for (const [key, value] of Object.entries(preferences)) {
        if (allowedFields.includes(key)) {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length === 0) {
        Logger.error(req, 'update_email_preferences', startTime, new Error('No valid fields provided for update'));

        const validationError = ServiceValidationError.forField('request_body', 'No valid fields provided for update', {
          operation: 'update_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const updatedPreferences = await this.supabaseService.updateEmailPreferences(user.id, updateData);

      Logger.success(req, 'update_email_preferences', startTime, {
        user_id: user.id,
        updated_fields: Object.keys(updateData),
      });

      res.json(updatedPreferences);
    } catch (error) {
      Logger.error(req, 'update_email_preferences', startTime, error);
      next(error);
    }
  }
}
