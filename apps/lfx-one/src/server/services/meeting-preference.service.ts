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

      let parsed;
      try {
        parsed = JSON.parse(codec.decode(response.data));
      } catch {
        // JSON.parse's error message can embed a snippet of the malformed input (e.g. a bare
        // email address) — log only that parsing failed, never the raw error.
        logger.warning(req, 'get_meeting_invite_email', 'NATS preferred_email.get reply failed to parse as JSON');
        return null;
      }

      const getError = this.extractUpstreamError(parsed);
      if (getError !== null) {
        // Upstream error copy can embed the mailbox (e.g. validation messages) — redact before
        // it reaches the WARN log, which persists in production.
        logger.warning(req, 'get_meeting_invite_email', 'NATS preferred_email.get returned an error', {
          error: redactEmailAddresses(getError),
        });
        return null;
      }

      if (!this.isValidMeetingInviteReply(parsed)) {
        // A contract-breaking reply (missing/malformed fields) must not be read as a confirmed
        // "no override" — that would silently re-enable Remove on the actual invite-email identity.
        logger.warning(req, 'get_meeting_invite_email', 'NATS preferred_email.get returned an unexpected shape', {
          keys: Object.keys(parsed ?? {}),
        });
        return null;
      }

      return { email_id: parsed.email_id, email: parsed.email };
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

    // A rejected NATS request (timeout, no responder, connection refused, ...) is always a
    // transport failure — retryable. A resolved reply that fails to decode/parse, or has the
    // wrong shape, is an upstream contract failure instead, so it's kept in its own try/catch
    // rather than folded into the transport one, which would mislabel it as retryable.
    let response: { data: Uint8Array };
    try {
      const payload = JSON.stringify({ token: v1Token, email });
      // Outlast the responder's own 15s deadline. Giving up first would surface a 503 while the
      // mutation still completes upstream, leaving the preference changed behind an error message.
      response = await this.natsService.request(NatsSubjects.MEETING_PREFERRED_EMAIL_SET, codec.encode(payload), {
        timeout: NATS_CONFIG.MEETING_PREFERENCE_SET_TIMEOUT,
      });
    } catch (error) {
      // Warning-level logs are emitted in production; omit the raw email to avoid persisting PII.
      logger.warning(req, 'set_meeting_invite_email', 'NATS set meeting-invite email failed', {
        err: error,
      });
      return { success: false, reason: 'unavailable', error: 'Service temporarily unavailable' };
    }

    let parsed;
    try {
      parsed = JSON.parse(codec.decode(response.data));
    } catch {
      // Same PII guard as the GET path — JSON.parse's error message can embed a snippet of the
      // malformed input, so log only that parsing failed, never the raw error.
      logger.warning(req, 'set_meeting_invite_email', 'NATS preferred_email.set reply failed to parse as JSON');
      return { success: false, reason: 'upstream', error: 'Internal server error' };
    }

    const setError = this.extractUpstreamError(parsed);
    if (setError !== null) {
      // Warning-level logs are emitted in production; redact the address the validation copy
      // can embed rather than persisting it as PII. The returned `error` stays raw — the
      // controller substitutes fixed user-facing copy per `reason`, so nothing leaks to the client.
      logger.warning(req, 'set_meeting_invite_email', 'NATS preferred_email.set returned an error', {
        error: redactEmailAddresses(setError),
      });
      return { success: false, reason: this.classifyPreferredEmailError(setError), error: setError };
    }

    if (!this.isValidMeetingInviteReply(parsed)) {
      // Same contract-break guard as the GET path — a malformed success reply must fail rather
      // than silently confirm the write with a fabricated "no override" result.
      logger.warning(req, 'set_meeting_invite_email', 'NATS preferred_email.set returned an unexpected shape', {
        keys: Object.keys(parsed ?? {}),
      });
      return { success: false, reason: 'upstream', error: 'Internal server error' };
    }

    return { success: true, data: { email_id: parsed.email_id, email: parsed.email } };
  }

  // A reply is only `{ error }` when it's a non-null object whose `error` is itself a string —
  // valid JSON can also decode to null, a primitive, or `{ error: <non-string> }`, and accessing
  // `.error` on the former or handing the latter to the string-only redactor would throw, turning
  // a handled contract failure into an uncaught exception. Anything that doesn't match falls
  // through to the shape-validation branch below instead.
  private extractUpstreamError(value: unknown): string | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const { error } = value as Record<string, unknown>;
    return typeof error === 'string' ? error : null;
  }

  // The upstream contract always emits both keys as strings (an override) or both as null (no
  // override) on a non-error reply. Anything else — a missing key, a wrong type, or a mixed
  // null/string pair — is a contract break, not a valid "no override": callers must fail rather
  // than default the field to null themselves.
  private isValidMeetingInviteReply(value: unknown): value is MeetingInviteEmail {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const { email_id, email } = value as Record<string, unknown>;
    if (email_id === null && email === null) {
      return true;
    }
    return typeof email_id === 'string' && typeof email === 'string';
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
