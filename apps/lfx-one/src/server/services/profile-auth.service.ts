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
}

/**
 * Service for Flow C OAuth2 — obtains a user-scoped Auth0 Management API token
 * via a second authorization code flow with a separate "Profile Client".
 *
 * This is required because the M2M client only has read:users scope.
 * Profile updates need user-scoped management API tokens with
 * update:current_user_metadata and update:current_user_identities scopes.
 */
export class ProfileAuthService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly audience: string;
  private readonly scope: string;
  private readonly issuerBaseUrl: string;
  private readonly baseUrl: string;
  private readonly redirectUri: string;

  public constructor() {
    this.clientId = process.env['PROFILE_CLIENT_ID'] || '';
    this.clientSecret = process.env['PROFILE_CLIENT_SECRET'] || '';
    this.audience = process.env['PROFILE_AUDIENCE'] || '';
    this.scope = process.env['PROFILE_SCOPE'] || '';
    this.issuerBaseUrl = (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, '');
    this.baseUrl = process.env['PCC_BASE_URL'] || 'http://localhost:4000';
    this.redirectUri = process.env['PROFILE_REDIRECT_URI'] || `${this.baseUrl}/passwordless/callback`;
  }

  /**
   * Check if Profile Client (Flow C) is configured
   * Returns false for Authelia environments or when env vars are not set
   */
  public isProfileAuthConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.audience;
  }

  /**
   * Constructs the Auth0 /authorize URL and stores CSRF state in session
   */
  public getAuthorizationUrl(req: Request, returnTo?: string): string {
    const state = crypto.randomBytes(32).toString('hex');

    if (!req.appSession) {
      req.appSession = {};
    }
    req.appSession.profileAuthState = state;

    if (returnTo) {
      req.appSession['profileAuthReturnTo'] = returnTo;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: this.scope,
      audience: this.audience,
      state,
    });

    return `${this.issuerBaseUrl}/authorize?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for a management API token
   */
  public async exchangeCodeForToken(req: Request, code: string): Promise<TokenResponse> {
    const tokenEndpoint = `${this.issuerBaseUrl}/oauth/token`;

    const startTime = logger.startOperation(req, 'profile_auth_exchange_code', {
      token_endpoint: tokenEndpoint,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
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
      let errorBody: any = {};
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      logger.error(req, 'profile_auth_exchange_code', startTime, new Error(`Token exchange failed: ${response.status}`), {
        status: response.status,
        error_body: errorBody,
      });

      throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const tokenResponse: TokenResponse = await response.json();

    logger.success(req, 'profile_auth_exchange_code', startTime, {
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope,
      expires_in: tokenResponse.expires_in,
    });

    return tokenResponse;
  }

  /**
   * Decodes JWT payload (base64url) and validates the sub claim matches the expected user
   * Does NOT verify signature — the token was just received directly from Auth0
   */
  public decodeAndValidateSub(accessToken: string, expectedSub: string): boolean {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.sub === expectedSub;
  }

  /**
   * Reads the management token from the session, returning null if expired
   */
  public getManagementToken(req: Request): string | null {
    const token = req.appSession?.profileAccessToken;
    if (!token) {
      return null;
    }

    const expiresAt = req.appSession?.profileExpiresAt;
    if (!expiresAt || Date.now() >= expiresAt) {
      logger.info(req, 'profile_auth_token_expired', 'Management token expired, clearing session', {
        expired_at: expiresAt ? new Date(expiresAt).toISOString() : 'missing',
      });
      this.clearManagementToken(req);
      return null;
    }

    return token;
  }

  /**
   * Stores the management token response in the session
   */
  public storeManagementToken(req: Request, tokenResponse: TokenResponse): void {
    if (!req.appSession) {
      req.appSession = {};
    }

    req.appSession.profileAccessToken = tokenResponse.access_token;
    req.appSession.profileTokenType = tokenResponse.token_type;
    req.appSession.profileScope = tokenResponse.scope;
    req.appSession.profileExpiresIn = tokenResponse.expires_in;
    req.appSession.profileExpiresAt = Date.now() + (tokenResponse.expires_in - 300) * 1000;
  }

  /**
   * Clears all profile token fields from the session
   */
  private clearManagementToken(req: Request): void {
    if (!req.appSession) {
      return;
    }

    delete req.appSession.profileAccessToken;
    delete req.appSession.profileTokenType;
    delete req.appSession.profileScope;
    delete req.appSession.profileExpiresIn;
    delete req.appSession.profileExpiresAt;
  }
}
