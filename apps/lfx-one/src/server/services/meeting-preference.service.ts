// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { MeetingInviteEmail } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { logger } from './logger.service';
import { NatsService } from './nats.service';

/**
 * Service for the user's preferred meeting-invitation email, backed by the meeting-service
 * via NATS (subjects `lfx.meeting-service.preferred_email.{get,set}`).
 *
 * Unlike the auth-service email subjects, the meeting-service RPC carries the user's v1
 * API-gateway token in the `token` field of the payload (the service forwards it as a Bearer
 * token to v1 /v1/me). The reply is the selected email directly (`{ email_id, email }`), with
 * both fields null when the user has no override (meeting invitations fall back to primary),
 * or `{ error }` on failure.
 */
export class MeetingPreferenceService {
  private natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  /**
   * Fetch the user's preferred meeting-invitation email.
   * @param req - Express request object for logging
   * @param v1Token - The user's v1 API-gateway token (req.apiGatewayToken)
   * @returns The preferred email (null fields = using primary), or null on failure
   */
  public async getMeetingInviteEmail(req: Request, v1Token: string): Promise<MeetingInviteEmail | null> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'get_meeting_invite_email', 'Fetching preferred meeting-invite email via NATS');

    try {
      const payload = JSON.stringify({ token: v1Token });
      const response = await this.natsService.request(NatsSubjects.MEETING_PREFERRED_EMAIL_GET, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const parsed = JSON.parse(codec.decode(response.data));

      if (parsed.error) {
        logger.warning(req, 'get_meeting_invite_email', 'NATS preferred_email.get returned an error', {
          error: parsed.error,
        });
        return null;
      }

      return { email_id: parsed.email_id ?? null, email: parsed.email ?? null };
    } catch (error) {
      logger.warning(req, 'get_meeting_invite_email', 'Failed to fetch preferred meeting-invite email via NATS', {
        err: error,
      });
      return null;
    }
  }

  /**
   * Set the user's preferred meeting-invitation email.
   * @param req - Express request object for logging
   * @param v1Token - The user's v1 API-gateway token (req.apiGatewayToken)
   * @param email - The verified email address to receive meeting invitations
   * @returns Result with the updated preference on success, or an error message on failure
   */
  public async setMeetingInviteEmail(
    req: Request,
    v1Token: string,
    email: string
  ): Promise<{ success: boolean; data?: MeetingInviteEmail; message?: string; error?: string }> {
    const codec = this.natsService.getCodec();

    logger.debug(req, 'set_meeting_invite_email', 'Setting preferred meeting-invite email via NATS', { email });

    try {
      const payload = JSON.stringify({ token: v1Token, email });
      const response = await this.natsService.request(NatsSubjects.MEETING_PREFERRED_EMAIL_SET, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const parsed = JSON.parse(codec.decode(response.data));

      if (parsed.error) {
        logger.warning(req, 'set_meeting_invite_email', 'NATS preferred_email.set returned an error', {
          email,
          error: parsed.error,
        });
        return { success: false, error: parsed.error, message: 'Failed to update meeting invitation email. Please try again.' };
      }

      return { success: true, data: { email_id: parsed.email_id ?? null, email: parsed.email ?? null } };
    } catch (error) {
      logger.warning(req, 'set_meeting_invite_email', 'NATS set meeting-invite email failed', {
        email,
        err: error,
      });

      if (error instanceof Error && (error.message.includes('timeout') || error.message.includes('503'))) {
        return {
          success: false,
          error: 'Service temporarily unavailable',
          message: 'Unable to reach the meeting service. Please try again later.',
        };
      }

      return {
        success: false,
        error: 'Internal server error',
        message: 'Failed to update meeting invitation email. Please try again.',
      };
    }
  }
}
