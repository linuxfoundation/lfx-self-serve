// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { ApiGatewayAuthState, ApiGatewayGrant } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { valkey, log } = vi.hoisted(() => ({
  valkey: { isEnabled: vi.fn(), setJson: vi.fn(), getdelJson: vi.fn() },
  log: { warning: vi.fn() },
}));
vi.mock('./valkey.service', () => ({
  valkeyService: valkey,
  buildAuthStateCacheKey: (state: string) => `lfx-ui:auth-state:v1:${state}`,
}));
vi.mock('./logger.service', () => ({ logger: log }));

import { ApiGatewayAuthService } from './api-gateway-auth.service';

describe('ApiGatewayAuthService', () => {
  const now = 1_800_000_000;
  const grant: ApiGatewayGrant = {
    sub: 'auth0|synthetic-user',
    issuer: 'https://issuer.example/',
    audience: 'https://gateway.example/',
    clientId: 'self-serve-client',
  };
  let service: ApiGatewayAuthService;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  function request(session: NonNullable<Request['appSession']> = {}): Request {
    return {
      appSession: { refresh_token: 'primary-refresh', crowdfundingToken: 'cf-token', crowdfundingRefreshToken: 'cf-refresh', ...session },
      bearerToken: 'primary-token',
      oidc: { isAuthenticated: () => true, user: { sub: grant.sub }, accessToken: { access_token: 'primary-token' } },
    } as unknown as Request;
  }

  function jwt(overrides: Record<string, unknown> = {}): string {
    const claims = {
      sub: grant.sub,
      iss: grant.issuer,
      aud: [grant.audience, 'https://issuer.example/userinfo'],
      azp: grant.clientId,
      scope: 'openid email profile access:api offline_access',
      exp: now + 3600,
      ...overrides,
    };
    return `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  }

  function tokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { access_token: jwt(), token_type: 'Bearer', expires_in: 3600, refresh_token: 'gateway-refresh', ...overrides };
  }

  function cache(token = jwt()): NonNullable<Request['appSession']> {
    return {
      apiGatewayToken: token,
      apiGatewayTokenExpiresAt: now + 3300,
      apiGatewayRefreshToken: 'gateway-refresh',
      apiGatewayGrant: { ...grant },
    };
  }

  async function stateFor(req: Request): Promise<ApiGatewayAuthState> {
    const url = new URL(await service.getAuthorizationUrl(req, '/org/acme/easycla?tab=agreements'));
    return (await service.consumeAuthState(req, url.searchParams.get('state')))!;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now * 1000);
    vi.stubEnv('PCC_AUTH0_CLIENT_ID', grant.clientId);
    vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'synthetic-client-secret');
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', grant.issuer);
    vi.stubEnv('PCC_BASE_URL', 'https://self-serve.example/');
    vi.stubEnv('API_GW_AUDIENCE', grant.audience);
    valkey.isEnabled.mockReturnValue(false);
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    service = new ApiGatewayAuthService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('authorizes the Gateway audience with the same client, access:api, offline_access and PKCE', async () => {
    const req = request();
    const url = new URL(await service.getAuthorizationUrl(req, '/org/acme/easycla?tab=agreements'));
    const stored = req.appSession!.apiGatewayAuthState!;
    expect(url.origin + url.pathname).toBe('https://issuer.example/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      client_id: grant.clientId,
      audience: grant.audience,
      redirect_uri: 'https://self-serve.example/api-gateway/callback',
      scope: 'openid email profile access:api offline_access',
      prompt: 'none',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(stored.codeVerifier).digest('base64url'));
    expect(stored).toMatchObject({ ...grant, silent: true, returnTo: '/org/acme/easycla?tab=agreements' });
    expect(stored.state).toMatch(/^[a-f0-9]{64}$/);
    expect(req.appSession!.apiGatewayAuthAttempted).toBe(true);
    expect(url.href).not.toContain('synthetic-client-secret');
    expect(url.href).not.toContain(stored.codeVerifier);
  });

  it('exchanges the code with the dedicated callback and stores only the secondary token/RT', async () => {
    const req = request();
    const state = await stateFor(req);
    fetchMock.mockResolvedValue(Response.json(tokenResponse()));

    await service.exchangeCode(req, 'synthetic-code', state);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://issuer.example/oauth/token');
    expect(Object.fromEntries(new URLSearchParams(String(options!.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'synthetic-code',
      redirect_uri: 'https://self-serve.example/api-gateway/callback',
      code_verifier: state.codeVerifier,
      client_id: grant.clientId,
      client_secret: 'synthetic-client-secret',
    });
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(req.appSession).toMatchObject({
      apiGatewayToken: jwt(),
      apiGatewayTokenExpiresAt: now + 3300,
      apiGatewayRefreshToken: 'gateway-refresh',
      refresh_token: 'primary-refresh',
      crowdfundingToken: 'cf-token',
      crowdfundingRefreshToken: 'cf-refresh',
    });
    expect(req.bearerToken).toBe('primary-token');
    expect(req.oidc.accessToken!.access_token).toBe('primary-token');
    expect(req.appSession!.apiGatewayAuthAttempted).toBeUndefined();
    expect(service.getCachedToken(req)).toBe(jwt());
  });

  it.each([
    ['wrong audience', { access_token: jwt({ aud: 'https://v2.example/' }) }],
    ['malformed audience array', { access_token: jwt({ aud: [grant.audience, 17] }) }],
    ['wrong subject', { access_token: jwt({ sub: 'auth0|another-user' }) }],
    ['wrong issuer', { access_token: jwt({ iss: 'https://other-issuer.example/' }) }],
    ['wrong client', { access_token: jwt({ azp: 'other-client' }) }],
    ['missing client', { access_token: jwt({ azp: undefined }) }],
    ['conflicting client', { access_token: jwt({ client_id: 'other-client' }) }],
    ['missing scope', { access_token: jwt({ scope: 'openid profile' }) }],
    ['expired', { access_token: jwt({ exp: now }) }],
    ['not yet valid', { access_token: jwt({ nbf: now + 60 }) }],
    ['missing expiry', { access_token: jwt({ exp: undefined }) }],
    ['fractional expiry', { access_token: jwt({ exp: now + 3600.5 }) }],
    ['malformed', { access_token: 'not-a-jwt' }],
    ['non-object payload', { access_token: 'header.bnVsbA.signature' }],
    ['invalid header', { access_token: jwt().replace(/^[^.]+/, Buffer.from('null').toString('base64url')) }],
    ['unsigned algorithm', { access_token: jwt().replace(/^[^.]+/, Buffer.from('{"alg":"none"}').toString('base64url')) }],
    ['unsigned token', { access_token: jwt().replace(/[^.]+$/, '') }],
    ['bad lifetime', { expires_in: -1 }],
    ['fractional lifetime', { expires_in: 3600.5 }],
    ['string lifetime', { expires_in: '3600' }],
    ['wrong type', { token_type: 'Basic' }],
    ['no dedicated refresh token', { refresh_token: undefined }],
  ])('rejects a newly returned %s token without touching primary/CF tokens', async (_description, overrides) => {
    const req = request();
    const state = await stateFor(req);
    fetchMock.mockResolvedValue(Response.json(tokenResponse(overrides)));
    await expect(service.exchangeCode(req, 'synthetic-code', state)).rejects.toThrow('API Gateway authorization could not be completed');
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(req.appSession!.crowdfundingRefreshToken).toBe('cf-refresh');
  });

  it('accepts a scalar audience and caps the cache lifetime at the JWT expiry, including short lifetimes', async () => {
    const req = request();
    const state = await stateFor(req);
    fetchMock.mockResolvedValue(Response.json(tokenResponse({ access_token: jwt({ aud: grant.audience, exp: now + 100 }) })));
    await service.exchangeCode(req, 'synthetic-code', state);
    expect(req.appSession!.apiGatewayTokenExpiresAt).toBe(now + 50);
    vi.setSystemTime((now + 50) * 1000);
    expect(service.getCachedToken(req)).toBeNull();
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
  });

  it('invalidates legacy cached tokens rather than trusting the named slot or using the primary RT', async () => {
    const req = request({ apiGatewayToken: jwt({ aud: 'https://v2.example/' }), apiGatewayTokenExpiresAt: now + 3600 });
    expect(await service.loadToken(req)).toBe('required');
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong audience', jwt({ aud: 'https://v2.example/' })],
    ['malformed token', 'not-a-jwt'],
    ['wrong issuer', jwt({ iss: 'https://other.example/' })],
    ['wrong client', jwt({ azp: 'other-client' })],
    ['wrong subject', jwt({ sub: 'auth0|other' })],
  ])('discards a %s cache and its untrusted grant', async (_description, token) => {
    const req = request(cache(token));
    expect(await service.loadToken(req)).toBe('required');
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not accept a grant from another audience/client/user', async () => {
    for (const changed of [{ sub: 'auth0|other' }, { clientId: 'other-client' }, { audience: 'https://v2.example/' }]) {
      const other = request({ ...cache(), apiGatewayGrant: { ...grant, ...changed } });
      expect(await service.loadToken(other)).toBe('required');
      expect(other.appSession!.apiGatewayRefreshToken).toBeUndefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a valid cache without a token request', async () => {
    const req = request(cache());
    expect(await service.loadToken(req)).toBe('ready');
    expect(req.apiGatewayToken).toBe(jwt());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes with the Gateway RT, rotates it and preserves all other grants', async () => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now - 1 });
    fetchMock.mockResolvedValue(Response.json(tokenResponse({ refresh_token: 'rotated-gateway-refresh', access_token: jwt({ exp: now + 7200 }) })));
    expect(await service.loadToken(req)).toBe('ready');
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]!.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('gateway-refresh');
    expect(body.get('audience')).toBe(grant.audience);
    expect(body.toString()).not.toContain('primary-refresh');
    expect(req.appSession!.apiGatewayRefreshToken).toBe('rotated-gateway-refresh');
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    expect(req.appSession!.crowdfundingRefreshToken).toBe('cf-refresh');
  });

  it('keeps the dedicated RT when refresh succeeds without rotation', async () => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    fetchMock.mockResolvedValue(Response.json(tokenResponse({ refresh_token: undefined })));
    expect(await service.loadToken(req)).toBe('ready');
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
  });

  it.each([429, 500, 503])('retains the RT on transient HTTP %s failures', async (status) => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant', error_description: 'never-log-this' }, { status }));
    expect(await service.loadToken(req)).toBe('unavailable');
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
    expect(req.apiGatewayToken).toBeUndefined();
    expect(JSON.stringify(log.warning.mock.calls.map((call) => call.slice(1)))).not.toContain('never-log-this');
  });

  it('retains the RT on a timeout and retries successfully on the next request', async () => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    fetchMock.mockRejectedValueOnce(new DOMException('secret-from-transport', 'TimeoutError')).mockResolvedValueOnce(Response.json(tokenResponse()));
    expect(await service.loadToken(req)).toBe('unavailable');
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
    expect(await service.loadToken(req)).toBe('ready');
    expect(JSON.stringify(log.warning.mock.calls.map((call) => call.slice(1)))).not.toContain('secret-from-transport');
  });

  it.each([400, 403])('clears only the dedicated grant on terminal invalid_grant (%s), allowing navigation to reauthorize', async (status) => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now, apiGatewayAuthAttempted: true });
    fetchMock.mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status }));
    expect(await service.loadToken(req)).toBe('required');
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
    expect(req.appSession!.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayAuthAttempted).toBeUndefined();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
  });

  it('rejects a wrong-audience refresh response instead of forwarding it', async () => {
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    fetchMock.mockResolvedValue(Response.json(tokenResponse({ access_token: jwt({ aud: 'https://v2.example/' }) })));
    expect(await service.loadToken(req)).toBe('required');
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
  });

  it('single-flights refresh and updates every independent request/session snapshot', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const first = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    const second = request(structuredClone(first.appSession!));
    const pending = [service.loadToken(first), service.loadToken(second)];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(Response.json(tokenResponse({ refresh_token: 'rotated-pair' })));
    expect(await Promise.all(pending)).toEqual(['ready', 'ready']);
    for (const req of [first, second]) {
      expect(req.apiGatewayToken).toBe(jwt());
      expect(req.appSession!.apiGatewayRefreshToken).toBe('rotated-pair');
    }
  });

  it('also populates each request when concurrent callers share a session object', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const first = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    const second = request();
    second.appSession = first.appSession;
    const pending = [service.loadToken(first), service.loadToken(second)];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(Response.json(tokenResponse({ refresh_token: 'rotated-pair' })));
    expect(await Promise.all(pending)).toEqual(['ready', 'ready']);
    for (const req of [first, second]) expect(req.apiGatewayToken).toBe(jwt());
  });

  it('applies terminal cleanup to every waiter without poisoning the primary token', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const first = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    const second = request(structuredClone(first.appSession!));
    const pending = [service.loadToken(first), service.loadToken(second)];
    finish(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect(await Promise.all(pending)).toEqual(['required', 'required']);
    for (const req of [first, second]) {
      expect(req.appSession!.apiGatewayRefreshToken).toBeUndefined();
      expect(req.appSession!['refresh_token']).toBe('primary-refresh');
    }
  });

  it('never recreates an OIDC session that was cleared while refresh was in flight', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    const pending = service.loadToken(req);
    req.appSession = null;
    finish(Response.json(tokenResponse()));
    expect(await pending).toBe('required');
    expect(req.appSession).toBeNull();
    expect(req.apiGatewayToken).toBeUndefined();
  });

  it.each(['subject', 'impersonation'] as const)('does not restore real-user credentials after %s changes during a refresh', async (change) => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const req = request({ ...cache(), apiGatewayTokenExpiresAt: now });
    const pending = service.loadToken(req);
    if (change === 'subject') req.oidc.user!['sub'] = 'auth0|another-user';
    else req.impersonationActive = true;
    finish(Response.json(tokenResponse({ refresh_token: 'rotated-pair' })));
    expect(await pending).toBe('required');
    expect(req.apiGatewayToken).toBeUndefined();
    expect(req.appSession!.apiGatewayRefreshToken).toBe('gateway-refresh');
  });

  it('never acquires or exposes the real user Gateway token during impersonation', async () => {
    const req = request(cache());
    req.impersonationActive = true;
    expect(await service.loadToken(req)).toBe('impersonating');
    expect(req.apiGatewayToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.getAuthorizationUrl(req, '/')).rejects.toThrow('non-impersonated');
  });

  it('requires the original subject and one unexpired, single-use state even on the session fallback', async () => {
    const req = request();
    await service.getAuthorizationUrl(req, '/org/acme');
    const state = req.appSession!.apiGatewayAuthState!.state;
    expect(await service.consumeAuthState(req, '0'.repeat(64))).toBeNull();
    expect(req.appSession!.apiGatewayAuthState!.state).toBe(state);
    expect(await service.consumeAuthState(req, state)).toMatchObject({ sub: grant.sub });
    expect(await service.consumeAuthState(req, state)).toBeNull();

    await service.getAuthorizationUrl(req, '/');
    req.appSession!.apiGatewayAuthState!.sub = 'auth0|other';
    expect(await service.consumeAuthState(req, req.appSession!.apiGatewayAuthState!.state)).toBeNull();
    await service.getAuthorizationUrl(req, '/');
    vi.setSystemTime((now + 601) * 1000);
    expect(await service.consumeAuthState(req, req.appSession!.apiGatewayAuthState!.state)).toBeNull();
  });

  it.each(['PCC_AUTH0_CLIENT_ID', 'PCC_AUTH0_ISSUER_BASE_URL', 'API_GW_AUDIENCE'])(
    'rejects a callback after the grant configuration changes (%s)',
    async (name) => {
      const req = request();
      const authorize = new URL(await service.getAuthorizationUrl(req, '/'));
      vi.stubEnv(name, 'https://another.example/');
      expect(await service.consumeAuthState(req, authorize.searchParams.get('state'))).toBeNull();
    }
  );

  it('uses a distinct Valkey nonce record with GETDEL, surviving a lost session mutation', async () => {
    valkey.isEnabled.mockReturnValue(true);
    const records = new Map<string, ApiGatewayAuthState>();
    valkey.setJson.mockImplementation(async (key: string, value: ApiGatewayAuthState) => {
      records.set(key, value);
      return true;
    });
    valkey.getdelJson.mockImplementation(async (key: string) => {
      const value = records.get(key);
      records.delete(key);
      return value ? { status: 'hit', value } : { status: 'miss' };
    });
    const req = request({ profileAuthState: 'profile-state', crowdfundingAuthState: 'cf-state' });
    const url = new URL(await service.getAuthorizationUrl(req, '/org/acme'));
    const nonce = url.searchParams.get('state')!;
    expect(valkey.setJson).toHaveBeenCalledWith(`lfx-ui:auth-state:v1:${nonce}:api-gateway`, expect.any(Object), 600, expect.any(Number));
    const callback = request({ profileAuthState: 'profile-state', crowdfundingAuthState: 'cf-state' });
    expect(await service.consumeAuthState(callback, nonce)).toMatchObject({ sub: grant.sub, returnTo: '/org/acme' });
    expect(await service.consumeAuthState(callback, nonce)).toBeNull();
    expect(callback.appSession!.profileAuthState).toBe('profile-state');
    expect(callback.appSession!.crowdfundingAuthState).toBe('cf-state');
  });

  it('never falls back to session state after an uncertain Valkey write or destructive read', async () => {
    const req = request();
    await service.getAuthorizationUrl(req, '/');
    const previous = req.appSession!.apiGatewayAuthState!;
    valkey.isEnabled.mockReturnValue(true);
    valkey.setJson.mockResolvedValue(false);
    await expect(service.getAuthorizationUrl(req, '/')).rejects.toThrow('could not be saved');
    expect(req.appSession!.apiGatewayAuthState).toBeUndefined();
    req.appSession!.apiGatewayAuthState = previous;
    valkey.getdelJson.mockResolvedValue({ status: 'fault' });
    expect(await service.consumeAuthState(req, previous.state)).toBeNull();
  });

  it('leaves Authelia on its existing refresh-token exchange rather than starting a new grant', async () => {
    vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', 'https://auth.k8s.orb.local/');
    const req = request();
    expect(service.isAuthelia).toBe(true);
    expect(service.isConfigured()).toBe(false);
    expect(await service.loadToken(req)).toBe('not_configured');
    await expect(service.getAuthorizationUrl(req, '/profile')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(req.appSession!['refresh_token']).toBe('primary-refresh');
  });

  it('does not include token endpoint response bodies or transport messages in logs/errors', async () => {
    const req = request();
    const state = await stateFor(req);
    fetchMock.mockResolvedValue(
      Response.json({ error: 'failure', error_description: 'synthetic-code synthetic-client-secret gateway-refresh' }, { status: 400 })
    );
    const error = await service.exchangeCode(req, 'synthetic-code', state).catch((error: unknown) => error);
    const output = JSON.stringify([String(error), log.warning.mock.calls.map((call) => call.slice(1))]);
    for (const secret of ['synthetic-code', 'synthetic-client-secret', 'gateway-refresh']) expect(output).not.toContain(secret);
  });
});
