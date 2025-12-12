// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AddEmailRequest,
  CombinedProfile,
  ProfileUpdateRequest,
  UpdateEmailPreferencesRequest,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserProfile,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { SupabaseService } from '../services/supabase.service';
import { UserService } from '../services/user.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

/**
 * Controller for handling profile HTTP requests
 */
export class ProfileController {
  private supabaseService: SupabaseService = new SupabaseService();
  private userService: UserService = new UserService();

  /**
   * GET /api/profile - Get current user's combined profile
   * Uses NATS as the sole authoritative source for user metadata
   */
  public async getCurrentUserProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_current_user_profile');

    try {
      // Get username from auth context
      const username = await getUsernameFromAuth(req);

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_current_user_profile',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Get OIDC user data to construct UserProfile
      const oidcUser = req.oidc?.user;

      if (!oidcUser) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication data not available', {
          operation: 'get_current_user_profile',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Get user metadata from NATS (authoritative source)
      let natsUserData: UserMetadata | null = null;
      try {
        const natsResponse = await this.userService.getUserInfo(req, username);

        if (natsResponse.success && natsResponse.data) {
          natsUserData = natsResponse.data;
        } else {
          logger.warning(req, 'get_current_user_profile', 'Failed to fetch user metadata from NATS', {
            username,
            error: natsResponse.error,
          });
        }
      } catch (error) {
        logger.warning(req, 'get_current_user_profile', 'Exception while fetching user metadata from NATS', {
          username,
          err: error,
        });
      }

      // Construct UserProfile from OIDC token data
      const userProfile: UserProfile = {
        id: oidcUser['sub'] as string,
        email: oidcUser['email'] as string,
        first_name: (natsUserData?.given_name || oidcUser['given_name'] || oidcUser['first_name'] || null) as string | null,
        last_name: (natsUserData?.family_name || oidcUser['family_name'] || oidcUser['last_name'] || null) as string | null,
        username: (oidcUser['username'] || oidcUser['preferred_username'] || username) as string,
        created_at: (oidcUser['created_at'] || new Date().toISOString()) as string,
        updated_at: (oidcUser['updated_at'] || new Date().toISOString()) as string,
      };

      // Build CombinedProfile response
      const combinedProfile: CombinedProfile = {
        user: userProfile,
        profile: natsUserData,
      };

      logger.success(req, 'get_current_user_profile', startTime, {
        user_id: userProfile.id,
        username,
        has_metadata: !!natsUserData,
      });

      res.json(combinedProfile);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/profile - Update user metadata via NATS
   * Handles all user profile fields including personal info and profile details
   */
  public async updateUserMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_user_metadata_nats', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      // Get the bearer token from the request (set by auth middleware) or OIDC access token
      const token = req.bearerToken || req.oidc?.accessToken?.access_token;
      if (!token) {
        const validationError = ServiceValidationError.forField('token', 'Authentication token required', {
          operation: 'update_user_metadata_nats',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Get username from auth context for user_id
      const username = await getUsernameFromAuth(req);
      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_user_metadata_nats',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Extract and validate request body
      const { user_metadata }: ProfileUpdateRequest = req.body;

      // Validate at least one field to update is provided
      if (!user_metadata) {
        const validationError = ServiceValidationError.forField('body', 'At least one field to update must be provided', {
          operation: 'update_user_metadata_nats',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Validate user metadata if provided
      if (user_metadata) {
        try {
          this.userService.validateUserMetadata(user_metadata);
        } catch (validationError) {
          const error = ServiceValidationError.forField('user_metadata', validationError instanceof Error ? validationError.message : 'Invalid user metadata', {
            operation: 'update_user_metadata_nats',
            service: 'profile_controller',
            path: req.path,
          });

          return next(error);
        }
      }

      // Prepare the update request
      const updateRequest: UserMetadataUpdateRequest = {
        token,
        username,
        user_metadata: user_metadata,
      };

      // Call the user service to update via NATS
      const response = await this.userService.updateUserMetadata(req, updateRequest);

      // Handle response
      if (response.success) {
        logger.success(req, 'update_user_metadata_nats', startTime, {
          user_id: username,
          updated_fields: response.updated_fields,
        });

        res.status(200).json({
          success: true,
          message: response.message || 'User metadata updated successfully',
          updated_fields: response.updated_fields,
        });
      } else {
        // Create appropriate error based on error type
        let error: any;

        if (response.error === 'Service temporarily unavailable') {
          // Service unavailable error
          error = new MicroserviceError(response.message || 'Authentication service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE', {
            operation: 'update_user_metadata_nats',
            service: 'auth-service',
            path: req.path,
            errorBody: { error: response.error, message: response.message },
          });
        } else if (response.error?.includes('authentication') || response.error?.includes('token')) {
          // Authentication error
          error = new AuthenticationError(response.message || 'Authentication failed', {
            operation: 'update_user_metadata_nats',
            service: 'profile_controller',
            path: req.path,
            metadata: { error: response.error },
          });
        } else if (response.error?.includes('permission') || response.error?.includes('forbidden')) {
          // Authorization error
          error = new AuthorizationError(response.message || 'Insufficient permissions to update user metadata', {
            operation: 'update_user_metadata_nats',
            service: 'profile_controller',
            path: req.path,
          });
        } else if (response.error?.includes('not found')) {
          // Resource not found error
          error = new ResourceNotFoundError('User', username, {
            operation: 'update_user_metadata_nats',
            service: 'profile_controller',
            path: req.path,
          });
        } else if (response.error?.includes('validation') || response.error?.includes('invalid')) {
          // Validation error
          error = ServiceValidationError.forField('user_metadata', response.message || response.error || 'Invalid user metadata', {
            operation: 'update_user_metadata_nats',
            service: 'profile_controller',
            path: req.path,
          });
        } else {
          // Generic microservice error
          error = new MicroserviceError(response.message || response.error || 'Failed to update user metadata', 500, 'INTERNAL_ERROR', {
            operation: 'update_user_metadata_nats',
            service: 'auth-service',
            path: req.path,
            errorBody: { error: response.error, message: response.message },
          });
        }

        return next(error);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/emails - Get current user's email management data
   */
  public async getUserEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_emails');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_user_emails',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const userId = await this.supabaseService.getUser(username);

      if (!userId) {
        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'get_user_emails',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const emailData = await this.supabaseService.getEmailManagementData(userId.id);

      logger.success(req, 'get_user_emails', startTime, {
        user_id: userId.id,
        email_count: emailData.emails.length,
        has_preferences: !!emailData.preferences,
      });

      res.json(emailData);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/emails - Add new email for current user
   */
  public async addUserEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'add_user_email', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const { email }: AddEmailRequest = req.body;

      if (!email || typeof email !== 'string') {
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
        const validationError = ServiceValidationError.forField('email', 'Invalid email format', {
          operation: 'add_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const newEmail = await this.supabaseService.addUserEmail(user.id, email);

      logger.success(req, 'add_user_email', startTime, {
        user_id: user.id,
        email_id: newEmail.id,
        email: newEmail.email,
      });

      res.status(201).json(newEmail);
    } catch (error) {
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
    const startTime = logger.startOperation(req, 'delete_user_email', {
      email_id: req.params['emailId'],
    });

    try {
      const username = await getUsernameFromAuth(req);
      const emailId = req.params['emailId'];

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      if (!emailId) {
        const validationError = ServiceValidationError.forField('email_id', 'Email ID is required', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'delete_user_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.supabaseService.deleteUserEmail(emailId, user.id);

      logger.success(req, 'delete_user_email', startTime, {
        user_id: user.id,
        email_id: emailId,
      });

      res.status(204).send();
    } catch (error) {
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
    const startTime = logger.startOperation(req, 'set_primary_email', {
      email_id: req.params['emailId'],
    });

    try {
      const username = await getUsernameFromAuth(req);
      const emailId = req.params['emailId'];

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      if (!emailId) {
        const validationError = ServiceValidationError.forField('email_id', 'Email ID is required', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        const validationError = ServiceValidationError.forField('user_id', 'User not found', {
          operation: 'set_primary_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.supabaseService.setPrimaryEmail(user.id, emailId);

      logger.success(req, 'set_primary_email', startTime, {
        user_id: user.id,
        email_id: emailId,
      });

      res.status(200).json({ message: 'Primary email updated successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/email-preferences - Get user email preferences
   */
  public async getEmailPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_email_preferences');

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const preferences = await this.supabaseService.getEmailPreferences(user.id);

      logger.success(req, 'get_email_preferences', startTime, {
        user_id: user.id,
        has_preferences: !!preferences,
      });

      res.json(preferences);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/profile/email-preferences - Update user email preferences
   */
  public async updateEmailPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_email_preferences', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const username = await getUsernameFromAuth(req);

      if (!username) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const user = await this.supabaseService.getUser(username);

      if (!user) {
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
        const validationError = ServiceValidationError.forField('request_body', 'No valid fields provided for update', {
          operation: 'update_email_preferences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const updatedPreferences = await this.supabaseService.updateEmailPreferences(user.id, updateData);

      logger.success(req, 'update_email_preferences', startTime, {
        user_id: user.id,
        updated_fields: Object.keys(updateData),
      });

      res.json(updatedPreferences);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/developer - Get current user's developer token information
   */
  public async getDeveloperTokenInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_developer_token_info');

    try {
      // Get user ID from auth context
      const userId = await getUsernameFromAuth(req);

      if (!userId) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_developer_token_info',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Extract the bearer token from the request (set by auth middleware)
      const bearerToken = req.bearerToken;

      if (!bearerToken) {
        const validationError = ServiceValidationError.forField('token', 'No API token available for user', {
          operation: 'get_developer_token_info',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Return token information
      const tokenInfo = {
        token: bearerToken,
        type: 'Bearer',
      };

      logger.success(req, 'get_developer_token_info', startTime, {
        user_id: userId,
        token_length: bearerToken.length,
      });

      // Set cache headers to prevent caching of sensitive bearer tokens
      res.set({
        ['Cache-Control']: 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
      });

      res.json(tokenInfo);
    } catch (error) {
      next(error);
    }
  }
}
