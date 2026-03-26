// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import {
  Auth0Identity,
  LinkIdentityNatsResponse,
  ListIdentitiesNatsResponse,
  SendEmailVerificationResponse,
  UnlinkIdentityNatsResponse,
  VerifyEmailOtpNatsResponse,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

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
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
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
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
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
        error: error instanceof Error ? error.message : 'Unknown error',
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
        error: error instanceof Error ? error.message : 'Unknown error',
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
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
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
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  /**
   * List linked identities for a user via NATS
   * @param req - Express request object for logging
   * @param authToken - Management token or M2M token to identify the user
   * @returns Array of Auth0 linked identities
   */
  public async listIdentities(req: Request, authToken: string): Promise<Auth0Identity[]> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'list_identities', 'Listing user identities via NATS');

    try {
      const payload = JSON.stringify({
        user: { auth_token: authToken },
      });

      const response = await this.natsService.request(NatsSubjects.USER_IDENTITY_LIST, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const parsed: ListIdentitiesNatsResponse = JSON.parse(responseText);

      logger.info(req, 'list_identities', 'Raw NATS USER_IDENTITY_LIST response', {
        raw_response: responseText,
        parsed_success: parsed.success,
        parsed_data: parsed.data,
        parsed_error: parsed.error,
      });

      if (!parsed.success || !parsed.data) {
        logger.warning(req, 'list_identities', 'NATS identity list returned unsuccessful', {
          error: parsed.error,
          message: parsed.message,
        });
        return [];
      }

      logger.debug(req, 'list_identities', 'Fetched identities via NATS', {
        identity_count: parsed.data.length,
      });

      return parsed.data;
    } catch (error) {
      logger.warning(req, 'list_identities', 'Failed to list identities via NATS, returning empty array', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }
}
