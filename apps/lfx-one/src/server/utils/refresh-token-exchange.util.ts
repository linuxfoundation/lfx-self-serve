// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { GW_HOST_SESSION_ID_TOKEN_SCOPE } from '@lfx-one/shared/constants';
import { IdTokenExchangeResult, RefreshTokenExchangeOptions, TokenRequestParams } from '@lfx-one/shared/interfaces';
import { logger } from '../services/logger.service';

const TOKEN_EXPIRY_BUFFER_SECONDS = 300;
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;

/**
 * Populates `req.apiGatewayToken` with a user-scoped access token for the API Gateway
 * audience, exchanging the session's refresh token when the request does not already
 * carry one. Single owner of the API_GW_AUDIENCE / PCC_AUTH0_* env config and the
 * 'apiGatewayToken' session-key contract — call this instead of re-wiring the exchange
 * inline (the auth middleware and routes that skip it both populate the token here).
 *
 * Session-cached (with a 5-minute expiry buffer) and fail-open: misconfiguration or an
 * exchange failure logs and leaves the request without the token.
 */
export async function populateApiGatewayToken(req: Request): Promise<void> {
  const apiGatewayAudience = process.env['API_GW_AUDIENCE'];
  if (!apiGatewayAudience) {
    logger.warning(req, 'api_gateway_token', 'API_GW_AUDIENCE env var is not set, skipping secondary token fetch');
    return;
  }

  if (req.apiGatewayToken) {
    return;
  }

  const token = await exchangeRefreshTokenForAudience(req, {
    issuerBaseUrl: process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '',
    clientId: process.env['PCC_AUTH0_CLIENT_ID'] || '',
    clientSecret: process.env['PCC_AUTH0_CLIENT_SECRET'] || '',
    audience: apiGatewayAudience,
    sessionKey: 'apiGatewayToken',
  });

  if (token) {
    req.apiGatewayToken = token;
    logger.debug(req, 'api_gateway_token', 'API Gateway token ready');
  }
}

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
    const config = createTokenRequest({ issuerBaseUrl, clientId, clientSecret, refreshToken, audience, scope });

    const response = await fetch(config.endpoint, {
      method: config.method,
      headers: config.createHeaders(),
      body: config.createBody(),
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
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

/**
 * Gets a fresh ID token for the signed-in user from the IdP's refresh grant, for GoTrue's
 * `id_token` grant (Gatewaze host-session mode, #2738). Sends `scope=openid email profile` and no
 * `audience`: an ID token from a refresh grant carries no `nonce`, which GoTrue requires when the
 * request sends no raw nonce. The login ID token in `req.oidc.idToken` cannot be used, because its
 * nonce claim is a value GoTrue cannot match.
 *
 * The token is returned and nothing else: it is never cached, never written to `req.appSession`
 * and never logged. Safe to call alongside express-openid-connect's own refresh because the LFX
 * One Auth0 client uses non-rotating refresh tokens.
 *
 * Unlike `exchangeRefreshTokenForAudience`, a failure is classified rather than collapsed to null,
 * so the caller can tell a dead LFX session (`ended`: `invalid_grant` only) from an
 * IdP it could not reach (`unavailable`: everything else, including missing configuration).
 */
export async function exchangeRefreshTokenForIdToken(req: Request): Promise<IdTokenExchangeResult> {
  const issuerBaseUrl = (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, '');
  const clientId = process.env['PCC_AUTH0_CLIENT_ID'] || '';
  const clientSecret = process.env['PCC_AUTH0_CLIENT_SECRET'] || '';
  if (!issuerBaseUrl || !clientId || !clientSecret) {
    logger.warning(req, 'exchange_refresh_token_for_id_token', 'PCC_AUTH0_* is not configured — cannot get an ID token');
    return { outcome: 'unavailable' };
  }

  const refreshToken = req.appSession?.['refresh_token'] as string | undefined;
  if (!refreshToken) {
    // A missing refresh token is a configuration fault (offline_access not requested), not a dead
    // session: answering `ended` would send an authenticated user round a sign-in that changes nothing.
    logger.warning(req, 'exchange_refresh_token_for_id_token', 'No refresh_token in OIDC session — ensure offline_access scope is requested');
    return { outcome: 'unavailable' };
  }

  try {
    const config = createTokenRequest({ issuerBaseUrl, clientId, clientSecret, refreshToken, scope: GW_HOST_SESSION_ID_TOKEN_SCOPE });
    const startTime = Date.now();
    const response = await fetch(config.endpoint, {
      method: config.method,
      headers: config.createHeaders(),
      body: config.createBody(),
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Only the OAuth error code is read and logged. The description is free text from the IdP.
      const errorBody = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const error = typeof errorBody?.['error'] === 'string' ? errorBody['error'] : undefined;
      if (error === 'invalid_grant') {
        logger.warning(req, 'exchange_refresh_token_for_id_token', 'IdP refused the refresh token', { status: response.status, error });
        return { outcome: 'ended' };
      }
      // Any other 4xx (invalid_client, unauthorized_client, invalid_request, invalid_scope, a bare
      // 401/403) is a client or tenant configuration fault. Signing the user out would not fix it.
      if (response.status >= 400 && response.status < 500) {
        logger.error(req, 'exchange_refresh_token_for_id_token', startTime, new Error(`ID token refresh grant rejected (${response.status})`), {
          status: response.status,
          error,
        });
      } else {
        logger.warning(req, 'exchange_refresh_token_for_id_token', 'ID token refresh grant failed upstream', { status: response.status, error });
      }
      return { outcome: 'unavailable' };
    }

    const data = (await response.json()) as { id_token?: unknown };
    if (typeof data?.id_token !== 'string' || !data.id_token) {
      logger.warning(req, 'exchange_refresh_token_for_id_token', 'Refresh grant answered without an id_token');
      return { outcome: 'unavailable' };
    }
    return { outcome: 'ok', idToken: data.id_token };
  } catch (error) {
    logger.warning(req, 'exchange_refresh_token_for_id_token', 'ID token refresh grant failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { outcome: 'unavailable' };
  }
}

/** Builds the refresh-grant request for the configured issuer: Authelia locally (chosen by issuer host), Auth0 everywhere else. */
function createTokenRequest(params: TokenRequestParams) {
  return params.issuerBaseUrl.includes('auth.k8s.orb.local') ? createAutheliaTokenRequest(params) : createAuth0TokenRequest(params);
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
      };
      if (audience) params['audience'] = audience;
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
      };
      if (audience) params['audience'] = audience;
      if (scope) params['scope'] = scope;
      return new URLSearchParams(params).toString();
    },
  };
}
