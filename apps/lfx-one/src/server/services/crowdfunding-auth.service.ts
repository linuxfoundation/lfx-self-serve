// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { Request } from 'express';

import { logger } from './logger.service';

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

const TOKEN_EXPIRY_BUFFER_SECONDS = 300;

/**
 * Obtains a user-scoped access token for the LFX Crowdfunding API audience via a
 * second authorization_code flow.
 *
 * LFX One's primary login targets the LFX V2 cluster audience; a refresh-token
 * exchange cannot mint a token for the Crowdfunding audience (Auth0 returns the
 * primary-audience token, which CF rejects with 401). This service runs a separate
 * redirecting auth-code flow for the CF audience and stores the resulting token in
 * the session. prompt=none is passed so the redirect is silent when the user already
 * has an Auth0 session — no second consent screen is shown.
 */
export class CrowdfundingAuthService {
  private readonly pendingRefreshes = new Map<string, Promise<boolean>>();

  private _clientId: string | undefined;
  private _clientSecret: string | undefined;
  private _audience: string | undefined;
  private _issuerBaseUrl: string | undefined;
  private _baseUrl: string | undefined;
  private _redirectUri: string | undefined;

  private get clientId(): string {
    return (this._clientId ??= process.env['PCC_AUTH0_CLIENT_ID'] || '');
  }

  private get clientSecret(): string {
    return (this._clientSecret ??= process.env['PCC_AUTH0_CLIENT_SECRET'] || '');
  }

  private get audience(): string {
    return (this._audience ??= process.env['CROWDFUNDING_API_AUDIENCE'] || '');
  }

  private get issuerBaseUrl(): string {
    return (this._issuerBaseUrl ??= (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, ''));
  }

  private get baseUrl(): string {
    return (this._baseUrl ??= process.env['PCC_BASE_URL'] || 'http://localhost:4000');
  }

  private get redirectUri(): string {
    return (this._redirectUri ??= process.env['CROWDFUNDING_REDIRECT_URI'] || `${this.baseUrl}/crowdfunding/callback`);
  }

  public isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.audience && !!this.issuerBaseUrl;
  }

  public hasValidToken(req: Request): boolean {
    const token = req.appSession?.crowdfundingToken;
    const expiresAt = req.appSession?.crowdfundingTokenExpiresAt;
    return !!token && !!expiresAt && Math.floor(Date.now() / 1000) < expiresAt;
  }

  /**
   * Builds the Auth0 /authorize URL for the CF audience.
   * prompt=none ensures the redirect is silent when the user already has an Auth0
   * session — Auth0 issues the code without showing any UI. If the session is gone,
   * Auth0 returns error=login_required and the callback falls back gracefully.
   */
  public getAuthorizationUrl(req: Request, returnTo?: string, silent = true): string {
    const state = crypto.randomBytes(32).toString('hex');

    if (!req.appSession) {
      req.appSession = {};
    }
    req.appSession.crowdfundingAuthState = state;

    if (returnTo) {
      req.appSession.crowdfundingAuthReturnTo = returnTo;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid profile access:me offline_access',
      audience: this.audience,
      state,
    });

    if (silent) {
      params.set('prompt', 'none');
    }

    return `${this.issuerBaseUrl}/authorize?${params.toString()}`;
  }

  public async exchangeCodeForToken(req: Request, code: string): Promise<TokenResponse> {
    const tokenEndpoint = `${this.issuerBaseUrl}/oauth/token`;

    const startTime = logger.startOperation(req, 'crowdfunding_auth_exchange_code', {
      token_endpoint: tokenEndpoint,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      logger.error(req, 'crowdfunding_auth_exchange_code', startTime, new Error(`Token exchange failed: ${response.status}`), {
        status: response.status,
        error_body: errorBody,
      });

      throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const tokenResponse: TokenResponse = await response.json();

    logger.success(req, 'crowdfunding_auth_exchange_code', startTime, {
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope,
      expires_in: tokenResponse.expires_in,
    });

    return tokenResponse;
  }

  /**
   * Decodes the JWT payload and validates the sub claim matches the logged-in user.
   * Does NOT verify the signature — the token was just received directly from Auth0.
   */
  public decodeAndValidateSub(accessToken: string, expectedSub: string): boolean {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return false;
    }

    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      return payload.sub === expectedSub;
    } catch {
      return false;
    }
  }

  public storeToken(req: Request, tokenResponse: TokenResponse): void {
    if (!req.appSession) {
      req.appSession = {};
    }

    const now = Math.floor(Date.now() / 1000);
    const rawExpiresAt = now + tokenResponse.expires_in - TOKEN_EXPIRY_BUFFER_SECONDS;
    const expiresAt = rawExpiresAt <= now ? now + Math.floor(tokenResponse.expires_in / 2) : rawExpiresAt;

    req.appSession.crowdfundingToken = tokenResponse.access_token;
    req.appSession.crowdfundingTokenExpiresAt = expiresAt;

    if (tokenResponse.refresh_token) {
      req.appSession.crowdfundingRefreshToken = tokenResponse.refresh_token;
    }
  }

  /**
   * Attempts to silently renew the CF access token using the stored refresh token.
   * Returns true and updates the session on success; returns false (non-throwing)
   * on any failure so callers can fall back to the auth-code redirect.
   * Clears the stale refresh token only on invalid_grant (terminal error); transient
   * failures (5xx, timeouts) leave the token in place for the next request to retry.
   * Single-flight: concurrent requests sharing the same refresh token share one Promise
   * so only one refresh attempt hits Auth0 per in-flight batch.
   */
  public tryRefreshToken(req: Request): Promise<boolean> {
    const refreshToken = req.appSession?.crowdfundingRefreshToken;
    if (!refreshToken) return Promise.resolve(false);

    const key = crypto.createHash('sha256').update(refreshToken).digest('hex').substring(0, 16);
    const inflight = this.pendingRefreshes.get(key);
    if (inflight) return inflight;

    const promise = this.doRefreshToken(req, refreshToken).finally(() => this.pendingRefreshes.delete(key));
    this.pendingRefreshes.set(key, promise);
    return promise;
  }

  private async doRefreshToken(req: Request, refreshToken: string): Promise<boolean> {
    const startTime = logger.startOperation(req, 'crowdfunding_token_refresh', {});

    try {
      const response = await fetch(`${this.issuerBaseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          audience: this.audience,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const errorCode = (errorBody as Record<string, unknown>)?.['error'];
        logger.warning(req, 'crowdfunding_token_refresh', 'Token refresh returned non-OK status', {
          status: response.status,
          error: errorCode,
        });
        if (errorCode === 'invalid_grant' && req.appSession) {
          delete req.appSession.crowdfundingRefreshToken;
        }
        return false;
      }

      const tokenResponse: TokenResponse = await response.json();
      this.storeToken(req, tokenResponse);

      logger.success(req, 'crowdfunding_token_refresh', startTime, { expires_in: tokenResponse.expires_in });

      return true;
    } catch (error) {
      logger.warning(req, 'crowdfunding_token_refresh', 'Token refresh request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }
}
