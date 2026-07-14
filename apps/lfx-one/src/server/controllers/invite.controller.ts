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

/** Delay between auto-accept retries while waiting for FGA invitee tuple propagation. */
const FGA_PROPAGATION_DELAY_MS = 3_000;
/** Maximum number of retries after the initial attempt (total wait: up to 9 s). */
const FGA_PROPAGATION_MAX_RETRIES = 3;

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

      const codec = this.natsService.getCodec();
      await this.natsService.publish(NatsSubjects.INVITE_ACCEPTED, codec.encode(JSON.stringify({ invite_uid: payload.invite_uid, username })));

      let pendingCommitteeInvite: PendingCommitteeInviteForOrg | undefined;
      try {
        pendingCommitteeInvite = (await this.autoAcceptPendingCommitteeInvites(req, payload)) ?? undefined;
      } catch (error) {
        // Best-effort — committee auto-accept failures must not block LFID invite acceptance.
        logger.warning(req, 'accept_invite', 'Committee invite auto-accept failed; LFID accept continues', {
          invite_uid: payload.invite_uid,
          err: error,
        });
      }

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
   * When an LFID invite is accepted for a committee invitee, accept any matching pending
   * committee_invite so a committee_member is created with the session username. Requires
   * the authenticated user's email to match the email embedded in the LFID invite JWT.
   *
   * Returns a {@link PendingCommitteeInviteForOrg} when an invite requires an organization
   * that was not pre-filled — the caller should surface this to the client for manual org
   * collection. Returns null when all invites were handled or the flow was skipped.
   */
  private async autoAcceptPendingCommitteeInvites(req: Request, payload: InviteTokenPayload): Promise<PendingCommitteeInviteForOrg | null> {
    const invitedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const sessionEmail = getEffectiveEmail(req)?.trim() ?? null;

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

    // When resource_type is present: 'group' means committee invite (retry while FGA propagates),
    // any other value means not a committee invite (skip retry).
    // When resource_type is absent we can't rule out a committee invite, so still attempt
    // auto-accept rather than silently skip it.
    const isCommitteeInvite = payload.resource_type ? payload.resource_type === 'group' : !!payload.resource_uid?.trim();

    for (let attempt = 0; attempt <= FGA_PROPAGATION_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, FGA_PROPAGATION_DELAY_MS));
      }

      const result = await this.committeeService.acceptPendingCommitteeInvitesAfterLfidAccept(req, {
        invitedEmail,
        resourceUid: payload.resource_uid,
      });

      // undefined = no pending invites found yet; the FGA tuple may still be in-flight — retry.
      // null or PendingCommitteeInviteForOrg = invite was found and processed; return immediately.
      if (result !== undefined || !isCommitteeInvite) {
        return result ?? null;
      }
    }

    return null;
  }
}
