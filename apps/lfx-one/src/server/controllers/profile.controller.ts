// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ALLOWED_AVATAR_MIME_TYPES,
  AUTH0_TO_CDP_PROVIDER_MAP,
  CDP_DISPLAYABLE_IDENTITY_COMBOS,
  CDP_PLATFORM_ICONS,
  CDP_PLATFORM_TO_TYPE_MAP,
  CDP_TO_AUTH0_PROVIDER_MAP,
  EMAIL_ALREADY_CONNECTED_MESSAGE,
  EMAIL_ALREADY_CONNECTED_STATUS,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_CALLBACK_RETRY_REQUIRED_STATUS,
  EMAIL_CALLBACK_STATUS_PARAM,
  EMAIL_REGEX,
  EMAIL_VERIFICATION_FAILED_ERROR,
  EMAIL_VERIFICATION_FAILED_MESSAGE,
  EMAIL_VERIFICATION_MIN_RESPONSE_MS,
  EMAIL_VERIFICATION_SENT_MESSAGE,
  ERROR_CODES,
  IDENTITY_ALREADY_CONNECTED_STATUS,
  PROFILE_EMAIL_PATH,
  PROFILE_EMAILS_PATH,
  PROFILE_PASSWORD_PATH,
  PROFILE_SETTINGS_PATH,
  PROFILE_VISIBILITY_KEYS,
  PURCHASE_LINUX_URL,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import {
  Auth0Identity,
  CdpIdentity,
  CdpIdentityType,
  CdpWorkExperienceRequest,
  ClaimAliasRequest,
  ClaimAliasResponse,
  CombinedProfile,
  DeveloperTokenInfo,
  EmailManagementData,
  EmailVerificationCallbackStatus,
  EnrichedIdentity,
  IdentitiesPrimaryEmail,
  IdentityDisplayState,
  LinuxAliasData,
  ProfileAuthStatus,
  ProfilePictureUploadResponse,
  ProfileUpdateRequest,
  ProfileVisibilityUpdateRequest,
  SetMeetingInviteResult,
  UpdateForwardRequest,
  UserEmail,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserMetadataUpdateResponse,
  UserProfile,
  VerifyAndLinkEmailResponse,
  VerifyEmailOtpNatsResponse,
  WorkExperienceCreateUpdateBody,
} from '@lfx-one/shared/interfaces';
import { emailsEqual, isIdentityAlreadyLinkedError, isMeetingInvitePrimarySentinel } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getLinuxForwardDomain } from '../helpers/linux-forward.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { authStateService } from '../services/auth-state.service';
import { Auth0Service } from '../services/auth0.service';
import { CdpService } from '../services/cdp.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { EnrollmentService } from '../services/enrollment.service';
import { ForwardsService } from '../services/forwards.service';
import { logger } from '../services/logger.service';
import { MeetingPreferenceService } from '../services/meeting-preference.service';
import { ObjectStoreService } from '../services/object-store.service';
import { ProfileAuthService } from '../services/profile-auth.service';
import { SocialVerificationService } from '../services/social-verification.service';
import { UserService } from '../services/user.service';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, getUsernameFromAuth, isImpersonating } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';
import { withMeetingInviteLock } from '../utils/meeting-invite-lock';
import { populateApiGatewayToken } from '../utils/refresh-token-exchange.util';

// Maps auth-service error strings to user-facing responses. First match wins; if
// none match, the password-change path falls back to a generic 502.
const PASSWORD_ERROR_RULES: readonly {
  pattern: RegExp;
  status: number;
  code: string;
  message: string;
  useUpstreamMessage?: boolean;
}[] = [
  {
    pattern: /wrong password|invalid password|incorrect password/,
    status: 400,
    code: 'INVALID_CURRENT_PASSWORD',
    message: 'Your current password is incorrect.',
  },
  {
    pattern: /password is too weak|password policy|does not meet/,
    status: 400,
    code: 'PASSWORD_POLICY_VIOLATION',
    message: 'Your new password does not meet the password policy requirements.',
    useUpstreamMessage: true,
  },
  {
    pattern: /\btoo many (attempts|requests)\b|\brate.?limit\b|\baccount (is )?blocked\b/,
    status: 429,
    code: 'TOO_MANY_ATTEMPTS',
    message: 'Too many password change attempts. Please wait a few minutes and try again.',
  },
];

/**
 * Controller for handling profile HTTP requests
 */
export class ProfileController {
  /** Single source of truth for normalizeProfileReturnTo's fallback, so other call sites needing the same default (e.g. the impersonation guard) don't hardcode a second copy of '/profile'. */
  private static readonly profileDefaultReturnTo = '/profile';

  private static readonly allowedProfileReturnPaths: ReadonlySet<string> = new Set([
    ProfileController.profileDefaultReturnTo,
    PROFILE_EMAIL_PATH,
    PROFILE_EMAILS_PATH,
    '/profile/identities',
    PROFILE_PASSWORD_PATH,
    '/profile/linux-email',
    PROFILE_SETTINGS_PATH,
    // Not a profile page, but it embeds the same Add-identity dialog, so a mentor who links an
    // account mid-registration has to come back to the form instead of the Identities tab.
    '/mentorship/mentor',
  ]);

  private auth0Service: Auth0Service = new Auth0Service();
  private cdpService: CdpService = new CdpService();
  private emailVerificationService: EmailVerificationService = new EmailVerificationService();
  private enrollmentService: EnrollmentService = new EnrollmentService();
  private forwardsService: ForwardsService = new ForwardsService();
  private meetingPreferenceService: MeetingPreferenceService = new MeetingPreferenceService();
  private objectStoreService: ObjectStoreService = new ObjectStoreService();
  private profileAuthService: ProfileAuthService = new ProfileAuthService();
  private socialVerificationService: SocialVerificationService = new SocialVerificationService();
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

      // The primary-email and metadata reads are independent; overlap their NATS round trips.
      const primaryEmailPromise = this.resolveIdentitiesPrimaryEmail(req, getEffectiveUsername(req));

      // Get user metadata from NATS (authoritative source). created_at rides top-level on the
      // envelope (not inside UserMetadata) — see #2836. `username` was resolved above via
      // getUsernameFromAuth, which routes through the impersonation-aware getEffectiveUsername
      // except on its pre-existing Authelia-bearer-token shortcut (see parent issue #2835).
      let natsUserData: UserMetadata | null = null;
      let natsCreatedAt = '';
      try {
        const natsResponse = await this.userService.getUserInfo(req, username);

        if (natsResponse.success) {
          // created_at lives on the envelope independent of `data` — a user with no stored
          // metadata still gets a real join date and must not have it dropped by this guard.
          natsCreatedAt = natsResponse.created_at || '';
        }

        if (natsResponse.success && natsResponse.data) {
          natsUserData = natsResponse.data;
        } else if (!natsResponse.success) {
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

      // Construct UserProfile from token data. During impersonation, req.oidc.user is still the
      // impersonator, so identity/name fields must come from the effective (target) identity and
      // NATS metadata — never fall back to the impersonator's OIDC claims.
      const impersonating = isImpersonating(req);
      // Match Identities even when the login session still contains the previous primary address.
      const primaryEmail = await primaryEmailPromise;
      const userProfile: UserProfile = impersonating
        ? {
            // Never fall back to the impersonator's OIDC claims here — the effective helpers resolve
            // the target's identity from the impersonation session.
            id: (getEffectiveSub(req) || '') as string,
            email: primaryEmail?.email || '',
            first_name: (natsUserData?.given_name || null) as string | null,
            last_name: (natsUserData?.family_name || null) as string | null,
            username: (getEffectiveUsername(req) || username) as string,
            // NATS-sourced join date for the resolved username (target user except on the
            // Authelia shortcut noted above) — never fabricated.
            created_at: natsCreatedAt,
            updated_at: '',
          }
        : {
            id: oidcUser['sub'] as string,
            email: primaryEmail?.email || '',
            first_name: (natsUserData?.given_name || oidcUser['given_name'] || oidcUser['first_name'] || null) as string | null,
            last_name: (natsUserData?.family_name || oidcUser['family_name'] || oidcUser['last_name'] || null) as string | null,
            // The resolved LFID above — not the OIDC username/preferred_username display claims.
            username: username as string,
            // created_at: use the real NATS-sourced join date. Never fabricate a timestamp (e.g.
            // new Date()) — an unavailable date must surface as '' so the UI can hide the field,
            // not a moving value. (updated_at below is unrelated and out of scope for this rule.)
            created_at: natsCreatedAt,
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

      // Per-user profile data must never be served from a cache — otherwise the client
      // refetch right after a profile save can return the pre-save body from the browser
      // HTTP cache, leaving the header card / edit dialog showing stale values until a full reload.
      res.set({
        ['Cache-Control']: 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
        Expires: '0',
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

      // organization_domain is server-owned: strip any client-supplied value so it can only be set
      // by the CDP resolution below (and never bypass it when organization is absent or the lookup
      // fails). Resolved after the token gate so the Flow C 403 challenge doesn't trigger a CDP
      // lookup that would be discarded and re-run on the client's retry.
      delete user_metadata.organization_domain;

      // Resolve the organization's canonical CDP domain server-side so every save path — the
      // direct save and the Flow C management-token retry — persists organization_domain
      // consistently. Found → its domain; found-without-domain or no match → '' (which overwrites
      // and thereby clears a stale value); a transient CDP lookup error leaves the field unset so
      // we never clobber a previously-stored valid domain. The frontend no longer sends this field.
      if (user_metadata.organization) {
        const organizationName = user_metadata.organization.trim();
        if (organizationName) {
          try {
            const organization = await this.cdpService.findOrganizationByName(req, organizationName);
            user_metadata.organization_domain = organization?.domain || '';
          } catch (error) {
            logger.warning(req, 'resolve_organization_domain', 'CDP domain lookup failed; leaving organization_domain unchanged', {
              organization: organizationName,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
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
        return next(this.mapUserMetadataUpdateError(response, username, 'update_user_metadata_nats', req.path));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/picture-upload - Upload a profile picture to the object store and persist
   * its URL to user_metadata.picture via the existing NATS update path.
   */
  public async uploadProfilePicture(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'upload_profile_picture', {
      content_type: req.headers['content-type'],
      content_length: req.headers['content-length'],
    });

    try {
      const username = await getUsernameFromAuth(req);
      if (!username) {
        return next(
          ServiceValidationError.forField('user_id', 'User authentication required', {
            operation: 'upload_profile_picture',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const rawContentType = req.headers['content-type'];
      const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || '').split(';')[0].trim();
      if (!(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(contentType)) {
        return next(
          ServiceValidationError.forField('content-type', `Unsupported image type: ${contentType || 'unknown'}`, {
            operation: 'upload_profile_picture',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const rawBody: unknown = req.body;
      if (Array.isArray(rawBody) || typeof rawBody === 'string' || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        return next(
          ServiceValidationError.forField('body', 'Request body must contain image data', {
            operation: 'upload_profile_picture',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }
      const buffer = rawBody;

      // Determine which token to use for the auth-service — same selection as updateUserMetadata.
      const issuerBaseUrl = process.env['M2M_AUTH_ISSUER_BASE_URL'] || '';
      const isAuthelia = issuerBaseUrl.includes('auth.k8s.orb.local');
      const isProfileAuthConfigured = this.profileAuthService.isProfileAuthConfigured();

      let token: string;

      if (!isAuthelia && isProfileAuthConfigured) {
        const mgmtToken = this.profileAuthService.getManagementToken(req);
        if (!mgmtToken) {
          logger.warning(req, 'upload_profile_picture', 'Management token required but not present in session', { username });

          res.status(403).json({
            error: 'management_token_required',
            message: 'Profile authorization required',
            authorize_url: '/api/profile/auth/start?returnTo=/profile',
          });
          return;
        }
        token = mgmtToken;
      } else {
        if (!issuerBaseUrl) {
          return next(
            new MicroserviceError('M2M_AUTH_ISSUER_BASE_URL is not configured; cannot generate an auth-service token', 500, 'M2M_ISSUER_NOT_CONFIGURED', {
              operation: 'upload_profile_picture',
              service: 'profile_controller',
              path: req.path,
            })
          );
        }
        const authServiceAudience = new URL('api/v2/', issuerBaseUrl).toString();
        token = await generateM2MToken(req, { audience: authServiceAudience });
      }

      const { url } = await this.objectStoreService.uploadProfilePicture(req, username, buffer, contentType);

      // CDN_URL_PREFIX unconfigured means there is no absolute URL to persist into
      // user_metadata.picture (which requires a parseable URL) — surface this as a config
      // error rather than silently accepting the upload without updating the visible picture.
      if (!url) {
        return next(
          new MicroserviceError('CDN_URL_PREFIX is not configured; cannot generate a public profile picture URL', 500, 'CDN_NOT_CONFIGURED', {
            operation: 'upload_profile_picture',
            service: 'object-store',
            path: req.path,
          })
        );
      }

      const updateRequest: UserMetadataUpdateRequest = {
        token,
        username,
        user_metadata: { picture: url },
      };

      const response = await this.userService.updateUserMetadata(req, updateRequest);

      if (response.success) {
        logger.success(req, 'upload_profile_picture', startTime, { username, public_url: url });

        const body: ProfilePictureUploadResponse = { success: true, public_url: url };
        res.status(201).json(body);
      } else {
        return next(this.mapUserMetadataUpdateError(response, username, 'upload_profile_picture', req.path));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/emails - Get current user's email management data from auth-service via NATS
   */
  public async getUserEmails(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_user_emails');

    try {
      // Effective identity — during impersonation these resolve to the target user; auth-service
      // resolves emails/identities from the raw sub string, so the target's emails are returned.
      const userSub = getEffectiveSub(req) ?? undefined;
      const sessionEmail = getEffectiveEmail(req) ?? undefined;

      if (!userSub) {
        return next(
          ServiceValidationError.forField('user_id', 'User authentication required', {
            operation: 'get_user_emails',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const [freshEmails, identities] = await Promise.all([
        this.emailVerificationService.getUserEmails(req, userSub),
        this.emailVerificationService.listIdentitiesSafe(req, userSub),
      ]);

      // sessionEmail is the target's email or undefined under impersonation (never the
      // impersonator's), so a target with no primary correctly 400s instead of leaking it.
      const primaryEmail = freshEmails?.primary_email || sessionEmail;

      if (!primaryEmail) {
        return next(
          ServiceValidationError.forField('primary_email', 'Unable to resolve primary email for user', {
            operation: 'get_user_emails',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const alternateEmails: UserEmail[] = freshEmails?.alternate_emails
        ? freshEmails.alternate_emails.map((ae) => ({
            email: ae.email,
            verified: ae.verified,
            user_id:
              ae.user_id ??
              identities.find((id) => id.provider === 'email' && id.profileData?.email?.toLowerCase().trim() === ae.email.toLowerCase().trim())?.user_id,
          }))
        : identities
            .filter((id) => id.provider === 'email' && !!id.profileData?.email && id.profileData.email !== primaryEmail)
            .map((id) => ({
              email: id.profileData!.email as string,
              verified: id.profileData?.['email_verified'] === true,
              user_id: id.user_id,
            }));

      const emailData: EmailManagementData = {
        primary_email: primaryEmail,
        alternate_emails: alternateEmails,
      };

      logger.success(req, 'get_user_emails', startTime, {
        alternate_email_count: alternateEmails.length,
      });

      res.json(emailData);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/profile/emails/:email/primary - Set email as primary via auth-service NATS
   * The :email param is the URL-encoded email address to make primary. With no meeting-invite
   * override, the current primary is pinned as the invite email first; failing that, nothing changes.
   */
  public async setPrimaryEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const emailAddress = req.params['emailId'] ?? '';
    // `email` is PII outside the Pino redact paths — never log the address itself.
    const startTime = logger.startOperation(req, 'set_primary_email');

    try {
      if (!emailAddress) {
        return next(
          ServiceValidationError.forField('email', 'Email address is required', {
            operation: 'set_primary_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      if (!EMAIL_REGEX.test(emailAddress)) {
        return next(
          ServiceValidationError.forField('email', 'Invalid email format', {
            operation: 'set_primary_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const authToken = this.profileAuthService.getManagementToken(req);

      if (!authToken) {
        if (!this.profileAuthService.isProfileAuthConfigured()) {
          res.status(501).json({
            error: 'profile_auth_not_configured',
            message: 'Changing the primary email is not available in this environment.',
          });
          return;
        }
        res.status(403).json({
          error: 'management_token_required',
          message: 'Profile authorization required to change the primary email',
          // Static legacy path (not `referer`, which is the settings page itself and carries no
          // fragment) — profile.routes.ts's redirectTo re-attaches #email-settings on return.
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent(PROFILE_EMAILS_PATH)}`,
        });
        return;
      }

      const username = await getUsernameFromAuth(req);

      if (!username) {
        return next(
          ServiceValidationError.forField('user_id', 'User authentication required', {
            operation: 'set_primary_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const v1Token = req.apiGatewayToken;

      if (!v1Token) {
        return next(this.inviteEmailPinFailedError('unavailable'));
      }

      // Invites stick to an address, not the primary role: pin the current primary as the invite
      // email before switching, under the lock that guards every other invite-email write (#3983).
      const outcome = await withMeetingInviteLock(req, username, VALKEY_CACHE.MEETING_INVITE_LOCK_TTL_MS, async () => {
        const pin = await this.pinMeetingInviteToCurrentPrimary(req, v1Token, emailAddress);
        if (pin.blockedReason) {
          return { blockedReason: pin.blockedReason };
        }
        // A pin that lands before a failed switch is harmless: invites stay on the unchanged primary.
        return { pinnedInvite: pin.pinned, result: await this.emailVerificationService.setPrimaryEmail(req, authToken, emailAddress) };
      });

      if ('blockedReason' in outcome) {
        return next(this.inviteEmailPinFailedError(outcome.blockedReason));
      }

      if (!outcome.result.success) {
        return next(
          new MicroserviceError(outcome.result.message || 'Failed to set primary email', 502, 'BAD_GATEWAY', {
            operation: 'set_primary_email',
            service: 'profile_controller',
          })
        );
      }

      logger.success(req, 'set_primary_email', startTime, { pinned_invite: outcome.pinnedInvite });

      res.status(200).json({ message: 'Primary email updated successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/emails/meeting-invite - Resolve the user's preferred meeting-invitation
   * email from the meeting-service. Null fields mean the user has no override (invitations fall
   * back to the primary email). Requires the user's v1 API-gateway token, which the
   * meeting-service forwards to v1 /v1/me.
   */
  public async getMeetingInviteEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_meeting_invite_email');

    try {
      const v1Token = req.apiGatewayToken;

      if (!v1Token) {
        // Also absent after a transient audience-token exchange failure (auth middleware continues
        // without it), so the copy stays neutral; next() lets apiErrorHandler close the operation.
        return next(
          new MicroserviceError(
            'Meeting invitation email settings are temporarily unavailable. Please refresh the page and try again.',
            503,
            'SERVICE_UNAVAILABLE',
            {
              operation: 'get_meeting_invite_email',
              service: 'profile_controller',
            }
          )
        );
      }

      const preference = await this.meetingPreferenceService.getMeetingInviteEmail(req, v1Token);

      if (!preference) {
        // The service returns null only on failure (NATS error reply, transport, or decode
        // failure) — a confirmed no-override comes back as `{ email_id: null, email: null }`.
        // Normalizing a failure to that same shape would look identical to the client, so its
        // delete/remove fail-closed guard would never trip during a real outage.
        return next(
          new MicroserviceError(
            'Meeting invitation email settings are temporarily unavailable. Please refresh the page and try again.',
            503,
            'SERVICE_UNAVAILABLE',
            {
              operation: 'get_meeting_invite_email',
              service: 'profile_controller',
            }
          )
        );
      }

      logger.success(req, 'get_meeting_invite_email', startTime, { has_override: Boolean(preference.email) });

      res.json(preference);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/profile/emails/meeting-invite - Set the user's preferred meeting-invitation email.
   * Body: { email }. Requires the user's v1 API-gateway token.
   */
  public async setMeetingInviteEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    // `req.body.email` is unvalidated client JSON — a non-string (e.g. `{}`) would reach the
    // string helpers below and throw outside the try block, turning bad input into a 500.
    // Coercing to '' instead routes it through the field-validation error further down.
    const rawEmail: unknown = req.body?.email;
    const emailAddress = typeof rawEmail === 'string' ? rawEmail : '';
    // The sentinel clears the override. The UI no longer sends it (#3983) — it pins literal addresses.
    const isReset = isMeetingInvitePrimarySentinel(emailAddress);
    // `email` is PII and `data.email` is not covered by the Pino redact paths — record the shape
    // of the request rather than the address itself.
    const startTime = logger.startOperation(req, 'set_meeting_invite_email', { is_reset: isReset });

    try {
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        return next(
          ServiceValidationError.forField('user_id', 'User authentication required', {
            operation: 'set_meeting_invite_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      if (!emailAddress) {
        return next(
          ServiceValidationError.forField('email', 'Email address is required', {
            operation: 'set_meeting_invite_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      if (!isReset && !EMAIL_REGEX.test(emailAddress)) {
        return next(
          ServiceValidationError.forField('email', 'Invalid email format', {
            operation: 'set_meeting_invite_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const v1Token = req.apiGatewayToken;

      if (!v1Token) {
        // Also absent after a transient audience-token exchange failure (auth middleware continues
        // without it), so the copy stays neutral; next() lets apiErrorHandler close the operation.
        return next(
          new MicroserviceError(
            'Meeting invitation email settings are temporarily unavailable. Please refresh the page and try again.',
            503,
            // Written for the organizer, and the write path surfaces it: `extractErrorMessage` reads a
            // 5xx body only under this code. The two GET-path 503s above keep SERVICE_UNAVAILABLE —
            // that response is swallowed by an `inviteLoadFailed` catch, so their copy reaches nobody.
            ERROR_CODES.SERVICE_ADVISORY,
            {
              operation: 'set_meeting_invite_email',
              service: 'profile_controller',
            }
          )
        );
      }

      // Serializes against a concurrent `rejectIdentity` guard for the same user (LFXV2 #2241) —
      // see `withMeetingInviteLock` and the comment on `rejectIdentity`'s meeting-invite guard. Uses the
      // shorter set-specific TTL since this locked region is a single bounded NATS call, unlike
      // `rejectIdentity`'s longer multi-call chain.
      const result = await withMeetingInviteLock(req, sub, VALKEY_CACHE.MEETING_INVITE_SET_LOCK_TTL_MS, () =>
        this.meetingPreferenceService.setMeetingInviteEmail(req, v1Token, emailAddress)
      );

      if (!result.success) {
        const errorOptions = { operation: 'set_meeting_invite_email', service: 'profile_controller', path: req.path };

        // Not an active, verified record — retrying won't help. Build ServiceValidationError directly
        // so its top-level `message` (what the frontend reads) keeps the text; `forField` would replace it.
        if (result.reason === 'validation') {
          const validationMessage = 'This email is not an active, verified address on your account yet. Choose a different email, or verify it and try again.';
          return next(
            new ServiceValidationError([{ field: 'email', message: validationMessage, code: 'FIELD_VALIDATION_ERROR' }], validationMessage, errorOptions)
          );
        }

        // SFDC sync from auth0 hasn't landed yet — the address is valid but not usable right now.
        if (result.reason === 'sync_pending') {
          return next(
            new MicroserviceError(
              'This email was added recently and is not ready to use yet. Please try again in a few minutes.',
              503,
              ERROR_CODES.SERVICE_ADVISORY,
              {
                operation: 'set_meeting_invite_email',
                service: 'profile_controller',
              }
            )
          );
        }

        // The meeting service itself was unreachable (timeout/503) — transport failure, retryable.
        if (result.reason === 'unavailable') {
          return next(
            new MicroserviceError('The meeting service is temporarily unavailable. Please try again in a few minutes.', 503, ERROR_CODES.SERVICE_ADVISORY, {
              operation: 'set_meeting_invite_email',
              service: 'profile_controller',
            })
          );
        }

        return next(
          new MicroserviceError('Failed to update meeting invitation email. Please try again.', 502, 'BAD_GATEWAY', {
            operation: 'set_meeting_invite_email',
            service: 'profile_controller',
          })
        );
      }

      // success() emits at INFO in production for writes; omit the raw email to avoid persisting PII.
      logger.success(req, 'set_meeting_invite_email', startTime);

      res.status(200).json(result.data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/linux-email - Resolve the user's Linux.com alias state.
   *
   * Composes three signals into one of four states: the claimed alias (from
   * auth-service `user_emails.read`), the forwarding target (from
   * forwards-service `get_forward`), and the add-on purchase (from
   * member-service). Alias presence wins — a claimed alias short-circuits the
   * purchase lookup.
   */
  public async getLinuxAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_linux_alias');

    try {
      const domain = getLinuxForwardDomain('get_linux_alias', 'profile_controller');
      // Effective sub — the target user's alias state during impersonation (read-only).
      const userSub = getEffectiveSub(req) ?? undefined;
      if (!userSub) {
        return next(
          ServiceValidationError.forField('user_id', 'User authentication required', {
            operation: 'get_linux_alias',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const emails = await this.emailVerificationService.getUserEmails(req, userSub);
      if (emails === null) {
        logger.success(req, 'get_linux_alias', startTime, { state: 'service_unavailable' });
        res.json(this.linuxAliasState('service_unavailable', domain));
        return;
      }

      // Match GET /api/profile/emails: fall back to the effective session email when auth-service
      // omits a primary (null under impersonation — never the impersonator's, so stays null here).
      const sessionEmail = getEffectiveEmail(req) ?? undefined;
      const primaryEmail = emails.primary_email || sessionEmail || null;

      const suffix = `@${domain}`;
      // Scan alternate emails first; also cover the edge case where the claimed alias is the
      // user's primary email, which would otherwise be missed and read as unclaimed.
      const aliasEmail =
        emails.alternate_emails.find((e) => e.email.toLowerCase().trim().endsWith(suffix)) ??
        (emails.primary_email?.toLowerCase().trim().endsWith(suffix) ? { email: emails.primary_email } : undefined);

      if (aliasEmail) {
        const email = aliasEmail.email.toLowerCase().trim();
        const alias = email.slice(0, -suffix.length);
        // forwards-service requires a Management-API-audience JWT (Flow C token), same as add_alias.
        // Read the current target best-effort: without a management token in session we still report
        // the claimed state from user_emails.read; forwardTo stays null until the user re-authorizes.
        // During impersonation the only management token available belongs to the impersonator, not
        // the target — never use it here; report the claimed state read-only with a null forward.
        const managementToken = isImpersonating(req) ? null : this.profileAuthService.getManagementToken(req);
        const forward = managementToken ? await this.forwardsService.getForward(req, managementToken, domain) : null;

        // Null with a token means forwards-service was unreachable — degrade to service_unavailable
        // instead of emitting a claimed state with a null forward the client could overwrite on Save.
        if (managementToken && forward === null) {
          logger.success(req, 'get_linux_alias', startTime, { state: 'service_unavailable' });
          res.json(this.linuxAliasState('service_unavailable', domain));
          return;
        }

        // The forward is unreadable without a Flow C management token — true regardless of whether
        // Flow C is even configured, so the client can't mistake "unreadable" for "unset". Suppressed
        // under impersonation — the re-auth would rewrite the impersonator's own session.
        const forwardAuthRequired = !isImpersonating(req) && !managementToken;
        // Re-authorization is only offered when Flow C is actually configured; otherwise there's no
        // authorizeUrl to send the client to and it falls back to the "try again later" copy.
        const canReauth = forwardAuthRequired && this.profileAuthService.isProfileAuthConfigured();

        logger.success(req, 'get_linux_alias', startTime, { state: 'claimed' });
        res.json({
          state: 'claimed',
          domain,
          alias,
          email,
          forwardTo: forward?.target_email ?? null,
          primaryEmail,
          ...(forwardAuthRequired
            ? {
                forwardAuthRequired: true,
                ...(canReauth
                  ? { authorizeUrl: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/linux-email')}` }
                  : {}),
              }
            : {}),
        } satisfies LinuxAliasData);
        return;
      }

      // Degrade to service_unavailable if the purchase lookup fails, so the tab keeps its
      // 4-state contract (renders the retry panel) instead of erroring out via next(error).
      let purchased: boolean;
      try {
        purchased = await this.enrollmentService.hasLinuxComAddon(req);
      } catch {
        logger.success(req, 'get_linux_alias', startTime, { state: 'service_unavailable' });
        res.json(this.linuxAliasState('service_unavailable', domain));
        return;
      }
      const state = purchased ? 'purchased_unclaimed' : 'not_purchased';

      logger.success(req, 'get_linux_alias', startTime, { state });
      res.json(this.linuxAliasState(state, domain, primaryEmail));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/linux-email/claim - Claim an alias and set its forward.
   *
   * Two-step, non-atomic by design (mirrors the legacy flow): `add_alias`
   * (auth-service, Flow C token) then `set_target` (forwards-service). If the
   * forward step fails after a successful claim, we surface a 502 — the next GET
   * returns `claimed` with no forward, and the user completes it via the edit
   * path.
   */
  public async claimLinuxAlias(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'claim_linux_alias');

    try {
      const domain = getLinuxForwardDomain('claim_linux_alias', 'profile_controller');
      const body = (req.body ?? {}) as Partial<ClaimAliasRequest>;
      const alias = typeof body.alias === 'string' ? body.alias.trim().toLowerCase() : '';
      const forwardTo = typeof body.forwardTo === 'string' ? body.forwardTo.trim() : '';

      if (!alias) {
        return next(ServiceValidationError.forField('alias', 'Alias is required', { operation: 'claim_linux_alias', service: 'profile_controller' }));
      }
      if (!EMAIL_REGEX.test(forwardTo)) {
        return next(
          ServiceValidationError.forField('forwardTo', 'A valid forwarding email address is required', {
            operation: 'claim_linux_alias',
            service: 'profile_controller',
          })
        );
      }

      // Enforce the purchase gate server-side: a direct call must not bypass the
      // add-on requirement the UI gates on (mirrors the not_purchased state in getLinuxAlias).
      const purchased = await this.enrollmentService.hasLinuxComAddon(req);
      if (!purchased) {
        res.status(403).json({ error: 'addon_required', message: 'A Linux.com email add-on is required to claim an alias.' });
        return;
      }

      // Availability pre-check (best-effort; add_alias is authoritative).
      const availability = await this.forwardsService.checkAlias(req, alias, domain);
      if (availability?.exists) {
        res.status(409).json({ error: 'alias_not_available', message: 'That alias is already taken. Please choose another.' });
        return;
      }

      const managementToken = this.profileAuthService.getManagementToken(req);
      if (!managementToken) {
        if (!this.profileAuthService.isProfileAuthConfigured()) {
          res.status(501).json({ error: 'profile_auth_not_configured', message: 'Claiming a Linux.com alias is not available in this environment.' });
          return;
        }
        res.status(403).json({
          error: 'management_token_required',
          message: 'Profile authorization required to claim a Linux.com alias',
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/linux-email')}`,
        });
        return;
      }

      // Enforce the verified-address-only rule server-side before claiming, so a direct call can't
      // point the new alias at an address the account doesn't own.
      const verified = await this.validateLinuxForwardTarget(req, forwardTo, domain, 'claim_linux_alias');
      if ('error' in verified) {
        return next(verified.error);
      }

      const claim = await this.emailVerificationService.addAlias(req, managementToken, alias, domain);
      if (!claim.success) {
        const { status, message } = this.mapAddAliasError(claim.error);
        res.status(status).json({ error: claim.error ?? 'add_alias_failed', message });
        return;
      }

      const email = claim.email ?? `${alias}@${domain}`;

      // forwards-service requires the same Management-API-audience token as add_alias.
      const forward = await this.forwardsService.setTarget(req, managementToken, verified.target, domain);
      if (!forward || forward.error) {
        // Alias is claimed but forwarding could not be set — recoverable via the edit path.
        return next(
          new MicroserviceError('Alias claimed, but forwarding could not be set. Please set your forwarding address again.', 502, 'FORWARD_SET_FAILED', {
            operation: 'claim_linux_alias',
            service: 'profile_controller',
          })
        );
      }

      logger.success(req, 'claim_linux_alias', startTime, { domain });
      res.status(200).json({ state: 'claimed', domain, alias, email, forwardTo: forward.target_email ?? verified.target } satisfies ClaimAliasResponse);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/profile/linux-email/forward - Update the forwarding target for an
   * already-claimed alias (idempotent set_target).
   */
  public async updateLinuxForward(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_linux_forward');

    try {
      const domain = getLinuxForwardDomain('update_linux_forward', 'profile_controller');
      const body = (req.body ?? {}) as Partial<UpdateForwardRequest>;
      const forwardTo = typeof body.forwardTo === 'string' ? body.forwardTo.trim() : '';

      if (!EMAIL_REGEX.test(forwardTo)) {
        return next(
          ServiceValidationError.forField('forwardTo', 'A valid forwarding email address is required', {
            operation: 'update_linux_forward',
            service: 'profile_controller',
          })
        );
      }

      // forwards-service requires a Management-API-audience JWT (Flow C token), same as add_alias.
      const managementToken = this.profileAuthService.getManagementToken(req);
      if (!managementToken) {
        if (!this.profileAuthService.isProfileAuthConfigured()) {
          res.status(501).json({ error: 'profile_auth_not_configured', message: 'Updating your forwarding address is not available in this environment.' });
          return;
        }
        res.status(403).json({
          error: 'management_token_required',
          message: 'Profile authorization required to update your forwarding address',
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/linux-email')}`,
        });
        return;
      }

      // Enforce the verified-address-only rule server-side — the UI dropdown is not a security boundary.
      const verified = await this.validateLinuxForwardTarget(req, forwardTo, domain, 'update_linux_forward');
      if ('error' in verified) {
        return next(verified.error);
      }

      const forward = await this.forwardsService.setTarget(req, managementToken, verified.target, domain);
      if (!forward || forward.error) {
        return next(
          new MicroserviceError(forward?.error || 'Failed to update forwarding address', 502, 'FORWARD_SET_FAILED', {
            operation: 'update_linux_forward',
            service: 'profile_controller',
          })
        );
      }

      logger.success(req, 'update_linux_forward', startTime, { domain });
      res.status(200).json({ forwardTo: forward.target_email ?? verified.target });
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
      // During impersonation, req.bearerToken is the target user's live access token. Never surface
      // it to the impersonator — suppress the developer-token endpoint entirely (the UI skips the
      // fetch and shows an "API token unavailable" state). This is a read, but the payload is a live
      // credential, so it is treated like a write.
      if (isImpersonating(req)) {
        return next(
          new AuthorizationError('Developer tokens are not available while impersonating', {
            operation: 'get_developer_token_info',
            service: 'profile_controller',
            path: req.path,
            code: 'IMPERSONATION_READ_ONLY',
          })
        );
      }

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

      const tokenInfo: DeveloperTokenInfo = {
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
   * POST /api/profile/reset-password - Send password reset link via auth-service NATS
   * Uses the Flow C management token (update:current_user_metadata scope) to request
   * Auth0 send the reset email to the user's primary email.
   */
  public async sendPasswordResetEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'send_password_reset_email');

    try {
      const mgmtToken = this.profileAuthService.getManagementToken(req);
      if (!mgmtToken) {
        if (!this.profileAuthService.isProfileAuthConfigured()) {
          res.status(501).json({
            error: 'profile_auth_not_configured',
            message: 'Password reset is not available in this environment.',
          });
          return;
        }
        res.status(403).json({
          error: 'management_token_required',
          message: 'Profile authorization required to send a password reset link',
          // Static legacy path (not `referer`, which is the settings page itself and carries no
          // fragment) — profile.routes.ts's redirectTo re-attaches #password on return.
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent(PROFILE_PASSWORD_PATH)}`,
        });
        return;
      }

      const result = await this.emailVerificationService.sendPasswordResetLink(req, mgmtToken);

      if (!result.success) {
        return next(
          new MicroserviceError(result.message || 'Failed to send password reset link', 502, 'AUTH_SERVICE_ERROR', {
            operation: 'send_password_reset_email',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      logger.success(req, 'send_password_reset_email', startTime);

      res.json({ message: 'A password reset link has been sent to the primary email on file.' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/profile/change-password - Change user's password via auth-service NATS
   * Uses the Flow C management token (update:current_user_metadata scope) since
   * auth-service requires Management API audience for password updates.
   */
  public async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'change_password');

    try {
      const { current_password, new_password } = req.body as { current_password: string; new_password: string };

      if (!current_password || !new_password) {
        return next(
          ServiceValidationError.forField('body', 'current_password and new_password are required', {
            operation: 'change_password',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const mgmtToken = this.profileAuthService.getManagementToken(req);
      if (!mgmtToken) {
        if (!this.profileAuthService.isProfileAuthConfigured()) {
          res.status(501).json({
            error: 'profile_auth_not_configured',
            message: 'Changing your password is not available in this environment.',
          });
          return;
        }
        res.status(403).json({
          error: 'management_token_required',
          message: 'Profile authorization required to change your password',
          // Static legacy path (not `referer`, which is the settings page itself and carries no
          // fragment) — profile.routes.ts's redirectTo re-attaches #password on return.
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent(PROFILE_PASSWORD_PATH)}`,
        });
        return;
      }

      const result = await this.emailVerificationService.changePassword(req, mgmtToken, current_password, new_password);

      if (!result.success) {
        const upstreamText = [result.error, result.message].filter(Boolean).join(' ').toLowerCase();
        const match = PASSWORD_ERROR_RULES.find((rule) => rule.pattern.test(upstreamText));
        const { status, code, message } = match
          ? {
              status: match.status,
              code: match.code,
              message: match.useUpstreamMessage ? result.message || result.error || match.message : match.message,
            }
          : { status: 502, code: 'AUTH_SERVICE_ERROR', message: result.message || 'Failed to change password' };

        if (!match) {
          logger.warning(req, 'change_password', 'Unclassified password change failure — upstream message format may have changed', {
            upstream_message: result.message,
            upstream_error: result.error,
          });
        }

        return next(
          new MicroserviceError(message, status, code, {
            operation: 'change_password',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      logger.success(req, 'change_password', startTime, {});
      res.json({ message: result.message || 'Password changed successfully' });
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      // During impersonation these resolve to the target user so CDP/auth-service reads return the
      // target's identities.
      const auth0Sub = (isImpersonating(req) ? getEffectiveSub(req) : req.oidc?.user?.['sub']) as string;

      // Fetch CDP identities, auth-service identities, and the account's primary email in parallel
      const [cdpIdentities, auth0Identities, primaryEmail] = await Promise.all([
        this.cdpService.getIdentitiesForUser(req, lfid),
        auth0Sub ? this.auth0Service.getUserIdentities(req, auth0Sub) : Promise.resolve([]),
        this.resolveIdentitiesPrimaryEmail(req, lfid),
      ]);

      logger.debug(req, 'get_identities', 'Raw identity data before reconciliation', {
        cdp_identities: cdpIdentities,
        auth_service_identities: auth0Identities,
      });

      // Reconcile CDP identities with auth-service identities and filter to the
      // (platform, type) combos LFX One can surface for verification via Auth0. During impersonation
      // the read is preserved but CDP writes (auto-verify + synthetic-identity creation) are skipped —
      // an impersonator must never mutate the target's CDP records.
      const { enriched, cdpPostsQueued } = this.reconcileIdentities(req, cdpIdentities, auth0Identities, lfid, primaryEmail);
      const displayIdentities = enriched.filter((id) => CDP_DISPLAYABLE_IDENTITY_COMBOS.has(`${id.platform}+${id.type}`));

      logger.success(req, 'get_identities', startTime, {
        lfid,
        cdp_count: cdpIdentities.length,
        auth_service_count: auth0Identities.length,
        display_count: displayIdentities.length,
        hidden_count: enriched.filter((i) => i.displayState === 'hidden').length,
        cdp_posts_queued: cdpPostsQueued,
        has_primary_email: !!primaryEmail,
        primary_email_verified: primaryEmail?.verified === true,
      });

      res.json(displayIdentities);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/work-experiences - Get user's work experiences from CDP
   */
  public async getWorkExperiences(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_work_experiences');

    try {
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const workExperiences = await this.cdpService.getWorkExperiencesForUser(req, lfid);

      logger.success(req, 'get_work_experiences', startTime, {
        lfid,
        count: workExperiences.length,
      });

      res.json(workExperiences);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/project-affiliations - Get user's project affiliations from CDP
   */
  public async getProjectAffiliations(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_project_affiliations');

    try {
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const affiliations = await this.cdpService.getProjectAffiliationsForUser(req, lfid);

      logger.success(req, 'get_project_affiliations', startTime, {
        lfid,
        count: affiliations.length,
      });

      res.json(affiliations);
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const identityId = req.params['identityId'];

      if (!identityId) {
        const validationError = ServiceValidationError.forField('identityId', 'Identity ID is required', {
          operation: 'reject_identity',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // If provider and auth0UserId are provided, attempt to unlink from Auth0 via NATS
      const { provider, auth0UserId, email } = req.body || {};

      // `email` is only sent for an email identity (see profile-identities.component.ts and
      // account-settings.component.ts). The guard below reads the current meeting-invite
      // preference, then removes the identity if it doesn't match — a check-then-act sequence
      // that a concurrent PUT /api/profile/emails/meeting-invite could otherwise interleave with
      // (LFXV2 #2241), repointing the preference at this identity between the read and the
      // removal. `withMeetingInviteLock` serializes both sides of that race for a well-formed client; it
      // does not resolve the identity's address server-side, so a request that omits `email`
      // while naming an email `identityId` still bypasses this guard (pre-existing, tracked as
      // follow-up scope beyond #2241).
      // Single source of truth for "does this request touch the meeting-invite invariant" — the
      // guard above and the decision to take the lock below must never drift apart.
      const isEmailIdentity = typeof email === 'string' && !!email;

      const finishRejectIdentity = async (): Promise<void> => {
        if (isEmailIdentity) {
          const v1Token = req.apiGatewayToken;
          const preference = v1Token ? await this.meetingPreferenceService.getMeetingInviteEmail(req, v1Token) : null;

          if (!preference || emailsEqual(preference.email, email)) {
            // Hand-rolled shape (not ConflictError) to match this handler's other error responses
            // below and the client's `err.error?.error` branching — pre-existing convention, kept
            // as-is here; only the lock-contention path (withMeetingInviteLock) uses ConflictError.
            res.status(409).json({
              error: 'meeting_invite_email_active',
              message: preference
                ? 'This email is set to receive meeting invitations. Choose a different meeting-invitation email before removing it.'
                : 'Could not confirm your meeting-invitation email. Please try again.',
            });
            return;
          }
        }

        if (provider && auth0UserId) {
          // Map CDP platform name to Auth0 provider name (e.g., 'google' → 'google-oauth2')
          const auth0Provider = CDP_TO_AUTH0_PROVIDER_MAP[provider] || provider;
          const mgmtToken = this.profileAuthService.getManagementToken(req);
          if (mgmtToken) {
            const unlinkResult = await this.emailVerificationService.unlinkIdentity(req, mgmtToken, auth0Provider, auth0UserId);
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
            if (!this.profileAuthService.isProfileAuthConfigured()) {
              res.status(501).json({
                error: 'profile_auth_not_configured',
                message: 'Removing this identity is not available in this environment.',
              });
              return;
            }
            res.status(403).json({
              error: 'management_token_required',
              message: 'Profile authorization required to remove this identity',
              authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/identities')}`,
            });
            return;
          }
        }

        // Skip CDP rejection for synthetic identities (auth-service-only, prefixed with "auth0:")
        if (identityId.startsWith('auth0:')) {
          logger.debug(req, 'reject_identity', 'Synthetic identity — skipping CDP rejection', { identity_id: identityId });
        } else if (
          isEmailIdentity &&
          (provider === 'email' || provider === 'google') &&
          emailsEqual(email, (await this.resolveIdentitiesPrimaryEmail(req, lfid))?.email)
        ) {
          // Only email/Google rows can represent the account's primary address (applyPrimaryEmail).
          // Removing that login only unlinks it; LinkedIn rows must still be rejected in CDP (#4123).
          logger.debug(req, 'reject_identity', 'Primary email address — unlink only, skipping CDP rejection', { identity_id: identityId });
        } else {
          await this.cdpService.rejectIdentityForUser(req, lfid, identityId);
        }

        logger.success(req, 'reject_identity', startTime, { lfid, identity_id: identityId });
        res.json({ success: true });
      };

      // Only the email-identity path touches the meeting-invite invariant — lock only that path.
      if (isEmailIdentity) {
        await withMeetingInviteLock(req, lfid, VALKEY_CACHE.MEETING_INVITE_LOCK_TTL_MS, finishRejectIdentity);
      } else {
        await finishRejectIdentity();
      }
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const workExperienceId = req.params['workExperienceId'];

      if (!workExperienceId) {
        const validationError = ServiceValidationError.forField('workExperienceId', 'Work experience ID is required', {
          operation: 'confirm_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.cdpService.confirmWorkExperienceForUser(req, lfid, workExperienceId);

      logger.success(req, 'confirm_work_experience', startTime, { lfid, work_experience_id: workExperienceId });
      res.json({ success: true });
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

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

      await this.cdpService.patchProjectAffiliationForUser(req, lfid, projectId, req.body);

      logger.success(req, 'patch_project_affiliation', startTime, { lfid, project_id: projectId, affiliation_count: affiliations.length });
      res.json({ success: true });
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const workExperienceId = req.params['workExperienceId'];

      if (!workExperienceId) {
        const validationError = ServiceValidationError.forField('workExperienceId', 'Work experience ID is required', {
          operation: 'delete_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      await this.cdpService.deleteWorkExperienceForUser(req, lfid, workExperienceId);

      logger.success(req, 'delete_work_experience', startTime, { lfid, work_experience_id: workExperienceId });
      res.json({ success: true });
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

      const body = req.body as WorkExperienceCreateUpdateBody;

      if (!body.organizationId || !body.jobTitle || !body.startDate) {
        const validationError = ServiceValidationError.forField('body', 'organizationId, jobTitle, and startDate are required', {
          operation: 'create_work_experience',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

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
      next(error);
    }
  }

  /**
   * GET /api/profile/auth/start - Initiate Flow C authorization
   * Redirects the user to Auth0 /authorize with the Profile Client credentials
   */
  public async startProfileAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'profile_auth_start');

    const returnTo = this.normalizeProfileReturnTo(req.query['returnTo']);

    if (!this.profileAuthService.isProfileAuthConfigured()) {
      logger.warning(req, 'profile_auth_start', 'Profile auth not configured', {});
      res.redirect(`${returnTo}?error=profile_auth_not_configured`);
      return;
    }

    try {
      const authorizeUrl = await this.profileAuthService.getAuthorizationUrl(req, returnTo);

      logger.success(req, 'profile_auth_start', startTime, {
        return_to: returnTo,
      });

      res.redirect(authorizeUrl);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/auth/callback - Handle Auth0 callback for Flow C
   * Exchanges the code for a management token, validates sub, stores in session
   */
  public async handleProfileAuthCallback(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'profile_auth_callback');

    // Checked before consuming: the nonce's Valkey record is single-use (deleted on read), so
    // consuming it ahead of a guard that then blocks the request would strand it, leaving no valid
    // nonce to retry with after impersonation ends. This redirect still lands on the generic
    // default fallback rather than the request's real returnTo, since that value lives in the
    // not-yet-consumed record — only the retry, not this immediate redirect, is preserved.
    if (this.blockCallbackDuringImpersonation(req, res, ProfileController.profileDefaultReturnTo, 'profile_auth_callback')) {
      return;
    }

    // See AuthStateService (#1938): looks up (and deletes) the nonce's Valkey record rather than
    // reading it off req.appSession. Single-use, so a replayed callback with the same state always
    // misses on its second try.
    const state = getStringQueryParam(req, 'state')?.trim() || undefined;
    const stateRecord = await authStateService.consume(req, state);
    const returnTo = this.normalizeProfileReturnTo(stateRecord?.returnTo);

    const code = getStringQueryParam(req, 'code');
    const error = getStringQueryParam(req, 'error');

    if (error) {
      logger.error(req, 'profile_auth_callback', startTime, new Error(`Auth0 returned error: ${error}`), {
        error_description: req.query['error_description'],
      });
      res.redirect(`${returnTo}?error=profile_auth_failed`);
      return;
    }

    // Validate the nonce (CSRF protection): it must exist, be unexpired/unused, and have been
    // issued to the user completing this callback.
    const currentSub = req.oidc?.user?.['sub'] as string | undefined;
    const subMismatch = !!stateRecord && stateRecord.sub !== currentSub;
    if (!state || !stateRecord || subMismatch) {
      // WARN, not ERROR: a stale, replayed, or forged `?state=` is caller-supplied invalid input,
      // not an internal fault (see .claude/rules/logging-patterns.md's WARN guidance, #1938).
      logger.warning(req, 'profile_auth_callback', 'Invalid state parameter', {
        has_state: !!state,
        has_state_record: !!stateRecord,
        sub_mismatch: subMismatch,
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

      // Auto-complete pending email verification if present. One-shot: the attempt is removed from
      // the session before anything else, so whatever the outcome its code is never replayed again.
      const pending = req.appSession?.pendingEmailVerification;
      let emailStatus: EmailVerificationCallbackStatus | undefined;
      if (pending) {
        delete req.appSession!.pendingEmailVerification;
        emailStatus = await this.completePendingEmailVerification(req, pending);
      }

      // Check for pending social connection (chained from social → Flow C → social)
      const pendingSocial = this.socialVerificationService.getPendingSocialConnect(req);
      if (pendingSocial) {
        this.socialVerificationService.clearPendingSocialConnect(req);
        logger.info(req, 'profile_auth_callback', 'Chaining to pending social connect', {
          provider: pendingSocial.provider,
          return_to: pendingSocial.returnTo,
        });
        res.redirect(`/api/profile/identities/social/connect?provider=${pendingSocial.provider}&returnTo=${encodeURIComponent(pendingSocial.returnTo)}`);
        return;
      }

      logger.success(req, 'profile_auth_callback', startTime, {
        user_sub: currentUserSub,
        token_type: tokenResponse.token_type,
        scope: tokenResponse.scope,
        expires_in: tokenResponse.expires_in,
        pending_verification_completed: !!pending && emailStatus !== EMAIL_CALLBACK_RETRY_REQUIRED_STATUS,
        pending_email_status: emailStatus,
      });

      // The email outcome rides alongside the authorization flag, which on its own proves only that
      // authorization succeeded. A newly linked address adds no marker (unchanged behavior).
      const emailStatusQuery = emailStatus ? `&${EMAIL_CALLBACK_STATUS_PARAM}=${emailStatus}` : '';
      res.redirect(`${returnTo}?success=profile_token_obtained${emailStatusQuery}`);
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
   * GET /api/profile/identities/social/connect?provider=github|google|linkedin&returnTo=/path
   * Initiates the social identity verification OAuth flow.
   * If no management token exists, chains through Flow C first.
   *
   * `returnTo` is where the browser lands once the handshake finishes, allowlisted like Flow C's.
   * The Add-identity dialog opens from the mentorship forms as well as the Identities tab, and
   * this redirect leaves the page either way, so the caller has to name the page to come back to.
   */
  public async startSocialConnect(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'start_social_connect');

    const provider = req.query['provider'] as string;
    const returnTo = this.normalizeSocialReturnTo(req.query['returnTo']);

    if (!provider || !this.socialVerificationService.isValidProvider(provider)) {
      logger.error(req, 'start_social_connect', startTime, new Error('Invalid provider'), { provider });
      res.redirect(`${returnTo}?error=invalid_provider`);
      return;
    }

    // Check if management token exists in session
    const mgmtToken = this.profileAuthService.getManagementToken(req);
    if (!mgmtToken) {
      // Store pending social connect and redirect to Flow C to obtain management token. Both
      // carry returnTo: the chain comes back through this handler, which re-reads it from the
      // pending record, and the plain returnTo covers Flow C finishing without that chain.
      this.socialVerificationService.storePendingSocialConnect(req, provider, returnTo);
      logger.info(req, 'start_social_connect', 'No management token, chaining through Flow C', { provider, return_to: returnTo });
      res.redirect(`/api/profile/auth/start?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    // Management token exists — redirect to Auth0 with social connection
    this.socialVerificationService.storeConnectReturnTo(req, returnTo);
    const authorizeUrl = this.socialVerificationService.getAuthorizeUrl(req, provider);

    logger.success(req, 'start_social_connect', startTime, { provider, return_to: returnTo });

    res.redirect(authorizeUrl);
  }

  /**
   * GET /social/callback - Handle Auth0 callback from social OAuth flow.
   * Exchanges code for id_token, links identity via NATS, verifies in CDP.
   */
  public async handleSocialCallback(req: Request, res: Response): Promise<void> {
    // Set by startSocialConnect; re-validated here because a session can outlive a page rename.
    // Read and cleared up front so every branch below — including the impersonation guard —
    // redirects to the page that started this, and no later callback inherits the path.
    const returnTo = this.normalizeSocialReturnTo(this.socialVerificationService.getConnectReturnTo(req));
    this.socialVerificationService.clearConnectReturnTo(req);

    if (this.blockCallbackDuringImpersonation(req, res, returnTo, 'social_auth_callback')) {
      return;
    }

    const startTime = logger.startOperation(req, 'social_auth_callback');

    const code = req.query['code'] as string;
    const state = req.query['state'] as string;
    const error = req.query['error'] as string;

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

      // Decode the id_token subject for the same-account reconnect check.
      const socialSub = this.getIdTokenSubject(req, tokenResponse.id_token);

      // Same subject as the signed-in session: the identity already resolves to this account
      // (e.g. reconnecting an owned social identity via Add identity or Verify). A successful
      // no-op — nothing is linked, verified in CDP, or synced. The token came from the direct,
      // state-checked code exchange above; the decode is plain JSON, not signature verification,
      // so this only selects a presentation outcome and never authorizes a write.
      const sessionSub = req.oidc?.user?.['sub'];
      if (socialSub && typeof sessionSub === 'string' && sessionSub.length > 0 && socialSub === sessionSub) {
        logger.success(req, 'social_auth_callback', startTime, { status: IDENTITY_ALREADY_CONNECTED_STATUS });
        res.redirect(`${returnTo}?success=${IDENTITY_ALREADY_CONNECTED_STATUS}`);
        return;
      }

      // Link the social identity via NATS (reuses existing email verification linking)
      const linkResponse = await this.emailVerificationService.linkIdentity(req, mgmtToken, tokenResponse.id_token);

      if (!linkResponse.success) {
        const isAlreadyLinked = isIdentityAlreadyLinkedError(linkResponse.error, linkResponse.message);
        logger.error(req, 'social_auth_callback', startTime, new Error('Identity link failed'), {
          error: linkResponse.error,
          message: linkResponse.message,
          social_sub: socialSub,
          is_already_linked: isAlreadyLinked,
        });
        // Do not include the owning LFID — leaking it would enable account enumeration.
        res.redirect(`${returnTo}?error=${isAlreadyLinked ? 'already_linked' : 'link_failed'}`);
        return;
      }

      // Fire-and-forget CDP identity verification
      const lfid = getEffectiveUsername(req);

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
                  err,
                });
              });
            }
          })
          .catch((err: unknown) => {
            logger.warning(req, 'social_auth_callback', 'CDP identity lookup failed (non-blocking)', {
              err,
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

      if (!EMAIL_REGEX.test(email)) {
        const validationError = ServiceValidationError.forField('email', 'Invalid email format', {
          operation: 'send_email_verification',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const upstreamStartedAt = Date.now();
      const response = await this.emailVerificationService.sendVerificationCode(req, email);
      await this.holdUntilFloor(upstreamStartedAt);

      if (response.success) {
        logger.success(req, 'send_email_verification', startTime);
        res.json({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
      } else {
        logger.debug(req, 'send_email_verification', 'Verification response on failure', {
          response_keys: Object.keys(response),
          error: response.error,
          message: response.message,
        });

        if (isIdentityAlreadyLinkedError(response.error, response.message)) {
          this.logLinkedEmailConflict(req, 'send_email_verification');
          logger.success(req, 'send_email_verification', startTime);
          res.json({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
        } else if (response.error === 'Service temporarily unavailable') {
          res.status(503).json({ success: false, error: response.error, message: response.message });
        } else {
          res.status(400).json({ success: false, error: response.error, message: response.message });
        }
      }
    } catch (error) {
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
      // Throws 401 when no IdP-asserted LFID resolves — before any input validation.
      const lfid = this.resolveEffectiveLfid(req);

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
      // The caller's own Flow C token, also sent with the OTP so auth-service can recognize an
      // address already connected to this account. Never set from the link-only M2M fallback below.
      let userManagementToken: string | undefined;

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
            // Static legacy path (not `referer`, which is the settings page itself and carries no
            // fragment) — profile.routes.ts's redirectTo re-attaches #email-settings on return.
            authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent(PROFILE_EMAILS_PATH)}`,
          });
          return;
        }
        authToken = mgmtToken;
        userManagementToken = mgmtToken;
      } else {
        const authServiceAudience = new URL('api/v2/', issuerBaseUrl).toString();
        authToken = await generateM2MToken(req, { audience: authServiceAudience });
      }

      // Step 2: Verify OTP via NATS
      const otpStartedAt = Date.now();
      const otpResponse = await this.emailVerificationService.verifyOtp(req, email, otp, userManagementToken);

      if (!otpResponse.success) {
        logger.debug(req, 'verify_and_link_email', 'OTP verification failed', { error: otpResponse.error, message: otpResponse.message });

        if (otpResponse.error === 'Service temporarily unavailable') {
          res.status(503).json({
            success: false,
            error: otpResponse.error,
            message: otpResponse.message || EMAIL_VERIFICATION_FAILED_MESSAGE,
          });
          return;
        }

        if (isIdentityAlreadyLinkedError(otpResponse.error, otpResponse.message)) {
          this.logLinkedEmailConflict(req, 'verify_and_link_email');
        }
        await this.holdUntilFloor(otpStartedAt);
        res.status(400).json({ success: false, error: EMAIL_VERIFICATION_FAILED_ERROR, message: EMAIL_VERIFICATION_FAILED_MESSAGE });
        return;
      }

      // Already connected to the caller's own account: a proven, successful no-op. Nothing is
      // linked, synced, or verified — the address is already part of the account.
      if (userManagementToken && this.isEmailAlreadyConnected(otpResponse)) {
        logger.success(req, 'verify_and_link_email', startTime, { status: EMAIL_ALREADY_CONNECTED_STATUS });
        const response: VerifyAndLinkEmailResponse = { success: true, status: EMAIL_ALREADY_CONNECTED_STATUS, message: EMAIL_ALREADY_CONNECTED_MESSAGE };
        res.json(response);
        return;
      }

      if (!otpResponse.data?.id_token) {
        const error = otpResponse.error || 'token_missing';
        const message = otpResponse.message || 'Verification succeeded but identity token was not returned. Please try again.';

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
        if (isIdentityAlreadyLinkedError(linkResponse.error, linkResponse.message)) {
          // Resolve the owning account for support/debugging only — never returned to the client.
          const linkedTo =
            (await this.emailVerificationService.resolveEmailToUsername(req, email)) || (await this.emailVerificationService.resolveEmailToSub(req, email));

          logger.warning(req, 'verify_and_link_email', 'Email already linked to another account', {
            email,
            linked_to: linkedTo,
          });

          // Never forward the upstream message here — it could name the owning account.
          res.status(409).json({ success: false, error: linkResponse.error, message: EMAIL_ALREADY_LINKED_MESSAGE });
        } else if (linkResponse.error === 'Service temporarily unavailable') {
          res.status(503).json({ success: false, error: linkResponse.error, message: linkResponse.message });
        } else {
          res.status(400).json({ success: false, error: linkResponse.error, message: linkResponse.message });
        }
        return;
      }

      // Sync the freshly verified address into v1 so meeting-invite resolution finds it (fail-open)
      await this.userService.syncVerifiedEmailToUserService(req, email);

      // Step 4: Fire-and-forget CDP identity verification
      // Find the newly linked email identity in CDP and verify it
      this.cdpService
        .getIdentitiesForUser(req, lfid)
        .then((identities) => {
          const emailIdentity = identities.find((id) => (id.platform === 'email' || id.platform === 'custom') && id.value === email);
          if (emailIdentity) {
            this.cdpService.verifyIdentityForUser(req, lfid, emailIdentity.id).catch((err: unknown) => {
              logger.warning(req, 'verify_and_link_email', 'CDP verify failed (non-blocking)', {
                err,
              });
            });
          }
        })
        .catch((err: unknown) => {
          logger.warning(req, 'verify_and_link_email', 'CDP identity lookup failed (non-blocking)', {
            err,
          });
        });

      logger.success(req, 'verify_and_link_email', startTime, { email });
      res.json({ success: true, message: 'Email identity verified and linked successfully' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profile/visibility — resolve the current user's public-profile visibility (master
   * IsPublic flag + section-level `visibility` preference).
   */
  public async getVisibility(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_profile_visibility');

    try {
      const visibility = await this.userService.getProfileVisibility(req);

      logger.success(req, 'get_profile_visibility', startTime, { is_public: visibility.isPublic });
      res.json(visibility);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/profile/visibility — update the current user's public-profile visibility. Blocked
   * during impersonation by route middleware.
   */
  public async updateVisibility(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_profile_visibility');

    try {
      const { isPublic, sections }: ProfileVisibilityUpdateRequest = req.body ?? {};

      // Require a fully-resolved map (the client always sends every key). A partial/empty map is
      // malformed: silently zero-filling missing keys would erase settings the caller didn't intend
      // to touch, so reject it here rather than fail closed to all-private downstream.
      const sectionsResolved =
        Boolean(sections) &&
        typeof sections === 'object' &&
        !Array.isArray(sections) &&
        PROFILE_VISIBILITY_KEYS.every((key) => typeof (sections as Record<string, unknown>)[key] === 'boolean');

      if (typeof isPublic !== 'boolean' || !sectionsResolved) {
        return next(
          ServiceValidationError.forField('body', 'isPublic (boolean) and a fully-resolved sections map (every visibility key a boolean) are required', {
            operation: 'update_profile_visibility',
            service: 'profile_controller',
            path: req.path,
          })
        );
      }

      const visibility = await this.userService.updateProfileVisibility(req, { isPublic, sections });

      logger.success(req, 'update_profile_visibility', startTime, { is_public: visibility.isPublic });
      res.json(visibility);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Maps an auth-service `UserMetadataUpdateResponse` failure to the appropriate typed API error.
   * Shared by every write path that persists through `userService.updateUserMetadata` (profile
   * field updates, profile picture upload) so the error classification stays consistent.
   */
  private mapUserMetadataUpdateError(response: UserMetadataUpdateResponse, username: string, operation: string, path: string): unknown {
    if (response.error === 'Service temporarily unavailable') {
      return new MicroserviceError(response.message || 'Authentication service temporarily unavailable', 503, 'SERVICE_UNAVAILABLE', {
        operation,
        service: 'auth-service',
        path,
        errorBody: { error: response.error, message: response.message },
      });
    } else if (response.error?.includes('authentication') || response.error?.includes('token')) {
      return new AuthenticationError(response.message || 'Authentication failed', {
        operation,
        service: 'profile_controller',
        path,
        metadata: { error: response.error },
      });
    } else if (response.error?.includes('permission') || response.error?.includes('forbidden')) {
      return new AuthorizationError(response.message || 'Insufficient permissions to update user metadata', {
        operation,
        service: 'profile_controller',
        path,
      });
    } else if (response.error?.includes('not found')) {
      return new ResourceNotFoundError('User', username, {
        operation,
        service: 'profile_controller',
        path,
      });
    } else if (response.error?.includes('validation') || response.error?.includes('invalid')) {
      return ServiceValidationError.forField('user_metadata', response.message || response.error || 'Invalid user metadata', {
        operation,
        service: 'profile_controller',
        path,
      });
    }

    return new MicroserviceError(response.message || response.error || 'Failed to update user metadata', 500, 'INTERNAL_ERROR', {
      operation,
      service: 'auth-service',
      path,
      errorBody: { error: response.error, message: response.message },
    });
  }

  /**
   * With no invite override, invitations follow the primary — pin the current primary so they stay
   * put when it changes. `blockedReason` is set when that couldn't be confirmed.
   */
  private async pinMeetingInviteToCurrentPrimary(
    req: Request,
    v1Token: string,
    newPrimary: string
  ): Promise<{ pinned: boolean; blockedReason?: SetMeetingInviteResult['reason'] }> {
    const preference = await this.meetingPreferenceService.getMeetingInviteEmail(req, v1Token);
    if (!preference) {
      return { pinned: false, blockedReason: 'unavailable' };
    }
    if (preference.email !== null) {
      return { pinned: false };
    }

    const sub = getEffectiveSub(req);
    const currentPrimary = sub ? (await this.emailVerificationService.getUserEmails(req, sub))?.primary_email : undefined;
    if (!currentPrimary) {
      logger.warning(req, 'set_primary_email', 'Could not resolve the current primary email to pin as the meeting-invite email');
      return { pinned: false, blockedReason: 'unavailable' };
    }
    if (emailsEqual(currentPrimary, newPrimary)) {
      return { pinned: false };
    }

    const result = await this.meetingPreferenceService.setMeetingInviteEmail(req, v1Token, currentPrimary);
    return result.success ? { pinned: true } : { pinned: false, blockedReason: result.reason ?? 'upstream' };
  }

  private inviteEmailPinFailedError(reason: SetMeetingInviteResult['reason']): ServiceValidationError | MicroserviceError {
    const errorOptions = { operation: 'set_primary_email', service: 'profile_controller' };

    // Retrying can't fix a rejected address — point at the way out: pick a different invite address.
    if (reason === 'validation') {
      const message =
        "Your primary email wasn't changed because your meeting invitations can't stay on your current primary email. Choose a different address for meeting invitations in Settings, then try again.";
      return new ServiceValidationError([{ field: 'email', message, code: 'FIELD_VALIDATION_ERROR' }], message, errorOptions);
    }

    // SERVICE_ADVISORY lets the frontend surface this copy from a 5xx body.
    return new MicroserviceError(
      "Your primary email wasn't changed because we couldn't keep your meeting invitations on their current address. Please try again in a few minutes.",
      503,
      ERROR_CODES.SERVICE_ADVISORY,
      errorOptions
    );
  }

  /** Hold indistinguishable responses until the shared upstream-to-response floor. */
  private async holdUntilFloor(startedAt: number): Promise<void> {
    const remainingMs = EMAIL_VERIFICATION_MIN_RESPONSE_MS - (Date.now() - startedAt);
    if (remainingMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remainingMs));
    }
  }

  /** Keep pre-proof conflict details request-correlated without logging another account's identity. */
  private logLinkedEmailConflict(req: Request, operation: string): void {
    logger.warning(req, operation, 'Email already linked to another account');
  }

  /**
   * The explicit own-account outcome: OTP proof succeeded and auth-service reports the address is
   * already connected to the caller. Only meaningful when the request carried the caller's own
   * token; any other tokenless success stays malformed.
   */
  private isEmailAlreadyConnected(otpResponse: VerifyEmailOtpNatsResponse): boolean {
    return otpResponse.success === true && otpResponse.data?.status === EMAIL_ALREADY_CONNECTED_STATUS;
  }

  /**
   * Replays a pending email verification during the Flow C callback, after the caller has already
   * removed it from the session. Returns the outcome to surface on the redirect: `already_connected`,
   * `retry_required` for any attempt that did not finish, or undefined when a new address was linked.
   * Never throws — the authorization itself has already succeeded.
   */
  private async completePendingEmailVerification(req: Request, pending: { email: string; otp: string }): Promise<EmailVerificationCallbackStatus | undefined> {
    // Resolve the freshly stored user token before replaying the code, so its absence never consumes it.
    const mgmtToken = this.profileAuthService.getManagementToken(req);
    if (!mgmtToken) {
      logger.warning(req, 'profile_auth_callback', 'Pending verification skipped: management token unavailable');
      return EMAIL_CALLBACK_RETRY_REQUIRED_STATUS;
    }

    try {
      const otpResponse = await this.emailVerificationService.verifyOtp(req, pending.email, pending.otp, mgmtToken);

      if (this.isEmailAlreadyConnected(otpResponse)) {
        logger.info(req, 'profile_auth_callback', 'Pending email already connected to this account');
        return EMAIL_ALREADY_CONNECTED_STATUS;
      }

      if (!otpResponse.success || !otpResponse.data?.id_token) {
        logger.warning(req, 'profile_auth_callback', 'Pending OTP verification failed (may have expired)', {
          error: otpResponse.error,
          has_token: !!otpResponse.data?.id_token,
        });
        return EMAIL_CALLBACK_RETRY_REQUIRED_STATUS;
      }

      const linkResponse = await this.emailVerificationService.linkIdentity(req, mgmtToken, otpResponse.data.id_token);
      if (!linkResponse.success) {
        logger.warning(req, 'profile_auth_callback', 'Pending verification link failed', {
          error: linkResponse.error,
        });
        return EMAIL_CALLBACK_RETRY_REQUIRED_STATUS;
      }
    } catch (err) {
      logger.warning(req, 'profile_auth_callback', 'Pending verification error (non-blocking)', {
        err,
      });
      return EMAIL_CALLBACK_RETRY_REQUIRED_STATUS;
    }

    // Linked — the follow-up writes below are fail-open and never turn a completed link into a retry.
    try {
      // This route's auth config skips the middleware's gateway-token exchange — populate
      // it here (session-cached, fail-open) so the v1 sync below has a token to work with.
      await populateApiGatewayToken(req);

      // Sync the freshly verified address into v1 so meeting-invite resolution finds it (fail-open)
      await this.userService.syncVerifiedEmailToUserService(req, pending.email);
    } catch (err) {
      logger.warning(req, 'profile_auth_callback', 'Pending verification follow-up sync failed (non-blocking)', {
        err,
      });
    }

    // Fire-and-forget CDP verification
    const lfid = getEffectiveUsername(req);

    if (lfid) {
      this.cdpService
        .getIdentitiesForUser(req, lfid)
        .then((identities) => {
          const emailIdentity = identities.find((id) => (id.platform === 'email' || id.platform === 'custom') && id.value === pending.email);
          if (emailIdentity) {
            this.cdpService.verifyIdentityForUser(req, lfid, emailIdentity.id).catch((err: unknown) => {
              logger.warning(req, 'profile_auth_callback', 'CDP verify failed (non-blocking)', {
                err,
              });
            });
          }
        })
        .catch((err: unknown) => {
          logger.warning(req, 'profile_auth_callback', 'CDP identity lookup failed (non-blocking)', {
            err,
          });
        });
    }

    logger.info(req, 'profile_auth_callback', 'Pending email verification completed');
    return undefined;
  }

  /**
   * Resolves the effective LFID for CDP/auth-service calls. During impersonation this is the target
   * user's username (from the impersonation session); otherwise it is the IdP-asserted LF username
   * claim. Never derived from display claims or the `sub`, since CDP writes are keyed on it — throws
   * when no LFID can be resolved.
   */
  private resolveEffectiveLfid(req: Request): string {
    const lfid = getEffectiveUsername(req);
    if (!lfid) {
      throw new AuthenticationError('User authentication required', {
        operation: 'resolve_effective_lfid',
        service: 'profile_controller',
        path: req.path,
      });
    }
    return lfid;
  }

  /**
   * Reconciles CDP identities with auth-service identities to determine display state
   * and trigger auto-verification where needed.
   *
   * Truth table:
   * 1. In auth-service AND CDP, verified=true & verifiedBy=lfid → VERIFIED (already reconciled)
   * 2. In auth-service AND CDP, verified=false OR verifiedBy≠lfid → VERIFIED (auto-verify via PATCH)
   * 3. In auth-service but NOT in CDP → VERIFIED (synthetic entry + fire-and-forget POST to CDP,
   *    skipping the POST when a `custom` row for the same email value has already been written
   *    in this loop or already exists as a CDP custom-email row owned by this user (verifiedBy=lfid))
   * 4. In CDP but NOT in auth-service, multi-LFID + verified & verifiedBy≠lfid → HIDDEN
   * 5. In CDP but NOT in auth-service (all other) → UNVERIFIED
   * 6. Primary email (applyPrimaryEmail, runs last) → exactly one email/google row for the
   *    account's primary address is marked isPrimary; its verified state comes only from the IdP
   *    `email_verified` proof (or an existing verified auth-service match), unlinked duplicates are
   *    hidden, and a display-only synthetic row is added when neither source has it. No CDP writes.
   *
   * Email-type values match case-insensitively between auth-service and CDP (identityMatchKey);
   * username values (e.g. GitHub) match exactly. Values written to CDP keep their original casing.
   * When several CDP rows match one auth-service login (e.g. case variants), only the first is
   * shown; the rest are HIDDEN so each login has a single row and Remove menu.
   */
  private reconcileIdentities(
    req: Request,
    cdpIdentities: CdpIdentity[],
    authServiceIdentities: Auth0Identity[],
    lfid: string,
    primaryEmail: IdentitiesPrimaryEmail | null = null
  ): { enriched: EnrichedIdentity[]; cdpPostsQueued: number } {
    // Under impersonation, produce the read-only enriched list without any CDP mutation: no
    // auto-verify, no synthetic-identity creation. Derived here (not a caller-supplied flag) so a
    // future call site can't accidentally re-enable CDP writes against the target's records. The
    // returned identities are unchanged either way.
    const skipCdpMutations = isImpersonating(req);

    // Build a map of "platform:type:value" → Auth0Identity for matching
    const authServiceMap = new Map<string, Auth0Identity>();
    for (const authId of authServiceIdentities) {
      const cdpPlatform = AUTH0_TO_CDP_PROVIDER_MAP[authId.provider];
      const value = this.getAuth0IdentityValue(authId);
      if (cdpPlatform && value) {
        authServiceMap.set(this.identityMatchKey(cdpPlatform, CDP_PLATFORM_TO_TYPE_MAP[cdpPlatform] ?? 'username', value), authId);
      }
    }

    // Track which auth-service identities have been matched to a CDP identity
    const matchedAuthKeys = new Set<string>();

    // Check if there are multiple LFID identities (indicates merged CDP profiles)
    const lfidCount = cdpIdentities.filter((id) => id.platform === 'lfid').length;
    const hasMultiLfid = lfidCount > 1;

    // Auth-service logins already shown by an earlier CDP row — case-variant CDP rows (dev@ / DEV@)
    // match the same login, which must appear once with one Remove menu.
    const claimedAuthIdentityKeys = new Set<string>();

    // Process CDP identities
    const enriched: EnrichedIdentity[] = cdpIdentities.map((cdp): EnrichedIdentity => {
      const authKey = this.identityMatchKey(cdp.platform, cdp.type, cdp.value);
      // Google OAuth creates email-type CDP entries — cross-match CDP email entries against Google auth identities
      const googleKey = cdp.platform === 'email' && cdp.type === 'email' ? this.identityMatchKey('google', 'email', cdp.value) : null;
      const authIdentity = authServiceMap.get(authKey) ?? (googleKey ? authServiceMap.get(googleKey) : undefined);

      const inAuthService = !!authIdentity;

      if (inAuthService) {
        matchedAuthKeys.add(authKey);
        // Also mark the Google auth key as matched to prevent duplicate synthetic entries
        if (googleKey && authIdentity?.provider === 'google-oauth2') {
          matchedAuthKeys.add(googleKey);
        }
      }

      // Rule: The logged-in user's own LFID is always verified
      if (cdp.platform === 'lfid' && cdp.value === lfid) {
        // Auto-verify LFID in CDP if not already verified with their LFID (skipped when read-only)
        if (!skipCdpMutations && !(cdp.verified && cdp.verifiedBy === lfid)) {
          this.cdpService.verifyIdentityForUser(req, lfid, cdp.id, lfid).catch((err: unknown) => {
            logger.warning(req, 'reconcile_identities', 'Auto-verify LFID failed (non-blocking)', {
              identity_id: cdp.id,
              err,
            });
          });
        }
        return { ...cdp, displayState: 'verified', inAuth0: true };
      }

      if (inAuthService) {
        // In both auth-service and CDP — auto-verify if needed (skipped when read-only)
        if (!skipCdpMutations && !(cdp.verified && cdp.verifiedBy === lfid)) {
          this.cdpService.verifyIdentityForUser(req, lfid, cdp.id, lfid).catch((err: unknown) => {
            logger.warning(req, 'reconcile_identities', 'Auto-verify failed (non-blocking)', {
              identity_id: cdp.id,
              platform: cdp.platform,
              err,
            });
          });
        }
        const authIdentityKey = `${authIdentity.provider}:${authIdentity.user_id}`;
        if (claimedAuthIdentityKeys.has(authIdentityKey)) {
          return { ...cdp, displayState: 'hidden', inAuth0: true };
        }
        claimedAuthIdentityKeys.add(authIdentityKey);
        // If a Google OAuth identity matched a CDP email entry, show it as a Google identity
        const isGoogleCrossMatch = cdp.platform === 'email' && authIdentity?.provider === 'google-oauth2';
        return {
          ...cdp,
          ...(isGoogleCrossMatch ? { platform: 'google', icon: CDP_PLATFORM_ICONS['google'] } : {}),
          displayState: 'verified',
          inAuth0: true,
          ...(authIdentity ? { auth0UserId: authIdentity.user_id } : {}),
        };
      }

      // In CDP but NOT in auth-service
      const isVerifiedByOtherOwner = cdp.verified && !!cdp.verifiedBy && cdp.verifiedBy !== lfid;
      let displayState: IdentityDisplayState;

      if (!CDP_DISPLAYABLE_IDENTITY_COMBOS.has(`${cdp.platform}+${cdp.type}`)) {
        // Combo not surfaceable via Auth0 (e.g. linkedin+username, gitlab+username) —
        // we have no way to help the user verify it, so hide.
        displayState = 'hidden';
      } else if (isVerifiedByOtherOwner && hasMultiLfid) {
        // Multi-LFID merged profile — hide identities verified by another LFID
        displayState = 'hidden';
      } else {
        displayState = 'unverified';
      }

      return { ...cdp, displayState, inAuth0: false };
    });

    // Process auth-service identities NOT in CDP — create synthetic entries
    let cdpPostsQueued = 0;
    // Tracks values we've POSTed to CDP as platform='custom' within this loop.
    // Google + email auth-service providers both POST as platform='custom' for
    // back-compat, so a user with BOTH providers for the same email would
    // otherwise generate two duplicate custom rows. Iteration order of
    // authServiceMap is not guaranteed to put 'email' first, and synthetic
    // entries pushed for the first iter use platform='google'|'email' (not
    // 'custom'), so the enriched-array-only check below misses them.
    const postedCustomEmails = new Set<string>();
    for (const [, authId] of authServiceMap) {
      const cdpPlatform = AUTH0_TO_CDP_PROVIDER_MAP[authId.provider];
      const value = this.getAuth0IdentityValue(authId);
      if (!cdpPlatform || !value) {
        continue;
      }

      const type = CDP_PLATFORM_TO_TYPE_MAP[cdpPlatform] ?? 'username';
      if (matchedAuthKeys.has(this.identityMatchKey(cdpPlatform, type, value))) {
        continue;
      }

      // Skip combos LFX One can't surface for verification (e.g. lfid, gitlab)
      if (!CDP_DISPLAYABLE_IDENTITY_COMBOS.has(`${cdpPlatform}+${type}`)) {
        continue;
      }

      // Google/email POST to CDP as platform='custom'. Suppress the create when
      // it would duplicate an existing CDP custom-email row (either a manually-
      // verified one already in `enriched`, or one we POSTed earlier in this
      // same loop for the other provider). LinkedIn POSTs as platform='linkedin',
      // a distinct row from an email identity with the same value — never
      // suppressed by this guard.
      const cdpPostPlatform = cdpPlatform === 'email' || cdpPlatform === 'google' ? 'custom' : cdpPlatform;
      const wouldDuplicateCustomEmail =
        cdpPostPlatform === 'custom' &&
        (postedCustomEmails.has(value.trim().toLowerCase()) ||
          enriched.some((id) => id.platform === 'email' && emailsEqual(id.value, value) && id.verified && id.verifiedBy === lfid));

      // Skip the CDP create entirely when read-only (impersonation) — the synthetic display entry
      // below is still produced, so the impersonator sees the identity without any CDP mutation.
      if (!skipCdpMutations && !wouldDuplicateCustomEmail) {
        cdpPostsQueued++;
        if (cdpPostPlatform === 'custom') {
          postedCustomEmails.add(value.trim().toLowerCase());
        }
        this.cdpService
          .createIdentityForUser(req, [lfid], {
            value,
            platform: cdpPostPlatform,
            type,
            source: 'lfxOne',
            verified: true,
            verifiedBy: lfid,
          })
          .catch((err: unknown) => {
            logger.warning(req, 'reconcile_identities', 'CDP identity create failed (non-blocking)', {
              platform: cdpPlatform,
              value,
              err,
            });
          });
      }

      // Create synthetic EnrichedIdentity for display
      enriched.push({
        id: `auth0:${authId.user_id}`,
        platform: cdpPlatform,
        type,
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

    this.applyPrimaryEmail(enriched, primaryEmail);

    return { enriched, cdpPostsQueued };
  }

  /**
   * The account's primary email for the profile and identities list: auth-service `primary_email`
   * (keyed on the LFID username), falling back to the session email for display even when the IdP hasn't
   * verified it (the target's stored email while impersonating). Verification follows
   * `resolveVerifiedUserEmails`: the session must hold an IdP-verified email
   * (`getEffectiveEmail(req)`), and then the auth-service primary is trusted even when it differs
   * from that session email — auth-service only promotes verified addresses, and the session claim
   * stays stale after a mid-session primary change. A session-only fallback is verified only when
   * it is that verified email. An unavailable LFID or failed auth-service read falls back rather than
   * failing the endpoint; returns null when neither source resolves an address.
   */
  private async resolveIdentitiesPrimaryEmail(req: Request, lfid: string | null): Promise<IdentitiesPrimaryEmail | null> {
    const sessionEmail = getEffectiveEmail(req);
    const sessionDisplayEmail = isImpersonating(req) ? sessionEmail : (req.oidc?.user?.['email'] as string | undefined)?.trim() || null;
    const emails = lfid ? await this.emailVerificationService.getUserEmails(req, lfid).catch(() => null) : null;
    const authServicePrimary = emails?.primary_email?.trim();
    const email = authServicePrimary || sessionDisplayEmail;
    if (!email) {
      return null;
    }
    return { email, verified: !!sessionEmail && (!!authServicePrimary || emailsEqual(email, sessionEmail)) };
  }

  /**
   * Key for matching auth-service identities against CDP identities. Email values are trimmed and
   * lowercased so a casing difference doesn't split one owned address into two rows; username
   * values (e.g. GitHub) match exactly. Include the type so unsupported username rows cannot claim
   * a linked email identity with the same value.
   */
  private identityMatchKey(platform: string, type: CdpIdentityType, value: string): string {
    return `${platform}:${type}:${type === 'email' ? value.trim().toLowerCase() : value}`;
  }

  /**
   * Marks exactly one email/google row for the account's primary address as `isPrimary` (preferring
   * an auth-service-backed verified row), hides any further unlinked rows for the same address, and
   * adds a display-only synthetic row when neither CDP nor auth-service has it. Linked auth-service
   * rows (auth0UserId) are never hidden, so a Google or email login on the primary address stays
   * removable. A row that isn't already verified takes its state from the IdP proof only. LinkedIn
   * rows are never candidates (#4124). Performs no CDP writes.
   */
  private applyPrimaryEmail(enriched: EnrichedIdentity[], primaryEmail: IdentitiesPrimaryEmail | null): void {
    if (!primaryEmail) {
      return;
    }

    const candidates = enriched.filter(
      (id) => id.type === 'email' && (id.platform === 'email' || id.platform === 'google') && emailsEqual(id.value, primaryEmail.email)
    );

    if (candidates.length === 0) {
      enriched.push({
        id: 'primary-email',
        platform: 'email',
        type: 'email',
        value: primaryEmail.email,
        verified: primaryEmail.verified,
        verifiedBy: null,
        source: 'auth-service',
        icon: CDP_PLATFORM_ICONS['email'],
        createdAt: '',
        updatedAt: '',
        displayState: primaryEmail.verified ? 'verified' : 'unverified',
        inAuth0: false,
        isPrimary: true,
      });
      return;
    }

    const pick = candidates.find((id) => id.displayState === 'verified' && id.inAuth0) ?? candidates[0];
    for (const candidate of candidates) {
      if (candidate !== pick && !candidate.auth0UserId) {
        candidate.displayState = 'hidden';
      }
    }

    pick.isPrimary = true;
    if (pick.displayState !== 'verified') {
      pick.displayState = primaryEmail.verified ? 'verified' : 'unverified';
    }
  }

  /** Build a LinuxAliasData for a non-claimed state (no alias/forward yet). */
  private linuxAliasState(
    state: 'not_purchased' | 'purchased_unclaimed' | 'service_unavailable',
    domain: string,
    primaryEmail: string | null = null
  ): LinuxAliasData {
    return {
      state,
      domain,
      alias: null,
      email: null,
      forwardTo: null,
      primaryEmail,
      ...(state === 'not_purchased' ? { purchaseUrl: PURCHASE_LINUX_URL } : {}),
    };
  }

  /**
   * Verify a Linux.com forwarding target is one of the caller's own verified addresses — the same
   * set the claim/edit dropdown offers: the primary email, verified alternate emails from
   * `user_emails.read`, and email-valued identities linked in auth-service (shown as verified on the
   * Identities tab). Addresses on the forward domain itself are rejected (an alias can't forward to
   * itself). A legacy external target stays readable via getLinuxAlias but is never re-accepted here.
   * Returns the matching owned address (as stored upstream, so the caller forwards to exactly that
   * address rather than to the raw input), or the error to pass to next(). Throws when the identity
   * list is unavailable, so an outage surfaces as 503 rather than a misleading validation error.
   */
  private async validateLinuxForwardTarget(
    req: Request,
    forwardTo: string,
    domain: string,
    operation: 'claim_linux_alias' | 'update_linux_forward'
  ): Promise<{ target: string } | { error: ServiceValidationError | MicroserviceError }> {
    const userSub = getEffectiveSub(req) ?? undefined;
    if (!userSub) {
      return {
        error: ServiceValidationError.forField('user_id', 'User authentication required', { operation, service: 'profile_controller', path: req.path }),
      };
    }

    const notAllowed = ServiceValidationError.forField('forwardTo', 'Choose one of your verified email addresses to forward to', {
      operation,
      service: 'profile_controller',
    });
    if (forwardTo.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`)) {
      return { error: notAllowed };
    }

    const [emails, identities] = await Promise.all([
      this.emailVerificationService.getUserEmails(req, userSub),
      this.emailVerificationService.listIdentities(req, userSub),
    ]);
    // Fail closed: without the caller's email list, ownership can't be established.
    if (emails === null) {
      return {
        error: new MicroserviceError('Unable to verify your forwarding address right now. Please try again later.', 503, 'SERVICE_UNAVAILABLE', {
          operation,
          service: 'profile_controller',
        }),
      };
    }

    // Same primary fallback as getLinuxAlias, which feeds the dropdown's "(Primary)" option.
    const primaryEmail = emails.primary_email || getEffectiveEmail(req) || null;
    const owned = [
      primaryEmail,
      ...(emails.alternate_emails ?? []).filter((e) => e.verified === true).map((e) => e.email),
      ...identities
        .filter((id) => CDP_PLATFORM_TO_TYPE_MAP[AUTH0_TO_CDP_PROVIDER_MAP[id.provider] ?? ''] === 'email')
        .map((id) => this.getAuth0IdentityValue(id)),
    ];

    const match = owned.find((email) => emailsEqual(email, forwardTo));
    // Re-check the canonical address too: an owned address on the forward domain is never a valid target.
    if (!match || match.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`)) {
      return { error: notAllowed };
    }
    return { target: match.trim() };
  }

  /** Map an auth-service add_alias error code to an HTTP status + user message. */
  private mapAddAliasError(code: string | undefined): { status: number; message: string } {
    switch (code) {
      case 'already_claimed':
        return { status: 409, message: 'You already have a Linux.com alias on your account.' };
      case 'alias_not_available':
        return { status: 409, message: 'That alias is already taken. Please choose another.' };
      case 'alias_reserved':
        return { status: 400, message: 'That alias is reserved. Please choose another.' };
      case 'alias_invalid':
        return { status: 400, message: 'That alias is not valid. Use letters, numbers, dots, and hyphens only.' };
      case 'domain_not_allowed':
        return { status: 400, message: 'Linux.com aliases are not available in this environment.' };
      case 'alias_service_unavailable':
        return { status: 503, message: 'The alias service is temporarily unavailable. Please try again later.' };
      default:
        return { status: 502, message: 'Failed to claim the alias. Please try again.' };
    }
  }

  private normalizeProfileReturnTo(raw: unknown): string {
    return this.normalizeReturnTo(raw, ProfileController.profileDefaultReturnTo);
  }

  /**
   * Same allowlist, but an unusable value falls back to the Identities tab: that was the only
   * entry point to social connect before the mentorship forms embedded the dialog, and it's the
   * page that can show the identity the user just linked.
   */
  private normalizeSocialReturnTo(raw: unknown): string {
    return this.normalizeReturnTo(raw, '/profile/identities');
  }

  private normalizeReturnTo(raw: unknown, fallback: string): string {
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    try {
      // Accepts both relative paths and full URLs (e.g. req.headers['referer']).
      // Only pathname is used — host, query, and fragment are discarded.
      const { pathname } = new URL(raw, 'http://internal');
      return ProfileController.allowedProfileReturnPaths.has(pathname) ? pathname : fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Root callbacks (`/passwordless/callback`, `/social/callback`) sit outside the `/api`
   * error-handler mount, so a `next(err)` there would surface a bare JSON 403 in a top-level
   * navigation instead of a redirect — they can't reuse blockDuringImpersonation's next(err)
   * contract (impersonation-readonly.middleware.ts). This enforces the same read-only guarantee by
   * redirecting before any code exchange or token mint, matching the handlers' own
   * `?error=` convention. Returns true if the callback was blocked.
   */
  private blockCallbackDuringImpersonation(req: Request, res: Response, returnTo: string, operation: string): boolean {
    if (!isImpersonating(req)) return false;

    logger.warning(req, 'impersonation_readonly', 'Blocked auth callback during impersonation', {
      path: req.path,
      method: req.method,
      action: operation,
      outcome: 'blocked',
      impersonator_sub: req.appSession?.['impersonator']?.sub,
      target_sub: req.appSession?.['impersonationUser']?.sub,
    });
    res.redirect(`${returnTo}?error=impersonation_read_only`);
    return true;
  }

  /**
   * Reads the `sub` claim of a social id_token for the same-account check without logging its claims.
   * Plain JSON decoding — no signature verification — so callers must only use it on a token from
   * their own server-side code exchange, and never to authorize a write. Returns undefined unless
   * the token is a three-segment JWT whose payload is an object with a nonempty string `sub`.
   */
  private getIdTokenSubject(req: Request, idToken: string): string | undefined {
    try {
      const segments = idToken.split('.');
      if (segments.length !== 3 || !segments[1]) return undefined;

      const decoded: unknown = JSON.parse(Buffer.from(segments[1], 'base64url').toString());
      if (!decoded || typeof decoded !== 'object') return undefined;

      const { sub } = decoded as Record<string, unknown>;
      return typeof sub === 'string' && sub.length > 0 ? sub : undefined;
    } catch {
      logger.debug(req, 'social_auth_callback', 'Could not decode social id_token subject');
      return undefined;
    }
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
      case 'google-oauth2':
        return pd.email ?? null;
      case 'linkedin':
        // No name fallback: with type='email' on POST, persisting pd.name (a display name,
        // not an email) would corrupt CDP. Skip the identity if Auth0 didn't give us an email.
        return pd.email ?? null;
      default:
        return null;
    }
  }
}
