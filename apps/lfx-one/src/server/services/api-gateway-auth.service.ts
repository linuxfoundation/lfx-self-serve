// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { API_GATEWAY_AUTH, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  ApiGatewayAuthState,
  ApiGatewayAuthStatus,
  ApiGatewayGrant,
  ApiGatewayRefreshResult,
  ApiGatewayTokenResponse,
  LfxAccessTokenClaims,
} from '@lfx-one/shared/interfaces';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';

import { AuthenticationError } from '../errors';
import { normalizeApiGatewayReturnTo } from '../helpers/api-gateway-auth.helper';
import { decodeJwtPayload, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import { buildAuthStateCacheKey, valkeyService } from './valkey.service';

export class ApiGatewayAuthService {
  private readonly pendingRefreshes = new Map<string, Promise<ApiGatewayRefreshResult>>();

  private get clientId(): string {
    return process.env['PCC_AUTH0_CLIENT_ID'] || '';
  }

  private get clientSecret(): string {
    return process.env['PCC_AUTH0_CLIENT_SECRET'] || '';
  }

  private get issuer(): string {
    return (process.env['PCC_AUTH0_ISSUER_BASE_URL'] || '').replace(/\/+$/, '');
  }

  private get audience(): string {
    return process.env['API_GW_AUDIENCE'] || '';
  }

  private get redirectUri(): string {
    return `${(process.env['PCC_BASE_URL'] || 'http://localhost:4000').replace(/\/+$/, '')}${API_GATEWAY_AUTH.CALLBACK_PATH}`;
  }

  public get isAuthelia(): boolean {
    return this.issuer.includes('auth.k8s.orb.local');
  }

  public isConfigured(): boolean {
    if (this.isAuthelia || !this.clientId || !this.clientSecret || !this.audience || !this.issuer) return false;
    try {
      return ['http:', 'https:'].includes(new URL(this.issuer).protocol) && ['http:', 'https:'].includes(new URL(this.redirectUri).protocol);
    } catch {
      return false;
    }
  }

  public async getAuthorizationUrl(req: Request, returnTo: string, silent = true): Promise<string> {
    const grant = this.currentGrant(req);
    if (!this.isConfigured() || !grant || !req.appSession || isImpersonating(req)) {
      throw new AuthenticationError('API Gateway authorization requires an authenticated, non-impersonated session.');
    }

    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const record: ApiGatewayAuthState = {
      ...grant,
      state,
      codeVerifier,
      returnTo: normalizeApiGatewayReturnTo(returnTo),
      silent,
      expiresAt: Date.now() + VALKEY_CACHE.AUTH_STATE_TTL_SECONDS * 1000,
    };
    // Retry a failed flow only through an explicit start, not an automatic redirect loop.
    req.appSession.apiGatewayAuthAttempted = true;
    delete req.appSession.apiGatewayAuthState;
    if (valkeyService.isEnabled()) {
      // Keep single-use state outside whole-session write races.
      const key = this.stateKey(state);
      if (!key || !(await valkeyService.setJson(key, record, VALKEY_CACHE.AUTH_STATE_TTL_SECONDS, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS))) {
        throw new Error('API Gateway authorization state could not be saved.');
      }
    } else {
      req.appSession.apiGatewayAuthState = record;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      audience: this.audience,
      scope: API_GATEWAY_AUTH.SCOPE,
      state,
      code_challenge: this.digest(codeVerifier, 'base64url'),
      code_challenge_method: 'S256',
    });
    if (silent) params.set('prompt', 'none');
    return `${this.issuer}/authorize?${params}`;
  }

  public async consumeAuthState(req: Request, state: unknown): Promise<ApiGatewayAuthState | null> {
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
    let record: ApiGatewayAuthState | undefined;
    if (valkeyService.isEnabled()) {
      const result = await valkeyService.getdelJson<ApiGatewayAuthState>(this.stateKey(state)!, undefined, VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS);
      if (result.status === 'hit') record = result.value;
      // A miss or uncertain destructive read is authoritative, never a session fallback.
    } else if (req.appSession?.apiGatewayAuthState?.state === state) {
      record = req.appSession.apiGatewayAuthState;
      delete req.appSession.apiGatewayAuthState;
    }
    if (
      !record ||
      record.state !== state ||
      !this.matchesGrant(req, record) ||
      typeof record.expiresAt !== 'number' ||
      !Number.isFinite(record.expiresAt) ||
      Date.now() >= record.expiresAt ||
      typeof record.silent !== 'boolean' ||
      typeof record.codeVerifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(record.codeVerifier)
    ) {
      return null;
    }
    return record;
  }

  public async exchangeCode(req: Request, code: string, state: ApiGatewayAuthState): Promise<void> {
    const session = req.appSession;
    try {
      const response = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: state.codeVerifier,
      });
      if (!response.ok) throw new Error('Token exchange refused');
      const token: unknown = await response.json();
      const expiresAt = this.validateTokenResponse(token, state);
      if (
        !expiresAt ||
        !this.isTokenResponse(token) ||
        !token.refresh_token ||
        !session ||
        req.appSession !== session ||
        !this.matchesGrant(req, state) ||
        isImpersonating(req)
      ) {
        throw new Error('Invalid Gateway grant');
      }
      this.storeToken(req, token, state, expiresAt);
      delete session.apiGatewayAuthAttempted;
    } catch {
      // Provider errors can contain codes or credentials.
      logger.warning(req, 'api_gateway_code_exchange', 'API Gateway authorization could not be completed');
      throw new Error('API Gateway authorization could not be completed. Please try again.');
    }
  }

  public getCachedToken(req: Request): string | null {
    const session = req.appSession;
    if (!this.isConfigured() || !session || isImpersonating(req)) return null;
    if (!this.matchesGrant(req, session.apiGatewayGrant)) {
      this.clearGrant(req);
      return null;
    }
    const token = session.apiGatewayToken;
    if (!token) return null;
    const claims = typeof token === 'string' ? this.jwtClaims(token) : null;
    if (!this.validClaims(claims, session.apiGatewayGrant!)) {
      this.clearGrant(req);
      return null;
    }
    const expiresAt = session.apiGatewayTokenExpiresAt;
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || Math.floor(Date.now() / 1000) >= Math.min(expiresAt, claims.exp)) {
      this.clearAccessToken(req);
      return null;
    }
    return token;
  }

  public async loadToken(req: Request): Promise<ApiGatewayAuthStatus> {
    delete req.apiGatewayToken;
    let status: ApiGatewayAuthStatus;
    if (!this.isConfigured()) {
      status = 'not_configured';
    } else if (isImpersonating(req)) {
      status = 'impersonating';
    } else {
      const cached = this.getCachedToken(req);
      if (cached) {
        req.apiGatewayToken = cached;
        status = 'ready';
      } else {
        status = await this.tryRefreshToken(req);
      }
    }
    req.apiGatewayAuthStatus = status;
    return status;
  }

  public async tryRefreshToken(req: Request): Promise<ApiGatewayAuthStatus> {
    const session = req.appSession;
    const grant = this.currentGrant(req);
    const refreshToken = session?.apiGatewayRefreshToken;
    if (!this.isConfigured() || !session || !grant || isImpersonating(req) || !this.matchesGrant(req, session.apiGatewayGrant)) return 'required';
    if (typeof refreshToken !== 'string' || !refreshToken) return 'required';

    const key = this.digest(JSON.stringify([grant, refreshToken]));
    let pending = this.pendingRefreshes.get(key);
    if (!pending) {
      pending = this.refresh(req, refreshToken, grant).finally(() => this.pendingRefreshes.delete(key));
      this.pendingRefreshes.set(key, pending);
    }
    const result = await pending;
    // Each waiter must update its own session snapshot with the refreshed pair.
    if (req.appSession !== session || !this.matchesGrant(req, grant) || isImpersonating(req)) return 'required';
    if (session.apiGatewayRefreshToken !== refreshToken) {
      const cached = this.getCachedToken(req);
      if (!cached) return 'required';
      req.apiGatewayToken = cached;
      return 'ready';
    }
    if (result.status === 'success' && result.token && result.expiresAt) {
      this.storeToken(req, result.token, grant, result.expiresAt);
      return 'ready';
    }
    if (result.status === 'invalid_grant' || result.status === 'invalid_token') {
      this.clearGrant(req);
      delete session.apiGatewayAuthAttempted;
      return 'required';
    }
    return 'unavailable';
  }

  private async refresh(req: Request, refreshToken: string, grant: ApiGatewayGrant): Promise<ApiGatewayRefreshResult> {
    try {
      const response = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, audience: this.audience });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const invalidGrant = response.status < 500 && response.status !== 429 && (body as Record<string, unknown> | null)?.['error'] === 'invalid_grant';
        logger.warning(req, 'api_gateway_refresh', 'API Gateway refresh failed', { status: response.status, terminal: invalidGrant });
        return { status: invalidGrant ? 'invalid_grant' : 'unavailable' };
      }
      const token: unknown = await response.json();
      const expiresAt = this.validateTokenResponse(token, grant);
      if (!expiresAt || !this.isTokenResponse(token)) {
        logger.warning(req, 'api_gateway_refresh', 'Rejected an invalid API Gateway token');
        return { status: 'invalid_token' };
      }
      return { status: 'success', token, expiresAt };
    } catch {
      logger.warning(req, 'api_gateway_refresh', 'API Gateway refresh is temporarily unavailable');
      return { status: 'unavailable' };
    }
  }

  private tokenRequest(params: Record<string, string>): Promise<globalThis.Response> {
    return fetch(`${this.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({ ...params, client_id: this.clientId, client_secret: this.clientSecret }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(API_GATEWAY_AUTH.TIMEOUT_MS),
    });
  }

  private validateTokenResponse(value: unknown, grant: ApiGatewayGrant): number | null {
    if (!this.isTokenResponse(value)) return null;
    const claims = this.jwtClaims(value.access_token);
    if (!this.validClaims(claims, grant)) return null;
    const now = Math.floor(Date.now() / 1000);
    const lifetime = Math.min(value.expires_in, claims.exp - now);
    if (lifetime <= 1) return null;
    return now + (lifetime > API_GATEWAY_AUTH.EXPIRY_BUFFER_SECONDS ? lifetime - API_GATEWAY_AUTH.EXPIRY_BUFFER_SECONDS : Math.floor(lifetime / 2));
  }

  private validClaims(value: unknown, grant: ApiGatewayGrant): value is LfxAccessTokenClaims & { exp: number } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const claims = value as Record<string, unknown>;
    const audiences = Array.isArray(claims['aud']) ? claims['aud'] : [claims['aud']];
    // Tokens come from the configured issuer, not browser input; the API verifies signatures.
    return (
      claims['sub'] === grant.sub &&
      typeof claims['iss'] === 'string' &&
      `${claims['iss'].replace(/\/+$/, '')}/` === grant.issuer &&
      audiences.every((audience) => typeof audience === 'string') &&
      audiences.includes(grant.audience) &&
      claims['azp'] === grant.clientId &&
      (claims['client_id'] === undefined || claims['client_id'] === grant.clientId) &&
      typeof claims['scope'] === 'string' &&
      claims['scope'].split(/\s+/).includes('access:api') &&
      typeof claims['exp'] === 'number' &&
      Number.isSafeInteger(claims['exp']) &&
      (claims['nbf'] === undefined ||
        (typeof claims['nbf'] === 'number' && Number.isSafeInteger(claims['nbf']) && claims['nbf'] <= Math.floor(Date.now() / 1000)))
    );
  }

  private jwtClaims(token: string): LfxAccessTokenClaims | null {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    try {
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as { alg?: unknown };
      return header?.alg === 'RS256' ? decodeJwtPayload(token) : null;
    } catch {
      return null;
    }
  }

  private isTokenResponse(value: unknown): value is ApiGatewayTokenResponse {
    if (!value || typeof value !== 'object') return false;
    const token = value as ApiGatewayTokenResponse;
    return (
      typeof token.access_token === 'string' &&
      !!token.access_token &&
      typeof token.token_type === 'string' &&
      token.token_type.toLowerCase() === 'bearer' &&
      typeof token.expires_in === 'number' &&
      Number.isSafeInteger(token.expires_in) &&
      token.expires_in > 1 &&
      (token.refresh_token === undefined || (typeof token.refresh_token === 'string' && !!token.refresh_token))
    );
  }

  private currentGrant(req: Request): ApiGatewayGrant | null {
    const sub: unknown = req.oidc?.user?.['sub'];
    if (!req.oidc?.isAuthenticated() || typeof sub !== 'string' || !sub) return null;
    return { sub, issuer: `${this.issuer}/`, audience: this.audience, clientId: this.clientId };
  }

  private matchesGrant(req: Request, value: ApiGatewayGrant | undefined): boolean {
    const grant = this.currentGrant(req);
    return (
      !!value && !!grant && value.sub === grant.sub && value.issuer === grant.issuer && value.audience === grant.audience && value.clientId === grant.clientId
    );
  }

  private storeToken(req: Request, token: ApiGatewayTokenResponse, grant: ApiGatewayGrant, expiresAt: number): void {
    if (!req.appSession) return;
    req.appSession.apiGatewayGrant = { sub: grant.sub, issuer: grant.issuer, audience: grant.audience, clientId: grant.clientId };
    req.appSession.apiGatewayToken = token.access_token;
    req.appSession.apiGatewayTokenExpiresAt = expiresAt;
    if (token.refresh_token) req.appSession.apiGatewayRefreshToken = token.refresh_token;
    req.apiGatewayToken = token.access_token;
  }

  private clearAccessToken(req: Request): void {
    delete req.apiGatewayToken;
    delete req.appSession?.apiGatewayToken;
    delete req.appSession?.apiGatewayTokenExpiresAt;
  }

  private clearGrant(req: Request): void {
    this.clearAccessToken(req);
    delete req.appSession?.apiGatewayRefreshToken;
    delete req.appSession?.apiGatewayGrant;
  }

  private stateKey(state: string): string | null {
    const key = buildAuthStateCacheKey(state);
    return key ? `${key}:api-gateway` : null;
  }

  private digest(value: string, encoding: 'hex' | 'base64url' = 'hex'): string {
    return createHash('sha256').update(value).digest(encoding);
  }
}

export const apiGatewayAuthService = new ApiGatewayAuthService();
