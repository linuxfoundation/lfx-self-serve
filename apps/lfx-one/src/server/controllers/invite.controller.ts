// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { InviteTokenPayload } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';
import { errors as JoseErrors, JWK, JWT } from 'jose';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { logger } from '../services/logger.service';
import { NatsService } from '../services/nats.service';
import { getEffectiveUsername } from '../utils/auth-helper';

/**
 * Controller for handling invite acceptance for non-LF users arriving via a signed invite link.
 */
export class InviteController {
  private readonly natsService = new NatsService();

  /**
   * POST /api/invite/accept
   * Verifies the invite JWT signature (HS256), publishes lfx.invite.accepted via NATS
   * request-reply, and returns the return_url so the client can navigate to the intended resource.
   */
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

      let payload: InviteTokenPayload;
      try {
        payload = this.verifyInviteToken(token);
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
      const response = await this.natsService.request(
        NatsSubjects.INVITE_ACCEPTED,
        codec.encode(JSON.stringify({ invite_uid: payload.invite_uid, username })),
        {
          timeout: NATS_CONFIG.REQUEST_TIMEOUT,
        }
      );

      const responseText = codec.decode(response.data);
      if (!responseText || responseText.startsWith('error:')) {
        logger.warning(req, 'accept_invite', 'NATS handler rejected the invite acceptance', {
          invite_uid: payload.invite_uid,
          nats_response: responseText || '(empty)',
        });
        return next(
          new AuthorizationError('Invite could not be accepted', {
            operation: 'accept_invite',
            service: 'invite_controller',
            path: req.path,
          })
        );
      }

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

  // Verifies the JWT signature using HS256 and the JWT_SECRET env var.
  // Throws JoseErrors.JWTExpired for expired tokens and other JoseErrors for invalid/tampered ones.
  private verifyInviteToken(token: string): InviteTokenPayload {
    const secret = process.env['JWT_SECRET'];
    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }
    const key = JWK.asKey(Buffer.from(secret, 'base64'));
    return JWT.verify(token, key, { algorithms: ['HS256'] }) as InviteTokenPayload;
  }

  // Only LFX-owned domains are valid redirect destinations — prevents open-redirect.
  private validateReturnUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      if (!parsed.hostname.endsWith('.lfx.dev') && parsed.hostname !== 'lfx.dev') return null;
      return validateAndSanitizeUrl(url) ?? null;
    } catch {
      return null;
    }
  }
}
