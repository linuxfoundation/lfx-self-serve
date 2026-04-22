// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCOUNT_COOKIE_KEY, LENS_COOKIE_KEY, NATS_CONFIG, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { ImpersonationStatusResponse, ImpersonationUser, Impersonator, LfxAccessTokenClaims, M2MTokenResponse, PersonaType } from '@lfx-one/shared/interfaces';
import { Request, Response } from 'express';

import { MicroserviceError } from '../errors';
import { clearImpersonationSession, decodeJwtPayload } from '../utils/auth-helper';
import { logger } from './logger.service';
import { NatsService } from './nats.service';

export class ImpersonationService {
  private readonly natsService: NatsService;

  public constructor() {
    this.natsService = new NatsService();
  }

  public async exchangeToken(req: Request, targetUser: string): Promise<M2MTokenResponse> {
    logger.debug(req, 'cte_token_exchange', 'Starting CTE token exchange via NATS', { target_user: targetUser });

    const codec = this.natsService.getCodec();
    const payload = JSON.stringify({
      subject_token: req.bearerToken || '',
      target_user: targetUser,
    });

    try {
      const response = await this.natsService.request(NatsSubjects.IMPERSONATION_TOKEN_EXCHANGE, codec.encode(payload), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const result = JSON.parse(responseText);

      if (!result.success) {
        const errorMessage = result.error || 'Impersonation token exchange failed';
        throw new MicroserviceError(errorMessage, 400, 'CTE_EXCHANGE_FAILED', {
          operation: 'cte_token_exchange',
          service: 'auth-service',
          errorBody: { target_user: targetUser },
        });
      }

      const accessToken = result.data?.access_token;
      if (!accessToken) {
        throw new MicroserviceError('No access token in impersonation response', 500, 'CTE_NO_TOKEN', {
          operation: 'cte_token_exchange',
          service: 'auth-service',
        });
      }

      // Derive expires_in from the JWT exp claim
      let expiresIn = 86400;
      try {
        const payload = decodeJwtPayload(accessToken);
        if (payload?.['exp']) {
          expiresIn = Math.max(payload['exp'] - Math.floor(Date.now() / 1000), 0);
        }
      } catch {
        // Fall back to 24h default
      }

      logger.debug(req, 'cte_token_exchange', 'CTE token exchange successful', { target_user: targetUser, expires_in: expiresIn });

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
      };
    } catch (error) {
      if (error instanceof MicroserviceError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new MicroserviceError(`Impersonation token exchange failed: ${errorMessage}`, 502, 'CTE_NATS_ERROR', {
        operation: 'cte_token_exchange',
        service: 'auth-service',
        errorBody: { target_user: targetUser },
      });
    }
  }

  public async fetchTargetUserProfile(req: Request, userId: string): Promise<{ name?: string; picture?: string }> {
    try {
      logger.debug(req, 'fetch_target_user_profile', 'Fetching target user metadata via NATS', { user_id: userId });

      const codec = this.natsService.getCodec();
      const response = await this.natsService.request(NatsSubjects.USER_METADATA_READ, codec.encode(userId), {
        timeout: NATS_CONFIG.REQUEST_TIMEOUT,
      });

      const responseText = codec.decode(response.data);
      const result = JSON.parse(responseText);

      if (!result.success || !result.data) {
        logger.warning(req, 'fetch_target_user_profile', 'User metadata lookup returned no data', {
          user_id: userId,
          error: result.error,
        });
        return {};
      }

      return {
        name: result.data.name || result.data.given_name || undefined,
        picture: result.data.picture || undefined,
      };
    } catch (error) {
      logger.warning(req, 'fetch_target_user_profile', 'Error fetching target user metadata via NATS', {
        user_id: userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {};
    }
  }

  public startImpersonation(
    req: Request,
    res: Response,
    tokenResponse: M2MTokenResponse,
    targetClaims: LfxAccessTokenClaims,
    profile?: { name?: string; picture?: string },
    personaContext?: PersonaType
  ): void {
    if (!req.appSession) {
      req.appSession = {};
    }

    const targetUser: ImpersonationUser = {
      sub: targetClaims['sub'] || '',
      email: targetClaims['http://lfx.dev/claims/email'] || '',
      username: targetClaims['http://lfx.dev/claims/username'] || '',
      name: profile?.name,
      picture: profile?.picture,
    };

    const oidcUser = req.oidc?.user;
    const impersonator: Impersonator = {
      sub: oidcUser?.['sub'] || '',
      email: oidcUser?.['email'] || '',
      name: oidcUser?.['name'] || '',
    };

    req.appSession['impersonationToken'] = tokenResponse.access_token;
    const safetyBufferSeconds = tokenResponse.expires_in > 300 ? 300 : 0;
    req.appSession['impersonationExpiresAt'] = Date.now() + (tokenResponse.expires_in - safetyBufferSeconds) * 1000;
    req.appSession['impersonationUser'] = targetUser;
    req.appSession['impersonator'] = impersonator;

    if (personaContext) {
      req.appSession['impersonationPersonaContext'] = personaContext;
    } else {
      delete req.appSession['impersonationPersonaContext'];
    }

    // Clear impersonator's persona/lens/account cookies so the impersonated session re-detects cleanly on reload.
    res.clearCookie(PERSONA_COOKIE_KEY, { path: '/' });
    res.clearCookie(LENS_COOKIE_KEY, { path: '/' });
    res.clearCookie(ACCOUNT_COOKIE_KEY, { path: '/' });

    logger.info(req, 'impersonation_granted', 'Impersonation session started', {
      impersonator_sub: impersonator.sub,
      impersonator_email: impersonator.email,
      target_sub: targetUser.sub,
      target_email: targetUser.email,
      persona_context: personaContext ?? null,
    });
  }

  public stopImpersonation(req: Request, res: Response): void {
    // Always clear persona/lens/account cookies even when session is missing — stale cookies on the client must be reset.
    res.clearCookie(PERSONA_COOKIE_KEY, { path: '/' });
    res.clearCookie(LENS_COOKIE_KEY, { path: '/' });
    res.clearCookie(ACCOUNT_COOKIE_KEY, { path: '/' });

    if (!req.appSession) {
      return;
    }

    const impersonator = req.appSession['impersonator'];
    const targetUser = req.appSession['impersonationUser'];

    clearImpersonationSession(req);

    logger.info(req, 'impersonation_stopped', 'Impersonation session ended', {
      impersonator_sub: impersonator?.sub,
      impersonator_email: impersonator?.email,
      target_sub: targetUser?.sub,
      target_email: targetUser?.email,
    });
  }

  public getImpersonationToken(req: Request): string | null {
    const token = req.appSession?.['impersonationToken'];
    if (!token || typeof token !== 'string') {
      return null;
    }

    const expiresAt = req.appSession?.['impersonationExpiresAt'];
    if (!expiresAt || Date.now() >= expiresAt) {
      logger.debug(req, 'impersonation_token_expired', 'Impersonation token expired, clearing session');
      clearImpersonationSession(req);
      return null;
    }

    return token;
  }

  public getImpersonationStatus(req: Request): ImpersonationStatusResponse {
    const token = this.getImpersonationToken(req);
    if (!token) {
      return { impersonating: false };
    }

    return {
      impersonating: true,
      targetUser: req.appSession?.['impersonationUser'],
      impersonator: req.appSession?.['impersonator'],
    };
  }
}
