// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { InviteTokenPayload, PendingCommitteeInviteForOrg } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';
import { errors as JoseErrors, JWK, JWT } from 'jose';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { logger } from '../services/logger.service';
import { CommitteeService } from '../services/committee.service';
import { NatsService } from '../services/nats.service';
import { getEffectiveEmail, getEffectiveUsername } from '../utils/auth-helper';

/** Delay before each legacy email-search attempt while waiting for FGA tuple propagation. */
const FGA_PROPAGATION_DELAY_MS = 3_000;
/** Total number of legacy email-search attempts (each preceded by FGA_PROPAGATION_DELAY_MS). */
const FGA_LEGACY_MAX_ATTEMPTS = 3;

/** Controller for non-LF user invite acceptance via signed JWT. */
export class InviteController {
  private readonly natsService = new NatsService();
  private readonly committeeService = new CommitteeService();

  /** POST /api/invite/accept — verify JWT (HS256), publish NATS fire-and-forget, return return_url. */
  public async acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'accept_invite');

    try {
      const { token } = req.body as { token?: unknown };

      if (!token || typeof token !== 'string') {
        return next(
          ServiceValidationError.forField('token', 'Invite token is required', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const jwtSecret = process.env['INVITE_SERVICE_JWT_SECRET'];
      if (!jwtSecret) {
        return next(new Error('INVITE_SERVICE_JWT_SECRET is not configured'));
      }

      let payload: InviteTokenPayload;
      try {
        payload = this.verifyInviteToken(token, jwtSecret);
      } catch (err) {
        if (err instanceof JoseErrors.JWTExpired) {
          return next(
            new AuthorizationError('Invite link has expired', {
              operation: 'accept_invite',
              service: 'invite_controller',
              path: req.path,
              code: 'INVITE_EXPIRED',
            })
          );
        }
        return next(
          ServiceValidationError.forField('token', 'Invite token is invalid', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      if (!payload.invite_uid || typeof payload.invite_uid !== 'string') {
        return next(
          ServiceValidationError.forField('token', 'Invite token is missing required claims', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const safeReturnUrl = this.validateReturnUrl(payload.return_url);
      if (!safeReturnUrl) {
        return next(
          ServiceValidationError.forField('return_url', 'Invite token contains an invalid return URL', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      const username = getEffectiveUsername(req);
      if (!username) {
        return next(
          new AuthorizationError('Could not determine username from session', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

      // Accept committee invite before publishing INVITE_ACCEPTED — if committee accept
      // throws, NATS must not have fired yet so downstream services aren't left with a
      // partially-processed state.
      const pendingCommitteeInvite = await this.autoAcceptCommitteeInvite(req, payload);

      const codec = this.natsService.getCodec();
      await this.natsService.publish(NatsSubjects.INVITE_ACCEPTED, codec.encode(JSON.stringify({ invite_uid: payload.invite_uid, username })));

      logger.success(req, 'accept_invite', startTime, {
        invite_uid: payload.invite_uid,
        username,
        resource_uid: payload.resource_uid,
      });

      res.json({ return_url: safeReturnUrl, ...(pendingCommitteeInvite && { pending_committee_invite: pendingCommitteeInvite }) });
    } catch (error) {
      next(error);
    }
  }

  // Secret used as raw UTF-8 bytes to match Go invite service []byte(secret) key derivation.
  private verifyInviteToken(token: string, secret: string): InviteTokenPayload {
    const key = JWK.asKey(Buffer.from(secret));
    const payload = JWT.verify<InviteTokenPayload>(token, key, { algorithms: ['HS256'] });
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new Error('Token is missing required exp claim');
    }
    return payload;
  }

  // Only lfx.dev (apex) and *.lfx.dev (subdomains) are valid redirect destinations — prevents open-redirect.
  private validateReturnUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return null;
      if (!parsed.hostname.endsWith('.lfx.dev') && parsed.hostname !== 'lfx.dev') return null;
      return validateAndSanitizeUrl(url) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Accepts the committee invite associated with the LFID invite JWT.
   *
   * **New path** (JWT carries `committee_invite_uid`): calls the committee accept endpoint
   * directly — no email search needed since both the committee UID (`resource_uid`) and the
   * invite UID (`committee_invite_uid`) are embedded in the JWT.
   *
   * **Legacy path** (JWT pre-dates `committee_invite_uid`): falls back to searching pending
   * invites by email. Waits {@link FGA_PROPAGATION_DELAY_MS} before each attempt so that the
   * FGA invitee tuple has time to propagate; retries up to {@link FGA_LEGACY_MAX_ATTEMPTS}
   * times total. Returns a {@link PendingCommitteeInviteForOrg} when an invite requires an
   * organization that was not pre-filled — the client must collect the org and re-submit.
   *
   * Requires the session email to match the email claim in the JWT. Throws on unrecoverable
   * failures so the caller can surface the error rather than silently redirecting.
   */
  private async autoAcceptCommitteeInvite(req: Request, payload: InviteTokenPayload): Promise<PendingCommitteeInviteForOrg | null> {
    const invitedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const sessionEmail = getEffectiveEmail(req)?.trim().toLowerCase() ?? null;

    if (!invitedEmail) {
      logger.warning(req, 'accept_invite', 'Skipping committee invite auto-accept — LFID invite token has no email claim', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    if (!sessionEmail) {
      logger.warning(req, 'accept_invite', 'Skipping committee invite auto-accept — session email unavailable', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    if (invitedEmail !== sessionEmail) {
      logger.info(req, 'accept_invite', 'Skipping committee invite auto-accept — session email does not match LFID invite token email', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    // JWT.verify only validates the signature — claims can be null, non-strings, or whitespace.
    const committeeInviteUid = typeof payload.committee_invite_uid === 'string' ? payload.committee_invite_uid.trim() : '';
    const committeeUid = typeof payload.resource_uid === 'string' ? payload.resource_uid.trim() : '';

    if (committeeInviteUid) {
      // Both UIDs are known — call accept directly without searching.
      if (!committeeUid) {
        throw ServiceValidationError.forField('resource_uid', 'Invite token is missing the committee UID required to accept this invite', {
          operation: 'accept_invite',
          service: 'invite_controller',
          path: req.path,
        });
      }
      await this.committeeService.acceptCommitteeInvite(req, committeeUid, committeeInviteUid);
      logger.info(req, 'accept_invite', 'Committee invite accepted directly after LFID invite', {
        committee_uid: committeeUid,
        committee_invite_uid: committeeInviteUid,
      });
      return null;
    }

    // Legacy path: JWT pre-dates committee_invite_uid — search pending invites by email.
    // Require committeeUid so the search is scoped to the specific committee; without it we
    // cannot safely identify which pending invite to accept and must skip.
    if (!committeeUid) {
      logger.warning(req, 'accept_invite', 'Skipping legacy committee invite auto-accept — resource_uid (committee UID) is absent from the JWT', {
        invite_uid: payload.invite_uid,
      });
      return null;
    }

    // Wait before every attempt (including the first) so the FGA invitee tuple can propagate.
    for (let attempt = 0; attempt < FGA_LEGACY_MAX_ATTEMPTS; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, FGA_PROPAGATION_DELAY_MS));

      const result = await this.committeeService.acceptPendingCommitteeInvitesAfterLfidAccept(req, {
        invitedEmail,
        resourceUid: committeeUid,
      });

      // undefined = invite not visible yet — FGA still propagating; retry.
      // null | PendingCommitteeInviteForOrg = processed; return immediately.
      if (result !== undefined) {
        return result ?? null;
      }
    }

    logger.warning(req, 'accept_invite', 'Legacy committee invite auto-accept exhausted retries without finding a matching invite', {
      invite_uid: payload.invite_uid,
      resource_uid: committeeUid,
    });
    return null;
  }
}
