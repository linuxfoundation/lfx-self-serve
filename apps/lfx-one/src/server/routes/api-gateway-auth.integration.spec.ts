// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import type { SessionStorePayload } from '@lfx-one/shared/interfaces';
import express, { type NextFunction, type Request, type Response } from 'express';
import { auth } from 'express-openid-connect';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { from, lastValueFrom, mergeMap } from 'rxjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { stubConstructor, valkey } = vi.hoisted(() => ({
  stubConstructor: vi.fn(function (this: object) {
    return this;
  }),
  valkey: { isEnabled: vi.fn(() => false), setJson: vi.fn(), getdelJson: vi.fn() },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), info: vi.fn(), warning: vi.fn(), debug: vi.fn(), error: vi.fn(), getLastOperation: vi.fn() },
}));
vi.mock('../services/valkey.service', () => ({
  valkeyService: valkey,
  buildAuthStateCacheKey: (state: string) => `lfx-ui:auth-state:v1:${state}`,
}));
// Exercise Developer Settings and Salesforce ID without connecting their unrelated
// collaborators; OIDC, Gateway auth, session persistence and profile HTTP requests are real.
vi.mock('../services/auth0.service', () => ({ Auth0Service: stubConstructor }));
vi.mock('../services/cdp.service', () => ({ CdpService: stubConstructor }));
vi.mock('../services/email-verification.service', () => ({ EmailVerificationService: stubConstructor }));
vi.mock('../services/enrollment.service', () => ({ EnrollmentService: stubConstructor }));
vi.mock('../services/forwards.service', () => ({ ForwardsService: stubConstructor }));
vi.mock('../services/meeting-preference.service', () => ({ MeetingPreferenceService: stubConstructor }));
vi.mock('../services/object-store.service', () => ({ ObjectStoreService: stubConstructor }));
vi.mock('../services/social-verification.service', () => ({ SocialVerificationService: stubConstructor }));
vi.mock('../services/profile-auth.service', () => ({ ProfileAuthService: stubConstructor }));
vi.mock('../services/nats.service', () => ({ NatsService: stubConstructor }));
vi.mock('../services/snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({}) } }));
vi.mock('../services/meeting.service', () => ({ MeetingService: stubConstructor }));
vi.mock('../services/project.service', () => ({ ProjectService: stubConstructor }));
vi.mock('../services/microservice-proxy.service', () => ({ MicroserviceProxyService: stubConstructor }));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: stubConstructor }));
vi.mock('../services/committee.service', () => ({ CommitteeService: stubConstructor }));
vi.mock('../services/formation.service', () => ({ formationService: {} }));

import { ProfileController } from '../controllers/profile.controller';
import { UserController } from '../controllers/user.controller';
import { apiGatewayAuthInterceptor } from '../../app/shared/interceptors/api-gateway-auth.interceptor';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { validateAndSanitizeUrl } from '../helpers/url-validation';
import { authMiddleware } from '../middleware/auth.middleware';
import { apiErrorHandler } from '../middleware/error-handler.middleware';
import { apiRateLimiter, authRateLimiter, publicApiRateLimiter } from '../middleware/rate-limit.middleware';
import { REWARD_PROMOTIONS_PAGE_SIZE } from '../constants';
import { ClaService } from '../services/cla.service';
import { OrgClaService } from '../services/org-cla.service';
import { RewardsService } from '../services/rewards.service';
import apiGatewayAuthRouter from './api-gateway-auth.route';

describe('Gateway grant with real express-openid-connect and persisted sessions', () => {
  const sessions = new Map<string, SessionStorePayload>();
  const tokenRequests: Record<string, string>[] = [];
  const upstreamAuthorizations: string[] = [];
  const upstreamPaths: string[] = [];
  const cookies = new Map<string, string>();
  const targetSalesforceId = '005000000000001AAA';
  const claGroupId = '11111111-2222-4333-8444-555555555555';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let issuerServer: Server;
  let bffServer: Server;
  let issuer: string;
  let baseUrl: string;
  let nonce: string;
  let failRefresh = false;
  let primaryAccessToken: string;
  let gatewayAccessToken: string;

  function jwt(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const data = `${header}.${payload}`;
    return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
  }

  function accessToken(audience: string): string {
    return jwt({
      iss: issuer,
      sub: 'auth0|synthetic-user',
      aud: audience,
      azp: 'self-serve-client',
      scope: 'openid email profile access:api offline_access',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  async function listen(app: express.Express): Promise<Server> {
    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
  }

  async function close(server?: Server): Promise<void> {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  async function send(path: string, method = 'GET', accept = 'text/html'): Promise<globalThis.Response> {
    // Node fetch forces Sec-Fetch-Mode:cors. Use HTTP to model a browser navigation
    // without weakening the real middleware's prohibition on redirecting fetch/XHR.
    const incoming = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = httpRequest(
        `${baseUrl}${path}`,
        {
          method,
          headers: {
            Accept: accept,
            Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
            ...(accept === 'text/html' ? { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } : {}),
          },
        },
        resolve
      );
      req.on('error', reject);
      req.end();
    });
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    const result = new globalThis.Response(Buffer.concat(chunks), { status: incoming.statusCode, headers });
    for (const cookie of result.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const separator = pair.indexOf('=');
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) cookies.set(key, value);
      else cookies.delete(key);
    }
    return result;
  }

  async function login(returnTo = '/org/acme/easycla'): Promise<void> {
    const start = await send(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location')!);
    nonce = location.searchParams.get('nonce')!;
    expect(location.searchParams.get('audience')).toBe('https://v2.example/');
    const callback = await send(`/callback?code=primary-code&state=${encodeURIComponent(location.searchParams.get('state')!)}`);
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get('location')!, baseUrl).pathname).toBe(returnTo);
    expect(sessions.size).toBe(1);
  }

  async function gatewayLogin(): Promise<void> {
    const page = await send('/org/acme/easycla?tab=agreements');
    expect(page.status).toBe(302);
    const location = new URL(page.headers.get('location')!);
    expect(location.searchParams.get('audience')).toBe(`${issuer}gateway/`);
    expect(location.searchParams.get('redirect_uri')).toBe(`${baseUrl}/api-gateway/callback`);
    const callback = await send(`/api-gateway/callback?code=gateway-code&state=${location.searchParams.get('state')}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/org/acme/easycla?tab=agreements');
    expect(callback.headers.get('cache-control')).toBe('no-store');
    expect(callback.headers.get('referrer-policy')).toBe('no-referrer');
  }

  beforeAll(async () => {
    const provider = express();
    provider.use(express.urlencoded({ extended: false }));
    provider.get('/.well-known/openid-configuration', (_req, res) =>
      res.json({
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}oauth/token`,
        jwks_uri: `${issuer}jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      })
    );
    provider.get('/jwks', (_req, res) => res.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', use: 'sig', alg: 'RS256' }] }));
    provider.post('/oauth/token', (req, res) => {
      tokenRequests.push({ ...req.body });
      if (failRefresh && req.body.grant_type === 'refresh_token') {
        res.status(503).json({ error: 'temporarily_unavailable' });
        return;
      }
      const primary = req.body.code === 'primary-code' || req.body.refresh_token === 'primary-refresh';
      const now = Math.floor(Date.now() / 1000);
      res.json({
        access_token: primary ? primaryAccessToken : gatewayAccessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: primary ? 'primary-refresh' : 'gateway-refresh',
        ...(primary
          ? {
              id_token: jwt({
                iss: issuer,
                aud: 'self-serve-client',
                sub: 'auth0|synthetic-user',
                nickname: 'synthetic-user',
                name: 'Synthetic User',
                nonce,
                iat: now,
                exp: now + 3600,
              }),
            }
          : {}),
      });
    });
    provider.all('/resource', (req, res) => {
      upstreamAuthorizations.push(req.headers.authorization ?? '');
      res.json({ completed: true });
    });
    provider.use('/gateway', (req, _res, next) => {
      upstreamAuthorizations.push(req.headers.authorization ?? '');
      upstreamPaths.push(req.originalUrl);
      next();
    });
    provider.get('/gateway/user-service/v1/me', (_req, res) => {
      res.json({ ID: 'synthetic-profile-id' });
    });
    provider.get('/gateway/cla-service/v4/cla-group/search', (_req, res) => {
      res.json({
        results: [{ claGroupID: claGroupId, projectName: 'Synthetic Project', iclaEnabled: true, cclaEnabled: true, projectSFID: 'synthetic-project' }],
      });
    });
    provider.get('/gateway/cla-service/v4/template/:claGroupId/preview', (_req, res) => {
      res.type('application/pdf').send(Buffer.from('%PDF-1.7\nsynthetic preview\n%%EOF\n'));
    });
    provider.get('/gateway/user-service/v1/users', (_req, res) => {
      res.json({ Data: [{ ID: targetSalesforceId, Username: 'synthetic-target' }], Metadata: { TotalSize: 1 } });
    });
    provider.get(`/gateway/user-service/v1/users/${targetSalesforceId}`, (_req, res) => {
      res.json({ Username: 'synthetic-target', TuxRewards: 10 });
    });
    provider.get(`/gateway/user-service/v1/users/${targetSalesforceId}/promotions`, (_req, res) => {
      res.json({ Data: [], Metadata: { Offset: 0, PageSize: REWARD_PROMOTIONS_PAGE_SIZE, TotalSize: 0 } });
    });
    issuerServer = await listen(provider);
    issuer = `http://127.0.0.1:${(issuerServer.address() as AddressInfo).port}/`;
    expect((await fetch(`${issuer}.well-known/openid-configuration`)).status).toBe(200);
  });

  beforeEach(async () => {
    valkey.isEnabled.mockReturnValue(false);
    valkey.setJson.mockReset();
    valkey.getdelJson.mockReset();
    for (const limiter of [apiRateLimiter, authRateLimiter, publicApiRateLimiter]) limiter.resetKey('127.0.0.1');
    sessions.clear();
    cookies.clear();
    tokenRequests.length = 0;
    upstreamAuthorizations.length = 0;
    upstreamPaths.length = 0;
    failRefresh = false;
    primaryAccessToken = accessToken('https://v2.example/');
    gatewayAccessToken = accessToken(`${issuer}gateway/`);
    const app = express();
    bffServer = await listen(app);
    baseUrl = `http://127.0.0.1:${(bffServer.address() as AddressInfo).port}`;
    vi.stubEnv('PCC_BASE_URL', baseUrl);
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', issuer);
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'self-serve-client');
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'synthetic-client-secret');
    vi.stubEnv('API_GW_AUDIENCE', `${issuer}gateway/`);
    vi.stubEnv('CLA_SERVICE_URL', '');
    vi.stubEnv('CROWDFUNDING_API_AUDIENCE', '');
    app.use('/public/api/', publicApiRateLimiter);
    app.use(apiRateLimiter);
    app.use(
      auth({
        authRequired: false,
        auth0Logout: false,
        baseURL: baseUrl,
        issuerBaseURL: issuer,
        clientID: 'self-serve-client',
        clientSecret: 'synthetic-client-secret',
        secret: 'a-long-synthetic-cookie-encryption-secret',
        authorizationParams: {
          response_type: 'code',
          response_mode: 'query',
          audience: 'https://v2.example/',
          scope: 'openid email profile access:api offline_access',
        },
        routes: { login: false },
        session: {
          genid: () => randomBytes(32).toString('hex'),
          store: {
            async get(sid: string) {
              return structuredClone(sessions.get(sid));
            },
            async set(sid: string, value?: SessionStorePayload) {
              if (value) sessions.set(sid, structuredClone(value));
            },
            async destroy(sid: string) {
              sessions.delete(sid);
            },
          },
        },
      })
    );
    app.get('/login', authRateLimiter, (req, res) => res.oidc.login({ returnTo: validateAndSanitizeUrl(req.query['returnTo'] as string, [baseUrl]) ?? '/' }));
    app.use(authMiddleware);
    app.use(apiGatewayAuthRouter);
    const profile = new ProfileController();
    app.get('/api/profile/developer', (req, res, next) => profile.getDeveloperTokenInfo(req, res, next));
    const user = new UserController();
    app.get('/api/user/salesforce-id', (req, res, next) => user.getSalesforceId(req, res, next));
    const cla = new ClaService();
    const orgCla = new OrgClaService();
    const rewards = new RewardsService();
    app.get('/api/operator-read/me-catalogue', (req, res, next) => {
      void cla
        .searchClaGroups(req, 'synthetic')
        .then((data) => res.json(data))
        .catch(next);
    });
    app.get('/api/operator-read/org-catalogue', (req, res, next) => {
      void orgCla
        .getSignOptions(req, 'synthetic')
        .then((data) => res.json(data))
        .catch(next);
    });
    app.get('/api/operator-read/preview', (req, res, next) => {
      void orgCla
        .getCclaPreview(req, claGroupId)
        .then((data) => res.type('application/pdf').send(data))
        .catch(next);
    });
    app.get('/api/operator-read/rewards', (req, res, next) => {
      void rewards
        .getSummary(req)
        .then((data) => res.json(data))
        .catch(next);
    });
    app.get('/api/v2-only', (_req, res) => res.json({ primaryRoute: true }));
    app.all('/api/gateway-operation', async (req, res, next) => {
      try {
        res.json(
          await gatewayFetch(req, `${issuer}resource`, {
            operation: 'synthetic_operation',
            service: 'test',
            errorMessage: 'failed',
            errorCode: 'FAILED',
            method: req.method === 'POST' ? 'POST' : 'GET',
          })
        );
      } catch (error) {
        next(error);
      }
    });
    app.get('/org/acme/easycla', (_req, res) => res.type('html').send('<p>Application shell</p>'));
    app.get(/^\/(?:foundation|project)\/gw(?:\/.*)?$/, (_req, res) => res.type('html').send('<p>Gatewaze shell</p>'));
    app.get('/meetings/public-event', (_req, res) => res.type('html').send('<p>Public meeting</p>'));
    app.use((error: Error, req: Request, res: Response, next: NextFunction) => apiErrorHandler(error, req, res, next));
  });

  afterEach(async () => {
    await close(bffServer);
    vi.unstubAllEnvs();
  });
  afterAll(async () => close(issuerServer));

  it('persists the dedicated callback/RT and feeds Gateway without changing primary/CF/exported tokens', async () => {
    await login();
    const initial = [...sessions.values()][0];
    initial.data['crowdfundingToken'] = 'existing-cf-token';
    initial.data['crowdfundingTokenExpiresAt'] = Math.floor(Date.now() / 1000) + 3600;
    initial.data['crowdfundingRefreshToken'] = 'existing-cf-refresh';
    await gatewayLogin();
    const shell = await send('/org/acme/easycla?tab=agreements');
    expect(shell.status).toBe(200);
    expect(await shell.text()).not.toContain(gatewayAccessToken);

    const operation = await send('/api/gateway-operation', 'POST', 'application/json');
    expect(operation.status).toBe(200);
    expect(await operation.json()).toEqual({ completed: true });
    expect(upstreamAuthorizations).toEqual([`Bearer ${gatewayAccessToken}`]);

    const exported = await send('/api/profile/developer', 'GET', 'application/json');
    expect(exported.status).toBe(200);
    expect(await exported.json()).toEqual({ token: primaryAccessToken, type: 'Bearer' });
    expect(exported.headers.get('cache-control')).toContain('no-store');
    const session = [...sessions.values()][0].data;
    expect(session).toMatchObject({
      access_token: primaryAccessToken,
      refresh_token: 'primary-refresh',
      apiGatewayToken: gatewayAccessToken,
      apiGatewayRefreshToken: 'gateway-refresh',
      crowdfundingToken: 'existing-cf-token',
      crowdfundingRefreshToken: 'existing-cf-refresh',
    });
    expect(tokenRequests.map((body) => body['grant_type'])).toEqual(['authorization_code', 'authorization_code']);
    expect(tokenRequests[1]).toMatchObject({ code: 'gateway-code', redirect_uri: `${baseUrl}/api-gateway/callback`, client_id: 'self-serve-client' });
    expect(tokenRequests[1]['code_verifier']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...cookies.values()].join(' ')).not.toContain(gatewayAccessToken);
  });

  it('returns a JSON challenge for an API write without replay or primary-token fallback', async () => {
    await login();
    const denied = await send('/api/gateway-operation', 'POST', 'application/json');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('location')).toBeNull();
    expect(await denied.json()).toMatchObject({ code: 'API_GATEWAY_AUTH_REQUIRED', details: { authorize_url: '/api-gateway/auth/start' } });
    expect(upstreamAuthorizations).toEqual([]);
    expect(tokenRequests).toHaveLength(1);
    expect((await send('/api/v2-only', 'GET', 'application/json')).status).toBe(200);
    expect(tokenRequests).toHaveLength(1);
  });

  it.each(['/api-gateway/auth/start', '/api-gateway/callback'])('returns the standard authorization envelope for XHR %s', async (path) => {
    await login();
    const denied = await send(path, 'GET', 'application/json');
    const body: unknown = await denied.json();

    expect(denied.status).toBe(403);
    expect(body).toMatchObject({ code: 'API_GATEWAY_AUTH_REQUIRED', details: { authorize_url: '/api-gateway/auth/start' } });
    expect(body).not.toHaveProperty('authorize_url');
    expect(denied.headers.get('location')).toBeNull();
    expect(denied.headers.get('cache-control')).toBe('no-store');
    expect(tokenRequests).toHaveLength(1);
    expect(upstreamAuthorizations).toEqual([]);
  });

  it.each(['/foundation/gw/newsletters', '/project/gw/newsletters'])('renders %s without an extra OAuth round trip before fragment adoption', async (path) => {
    await login('/meetings/public-event');
    const browserUrl = new URL(`${baseUrl}${path}?project=synthetic-project&gw_state=synthetic-state#access_token=gw-access&refresh_token=gw-refresh`);
    const page = await send(`${browserUrl.pathname}${browserUrl.search}`);

    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    expect(await page.text()).toBe('<p>Gatewaze shell</p>');
    expect([...sessions.values()][0].data['apiGatewayAuthAttempted']).toBeUndefined();
    expect(tokenRequests).toHaveLength(1);

    const operation = await send('/api/gateway-operation', 'POST', 'application/json');
    expect(operation.status).toBe(403);
    expect(await operation.json()).toMatchObject({ code: 'API_GATEWAY_AUTH_REQUIRED' });
    expect(upstreamAuthorizations).toEqual([]);
  });

  it.each(['refused', 'rejected'] as const)('recovers automatic navigation after a %s auth-state write across persisted sessions', async (failure) => {
    await login();
    valkey.isEnabled.mockReturnValue(true);
    if (failure === 'rejected') valkey.setJson.mockRejectedValueOnce(new Error('state-store unavailable'));
    else valkey.setJson.mockResolvedValueOnce(false);
    valkey.setJson.mockResolvedValue(true);

    const unavailable = await send('/org/acme/easycla');
    expect(unavailable.status).toBe(200);
    expect(unavailable.headers.get('location')).toBeNull();
    expect([...sessions.values()][0].data['apiGatewayAuthAttempted']).toBeUndefined();
    expect([...sessions.values()][0].data['apiGatewayAuthState']).toBeUndefined();

    const recovered = await send('/org/acme/easycla');
    expect(recovered.status).toBe(302);
    expect(new URL(recovered.headers.get('location')!).searchParams.get('audience')).toBe(`${issuer}gateway/`);
    expect([...sessions.values()][0].data['apiGatewayAuthAttempted']).toBe(true);
    expect(valkey.setJson).toHaveBeenCalledTimes(2);
    expect(tokenRequests).toHaveLength(1);

    expect((await send('/org/acme/easycla')).status).toBe(200);
    expect(valkey.setJson).toHaveBeenCalledTimes(2);
  });

  it('rejects excess requests before refreshing tokens or starting document authorization', async () => {
    await login();
    apiRateLimiter.resetKey('127.0.0.1');
    for (let attempt = 0; attempt < 500; attempt++) {
      expect((await send('/api/v2-only', 'GET', 'application/json')).status).toBe(200);
    }
    [...sessions.values()][0].data['expires_at'] = String(Math.floor(Date.now() / 1000) - 1);

    const rejected = await send('/api/v2-only', 'GET', 'application/json');
    expect(rejected.status).toBe(429);
    expect(tokenRequests).toHaveLength(1);
    expect((await send('/org/acme/easycla')).status).toBe(429);
    expect([...sessions.values()][0].data['apiGatewayAuthState']).toBeUndefined();
    expect(upstreamAuthorizations).toEqual([]);
  });

  it('rate-limits login before initiating another authorization request', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await send('/login')).status).toBe(302);
    }
    const rejected = await send('/login');
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get('location')).toBeNull();
    expect(tokenRequests).toEqual([]);
  });

  it.each([
    ['POST', '/api/gateway-operation', { completed: true }],
    ['GET', '/api/user/salesforce-id', { id: 'synthetic-profile-id' }],
  ] as const)('recovers SPA navigation from a public page without replaying %s %s', async (method, path, expected) => {
    await login('/meetings/public-event');
    expect((await send('/meetings/public-event')).status).toBe(200);
    expect(tokenRequests).toHaveLength(1);
    const location = { pathname: '/org/acme/easycla', search: '?tab=agreements', hash: '#active', href: '' };
    const injector = Injector.create({
      providers: [
        { provide: DOCUMENT, useValue: { location } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    const request = new HttpRequest(method, path, null);
    const next = vi.fn((req: HttpRequest<unknown>) =>
      from(send(req.url, req.method, 'application/json')).pipe(
        mergeMap(async (response) => {
          const body: unknown = await response.json();
          if (!response.ok) throw new HttpErrorResponse({ status: response.status, error: body, url: req.url });
          return new HttpResponse({ status: response.status, body });
        })
      )
    );
    try {
      await lastValueFrom(
        runInInjectionContext(injector, () => apiGatewayAuthInterceptor(request, next)),
        { defaultValue: undefined }
      );
    } finally {
      injector.destroy();
    }
    expect(next).toHaveBeenCalledExactlyOnceWith(request);
    expect(upstreamAuthorizations).toEqual([]);
    expect(location.href).toBe('/api-gateway/auth/start?returnTo=%2Forg%2Facme%2Feasycla%3Ftab%3Dagreements%23active');

    const start = await send(location.href);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location')!);
    const callback = await send(`/api-gateway/callback?code=gateway-code&state=${authorize.searchParams.get('state')}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/org/acme/easycla?tab=agreements#active');
    expect(tokenRequests).toHaveLength(2);
    expect(upstreamAuthorizations).toEqual([]);
    const retried = await send(path, method, 'application/json');
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(expected);
    expect(upstreamAuthorizations).toHaveLength(1);
    expect(upstreamAuthorizations[0]).not.toContain(primaryAccessToken);
  });

  it('refreshes the Gateway grant with its own RT across real request/session snapshots', async () => {
    await login();
    await gatewayLogin();
    [...sessions.values()][0].data['apiGatewayTokenExpiresAt'] = Math.floor(Date.now() / 1000) - 1;
    expect((await send('/api/gateway-operation', 'GET', 'application/json')).status).toBe(200);
    expect(tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'gateway-refresh', audience: `${issuer}gateway/` });
    expect([...sessions.values()][0].data['refresh_token']).toBe('primary-refresh');
    expect([...sessions.values()][0].data['apiGatewayTokenExpiresAt']).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('preserves the Gateway grant when express-openid-connect refreshes the primary token', async () => {
    await login();
    await gatewayLogin();
    [...sessions.values()][0].data['expires_at'] = String(Math.floor(Date.now() / 1000) - 1);
    expect((await send('/api/gateway-operation', 'GET', 'application/json')).status).toBe(200);
    expect(tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'primary-refresh' });
    expect(tokenRequests).toHaveLength(3);
    expect([...sessions.values()][0].data).toMatchObject({
      access_token: primaryAccessToken,
      apiGatewayToken: gatewayAccessToken,
      apiGatewayRefreshToken: 'gateway-refresh',
    });
  });

  it.each([false, true])('keeps real CLA/Rewards service reads working during impersonation (expired grant: %s)', async (expired) => {
    await login();
    await gatewayLogin();
    const session = [...sessions.values()][0].data;
    const targetToken = jwt({ sub: 'auth0|synthetic-target', aud: 'https://v2.example/', exp: Math.floor(Date.now() / 1000) + 3600 });
    session['impersonationToken'] = targetToken;
    session['impersonationExpiresAt'] = Date.now() + 3600_000;
    session['impersonationUser'] = { sub: 'auth0|synthetic-target', username: 'synthetic-target', email: 'target@example.com' };
    if (expired) session['apiGatewayTokenExpiresAt'] = Math.floor(Date.now() / 1000) - 1;

    for (const path of ['/api/operator-read/me-catalogue', '/api/operator-read/org-catalogue']) {
      const response = await send(path, 'GET', 'application/json');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ resultCount: 1, results: [{ claGroupId }] });
    }
    const preview = await send('/api/operator-read/preview', 'GET', 'application/pdf');
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('%PDF-1.7');
    const rewards = await send('/api/operator-read/rewards', 'GET', 'application/json');
    expect(rewards.status).toBe(200);
    expect(await rewards.json()).toMatchObject({
      readOnly: true,
      points: 10,
      availability: { profile: 'available', promotions: 'available' },
    });
    expect(upstreamAuthorizations).toEqual(Array.from({ length: 6 }, () => `Bearer ${gatewayAccessToken}`));
    expect(upstreamPaths).toEqual(
      expect.arrayContaining([
        '/gateway/cla-service/v4/cla-group/search?searchTerm=synthetic',
        `/gateway/cla-service/v4/template/${claGroupId}/preview?claType=ccla&watermark=true`,
        '/gateway/user-service/v1/users?username=synthetic-target&pageSize=2&offset=0',
        `/gateway/user-service/v1/users/${targetSalesforceId}`,
        `/gateway/user-service/v1/users/${targetSalesforceId}/promotions?offset=0&pageSize=${REWARD_PROMOTIONS_PAGE_SIZE}`,
      ])
    );
    expect(tokenRequests).toHaveLength(expired ? 3 : 2);
    if (expired) expect(tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'gateway-refresh' });

    for (const method of ['GET', 'POST']) {
      const denied = await send('/api/gateway-operation', method, 'application/json');
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: 'IMPERSONATION_READ_ONLY' });
    }
    expect((await send('/api/profile/developer', 'GET', 'application/json')).status).toBe(403);
    expect(upstreamAuthorizations).toHaveLength(6);
    expect([...sessions.values()][0].data['impersonationToken']).toBe(targetToken);
    expect([...sessions.values()][0].data['refresh_token']).toBe('primary-refresh');
  });

  it('rejects a v2 token returned for the Gateway code instead of caching or forwarding it', async () => {
    await login();
    gatewayAccessToken = primaryAccessToken;
    const page = await send('/org/acme/easycla');
    const authorize = new URL(page.headers.get('location')!);
    const callback = await send(`/api-gateway/callback?code=gateway-code&state=${authorize.searchParams.get('state')}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/org/acme/easycla?api_gateway_error=authorization_failed');
    expect((await send('/api/gateway-operation', 'POST', 'application/json')).status).toBe(403);
    expect(upstreamAuthorizations).toEqual([]);
    expect([...sessions.values()][0].data['apiGatewayToken']).toBeUndefined();
    expect([...sessions.values()][0].data['apiGatewayRefreshToken']).toBeUndefined();
    expect([...sessions.values()][0].data['refresh_token']).toBe('primary-refresh');
  });

  it('keeps primary routes authenticated during a Gateway outage and retains the dedicated RT', async () => {
    await login();
    await gatewayLogin();
    [...sessions.values()][0].data['apiGatewayTokenExpiresAt'] = Math.floor(Date.now() / 1000) - 1;
    failRefresh = true;
    expect((await send('/api/v2-only', 'GET', 'application/json')).status).toBe(200);
    const operation = await send('/api/gateway-operation', 'POST', 'application/json');
    expect(operation.status).toBe(503);
    expect(operation.headers.get('location')).toBeNull();
    expect(upstreamAuthorizations).toEqual([]);
    expect([...sessions.values()][0].data['apiGatewayRefreshToken']).toBe('gateway-refresh');
    expect([...sessions.values()][0].data['refresh_token']).toBe('primary-refresh');
  });
});
