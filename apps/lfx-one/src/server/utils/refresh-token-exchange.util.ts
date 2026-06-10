// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { RefreshTokenExchangeOptions, TokenRequestParams } from '@lfx-one/shared/interfaces';
import { logger } from '../services/logger.service';

const TOKEN_EXPIRY_BUFFER_SECONDS = 300;

/**
 * Exchanges the user's OIDC refresh token for an access token scoped to a
 * different audience. Produces a user-scoped token — the resulting token
 * carries the user's identity, not the application's.
 *
 * Returns null (non-throwing) when the refresh token is missing or the
 * exchange fails, so callers can degrade gracefully.
 */
export async function exchangeRefreshTokenForAudience(req: Request, options: RefreshTokenExchangeOptions): Promise<string | null> {
  const issuerBaseUrl = options.issuerBaseUrl.replace(/\/+$/, '');
  if (!issuerBaseUrl) {
    logger.warning(req, 'exchange_refresh_token', 'issuerBaseUrl is not configured — skipping token exchange', { audience: options.audience });
    return null;
  }
  const { clientId, clientSecret, audience, scope, sessionKey } = options;
  const isAuthelia = issuerBaseUrl.includes('auth.k8s.orb.local');

  // Serve from session cache if still valid
  if (sessionKey) {
    const now = Math.floor(Date.now() / 1000);
    const cachedToken = req.appSession?.[sessionKey] as string | undefined;
    const cachedExpiresAt = req.appSession?.[`${sessionKey}ExpiresAt`] as number | undefined;

    if (cachedToken && cachedExpiresAt && now < cachedExpiresAt) {
      logger.debug(req, 'exchange_refresh_token', 'Using cached token from session', { audience, sessionKey });
      return cachedToken;
    }
  }

  const refreshToken = req.appSession?.['refresh_token'] as string | undefined;
  if (!refreshToken) {
    logger.warning(req, 'exchange_refresh_token', 'No refresh_token in OIDC session — ensure offline_access scope is requested', { audience });
    return null;
  }

  try {
    const params: TokenRequestParams = { issuerBaseUrl, clientId, clientSecret, refreshToken, audience, scope };
    const config = isAuthelia ? createAutheliaTokenRequest(params) : createAuth0TokenRequest(params);

    const response = await fetch(config.endpoint, {
      method: config.method,
      headers: config.createHeaders(),
      body: config.createBody(),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      logger.warning(req, 'exchange_refresh_token', 'Token exchange returned non-OK status', {
        status: response.status,
        audience,
        error: (errorBody as Record<string, unknown>)?.['error'],
        error_description: (errorBody as Record<string, unknown>)?.['error_description'],
      });
      return null;
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };

    if (sessionKey) {
      const now = Math.floor(Date.now() / 1000);
      const rawExpiresAt = now + data.expires_in - TOKEN_EXPIRY_BUFFER_SECONDS;

      // Guard: if expires_in is too short to survive the buffer, fall back to half the raw
      // expires_in to avoid an immediate-expiry hot loop hammering the IdP on every request.
      const expiresAt = rawExpiresAt <= now ? now + Math.floor(data.expires_in / 2) : rawExpiresAt;

      if (rawExpiresAt <= now) {
        logger.warning(req, 'exchange_refresh_token', 'Token expires_in too short for buffer, using half of raw expiry as fallback', {
          expires_in: data.expires_in,
          buffer: TOKEN_EXPIRY_BUFFER_SECONDS,
          sessionKey,
        });
      }

      if (!req.appSession) req.appSession = {};
      req.appSession[sessionKey] = data.access_token;
      req.appSession[`${sessionKey}ExpiresAt`] = expiresAt;
    }

    logger.debug(req, 'exchange_refresh_token', 'Token exchange successful', { audience, sessionKey });
    return data.access_token;
  } catch (error) {
    logger.warning(req, 'exchange_refresh_token', 'Token exchange failed, returning null', {
      audience,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

function createAuth0TokenRequest({ issuerBaseUrl, clientId, clientSecret, refreshToken, audience, scope }: TokenRequestParams) {
  return {
    endpoint: `${issuerBaseUrl}/oauth/token`,
    method: 'POST',
    createHeaders: () => ({
      ['Content-Type']: 'application/x-www-form-urlencoded',
    }),
    createBody: () => {
      const params: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        audience,
      };
      if (scope) params['scope'] = scope;
      return new URLSearchParams(params).toString();
    },
  };
}

function createAutheliaTokenRequest({ issuerBaseUrl, clientId, clientSecret, refreshToken, audience, scope }: TokenRequestParams) {
  return {
    endpoint: `${issuerBaseUrl}/api/oidc/token`,
    method: 'POST',
    createHeaders: () => {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      return {
        ['Authorization']: `Basic ${basicAuth}`,
        ['Content-Type']: 'application/x-www-form-urlencoded',
      };
    },
    createBody: () => {
      const params: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        audience,
      };
      if (scope) params['scope'] = scope;
      return new URLSearchParams(params).toString();
    },
  };
}
