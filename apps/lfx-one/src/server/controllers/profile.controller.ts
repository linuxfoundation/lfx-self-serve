// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AUTH0_TO_CDP_PROVIDER_MAP, CDP_PLATFORM_ICONS, IDENTITY_DISPLAY_PLATFORMS } from '@lfx-one/shared/constants';
import {
  AddEmailRequest,
  Auth0Identity,
  CdpIdentity,
  CdpWorkExperienceRequest,
  CombinedProfile,
  EnrichedIdentity,
  IdentityDisplayState,
  ProfileAuthStatus,
  ProfileUpdateRequest,
  UpdateEmailPreferencesRequest,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserProfile,
  WorkExperienceCreateUpdateBody,
} from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { Auth0Service } from '../services/auth0.service';
import { CdpService } from '../services/cdp.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { logger } from '../services/logger.service';
import { ProfileAuthService } from '../services/profile-auth.service';
import { SocialVerificationService } from '../services/social-verification.service';
import { SupabaseService } from '../services/supabase.service';
import { UserService } from '../services/user.service';
import { getUsernameFromAuth } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

/**
 * Controller for handling profile HTTP requests
 */
export class ProfileController {
  private auth0Service: Auth0Service = new Auth0Service();
  private cdpService: CdpService = new CdpService();
  private emailVerificationService: EmailVerificationService = new EmailVerificationService();
  private profileAuthService: ProfileAuthService = new ProfileAuthService();
  private socialVerificationService: SocialVerificationService = new SocialVerificationService();
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

      // Determine which token to use for the auth-service:
      // - Auth0 with Flow C configured: use user-scoped management token from session
      // - Authelia (local dev) or Flow C not configured: fall back to M2M token
      const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'] || '';
      const isAuthelia = issuerBaseUrl.includes('auth.k8s.orb.local');
      const isProfileAuthConfigured = this.profileAuthService.isProfileAuthConfigured();

      let token: string;

      if (!isAuthelia && isProfileAuthConfigured) {
        // Auth0: Use Flow C management token from session
        const mgmtToken = this.profileAuthService.getManagementToken(req);
        if (!mgmtToken) {
          logger.warning(req, 'update_user_metadata_nats', 'Management token required but not present in session', {
            username,
          });

          res.status(403).json({
            error: 'management_token_required',
            message: 'Profile authorization required',
            authorize_url: '/api/profile/auth/start?returnTo=/profile',
          });
          return;
        }
        token = mgmtToken;
      } else {
        // Authelia (local dev) or Flow C not configured: Keep M2M token fallback
        const authServiceAudience = new URL('api/v2/', issuerBaseUrl).toString();
        token = await generateM2MToken(req, { audience: authServiceAudience });
      }

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

  /**
   * GET /api/profile/identities - Get user's identities with Auth0 cross-reference
   * Fetches CDP identities and Auth0 linked identities in parallel,
   * then applies display logic to determine verified/unverified/hidden state
   */
  public async getIdentities(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_identities');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_identities',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Extract username from sub by removing provider prefix (e.g., "auth0|fghiasy" → "fghiasy")
      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;
      const auth0Sub = req.oidc?.user?.['sub'] as string;

      // Fetch CDP identities and auth-service identities in parallel
      const [cdpIdentities, auth0Identities] = await Promise.all([
        this.cdpService.getIdentitiesForUser(req, lfid),
        auth0Sub
          ? this.auth0Service.getUserIdentities(req, auth0Sub).catch((err: unknown) => {
              logger.warning(req, 'get_identities', 'Auth0 identity fetch failed, continuing without cross-reference', {
                error: err instanceof Error ? err.message : 'Unknown error',
              });
              return [] as Auth0Identity[];
            })
          : Promise.resolve([]),
      ]);

      logger.info(req, 'get_identities', 'Raw identity data before reconciliation', {
        cdp_identities: cdpIdentities,
        auth_service_identities: auth0Identities,
      });

      // Reconcile CDP identities with auth-service identities and filter to display platforms
      const { enriched, notInCdpCount } = this.reconcileIdentities(req, cdpIdentities, auth0Identities, lfid);
      const displayIdentities = enriched.filter((id) => IDENTITY_DISPLAY_PLATFORMS.includes(id.platform));

      logger.success(req, 'get_identities', startTime, {
        lfid,
        cdp_count: cdpIdentities.length,
        auth_service_count: auth0Identities.length,
        display_count: displayIdentities.length,
        hidden_count: enriched.filter((i) => i.displayState === 'hidden').length,
        not_in_cdp_count: notInCdpCount,
      });

      res.json(displayIdentities);
    } catch (error) {
      logger.error(req, 'get_identities', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/profile/work-experiences - Get user's work experiences from CDP
   */
  public async getWorkExperiences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_work_experiences');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_work_experiences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      const workExperiences = await this.cdpService.getWorkExperiencesForUser(req, lfid);

      logger.success(req, 'get_work_experiences', startTime, {
        lfid,
        count: workExperiences.length,
      });

      res.json(workExperiences);
    } catch (error) {
      logger.error(req, 'get_work_experiences', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/profile/project-affiliations - Get user's project affiliations from CDP
   */
  public async getProjectAffiliations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_project_affiliations');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_project_affiliations',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      const affiliations = await this.cdpService.getProjectAffiliationsForUser(req, lfid);

      logger.success(req, 'get_project_affiliations', startTime, {
        lfid,
        count: affiliations.length,
      });

      res.json(affiliations);
    } catch (error) {
      logger.error(req, 'get_project_affiliations', startTime, error);
      next(error);
    }
  }

  /**
   * PATCH /api/profile/identities/:identityId - Reject an identity (mark as "not me")
   * Calls CDP PATCH to set verified=false, verifiedBy=lfxOne
   */
  public async rejectIdentity(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'reject_identity');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'reject_identity',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const identityId = req.params['identityId'];

      if (!identityId) {
        const validationError = ServiceValidationError.forField('identityId', 'Identity ID is required', {
          operation: 'reject_identity',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      // If provider and auth0UserId are provided, attempt to unlink from Auth0 via NATS
      const { provider, auth0UserId } = req.body || {};
      if (provider && auth0UserId) {
        const mgmtToken = this.profileAuthService.getManagementToken(req);
        if (mgmtToken) {
          const unlinkResult = await this.emailVerificationService.unlinkIdentity(req, mgmtToken, provider, auth0UserId);
          if (!unlinkResult.success) {
            logger.warning(req, 'reject_identity', 'Auth0 unlink failed, continuing with CDP rejection', {
              provider,
              auth0_user_id: auth0UserId,
              error: unlinkResult.error,
              message: unlinkResult.message,
            });
          } else {
            logger.debug(req, 'reject_identity', 'Auth0 identity unlinked successfully', {
              provider,
              auth0_user_id: auth0UserId,
            });
          }
        } else {
          logger.warning(req, 'reject_identity', 'No management token — cannot unlink from Auth0', {
            provider,
            auth0_user_id: auth0UserId,
          });
          res.status(403).json({
            error: 'management_token_required',
            message: 'Profile authorization required to remove this identity',
            authorize_url: '/api/profile/auth/start?returnTo=/profile/identities',
          });
          return;
        }
      }

      // Skip CDP rejection for synthetic identities (auth-service-only, prefixed with "auth0:")
      if (identityId.startsWith('auth0:')) {
        logger.debug(req, 'reject_identity', 'Synthetic identity — skipping CDP rejection', { identity_id: identityId });
      } else {
        await this.cdpService.rejectIdentityForUser(req, lfid, identityId);
      }

      logger.success(req, 'reject_identity', startTime, { lfid, identity_id: identityId });
      res.json({ success: true });
    } catch (error) {
      logger.error(req, 'reject_identity', startTime, error);
      next(error);
    }
  }

  /**
   * PATCH /api/profile/work-experiences/:workExperienceId - Confirm a work experience
   * Calls CDP PATCH to set verified=true, verifiedBy=lfid
   */
  public async confirmWorkExperience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'confirm_work_experience');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'confirm_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const workExperienceId = req.params['workExperienceId'];

      if (!workExperienceId) {
        const validationError = ServiceValidationError.forField('workExperienceId', 'Work experience ID is required', {
          operation: 'confirm_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      await this.cdpService.confirmWorkExperienceForUser(req, lfid, workExperienceId);

      logger.success(req, 'confirm_work_experience', startTime, { lfid, work_experience_id: workExperienceId });
      res.json({ success: true });
    } catch (error) {
      logger.error(req, 'confirm_work_experience', startTime, error);
      next(error);
    }
  }

  /**
   * PATCH /api/profile/project-affiliations/:projectId - Update project affiliations
   * Calls CDP PATCH to update a project's affiliations for the current user
   */
  public async patchProjectAffiliation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'patch_project_affiliation');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'patch_project_affiliation',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const projectId = req.params['projectId'];

      if (!projectId) {
        const validationError = ServiceValidationError.forField('projectId', 'Project ID is required', {
          operation: 'patch_project_affiliation',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const { id, affiliations } = req.body;

      if (!id || !Array.isArray(affiliations)) {
        const validationError = ServiceValidationError.forField('affiliations', 'Project id and affiliations array are required', {
          operation: 'patch_project_affiliation',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      await this.cdpService.patchProjectAffiliationForUser(req, lfid, projectId, req.body);

      logger.success(req, 'patch_project_affiliation', startTime, { lfid, project_id: projectId, affiliation_count: affiliations.length });
      res.json({ success: true });
    } catch (error) {
      logger.error(req, 'patch_project_affiliation', startTime, error);
      next(error);
    }
  }

  /**
   * DELETE /api/profile/work-experiences/:workExperienceId - Delete a work experience
   * Calls CDP DELETE to remove the work experience
   */
  public async deleteWorkExperience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'delete_work_experience');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'delete_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const workExperienceId = req.params['workExperienceId'];

      if (!workExperienceId) {
        const validationError = ServiceValidationError.forField('workExperienceId', 'Work experience ID is required', {
          operation: 'delete_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      await this.cdpService.deleteWorkExperienceForUser(req, lfid, workExperienceId);

      logger.success(req, 'delete_work_experience', startTime, { lfid, work_experience_id: workExperienceId });
      res.json({ success: true });
    } catch (error) {
      logger.error(req, 'delete_work_experience', startTime, error);
      next(error);
    }
  }

  /**
   * PUT /api/profile/work-experiences/:workExperienceId - Update a work experience
   * Constructs CdpWorkExperienceRequest with verified/verifiedBy injected by backend
   */
  public async updateWorkExperience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_work_experience');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'update_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const workExperienceId = req.params['workExperienceId'];

      if (!workExperienceId) {
        const validationError = ServiceValidationError.forField('workExperienceId', 'Work experience ID is required', {
          operation: 'update_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const body = req.body as WorkExperienceCreateUpdateBody;

      if (!body.organizationId || !body.jobTitle || !body.startDate) {
        const validationError = ServiceValidationError.forField('body', 'organizationId, jobTitle, and startDate are required', {
          operation: 'update_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      const cdpBody: CdpWorkExperienceRequest = {
        organizationId: body.organizationId,
        jobTitle: body.jobTitle,
        source: body.source,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        verified: true,
        verifiedBy: lfid,
      };

      await this.cdpService.updateWorkExperienceForUser(req, lfid, workExperienceId, cdpBody);

      logger.success(req, 'update_work_experience', startTime, { lfid, work_experience_id: workExperienceId });
      res.json({ success: true });
    } catch (error) {
      logger.error(req, 'update_work_experience', startTime, error);
      next(error);
    }
  }

  /**
   * POST /api/profile/work-experiences - Create a new work experience
   * Constructs CdpWorkExperienceRequest with verified/verifiedBy injected by backend
   */
  public async createWorkExperience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'create_work_experience');

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'create_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const body = req.body as WorkExperienceCreateUpdateBody;

      if (!body.organizationId || !body.jobTitle || !body.startDate) {
        const validationError = ServiceValidationError.forField('body', 'organizationId, jobTitle, and startDate are required', {
          operation: 'create_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      const cdpBody: CdpWorkExperienceRequest = {
        organizationId: body.organizationId,
        jobTitle: body.jobTitle,
        source: body.source,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        verified: true,
        verifiedBy: lfid,
      };

      await this.cdpService.createWorkExperienceForUser(req, lfid, cdpBody);

      logger.success(req, 'create_work_experience', startTime, { lfid });
      res.status(201).json({ success: true });
    } catch (error) {
      logger.error(req, 'create_work_experience', startTime, error);
      next(error);
    }
  }

  /**
   * GET /api/profile/auth/start - Initiate Flow C authorization
   * Redirects the user to Auth0 /authorize with the Profile Client credentials
   */
  public async startProfileAuth(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'profile_auth_start');

    if (!this.profileAuthService.isProfileAuthConfigured()) {
      logger.warning(req, 'profile_auth_start', 'Profile auth not configured', {});
      res.status(501).json({ error: 'Profile authorization is not configured' });
      return;
    }

    const returnTo = (req.query['returnTo'] as string) || '/profile';
    const authorizeUrl = this.profileAuthService.getAuthorizationUrl(req, returnTo);

    logger.success(req, 'profile_auth_start', startTime, {
      return_to: returnTo,
    });

    res.redirect(authorizeUrl);
  }

  /**
   * GET /api/profile/auth/callback - Handle Auth0 callback for Flow C
   * Exchanges the code for a management token, validates sub, stores in session
   */
  public async handleProfileAuthCallback(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'profile_auth_callback');

    const code = req.query['code'] as string;
    const state = req.query['state'] as string;
    const error = req.query['error'] as string;
    const returnTo = (req.appSession?.['profileAuthReturnTo'] as string) || '/profile';

    if (error) {
      logger.error(req, 'profile_auth_callback', startTime, new Error(`Auth0 returned error: ${error}`), {
        error_description: req.query['error_description'],
      });
      res.redirect(`${returnTo}?error=profile_auth_failed`);
      return;
    }

    // Validate state parameter (CSRF protection)
    if (!state || state !== req.appSession?.profileAuthState) {
      logger.error(req, 'profile_auth_callback', startTime, new Error('Invalid state parameter'), {
        has_state: !!state,
        has_session_state: !!req.appSession?.profileAuthState,
      });
      res.redirect(`${returnTo}?error=invalid_state`);
      return;
    }

    if (!code) {
      logger.error(req, 'profile_auth_callback', startTime, new Error('No authorization code received'), {});
      res.redirect(`${returnTo}?error=no_code`);
      return;
    }

    try {
      // Exchange code for token
      const tokenResponse = await this.profileAuthService.exchangeCodeForToken(req, code);

      // Validate sub claim matches the logged-in user
      const currentUserSub = req.oidc?.user?.['sub'] as string;

      if (!currentUserSub) {
        logger.error(req, 'profile_auth_callback', startTime, new Error('Current user sub not found in login session'), {});
        res.redirect(`${returnTo}?error=login_session_invalid`);
        return;
      }

      const subValid = this.profileAuthService.decodeAndValidateSub(tokenResponse.access_token, currentUserSub);

      if (!subValid) {
        logger.error(req, 'profile_auth_callback', startTime, new Error('Profile token sub mismatch'), {
          current_user_sub: currentUserSub,
        });
        res.redirect(`${returnTo}?error=user_mismatch`);
        return;
      }

      // Store token in session
      this.profileAuthService.storeManagementToken(req, tokenResponse);

      // Clean up state
      delete req.appSession?.profileAuthState;
      if (req.appSession) {
        delete req.appSession['profileAuthReturnTo'];
      }

      // Auto-complete pending email verification if present
      const pending = req.appSession?.pendingEmailVerification;
      if (pending) {
        delete req.appSession!.pendingEmailVerification;

        try {
          const otpResponse = await this.emailVerificationService.verifyOtp(req, pending.email, pending.otp);

          if (otpResponse.success && otpResponse.data?.id_token) {
            const mgmtToken = this.profileAuthService.getManagementToken(req);
            if (mgmtToken) {
              const linkResponse = await this.emailVerificationService.linkIdentity(req, mgmtToken, otpResponse.data.id_token);

              if (linkResponse.success) {
                // Fire-and-forget CDP verification
                const subUsername = currentUserSub?.includes('|') ? currentUserSub.split('|')[1] : currentUserSub;
                const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

                this.cdpService
                  .getIdentitiesForUser(req, lfid)
                  .then((identities) => {
                    const emailIdentity = identities.find((id) => (id.platform === 'email' || id.platform === 'custom') && id.value === pending.email);
                    if (emailIdentity) {
                      this.cdpService.verifyIdentityForUser(req, lfid, emailIdentity.id).catch((err: unknown) => {
                        logger.warning(req, 'profile_auth_callback', 'CDP verify failed (non-blocking)', {
                          error: err instanceof Error ? err.message : 'Unknown',
                        });
                      });
                    }
                  })
                  .catch((err: unknown) => {
                    logger.warning(req, 'profile_auth_callback', 'CDP identity lookup failed (non-blocking)', {
                      error: err instanceof Error ? err.message : 'Unknown',
                    });
                  });

                logger.info(req, 'profile_auth_callback', 'Pending email verification completed', { email: pending.email });
              } else {
                logger.warning(req, 'profile_auth_callback', 'Pending verification link failed', {
                  email: pending.email,
                  error: linkResponse.error,
                });
              }
            }
          } else {
            logger.warning(req, 'profile_auth_callback', 'Pending OTP verification failed (may have expired)', {
              email: pending.email,
              error: otpResponse.error,
            });
          }
        } catch (err) {
          logger.warning(req, 'profile_auth_callback', 'Pending verification error (non-blocking)', {
            email: pending.email,
            error: err instanceof Error ? err.message : 'Unknown',
          });
        }
      }

      // Check for pending social connection (chained from social → Flow C → social)
      const pendingSocial = this.socialVerificationService.getPendingSocialConnect(req);
      if (pendingSocial) {
        this.socialVerificationService.clearPendingSocialConnect(req);
        logger.info(req, 'profile_auth_callback', 'Chaining to pending social connect', { provider: pendingSocial.provider });
        res.redirect(`/api/profile/identities/social/connect?provider=${pendingSocial.provider}`);
        return;
      }

      logger.success(req, 'profile_auth_callback', startTime, {
        user_sub: currentUserSub,
        token_type: tokenResponse.token_type,
        scope: tokenResponse.scope,
        expires_in: tokenResponse.expires_in,
        pending_verification_completed: !!pending,
      });

      res.redirect(`${returnTo}?success=profile_token_obtained`);
    } catch (err) {
      logger.error(req, 'profile_auth_callback', startTime, err, {});
      res.redirect(`${returnTo}?error=token_exchange_failed`);
    }
  }

  /**
   * GET /api/profile/auth/status - Check if management token is available
   */
  public async getProfileAuthStatus(req: Request, res: Response): Promise<void> {
    const status: ProfileAuthStatus = {
      authorized: !!this.profileAuthService.getManagementToken(req),
      configured: this.profileAuthService.isProfileAuthConfigured(),
    };

    res.json(status);
  }

  /**
   * GET /api/profile/identities/social/connect?provider=github|linkedin
   * Initiates the social identity verification OAuth flow.
   * If no management token exists, chains through Flow C first.
   */
  public async startSocialConnect(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'start_social_connect');

    const provider = req.query['provider'] as string;

    if (!provider || !this.socialVerificationService.isValidProvider(provider)) {
      logger.error(req, 'start_social_connect', startTime, new Error('Invalid provider'), { provider });
      res.redirect('/profile/identities?error=invalid_provider');
      return;
    }

    // Check if management token exists in session
    const mgmtToken = this.profileAuthService.getManagementToken(req);
    if (!mgmtToken) {
      // Store pending social connect and redirect to Flow C to obtain management token
      this.socialVerificationService.storePendingSocialConnect(req, provider, '/profile/identities');
      logger.info(req, 'start_social_connect', 'No management token, chaining through Flow C', { provider });
      res.redirect(`/api/profile/auth/start?returnTo=/profile/identities`);
      return;
    }

    // Management token exists — redirect to Auth0 with social connection
    const authorizeUrl = this.socialVerificationService.getAuthorizeUrl(req, provider);

    logger.success(req, 'start_social_connect', startTime, { provider });

    res.redirect(authorizeUrl);
  }

  /**
   * GET /social/callback - Handle Auth0 callback from social OAuth flow.
   * Exchanges code for id_token, links identity via NATS, verifies in CDP.
   */
  public async handleSocialCallback(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'social_auth_callback');

    const code = req.query['code'] as string;
    const state = req.query['state'] as string;
    const error = req.query['error'] as string;
    const returnTo = '/profile/identities';

    if (error) {
      logger.error(req, 'social_auth_callback', startTime, new Error(`Auth0 returned error: ${error}`), {
        error_description: req.query['error_description'],
      });
      res.redirect(`${returnTo}?error=social_auth_failed`);
      return;
    }

    // Validate CSRF state
    if (!this.socialVerificationService.validateState(req, state)) {
      logger.error(req, 'social_auth_callback', startTime, new Error('Invalid state parameter'), {
        has_state: !!state,
        has_session_state: !!req.appSession?.socialAuthState,
      });
      res.redirect(`${returnTo}?error=invalid_state`);
      return;
    }

    this.socialVerificationService.clearState(req);

    if (!code) {
      logger.error(req, 'social_auth_callback', startTime, new Error('No authorization code received'), {});
      res.redirect(`${returnTo}?error=no_code`);
      return;
    }

    // Get management token from session
    const mgmtToken = this.profileAuthService.getManagementToken(req);
    if (!mgmtToken) {
      logger.error(req, 'social_auth_callback', startTime, new Error('Management token not found in session'), {});
      res.redirect(`${returnTo}?error=no_management_token`);
      return;
    }

    try {
      // Exchange code for tokens — the id_token represents the social identity
      const tokenResponse = await this.socialVerificationService.exchangeCodeForToken(req, code);

      if (!tokenResponse.id_token) {
        logger.error(req, 'social_auth_callback', startTime, new Error('No id_token in social token response'), {});
        res.redirect(`${returnTo}?error=no_identity_token`);
        return;
      }

      // Decode id_token sub claim to log the social identity being linked
      let socialSub: string | undefined;
      try {
        const payloadB64 = tokenResponse.id_token.split('.')[1];
        if (payloadB64) {
          const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
          socialSub = decoded.sub;
          logger.info(req, 'social_auth_callback', 'Social identity being linked', {
            social_sub: socialSub,
            social_email: decoded.email,
          });
        }
      } catch {
        logger.debug(req, 'social_auth_callback', 'Could not decode id_token payload for audit logging');
      }

      // Link the social identity via NATS (reuses existing email verification linking)
      const linkResponse = await this.emailVerificationService.linkIdentity(req, mgmtToken, tokenResponse.id_token);

      if (!linkResponse.success) {
        const isAlreadyLinked = linkResponse.error?.includes('already') || linkResponse.message?.includes('already');
        logger.error(req, 'social_auth_callback', startTime, new Error('Identity link failed'), {
          error: linkResponse.error,
          message: linkResponse.message,
          social_sub: socialSub,
          is_already_linked: isAlreadyLinked,
        });
        const errorParam = isAlreadyLinked ? 'already_linked' : 'link_failed';
        res.redirect(`${returnTo}?error=${errorParam}`);
        return;
      }

      // Fire-and-forget CDP identity verification
      const currentUserSub = req.oidc?.user?.['sub'] as string;
      const subUsername = currentUserSub?.includes('|') ? currentUserSub.split('|')[1] : currentUserSub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      if (lfid) {
        this.cdpService
          .getIdentitiesForUser(req, lfid)
          .then((identities) => {
            // Find the newly linked social identity — look for unverified identities on this platform
            const unverifiedSocial = identities.filter((id) => !id.verified);
            for (const identity of unverifiedSocial) {
              this.cdpService.verifyIdentityForUser(req, lfid, identity.id).catch((err: unknown) => {
                logger.warning(req, 'social_auth_callback', 'CDP verify failed (non-blocking)', {
                  identity_id: identity.id,
                  error: err instanceof Error ? err.message : 'Unknown',
                });
              });
            }
          })
          .catch((err: unknown) => {
            logger.warning(req, 'social_auth_callback', 'CDP identity lookup failed (non-blocking)', {
              error: err instanceof Error ? err.message : 'Unknown',
            });
          });
      }

      logger.success(req, 'social_auth_callback', startTime, {
        has_id_token: true,
        link_success: true,
      });

      res.redirect(`${returnTo}?success=identity_linked`);
    } catch (err) {
      logger.error(req, 'social_auth_callback', startTime, err, {});
      res.redirect(`${returnTo}?error=social_verification_failed`);
    }
  }

  /**
   * POST /api/profile/identities/email/send-code - Send verification code to email
   */
  public async sendEmailVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'send_email_verification', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'send_email_verification',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const { email } = req.body as { email: string };

      if (!email || typeof email !== 'string') {
        const validationError = ServiceValidationError.forField('email', 'Valid email address is required', {
          operation: 'send_email_verification',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        const validationError = ServiceValidationError.forField('email', 'Invalid email format', {
          operation: 'send_email_verification',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const response = await this.emailVerificationService.sendVerificationCode(req, email);

      if (response.success) {
        logger.success(req, 'send_email_verification', startTime, { email });
        res.json({ success: true, message: response.message || 'Verification code sent' });
      } else {
        logger.debug(req, 'send_email_verification', 'Full verification response on failure', {
          response_keys: Object.keys(response),
          full_response: response,
        });

        if (response.error?.includes('already linked')) {
          // Fallback chain: response field → EMAIL_TO_USERNAME → EMAIL_TO_SUB
          const linkedTo =
            response.linkedTo ||
            (await this.emailVerificationService.resolveEmailToUsername(req, email)) ||
            (await this.emailVerificationService.resolveEmailToSub(req, email));

          const message = linkedTo
            ? `This email is already linked to account: ${linkedTo}`
            : response.message || 'This email is already linked to another account';

          res.status(409).json({ success: false, error: response.error, message, linkedTo });
        } else if (response.error === 'Service temporarily unavailable') {
          res.status(503).json({ success: false, error: response.error, message: response.message });
        } else {
          res.status(400).json({ success: false, error: response.error, message: response.message });
        }
      }
    } catch (error) {
      logger.error(req, 'send_email_verification', startTime, error);
      next(error);
    }
  }

  /**
   * POST /api/profile/identities/email/verify - Verify OTP and link email identity
   */
  public async verifyAndLinkEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'verify_and_link_email', {
      request_body_keys: Object.keys(req.body),
    });

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'verify_and_link_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const { email, otp } = req.body as { email: string; otp: string };

      if (!email || typeof email !== 'string') {
        const validationError = ServiceValidationError.forField('email', 'Valid email address is required', {
          operation: 'verify_and_link_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
        const validationError = ServiceValidationError.forField('otp', 'A valid 6-digit OTP code is required', {
          operation: 'verify_and_link_email',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Step 1: Get auth token (Flow C management token with M2M fallback)
      // Check BEFORE consuming the OTP so the code isn't wasted if the token is missing
      const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'] || '';
      const isAuthelia = issuerBaseUrl.includes('auth.k8s.orb.local');
      const isProfileAuthConfigured = this.profileAuthService.isProfileAuthConfigured();

      let authToken: string;

      if (!isAuthelia && isProfileAuthConfigured) {
        const mgmtToken = this.profileAuthService.getManagementToken(req);
        if (!mgmtToken) {
          // Store pending verification so it auto-completes after Flow C callback
          if (req.appSession) {
            req.appSession.pendingEmailVerification = { email, otp };
          }

          logger.warning(req, 'verify_and_link_email', 'Management token required, storing pending verification', {
            email,
          });

          res.status(403).json({
            success: false,
            error: 'management_token_required',
            message: 'Profile authorization required',
            authorize_url: '/api/profile/auth/start?returnTo=/profile/identities',
          });
          return;
        }
        authToken = mgmtToken;
      } else {
        const authServiceAudience = new URL('api/v2/', issuerBaseUrl).toString();
        authToken = await generateM2MToken(req, { audience: authServiceAudience });
      }

      // Step 2: Verify OTP via NATS
      const otpResponse = await this.emailVerificationService.verifyOtp(req, email, otp);

      if (!otpResponse.success || !otpResponse.data?.id_token) {
        const error = otpResponse.error || (otpResponse.success ? 'token_missing' : 'verification_failed');
        const message =
          otpResponse.message ||
          (otpResponse.success
            ? 'Verification succeeded but identity token was not returned. Please try again.'
            : 'Verification failed. Please try again or request a new code.');

        if (error.includes('invalid') || error.includes('otp')) {
          res.status(400).json({ success: false, error, message });
        } else if (error === 'Service temporarily unavailable') {
          res.status(503).json({ success: false, error, message });
        } else {
          res.status(400).json({ success: false, error, message });
        }
        return;
      }

      const identityToken = otpResponse.data.id_token;

      // Step 3: Link identity via NATS
      const linkResponse = await this.emailVerificationService.linkIdentity(req, authToken, identityToken);

      if (!linkResponse.success) {
        if (linkResponse.error?.includes('already linked')) {
          res.status(409).json({ success: false, error: linkResponse.error, message: linkResponse.message });
        } else if (linkResponse.error === 'Service temporarily unavailable') {
          res.status(503).json({ success: false, error: linkResponse.error, message: linkResponse.message });
        } else {
          res.status(400).json({ success: false, error: linkResponse.error, message: linkResponse.message });
        }
        return;
      }

      // Step 4: Fire-and-forget CDP identity verification
      const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
      const lfid = (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;

      // Find the newly linked email identity in CDP and verify it
      this.cdpService
        .getIdentitiesForUser(req, lfid)
        .then((identities) => {
          const emailIdentity = identities.find((id) => (id.platform === 'email' || id.platform === 'custom') && id.value === email);
          if (emailIdentity) {
            this.cdpService.verifyIdentityForUser(req, lfid, emailIdentity.id).catch((err: unknown) => {
              logger.warning(req, 'verify_and_link_email', 'CDP verify failed (non-blocking)', {
                error: err instanceof Error ? err.message : 'Unknown',
              });
            });
          }
        })
        .catch((err: unknown) => {
          logger.warning(req, 'verify_and_link_email', 'CDP identity lookup failed (non-blocking)', {
            error: err instanceof Error ? err.message : 'Unknown',
          });
        });

      logger.success(req, 'verify_and_link_email', startTime, { email });
      res.json({ success: true, message: 'Email identity verified and linked successfully' });
    } catch (error) {
      logger.error(req, 'verify_and_link_email', startTime, error);
      next(error);
    }
  }

  /**
   * Reconciles CDP identities with auth-service identities to determine display state
   * and trigger auto-verification where needed.
   *
   * Truth table:
   * 1. In auth-service AND CDP, verified=true & verifiedBy=lfid → VERIFIED (already reconciled)
   * 2. In auth-service AND CDP, verified=false OR verifiedBy≠lfid → VERIFIED (auto-verify via PATCH)
   * 3. In auth-service but NOT in CDP → VERIFIED (synthetic entry, TODO: POST to CDP)
   * 4. In CDP but NOT in auth-service, multi-LFID + verifiedBy=lfxOne → HIDDEN
   * 5. In CDP but NOT in auth-service (all other) → UNVERIFIED
   */
  private reconcileIdentities(
    req: Request,
    cdpIdentities: CdpIdentity[],
    authServiceIdentities: Auth0Identity[],
    lfid: string
  ): { enriched: EnrichedIdentity[]; notInCdpCount: number } {
    // Build a map of "platform:value" → Auth0Identity for matching
    const authServiceMap = new Map<string, Auth0Identity>();
    for (const authId of authServiceIdentities) {
      const cdpPlatform = AUTH0_TO_CDP_PROVIDER_MAP[authId.provider];
      const value = this.getAuth0IdentityValue(authId);
      if (cdpPlatform && value) {
        authServiceMap.set(`${cdpPlatform}:${value}`, authId);
      }
    }

    // Track which auth-service identities have been matched to a CDP identity
    const matchedAuthKeys = new Set<string>();

    // Check if there are multiple LFID identities (indicates merged CDP profiles)
    const lfidCount = cdpIdentities.filter((id) => id.platform === 'lfid').length;
    const hasMultiLfid = lfidCount > 1;

    // Process CDP identities
    const enriched: EnrichedIdentity[] = cdpIdentities.map((cdp): EnrichedIdentity => {
      const authKey = `${cdp.platform}:${cdp.value}`;
      const authIdentity = authServiceMap.get(authKey);
      const inAuthService = !!authIdentity;

      if (inAuthService) {
        matchedAuthKeys.add(authKey);
      }

      // Rule: The logged-in user's own LFID is always verified
      if (cdp.platform === 'lfid' && cdp.value === lfid) {
        // Auto-verify LFID in CDP if not already verified with their LFID
        if (!(cdp.verified && cdp.verifiedBy === lfid)) {
          this.cdpService.verifyIdentityForUser(req, lfid, cdp.id, lfid).catch((err: unknown) => {
            logger.warning(req, 'reconcile_identities', 'Auto-verify LFID failed (non-blocking)', {
              identity_id: cdp.id,
              error: err instanceof Error ? err.message : 'Unknown',
            });
          });
        }
        return { ...cdp, displayState: 'verified', inAuth0: true };
      }

      if (inAuthService) {
        // In both auth-service and CDP — auto-verify if needed
        if (!(cdp.verified && cdp.verifiedBy === lfid)) {
          this.cdpService.verifyIdentityForUser(req, lfid, cdp.id, lfid).catch((err: unknown) => {
            logger.warning(req, 'reconcile_identities', 'Auto-verify failed (non-blocking)', {
              identity_id: cdp.id,
              platform: cdp.platform,
              error: err instanceof Error ? err.message : 'Unknown',
            });
          });
        }
        return {
          ...cdp,
          displayState: 'verified',
          inAuth0: true,
          ...(authIdentity ? { auth0UserId: authIdentity.user_id } : {}),
        };
      }

      // In CDP but NOT in auth-service
      const isCdpVerifiedWithOwner = cdp.verified && !!cdp.verifiedBy;
      let displayState: IdentityDisplayState;

      if (isCdpVerifiedWithOwner && hasMultiLfid) {
        // Multi-LFID merged profile — hide identities verified by another LFID
        displayState = 'hidden';
      } else {
        displayState = 'unverified';
      }

      return { ...cdp, displayState, inAuth0: false };
    });

    // Process auth-service identities NOT in CDP — create synthetic entries
    let notInCdpCount = 0;
    for (const [, authId] of authServiceMap) {
      const cdpPlatform = AUTH0_TO_CDP_PROVIDER_MAP[authId.provider];
      const value = this.getAuth0IdentityValue(authId);
      if (!cdpPlatform || !value) {
        continue;
      }

      const authKey = `${cdpPlatform}:${value}`;
      if (matchedAuthKeys.has(authKey)) {
        continue;
      }

      // Skip non-display platforms (e.g., lfid, google)
      if (!IDENTITY_DISPLAY_PLATFORMS.includes(cdpPlatform)) {
        continue;
      }

      notInCdpCount++;

      // Fire-and-forget: persist auth-service identity to CDP
      const cdpPostPlatform = cdpPlatform === 'email' ? 'custom' : cdpPlatform;
      this.cdpService
        .createIdentityForUser(req, [lfid], {
          value,
          platform: cdpPostPlatform,
          source: 'lfxOne',
          verified: true,
          verifiedBy: lfid,
        })
        .catch((err: unknown) => {
          logger.warning(req, 'reconcile_identities', 'CDP identity create failed (non-blocking)', {
            platform: cdpPlatform,
            value,
            error: err instanceof Error ? err.message : 'Unknown',
          });
        });

      // Create synthetic EnrichedIdentity for display
      enriched.push({
        id: `auth0:${authId.user_id}`,
        platform: cdpPlatform,
        value,
        verified: true,
        verifiedBy: lfid,
        source: 'lfxOne',
        icon: CDP_PLATFORM_ICONS[cdpPlatform] || 'fa-light fa-globe',
        createdAt: '',
        updatedAt: '',
        displayState: 'verified',
        inAuth0: true,
        auth0UserId: authId.user_id,
      });
    }

    return { enriched, notInCdpCount };
  }

  /**
   * Extract the matching value from an Auth0 identity's profileData
   * Used for value-level cross-referencing with CDP identities
   */
  private getAuth0IdentityValue(auth0Id: Auth0Identity): string | null {
    const pd = auth0Id.profileData;
    if (!pd) {
      return null;
    }
    switch (auth0Id.provider) {
      case 'email':
        return pd.email ?? null;
      case 'github':
        return pd.nickname ?? null;
      case 'linkedin':
        return pd.nickname ?? null;
      default:
        return null;
    }
  }
}
