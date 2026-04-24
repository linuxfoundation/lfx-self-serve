// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  Auth0Identity,
  EmailManagementData,
  LinkIdentityNatsResponse,
  ListIdentitiesNatsResponse,
  ResetPasswordLinkNatsResponse,
  SendEmailVerificationResponse,
  UnlinkIdentityNatsResponse,
  VerifyEmailOtpNatsResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { NatsService } from './nats.service';

/**
 * Service for email identity verification via NATS
 * Handles the 3-step flow: send verification code → verify OTP → link identity
 */
export class EmailVerificationService {
  private natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  /**
   * Send a verification code to an email address
   * @param req - Express request object for logging
   * @param email - Email address to send the code to
   * @returns Response indicating success or failure
   */
  public async sendVerificationCode(req: Request, email: string): Promise<SendEmailVerificationResponse> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'send_email_verification_code', 'Sending verification code via NATS', { email });

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_SEND_VERIFICATION, codec.encode(email), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed: SendEmailVerificationResponse = JSON.parse(responseText);

      logger.debug(req, 'send_email_verification_code', 'Full NATS send-code response', {
        raw_response: responseText,
        parsed_keys: Object.keys(parsed),
        parsed_response: parsed,
      });

      return parsed;
    } catch (error) {
      logger.warning(req, 'send_email_verification_code', 'NATS send verification code failed', {
        email,
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the email verification service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to send verification code. Please try again.',
      };
    }
  }

  /**
   * Verify an OTP code for an email address
   * @param req - Express request object for logging
   * @param email - Email address being verified
   * @param otp - The OTP code to verify
   * @returns Response with identity token on success
   */
  public async verifyOtp(req: Request, email: string, otp: string): Promise<VerifyEmailOtpNatsResponse> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'verify_email_otp', 'Verifying email OTP via NATS', { email });

    try {
      const payload = JSON.stringify({ email, otp });
      const response = await this.natsService.request(NatsSubjects.EMAIL_VERIFY_OTP, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed: VerifyEmailOtpNatsResponse = JSON.parse(responseText);

      logger.debug(req, 'verify_email_otp', 'Received OTP verification response', {
        success: parsed.success,
        has_token: !!parsed.data?.id_token,
        error: parsed.error,
        message: parsed.message,
        response_keys: Object.keys(parsed),
        data_keys: parsed.data ? Object.keys(parsed.data) : [],
      });

      return parsed;
    } catch (error) {
      logger.warning(req, 'verify_email_otp', 'NATS verify OTP failed', {
        email,
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the verification service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to verify code. Please try again.',
      };
    }
  }

  /**
   * Resolve an email address to the username that owns it
   * @param req - Express request object for logging
   * @param email - Email address to look up
   * @returns Username string or null if not found
   */
  public async resolveEmailToUsername(req: Request, email: string): Promise<string | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'resolve_email_to_username', 'Looking up username for email', { email });

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_USERNAME, codec.encode(email), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);

      if (!responseText || responseText === 'null' || responseText === '""') {
        logger.warning(req, 'resolve_email_to_username', 'No username found for email', { email });
        return null;
      }

      // Try parsing as JSON — error responses come as {"success":false,"error":"..."}
      try {
        const parsed = JSON.parse(responseText);
        if (typeof parsed === 'object' && parsed !== null && (parsed.success === false || parsed.error)) {
          logger.warning(req, 'resolve_email_to_username', 'Email lookup returned error', {
            email,
            error: parsed.error,
          });
          return null;
        }
        // JSON-encoded string like "\"john.doe\""
        if (typeof parsed === 'string') {
          logger.debug(req, 'resolve_email_to_username', 'Resolved email to username', { email, username: parsed });
          return parsed;
        }
      } catch {
        // Not JSON — treat raw text as the username (success case)
      }

      logger.debug(req, 'resolve_email_to_username', 'Resolved email to username', { email, username: responseText });
      return responseText;
    } catch (error) {
      logger.warning(req, 'resolve_email_to_username', 'Failed to resolve email to username', {
        email,
        err: error,
      });
      return null;
    }
  }

  /**
   * Resolve an email address to the auth0 sub that owns it (fallback for resolveEmailToUsername)
   * Uses EMAIL_TO_SUB NATS subject which has a different handler that may succeed when EMAIL_TO_USERNAME fails
   * @param req - Express request object for logging
   * @param email - Email address to look up
   * @returns Sub string or null if not found
   */
  public async resolveEmailToSub(req: Request, email: string): Promise<string | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'resolve_email_to_sub', 'Looking up sub for email (fallback)', { email });

    try {
      const response = await this.natsService.request(NatsSubjects.EMAIL_TO_SUB, codec.encode(email), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);

      if (!responseText || responseText === 'null' || responseText === '""') {
        logger.warning(req, 'resolve_email_to_sub', 'No sub found for email', { email });
        return null;
      }

      // Try parsing as JSON — error responses come as {"success":false,"error":"..."}
      try {
        const parsed = JSON.parse(responseText);
        if (typeof parsed === 'object' && parsed !== null && (parsed.success === false || parsed.error)) {
          logger.warning(req, 'resolve_email_to_sub', 'Email-to-sub lookup returned error', {
            email,
            error: parsed.error,
          });
          return null;
        }
        // JSON-encoded string like "\"auth0|abc123\""
        if (typeof parsed === 'string') {
          logger.debug(req, 'resolve_email_to_sub', 'Resolved email to sub', { email, sub: parsed });
          return parsed;
        }
      } catch {
        // Not JSON — treat raw text as the sub (success case)
      }

      logger.debug(req, 'resolve_email_to_sub', 'Resolved email to sub', { email, sub: responseText });
      return responseText;
    } catch (error) {
      logger.warning(req, 'resolve_email_to_sub', 'Failed to resolve email to sub', {
        email,
        err: error,
      });
      return null;
    }
  }

  /**
   * Link an identity to a user account
   * @param req - Express request object for logging
   * @param authToken - Management token with update:current_user_identities scope
   * @param identityToken - Identity token from OTP verification
   * @returns Response indicating success or failure
   */
  public async linkIdentity(req: Request, authToken: string, identityToken: string): Promise<LinkIdentityNatsResponse> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'link_identity', 'Linking identity via NATS');

    try {
      const payload = JSON.stringify({
        user: { auth_token: authToken },
        link_with: { identity_token: identityToken },
      });

      const response = await this.natsService.request(NatsSubjects.USER_IDENTITY_LINK, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed: LinkIdentityNatsResponse = JSON.parse(responseText);

      logger.debug(req, 'link_identity', 'Full NATS link-identity response', {
        raw_response: responseText,
        parsed_keys: Object.keys(parsed),
        parsed_response: parsed,
      });

      return parsed;
    } catch (error) {
      logger.warning(req, 'link_identity', 'NATS link identity failed', {
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the identity linking service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to link identity. Please try again.',
      };
    }
  }

  /**
   * Get all emails for the authenticated user from auth-service
   * @param req - Express request object for logging
   * @param userIdentifier - User's subject ID (e.g. auth0|123456789), username, or email — sent as raw string to auth-service which resolves it without JWT audience validation
   * @returns Primary email and list of alternate emails
   */
  public async getUserEmails(req: Request, userIdentifier: string): Promise<EmailManagementData | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'get_user_emails', 'Fetching user emails via NATS');

    try {
      const payload = JSON.stringify({ user: { auth_token: userIdentifier } });
      const response = await this.natsService.request(NatsSubjects.USER_EMAILS_READ, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed = JSON.parse(responseText);

      if (!parsed.success || !parsed.data) {
        logger.warning(req, 'get_user_emails', 'NATS user_emails.read returned unsuccessful', {
          error: parsed.error,
          message: parsed.message,
        });
        return null;
      }

      logger.debug(req, 'get_user_emails', 'Fetched user emails', {
        alternate_count: parsed.data.alternate_emails?.length ?? 0,
      });

      return parsed.data as EmailManagementData;
    } catch (error) {
      logger.warning(req, 'get_user_emails', 'Failed to fetch user emails via NATS', {
        err: error,
      });
      return null;
    }
  }

  /**
   * Set an alternate email as the primary email for the user
   * @param req - Express request object for logging
   * @param authToken - Management token with sufficient scope (Flow C or M2M)
   * @param email - The email address to make primary
   * @returns Response indicating success or failure
   */
  public async setPrimaryEmail(req: Request, authToken: string, email: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'set_primary_email', 'Setting primary email via NATS', { email });

    try {
      const payload = JSON.stringify({ user: { auth_token: authToken }, email });
      const response = await this.natsService.request(NatsSubjects.USER_EMAILS_SET_PRIMARY, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed = JSON.parse(responseText);

      logger.debug(req, 'set_primary_email', 'NATS set_primary_email response', {
        success: parsed.success,
        error: parsed.error,
      });

      return parsed;
    } catch (error) {
      logger.warning(req, 'set_primary_email', 'NATS set primary email failed', {
        email,
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the email service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to update primary email. Please try again.',
      };
    }
  }

  /**
   * Unlink an identity from a user account
   * @param req - Express request object for logging
   * @param authToken - Management token with update:current_user_identities scope
   * @param provider - Identity provider (e.g., 'github', 'linkedin')
   * @param identityId - The provider-specific user ID to unlink
   * @returns Response indicating success or failure
   */
  public async unlinkIdentity(req: Request, authToken: string, provider: string, identityId: string): Promise<UnlinkIdentityNatsResponse> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'unlink_identity', 'Unlinking identity via NATS', { provider, identity_id: identityId });

    try {
      const payload = JSON.stringify({
        user: { auth_token: authToken },
        unlink: { provider, identity_id: identityId },
      });

      const response = await this.natsService.request(NatsSubjects.USER_IDENTITY_UNLINK, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed: UnlinkIdentityNatsResponse = JSON.parse(responseText);

      logger.debug(req, 'unlink_identity', 'Full NATS unlink-identity response', {
        raw_response: responseText,
        parsed_keys: Object.keys(parsed),
        parsed_response: parsed,
      });

      return parsed;
    } catch (error) {
      logger.warning(req, 'unlink_identity', 'NATS unlink identity failed', {
        provider,
        identity_id: identityId,
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the identity unlinking service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to unlink identity. Please try again.',
      };
    }
  }

  /**
   * Send a password reset link via auth-service NATS
   * @param req - Express request object for logging
   * @param managementToken - Flow C management token (must carry update:current_user_metadata scope)
   */
  public async sendPasswordResetLink(req: Request, managementToken: string): Promise<ResetPasswordLinkNatsResponse> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'send_password_reset_link', 'Requesting password reset link via NATS');

    try {
      const payload = JSON.stringify({ token: managementToken });

      const response = await this.natsService.request(NatsSubjects.PASSWORD_RESET_LINK, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const parsed: ResetPasswordLinkNatsResponse = JSON.parse(codec.decode(response.data));
      return parsed;
    } catch (error) {
      logger.warning(req, 'send_password_reset_link', 'NATS send password reset link failed', {
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the password reset service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to send password reset email. Please try again.',
      };
    }
  }

  /**
   * Change the user's password via auth-service NATS
   * @param req - Express request object for logging
   * @param managementToken - Flow C management token (must carry update:current_user_metadata scope)
   * @param currentPassword - The user's current password
   * @param newPassword - The desired new password
   */
  public async changePassword(
    req: Request,
    managementToken: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'change_password', 'Changing password via NATS');

    try {
      const payload = JSON.stringify({ token: managementToken, current_password: currentPassword, new_password: newPassword });
      const response = await this.natsService.request(NatsSubjects.PASSWORD_UPDATE, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const parsed = JSON.parse(codec.decode(response.data));
      return parsed;
    } catch (error) {
      logger.warning(req, 'change_password', 'NATS change password failed', {
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return { success: false, error: 'Service temporarily unavailable', message: 'Unable to reach the password service. Please try again later.' };
      }

      return { success: false, error: 'Internal server error', message: 'Failed to change password. Please try again.' };
    }
  }

  /**
   * Non-throwing variant for callers that can degrade gracefully (e.g. email backfill).
   * Returns an empty array on failure. Use listIdentities() when identity data is critical.
   */
  public async listIdentitiesSafe(req: Request, userIdentifier: string): Promise<Auth0Identity[]> {
    try {
      return await this.listIdentities(req, userIdentifier);
    } catch (error) {
      logger.warning(req, 'list_identities_safe', 'Identity list unavailable — continuing without it', { err: error });
      return [];
    }
  }

  /**
   * List linked identities for a user via NATS.
   * @param req - Express request object for logging
   * @param userIdentifier - User's subject ID (e.g. auth0|123456789), username, or email — sent as raw string to auth-service which resolves it without JWT audience validation (same convention as getUserEmails)
   * @returns Array of Auth0 linked identities
   * @throws {MicroserviceError} 503 when the auth service is unavailable
   */
  public async listIdentities(req: Request, userIdentifier: string): Promise<Auth0Identity[]> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'list_identities', 'Listing user identities via NATS');

    let parsed: ListIdentitiesNatsResponse;
    try {
      const payload = JSON.stringify({ user: { auth_token: userIdentifier } });
      const response = await this.natsService.request(NatsSubjects.USER_IDENTITY_LIST, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });
      const responseText = codec.decode(response.data);
      parsed = JSON.parse(responseText);

      logger.debug(req, 'list_identities', 'Raw NATS USER_IDENTITY_LIST response', {
        raw_response: responseText,
        parsed_success: parsed.success,
        parsed_data: parsed.data,
        parsed_error: parsed.error,
      });
    } catch (error) {
      logger.warning(req, 'list_identities', 'Failed to list identities via NATS', { err: error });
      throw this.authServiceUnavailable('list_identities');
    }

    if (!parsed.success || !parsed.data) {
      logger.warning(req, 'list_identities', 'NATS identity list returned unsuccessful', {
        error: parsed.error,
        message: parsed.message,
      });
      throw this.authServiceUnavailable('list_identities');
    }

    logger.debug(req, 'list_identities', 'Fetched identities via NATS', { identity_count: parsed.data.length });
    return parsed.data;
  }

  private authServiceUnavailable(operation: string): MicroserviceError {
    return new MicroserviceError('Auth service temporarily unavailable', 503, 'AUTH_SERVICE_UNAVAILABLE', {
      operation,
      service: 'email_verification_service',
    });
  }
}
