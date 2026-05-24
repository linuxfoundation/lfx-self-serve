// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NatsSubjects } from '@lfx-one/shared/enums';
import { InviteTokenPayload } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';
import { errors as JoseErrors, JWK, JWT } from 'jose';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { logger } from '../services/logger.service';
import { NatsService } from '../services/nats.service';
import { getEffectiveUsername } from '../utils/auth-helper';

/** Controller for non-LF user invite acceptance via signed JWT. */
export class InviteController {
  private readonly natsService = new NatsService();

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

      logger.success(req, 'accept_invite', startTime, {
        invite_uid: payload.invite_uid,
        username,
        resource_uid: payload.resource_uid,
      });

      res.json({ return_url: safeReturnUrl });
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
}
