// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AUTH0_TO_CDP_PROVIDER_MAP,
  CDP_DISPLAYABLE_IDENTITY_COMBOS,
  CDP_PLATFORM_ICONS,
  CDP_PLATFORM_TO_TYPE_MAP,
  CDP_TO_AUTH0_PROVIDER_MAP,
  EMAIL_ALREADY_LINKED_MESSAGE,
  EMAIL_REGEX,
  PURCHASE_LINUX_URL,
} from '@lfx-one/shared/constants';
import {
  Auth0Identity,
  CdpIdentity,
  CdpWorkExperienceRequest,
  ClaimAliasRequest,
  CombinedProfile,
  DeveloperTokenInfo,
  EmailManagementData,
  EnrichedIdentity,
  IdentityDisplayState,
  LinuxAliasData,
  ProfileAuthStatus,
  ProfileUpdateRequest,
  UpdateForwardRequest,
  UserEmail,
  UserMetadata,
  UserMetadataUpdateRequest,
  UserProfile,
  WorkExperienceCreateUpdateBody,
} from '@lfx-one/shared/interfaces';
import { isIdentityAlreadyLinkedError } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getLinuxForwardDomain } from '../helpers/linux-forward.helper';
import { Auth0Service } from '../services/auth0.service';
import { CdpService } from '../services/cdp.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { EnrollmentService } from '../services/enrollment.service';
import { ForwardsService } from '../services/forwards.service';
import { logger } from '../services/logger.service';
import { ProfileAuthService } from '../services/profile-auth.service';
import { SocialVerificationService } from '../services/social-verification.service';
import { UserService } from '../services/user.service';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, getUsernameFromAuth, isImpersonating } from '../utils/auth-helper';
import { generateM2MToken } from '../utils/m2m-token.util';

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
  private static readonly allowedProfileReturnPaths: ReadonlySet<string> = new Set([
    '/profile',
    '/profile/emails',
    '/profile/identities',
    '/profile/password',
    '/profile/linux-email',
    '/profile/settings',
    '/settings',
  ]);

  private auth0Service: Auth0Service = new Auth0Service();
  private cdpService: CdpService = new CdpService();
  private emailVerificationService: EmailVerificationService = new EmailVerificationService();
  private enrollmentService: EnrollmentService = new EnrollmentService();
  private forwardsService: ForwardsService = new ForwardsService();
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

      // Construct UserProfile from token data. During impersonation, req.oidc.user is still the
      // impersonator, so identity/name fields must come from the effective (target) identity and
      // NATS metadata — never fall back to the impersonator's OIDC claims.
      const impersonating = isImpersonating(req);
      const userProfile: UserProfile = impersonating
        ? {
            // Never fall back to the impersonator's OIDC claims here — the effective helpers resolve
            // the target's identity from the impersonation session.
            id: (getEffectiveSub(req) || '') as string,
            email: (getEffectiveEmail(req) || '') as string,
            first_name: (natsUserData?.given_name || null) as string | null,
            last_name: (natsUserData?.family_name || null) as string | null,
            username: (getEffectiveUsername(req) || username) as string,
            // Use an explicit "unknown" ('') rather than a fabricated current time that would change
            // on every request. UserMetadata carries no created_at/updated_at, and these fields
            // aren't surfaced for the impersonated view.
            created_at: '',
            updated_at: '',
          }
        : {
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
        // Create appropriate error based on error type
        let error: unknown;

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
   * The :email param is the URL-encoded email address to make primary
   */
  public async setPrimaryEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    const emailAddress = req.params['emailId'] ?? '';
    const startTime = logger.startOperation(req, 'set_primary_email', { email: emailAddress });

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
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/emails')}`,
        });
        return;
      }

      const result = await this.emailVerificationService.setPrimaryEmail(req, authToken, emailAddress);

      if (!result.success) {
        return next(
          new MicroserviceError(result.message || 'Failed to set primary email', 502, 'BAD_GATEWAY', {
            operation: 'set_primary_email',
            service: 'profile_controller',
          })
        );
      }

      logger.success(req, 'set_primary_email', startTime, { email: emailAddress });

      res.status(200).json({ message: 'Primary email updated successfully' });
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

        // A claimed alias always has a forward target. If we had a management token but the read
        // still came back null, the forwards-service was unreachable (timeout/no-responder) — degrade
        // to service_unavailable (retry panel) rather than emitting a claimed state with a null
        // forward, which the client could misread and overwrite on Save.
        if (managementToken && forward === null) {
          logger.success(req, 'get_linux_alias', startTime, { state: 'service_unavailable' });
          res.json(this.linuxAliasState('service_unavailable', domain));
          return;
        }

        // A claimed alias always has a forward target, but reading it needs the Flow C
        // management token. When it's absent (and the flow is configured), tell the client
        // to re-authorize so it can load the real target instead of defaulting to primary.
        // Suppress the re-auth prompt during impersonation — it is a write-path the impersonator
        // must not trigger against their own session while viewing the target read-only.
        const forwardAuthRequired = !isImpersonating(req) && !managementToken && this.profileAuthService.isProfileAuthConfigured();

        logger.success(req, 'get_linux_alias', startTime, { state: 'claimed' });
        res.json({
          state: 'claimed',
          domain,
          alias,
          email,
          forwardTo: forward?.target_email ?? null,
          ...(forwardAuthRequired
            ? {
                forwardAuthRequired: true,
                authorizeUrl: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/linux-email')}`,
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
      res.json(this.linuxAliasState(state, domain));
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

      const claim = await this.emailVerificationService.addAlias(req, managementToken, alias, domain);
      if (!claim.success) {
        const { status, message } = this.mapAddAliasError(claim.error);
        res.status(status).json({ error: claim.error ?? 'add_alias_failed', message });
        return;
      }

      const email = claim.email ?? `${alias}@${domain}`;

      // forwards-service requires the same Management-API-audience token as add_alias.
      const forward = await this.forwardsService.setTarget(req, managementToken, forwardTo, domain);
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
      res.status(200).json({ state: 'claimed', domain, alias, email, forwardTo: forward.target_email ?? forwardTo } satisfies LinuxAliasData);
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

      const forward = await this.forwardsService.setTarget(req, managementToken, forwardTo, domain);
      if (!forward || forward.error) {
        return next(
          new MicroserviceError(forward?.error || 'Failed to update forwarding address', 502, 'FORWARD_SET_FAILED', {
            operation: 'update_linux_forward',
            service: 'profile_controller',
          })
        );
      }

      logger.success(req, 'update_linux_forward', startTime, { domain });
      res.status(200).json({ forwardTo: forward.target_email ?? forwardTo });
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

      // The v1 API Gateway token (audience api-gw.*) is minted by the auth middleware via
      // refresh-token exchange and stored on req.apiGatewayToken. Surface it alongside the v2
      // token so users migrating off the ID dashboard can keep calling v1 APIs. Only include the
      // key when present so the UI can hide the v1 row when the exchange produced nothing.
      const v1Token = req.apiGatewayToken;

      const tokenInfo: DeveloperTokenInfo = {
        token: bearerToken,
        type: 'Bearer',
        ...(v1Token ? { v1Token } : {}),
      };

      logger.success(req, 'get_developer_token_info', startTime, {
        user_id: userId,
        token_length: bearerToken.length,
        has_v1_token: Boolean(v1Token),
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
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/password')}`,
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
          authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/password')}`,
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
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_identities',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      // Extract username from sub by removing provider prefix (e.g., "auth0|fghiasy" → "fghiasy").
      // During impersonation these resolve to the target user so CDP/auth-service reads return the
      // target's identities.
      const lfid = this.resolveEffectiveLfid(req, sub);
      const auth0Sub = (isImpersonating(req) ? getEffectiveSub(req) : req.oidc?.user?.['sub']) as string;

      // Fetch CDP identities and auth-service identities in parallel
      const [cdpIdentities, auth0Identities] = await Promise.all([
        this.cdpService.getIdentitiesForUser(req, lfid),
        auth0Sub ? this.auth0Service.getUserIdentities(req, auth0Sub) : Promise.resolve([]),
      ]);

      logger.debug(req, 'get_identities', 'Raw identity data before reconciliation', {
        cdp_identities: cdpIdentities,
        auth_service_identities: auth0Identities,
      });

      // Reconcile CDP identities with auth-service identities and filter to the
      // (platform, type) combos LFX One can surface for verification via Auth0. During impersonation
      // the read is preserved but CDP writes (auto-verify + synthetic-identity creation) are skipped —
      // an impersonator must never mutate the target's CDP records.
      const { enriched, cdpPostsQueued } = this.reconcileIdentities(req, cdpIdentities, auth0Identities, lfid);
      const displayIdentities = enriched.filter((id) => CDP_DISPLAYABLE_IDENTITY_COMBOS.has(`${id.platform}+${id.type}`));

      logger.success(req, 'get_identities', startTime, {
        lfid,
        cdp_count: cdpIdentities.length,
        auth_service_count: auth0Identities.length,
        display_count: displayIdentities.length,
        hidden_count: enriched.filter((i) => i.displayState === 'hidden').length,
        cdp_posts_queued: cdpPostsQueued,
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
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_work_experiences',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const lfid = this.resolveEffectiveLfid(req, sub);

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
      const sub = await getUsernameFromAuth(req);

      if (!sub) {
        const validationError = ServiceValidationError.forField('user_id', 'User authentication required', {
          operation: 'get_project_affiliations',
          service: 'profile_controller',
          path: req.path,
        });

        return next(validationError);
      }

      const lfid = this.resolveEffectiveLfid(req, sub);

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

      const lfid = this.resolveEffectiveLfid(req, sub);

      // If provider and auth0UserId are provided, attempt to unlink from Auth0 via NATS
      const { provider, auth0UserId } = req.body || {};
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
      } else {
        await this.cdpService.rejectIdentityForUser(req, lfid, identityId);
      }

      logger.success(req, 'reject_identity', startTime, { lfid, identity_id: identityId });
      res.json({ success: true });
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

      const lfid = this.resolveEffectiveLfid(req, sub);

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

      const lfid = this.resolveEffectiveLfid(req, sub);

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

      const lfid = this.resolveEffectiveLfid(req, sub);

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

      const lfid = this.resolveEffectiveLfid(req, sub);

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

      const lfid = this.resolveEffectiveLfid(req, sub);

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
  public async startProfileAuth(req: Request, res: Response): Promise<void> {
    const startTime = logger.startOperation(req, 'profile_auth_start');

    const returnTo = this.normalizeProfileReturnTo(req.query['returnTo']);

    if (!this.profileAuthService.isProfileAuthConfigured()) {
      logger.warning(req, 'profile_auth_start', 'Profile auth not configured', {});
      res.redirect(`${returnTo}?error=profile_auth_not_configured`);
      return;
    }
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
    const returnTo = this.normalizeProfileReturnTo(req.appSession?.['profileAuthReturnTo']);

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
                const lfid = this.resolveEffectiveLfid(req, currentUserSub);

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
            err,
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
   * GET /api/profile/identities/social/connect?provider=github|google|linkedin
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
      const currentUserSub = req.oidc?.user?.['sub'] as string;
      const lfid = this.resolveEffectiveLfid(req, currentUserSub);

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

      const response = await this.emailVerificationService.sendVerificationCode(req, email);

      if (response.success) {
        logger.success(req, 'send_email_verification', startTime, { email });
        res.json({ success: true, message: response.message || 'Verification code sent' });
      } else {
        logger.debug(req, 'send_email_verification', 'Verification response on failure', {
          response_keys: Object.keys(response),
          error: response.error,
          message: response.message,
        });

        if (isIdentityAlreadyLinkedError(response.error, response.message)) {
          // Upstream auth-service emits the "already linked" error without identifying the
          // owning account, so resolve it here via EMAIL_TO_USERNAME → EMAIL_TO_SUB lookups.
          // The resolved account is logged for support/debugging only — never returned to the
          // client, so we don't expose another user's LFID.
          const linkedTo =
            (await this.emailVerificationService.resolveEmailToUsername(req, email)) || (await this.emailVerificationService.resolveEmailToSub(req, email));

          logger.warning(req, 'send_email_verification', 'Email already linked to another account', {
            email,
            linked_to: linkedTo,
          });

          res.status(409).json({ success: false, error: response.error, message: EMAIL_ALREADY_LINKED_MESSAGE });
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
            authorize_url: `/api/profile/auth/start?returnTo=${encodeURIComponent((req.headers['referer'] as string) || '/profile/emails')}`,
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

      // Step 4: Fire-and-forget CDP identity verification
      const lfid = this.resolveEffectiveLfid(req, sub);

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
   * Resolves the effective LFID for CDP/auth-service reads. During impersonation this is the target
   * user's username (from the impersonation session); otherwise it mirrors the pre-existing
   * derivation (OIDC username/preferred_username, falling back to the prefix-stripped sub).
   */
  private resolveEffectiveLfid(req: Request, sub: string): string {
    const subUsername = sub?.includes('|') ? sub.split('|')[1] : sub;
    if (isImpersonating(req)) {
      return (getEffectiveUsername(req) || subUsername) as string;
    }
    return (req.oidc?.user?.['username'] || req.oidc?.user?.['preferred_username'] || subUsername) as string;
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
   * 4. In CDP but NOT in auth-service, multi-LFID + verifiedBy=lfxOne → HIDDEN
   * 5. In CDP but NOT in auth-service (all other) → UNVERIFIED
   */
  private reconcileIdentities(
    req: Request,
    cdpIdentities: CdpIdentity[],
    authServiceIdentities: Auth0Identity[],
    lfid: string
  ): { enriched: EnrichedIdentity[]; cdpPostsQueued: number } {
    // Under impersonation, produce the read-only enriched list without any CDP mutation: no
    // auto-verify, no synthetic-identity creation. Derived here (not a caller-supplied flag) so a
    // future call site can't accidentally re-enable CDP writes against the target's records. The
    // returned identities are unchanged either way.
    const skipCdpMutations = isImpersonating(req);

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
      // Google OAuth creates email-type CDP entries — cross-match CDP email entries against Google auth identities
      const authIdentity = authServiceMap.get(authKey) ?? (cdp.platform === 'email' ? authServiceMap.get(`google:${cdp.value}`) : undefined);

      const inAuthService = !!authIdentity;

      if (inAuthService) {
        matchedAuthKeys.add(authKey);
        // Also mark the Google auth key as matched to prevent duplicate synthetic entries
        if (cdp.platform === 'email' && authIdentity?.provider === 'google-oauth2') {
          matchedAuthKeys.add(`google:${cdp.value}`);
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
      const isCdpVerifiedWithOwner = cdp.verified && !!cdp.verifiedBy;
      let displayState: IdentityDisplayState;

      if (!CDP_DISPLAYABLE_IDENTITY_COMBOS.has(`${cdp.platform}+${cdp.type}`)) {
        // Combo not surfaceable via Auth0 (e.g. linkedin+username, gitlab+username) —
        // we have no way to help the user verify it, so hide.
        displayState = 'hidden';
      } else if (isCdpVerifiedWithOwner && hasMultiLfid) {
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

      const authKey = `${cdpPlatform}:${value}`;
      if (matchedAuthKeys.has(authKey)) {
        continue;
      }

      const type = CDP_PLATFORM_TO_TYPE_MAP[cdpPlatform] ?? 'username';

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
        (postedCustomEmails.has(value) || enriched.some((id) => id.platform === 'email' && id.value === value && id.verified && id.verifiedBy === lfid));

      // Skip the CDP create entirely when read-only (impersonation) — the synthetic display entry
      // below is still produced, so the impersonator sees the identity without any CDP mutation.
      if (!skipCdpMutations && !wouldDuplicateCustomEmail) {
        cdpPostsQueued++;
        if (cdpPostPlatform === 'custom') {
          postedCustomEmails.add(value);
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

    return { enriched, cdpPostsQueued };
  }

  /** Build a LinuxAliasData for a non-claimed state (no alias/forward yet). */
  private linuxAliasState(state: 'not_purchased' | 'purchased_unclaimed' | 'service_unavailable', domain: string): LinuxAliasData {
    return {
      state,
      domain,
      alias: null,
      email: null,
      forwardTo: null,
      ...(state === 'not_purchased' ? { purchaseUrl: PURCHASE_LINUX_URL } : {}),
    };
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
    const DEFAULT = '/profile';
    if (typeof raw !== 'string' || raw.length === 0) return DEFAULT;
    try {
      // Accepts both relative paths and full URLs (e.g. req.headers['referer']).
      // Only pathname is used — host, query, and fragment are discarded.
      const { pathname } = new URL(raw, 'http://internal');
      return ProfileController.allowedProfileReturnPaths.has(pathname) ? pathname : DEFAULT;
    } catch {
      return DEFAULT;
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
