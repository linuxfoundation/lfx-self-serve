// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { MeetingInviteEmail, SetMeetingInviteResult } from '@lfx-one/shared/interfaces';
import { isMeetingInvitePrimarySentinel, redactEmailAddresses } from '@lfx-one/shared/utils';
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
        // Upstream error copy can embed the mailbox (e.g. validation messages) — redact before
        // it reaches the WARN log, which persists in production.
        logger.warning(req, 'get_meeting_invite_email', 'NATS preferred_email.get returned an error', {
          error: redactEmailAddresses(parsed.error),
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
   * @param email - The verified email address to receive meeting invitations, or
   *   MEETING_INVITE_PRIMARY_SENTINEL to clear the override so invitations follow the primary email
   * @returns Result with the updated preference on success, or an error message on failure
   */
  public async setMeetingInviteEmail(req: Request, v1Token: string, email: string): Promise<SetMeetingInviteResult> {
    const codec = this.natsService.getCodec();

    // `email` is PII and `data.email` is not covered by the Pino redact paths — log the shape of
    // the request (reset vs. explicit selection) rather than the address itself.
    logger.debug(req, 'set_meeting_invite_email', 'Setting preferred meeting-invite email via NATS', {
      is_reset: isMeetingInvitePrimarySentinel(email),
    });

    try {
      const payload = JSON.stringify({ token: v1Token, email });
      // Outlast the responder's own 15s deadline. Giving up first would surface a 503 while the
      // mutation still completes upstream, leaving the preference changed behind an error message.
      const response = await this.natsService.request(NatsSubjects.MEETING_PREFERRED_EMAIL_SET, codec.encode(payload), {
        timeout: NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT,
      });

      const parsed = JSON.parse(codec.decode(response.data));

      if (parsed.error) {
        // Warning-level logs are emitted in production; redact the address the validation copy
        // can embed rather than persisting it as PII. The returned `error` stays raw — the
        // controller substitutes fixed user-facing copy per `reason`, so nothing leaks to the client.
        logger.warning(req, 'set_meeting_invite_email', 'NATS preferred_email.set returned an error', {
          error: redactEmailAddresses(parsed.error),
        });
        return { success: false, reason: this.classifyPreferredEmailError(parsed.error), error: parsed.error };
      }

      return { success: true, data: { email_id: parsed.email_id ?? null, email: parsed.email ?? null } };
    } catch (error) {
      // Warning-level logs are emitted in production; omit the raw email to avoid persisting PII.
      logger.warning(req, 'set_meeting_invite_email', 'NATS set meeting-invite email failed', {
        err: error,
      });

      // The installed NATS 2.x client reports a request expiry as a NatsError with an uppercase
      // `code`/`message` of "TIMEOUT" — check both, case-insensitively, so a real timeout isn't
      // misclassified as `upstream` (502) instead of the intended retryable `unavailable` (503).
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
      if (code === 'TIMEOUT' || message.includes('timeout') || message.includes('503')) {
        return { success: false, reason: 'unavailable', error: 'Service temporarily unavailable' };
      }

      return { success: false, reason: 'upstream', error: 'Internal server error' };
    }
  }

  // Classify the upstream error string (the NATS reply carries only `{ error }`, no code) so the
  // controller can map it to an HTTP status: validation → 4xx, sync_pending/unavailable → 503,
  // anything else → 502.
  private classifyPreferredEmailError(error: string): SetMeetingInviteResult['reason'] {
    const normalized = error.toLowerCase();
    if (normalized.includes('not an active, verified address')) {
      return 'validation';
    }
    if (normalized.includes('not yet available') || normalized.includes('retry')) {
      return 'sync_pending';
    }
    // The meeting-service's user-service client maps network failures and HTTP 429/502/503/504 to
    // a retryable error, but the NATS envelope only carries `err.Error()` — no error-type field —
    // so recognize its known message shapes here rather than misclassifying them as `upstream`.
    if (normalized.includes('user-service request failed') || /\bhttp (429|502|503|504)\b/.test(normalized)) {
      return 'unavailable';
    }
    return 'upstream';
  }
}
