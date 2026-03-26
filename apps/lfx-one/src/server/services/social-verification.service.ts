// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { Request } from 'express';

import { logger } from './logger.service';

import type { SocialProvider } from '@lfx-one/shared/interfaces';

interface SocialTokenResponse {
  id_token: string;
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Service for handling social identity verification via Auth0 social connections.
 *
 * Uses the same Auth0 Profile Client as Flow C but with a `connection` parameter
 * to force authentication with a specific social provider (GitHub/LinkedIn).
 * The resulting id_token represents the social identity and can be used to link
 * the account via the existing NATS `user_identity.link` subject.
 *
 * Auth0 Configuration Required:
 * - The Profile Client must have the social callback URL in its Allowed Callback URLs
 *   e.g., http://localhost:4200/social/callback
 * - The `github` and `linkedin` social connections must be enabled on the Auth0 tenant
 */
export class SocialVerificationService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly issuerBaseUrl: string;
  private readonly baseUrl: string;
  private readonly redirectUri: string;

  private static readonly validProviders: readonly SocialProvider[] = ['github', 'linkedin'];

  public constructor() {
    this.clientId = process.env['PROFILE_CLIENT_ID'] || '';
    this.clientSecret = process.env['PROFILE_CLIENT_SECRET'] || '';
    this.issuerBaseUrl = (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, '');
    this.baseUrl = process.env['PCC_BASE_URL'] || 'http://localhost:4000';
    this.redirectUri = process.env['SOCIAL_REDIRECT_URI'] || `${this.baseUrl}/social/callback`;
  }

  /**
   * Validate that a provider string is a supported social provider
   */
  public isValidProvider(provider: string): provider is SocialProvider {
    return SocialVerificationService.validProviders.includes(provider as SocialProvider);
  }

  /**
   * Build the Auth0 /authorize URL with a connection parameter to force social login.
   * Stores CSRF state in session for validation on callback.
   *
   * Uses `prompt=login` to ensure the user authenticates with the social provider
   * even if they have an existing Auth0 session.
   * Does NOT include an audience — we only need the id_token, not management API access.
   */
  public getAuthorizeUrl(req: Request, provider: SocialProvider): string {
    const state = crypto.randomBytes(32).toString('hex');

    if (!req.appSession) {
      req.appSession = {};
    }
    req.appSession.socialAuthState = state;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      connection: provider,
      state,
      prompt: 'login',
    });

    return `${this.issuerBaseUrl}/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   * Returns the id_token which represents the social identity.
   */
  public async exchangeCodeForToken(req: Request, code: string): Promise<SocialTokenResponse> {
    const tokenEndpoint = `${this.issuerBaseUrl}/oauth/token`;

    const startTime = logger.startOperation(req, 'social_auth_exchange_code', {
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
      let errorBody: unknown = {};
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      logger.error(req, 'social_auth_exchange_code', startTime, new Error(`Social token exchange failed: ${response.status}`), {
        status: response.status,
        error_body: errorBody,
      });

      throw new Error(`Social token exchange failed: ${response.status} - ${JSON.stringify(errorBody)}`);
    }

    const tokenResponse: SocialTokenResponse = await response.json();

    logger.success(req, 'social_auth_exchange_code', startTime, {
      token_type: tokenResponse.token_type,
      has_id_token: !!tokenResponse.id_token,
    });

    return tokenResponse;
  }

  /**
   * Store a pending social connection in the session.
   * Used when the user needs to obtain a management token (Flow C) before social auth.
   */
  public storePendingSocialConnect(req: Request, provider: SocialProvider, returnTo: string): void {
    if (!req.appSession) {
      req.appSession = {};
    }
    req.appSession.pendingSocialConnect = { provider, returnTo };
  }

  /**
   * Retrieve and return the pending social connection from the session, if any.
   */
  public getPendingSocialConnect(req: Request): { provider: SocialProvider; returnTo: string } | null {
    const pending = req.appSession?.pendingSocialConnect;
    if (!pending) {
      return null;
    }
    return pending as { provider: SocialProvider; returnTo: string };
  }

  /**
   * Clear the pending social connection from the session.
   */
  public clearPendingSocialConnect(req: Request): void {
    if (req.appSession) {
      delete req.appSession.pendingSocialConnect;
    }
  }

  /**
   * Validate the CSRF state parameter from the callback against the session.
   */
  public validateState(req: Request, state: string): boolean {
    return !!state && state === req.appSession?.socialAuthState;
  }

  /**
   * Clear the stored CSRF state from the session.
   */
  public clearState(req: Request): void {
    if (req.appSession) {
      delete req.appSession.socialAuthState;
    }
  }
}
