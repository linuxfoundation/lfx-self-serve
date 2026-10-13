// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac, hkdfSync } from 'node:crypto';

import type { KeyValue, SetIfLockHeldResult } from '@gatewaze/host-session';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { warning: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('./logger.service', () => ({ logger: loggerMock }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
// The utils barrel pulls in @angular/forms. valkey.service.ts (for the key prefix) needs only these
// two modules from it, as valkey.service.spec.ts does.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
}));

import { deriveKeys } from '@gatewaze/host-session';

import {
  deriveGatewazeMasterKey,
  deriveGatewazeSid,
  deriveGatewazeSidKey,
  GatewazeSessionService,
  isGatewazeHostSessionEnabled,
} from './gatewaze-session.service';

// Every identity here is synthetic. Tokens are opaque strings except the Auth0 ID token, which is
// an unsigned JWT-shaped value so the package can read its `sub` the way it does after GoTrue
// accepts a real one.
const SUPABASE_URL = 'https://supabase.example.test';
const AUTH0_URL = 'https://auth.example.test';
const SECRET = 'synthetic-pcc-auth0-secret-for-specs';
const SUB_A = 'auth0|synthetic-user-a';
const SUB_B = 'auth0|synthetic-user-b';
const LFX_SID = 'a'.repeat(64);
const OTHER_LFX_SID = 'b'.repeat(64);

/** In-memory KeyValue with the same semantics as the package's Redis one (TTLs are not modelled). */
class FakeKeyValue implements KeyValue {
  public readonly data = new Map<string, string>();
  public readonly published: string[] = [];
  public failSubscribe = false;
  public failGet = false;
  public closed = false;
  private readonly listeners: { channel: string; onMessage: (message: string) => void }[] = [];

  public async get(key: string) {
    if (this.failGet) throw new Error('synthetic valkey outage');
    return this.data.get(key) ?? null;
  }
  public async set(key: string, value: string) {
    this.data.set(key, value);
  }
  public async setIfExists(key: string, value: string) {
    if (!this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
  public async setIfAbsent(key: string, value: string) {
    if (this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
  public async del(key: string) {
    this.data.delete(key);
  }
  public async delIfEquals(key: string, value: string) {
    if (this.data.get(key) === value) this.data.delete(key);
  }
  public async setIfLockHeld(key: string, value: string, _ttl: number, lockKey: string, lockValue: string, blockKey: string): Promise<SetIfLockHeldResult> {
    if (this.data.has(blockKey)) return 'blocked';
    if (this.data.get(lockKey) !== lockValue) return 'lock-lost';
    this.data.set(key, value);
    return 'ok';
  }
  public async publish(channel: string, message: string) {
    this.published.push(message);
    for (const l of this.listeners) if (l.channel === channel) l.onMessage(message);
  }
  public async subscribe(channel: string, onMessage: (message: string) => void) {
    if (this.failSubscribe) throw new Error('synthetic subscribe failure');
    this.listeners.push({ channel, onMessage });
  }
  public async close() {
    this.closed = true;
  }
}

function idTokenFor(sub: string): string {
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'none' })}.${part({ sub, iss: `${AUTH0_URL}/` })}.sig`;
}

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Routes fetch by URL to fake Auth0 and GoTrue. The real `@gatewaze/host-session` code runs against
 * it, so these specs cover the package's lock, single-flight and re-mint behaviour as LFX wires it.
 */
function fakeUpstreams() {
  const state = {
    auth0Sub: SUB_A,
    auth0Status: 200,
    auth0Body: null as unknown,
    grantStatus: 200,
    grantExpiresIn: 3600,
    refreshStatus: 200,
    grants: 0,
  };
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === `${AUTH0_URL}/oauth/token`) {
      if (state.auth0Status !== 200) return json(state.auth0Status, state.auth0Body);
      return json(200, { id_token: idTokenFor(state.auth0Sub) });
    }
    if (url === `${SUPABASE_URL}/auth/v1/token?grant_type=id_token`) {
      const n = ++state.grants;
      if (state.grantStatus !== 200) return json(state.grantStatus, { error: 'synthetic' });
      const { id_token } = JSON.parse(String(init?.body)) as { id_token: string };
      const sub = JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString()).sub as string;
      return json(200, {
        access_token: `gw-access-${n}`,
        refresh_token: `gw-refresh-${n}`,
        expires_at: Math.floor(Date.now() / 1000) + state.grantExpiresIn,
        user: { id: `gw-user-${sub}`, identities: [{ provider: 'custom:lfid', id: sub }] },
      });
    }
    if (url === `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`) {
      return json(state.refreshStatus, state.refreshStatus === 200 ? {} : { error: 'refresh_token_not_found' });
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/admin_profiles`)) return json(200, [{ is_active: true }]);
    if (url === `${SUPABASE_URL}/auth/v1/logout?scope=local`) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch ${url}`);
  });
  return { state, calls, fetchMock, count: (url: string) => calls.filter((c) => c === url).length };
}

const AUTH0_TOKEN = `${AUTH0_URL}/oauth/token`;
const ID_TOKEN_GRANT = `${SUPABASE_URL}/auth/v1/token?grant_type=id_token`;
const LOGOUT = `${SUPABASE_URL}/auth/v1/logout?scope=local`;

function buildReq(sub: string | null = SUB_A, lfxSid: string | null = LFX_SID): Request {
  return {
    headers: { cookie: lfxSid ? `other=1; appSession=${lfxSid}` : 'other=1' },
    oidc: { user: sub ? { sub } : undefined },
    appSession: { refresh_token: 'synthetic-lfx-refresh-token' },
  } as unknown as Request;
}

function enableHostSession() {
  vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', 'true');
  vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'true');
  vi.stubEnv('SESSION_STORE_ENABLED', 'true');
  vi.stubEnv('VALKEY_URL', 'redis://valkey.example.test:6379');
  vi.stubEnv('VALKEY_KEY_NAMESPACE', '');
  vi.stubEnv('GW_SUPABASE_URL', `${SUPABASE_URL}/`);
  vi.stubEnv('GW_SUPABASE_ANON_KEY', 'sb_publishable_synthetic');
  vi.stubEnv('PCC_AUTH0_SECRET', SECRET);
  vi.stubEnv('PCC_AUTH0_ISSUER_BASE_URL', AUTH0_URL);
  vi.stubEnv('PCC_AUTH0_CLIENT_ID', 'synthetic-client-id');
  vi.stubEnv('PCC_AUTH0_CLIENT_SECRET', 'synthetic-client-secret');
}

describe('deriveGatewazeMasterKey', () => {
  it('is HKDF-SHA256 of PCC_AUTH0_SECRET with the v1 info label, and deterministic', () => {
    const expected = Buffer.from(hkdfSync('sha256', Buffer.from(SECRET), Buffer.alloc(0), 'lfx-one gatewaze host-session v1', 32));
    expect(deriveGatewazeMasterKey(SECRET).equals(expected)).toBe(true);
    expect(deriveGatewazeMasterKey(SECRET).equals(deriveGatewazeMasterKey(SECRET))).toBe(true);
    expect(deriveGatewazeMasterKey(`${SECRET}-rotated`).equals(expected)).toBe(false);
  });
});

describe('deriveGatewazeSidKey', () => {
  it('is HKDF-SHA256 with its own info label, deterministic, and differs from the master and store keys', () => {
    const expected = Buffer.from(hkdfSync('sha256', Buffer.from(SECRET), Buffer.alloc(0), 'lfx-one gatewaze host-session v1 sid', 32));
    const sidKey = deriveGatewazeSidKey(SECRET);
    expect(sidKey.equals(expected)).toBe(true);
    expect(sidKey.equals(deriveGatewazeSidKey(SECRET))).toBe(true);
    expect(sidKey.equals(deriveGatewazeMasterKey(SECRET))).toBe(false);
    expect(sidKey.equals(deriveKeys([deriveGatewazeMasterKey(SECRET)], 'store')[0])).toBe(false);
  });
});

describe('deriveGatewazeSid', () => {
  const master = deriveGatewazeSidKey(SECRET);

  it('is base64url(HMAC-SHA256(master, "sid:" + lfxSid)), stable per LFX session id', () => {
    const expected = createHmac('sha256', master).update(`sid:${LFX_SID}`).digest('base64url');
    expect(deriveGatewazeSid(master, LFX_SID)).toBe(expected);
    expect(deriveGatewazeSid(master, LFX_SID)).toBe(deriveGatewazeSid(master, LFX_SID));
    expect(deriveGatewazeSid(master, LFX_SID)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('differs across LFX session ids and across master keys', () => {
    expect(deriveGatewazeSid(master, OTHER_LFX_SID)).not.toBe(deriveGatewazeSid(master, LFX_SID));
    expect(deriveGatewazeSid(deriveGatewazeMasterKey('another-secret'), LFX_SID)).not.toBe(deriveGatewazeSid(master, LFX_SID));
  });
});

describe('GatewazeSessionService.getGatewazeSession', () => {
  let kv: FakeKeyValue;
  let upstreams: ReturnType<typeof fakeUpstreams>;
  let service: GatewazeSessionService;
  let createKeyValue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    enableHostSession();
    kv = new FakeKeyValue();
    upstreams = fakeUpstreams();
    vi.stubGlobal('fetch', upstreams.fetchMock);
    createKeyValue = vi.fn(() => kv);
    service = new GatewazeSessionService(createKeyValue as unknown as (url: string) => KeyValue);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('mints a session from the Auth0 ID token and serves the stored one afterwards', async () => {
    const first = await service.getGatewazeSession(buildReq());
    const second = await service.getGatewazeSession(buildReq());

    expect(first).toEqual({ outcome: 'ok', session: expect.objectContaining({ access_token: 'gw-access-1', sub: SUB_A, is_admin: true }) });
    expect(second).toEqual(first);
    expect(upstreams.count(AUTH0_TOKEN)).toBe(1);
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
    expect(createKeyValue).toHaveBeenCalledWith('redis://valkey.example.test:6379');
  });

  it('mints once for concurrent first requests on the same LFX session', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => service.getGatewazeSession(buildReq())));

    expect(upstreams.count(AUTH0_TOKEN)).toBe(1);
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
    for (const r of results) expect(r).toEqual({ outcome: 'ok', session: expect.objectContaining({ access_token: 'gw-access-1' }) });
  });

  it('keeps separate sessions for separate LFX sessions', async () => {
    await service.getGatewazeSession(buildReq(SUB_A, LFX_SID));
    await service.getGatewazeSession(buildReq(SUB_A, OTHER_LFX_SID));

    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
  });

  it('stores only encrypted records under the lfx-ui gatewaze:v1 prefix', async () => {
    await service.getGatewazeSession(buildReq());

    const gwSid = deriveGatewazeSid(deriveGatewazeSidKey(SECRET), LFX_SID);
    const record = kv.data.get(`lfx-ui:gatewaze:v1:session:${gwSid}`);
    expect(record).toMatch(/^v1:/);
    expect(record).not.toContain('gw-access-1');
    expect(record).not.toContain('gw-refresh-1');
    expect(record).not.toContain(SUB_A);
  });

  it('puts the deployment namespace in the key prefix', async () => {
    vi.stubEnv('VALKEY_KEY_NAMESPACE', 'ui-pr-42');
    await service.getGatewazeSession(buildReq());

    expect([...kv.data.keys()].some((k) => k.startsWith('lfx-ui:ui-pr-42:gatewaze:v1:session:'))).toBe(true);
  });

  it('re-mints from the LFX session when GoTrue refuses the refresh', async () => {
    upstreams.state.grantExpiresIn = 30; // inside the refresh skew, so the next read refreshes
    await service.getGatewazeSession(buildReq());
    upstreams.state.grantExpiresIn = 3600;
    upstreams.state.refreshStatus = 400;

    const result = await service.getGatewazeSession(buildReq());

    expect(result).toEqual({ outcome: 'ok', session: expect.objectContaining({ access_token: 'gw-access-2' }) });
    expect(upstreams.count(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`)).toBe(1);
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
  });

  it('ends a stored session for another Auth0 subject and mints one for the signed-in user', async () => {
    await service.getGatewazeSession(buildReq(SUB_A));
    upstreams.state.auth0Sub = SUB_B;

    const result = await service.getGatewazeSession(buildReq(SUB_B));

    expect(result).toEqual({ outcome: 'ok', session: expect.objectContaining({ access_token: 'gw-access-2', sub: SUB_B }) });
    expect(upstreams.count(LOGOUT)).toBe(1);
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
  });

  it('revokes and refuses a minted session whose ID token names another subject', async () => {
    upstreams.state.auth0Sub = SUB_B;

    await expect(service.getGatewazeSession(buildReq(SUB_A))).resolves.toEqual({ outcome: 'ended' });
    expect(upstreams.count(LOGOUT)).toBe(1);
    expect([...kv.data.keys()].some((k) => k.includes(':session:'))).toBe(false);
  });

  it('reports ended when Auth0 refuses the LFX refresh token', async () => {
    upstreams.state.auth0Status = 403;
    upstreams.state.auth0Body = { error: 'invalid_grant' };

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'ended' });
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(0);
  });

  it('reports unavailable when Auth0 cannot answer', async () => {
    upstreams.state.auth0Status = 503;

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports refused, not ended, when GoTrue refuses the ID token', async () => {
    upstreams.state.grantStatus = 400;

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'refused' });
    // A provider config fault: logged at ERROR so it reaches alerting, with the status and no token.
    expect(loggerMock.error).toHaveBeenCalledWith(expect.anything(), 'get_gatewaze_session', expect.any(Number), expect.anything(), { status: 400 });
    // Everything but the request (which the real logger redacts) must be token-free.
    expect(JSON.stringify(loggerMock.error.mock.calls.map((call) => call.slice(1)))).not.toMatch(/synthetic|id-token|refresh/i);
  });

  it('reports unavailable when GoTrue cannot answer the grant', async () => {
    upstreams.state.grantStatus = 503;

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports unavailable, never ended, when Valkey fails', async () => {
    kv.failGet = true;

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('does not cache a failed connect, so the next request connects again', async () => {
    kv.failSubscribe = true;
    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
    expect(kv.closed).toBe(true);
    kv.failSubscribe = false;

    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'ok', session: expect.anything() });
    expect(createKeyValue).toHaveBeenCalledTimes(2);
  });

  it('reports ended when the request has no signed-in subject', async () => {
    await expect(service.getGatewazeSession(buildReq(null))).resolves.toEqual({ outcome: 'ended' });
    expect(upstreams.calls).toEqual([]);
  });

  it('never logs a token', async () => {
    upstreams.state.grantExpiresIn = 30;
    await service.getGatewazeSession(buildReq());
    upstreams.state.refreshStatus = 400;
    await service.getGatewazeSession(buildReq());

    const logged = JSON.stringify([...loggerMock.warning.mock.calls, ...loggerMock.debug.mock.calls]);
    expect(logged).not.toMatch(/gw-access-|gw-refresh-|synthetic-lfx-refresh-token/);
    expect(logged).not.toContain(idTokenFor(SUB_A));
  });

  it('never logs the GoTrue user_id from the package, and keeps its err and status', async () => {
    upstreams.state.grantExpiresIn = 30;
    await service.getGatewazeSession(buildReq(SUB_A));
    upstreams.state.refreshStatus = 400; // "refresh refused; ending the session" carries user_id
    upstreams.state.auth0Sub = SUB_B;
    await service.getGatewazeSession(buildReq(SUB_B)); // "stored session is for another IdP subject" too

    const storeWarnings = loggerMock.warning.mock.calls.filter((call) => call[1] === 'gatewaze_session_store');
    expect(storeWarnings.length).toBeGreaterThan(0);
    for (const call of storeWarnings) expect(Object.keys(call[3] as object).every((k) => k === 'err' || k === 'status')).toBe(true);
    expect(storeWarnings.some((call) => 'err' in (call[3] as object))).toBe(true);
    expect(JSON.stringify(loggerMock.warning.mock.calls)).not.toMatch(/user_id|gw-user-/);
  });

  it('turns host-session mode off in production when GW_SUPABASE_URL is not https', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GW_SUPABASE_URL', 'http://supabase.example.test');
    expect(isGatewazeHostSessionEnabled()).toBe(false);
    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'host_session_unavailable' });

    vi.stubEnv('GW_SUPABASE_URL', SUPABASE_URL);
    expect(isGatewazeHostSessionEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('GW_SUPABASE_URL', 'http://supabase.example.test');
    expect(isGatewazeHostSessionEnabled()).toBe(true);
  });

  it.each([
    ['the host-session flag is off', 'LFX_GATEWAZE_HOST_SESSION', ''],
    ['the embed flag is off', 'LFX_GATEWAZE_EMBED_ENABLED', 'false'],
    ['the session store is off', 'SESSION_STORE_ENABLED', ''],
    ['VALKEY_URL is missing', 'VALKEY_URL', ''],
    ['GW_SUPABASE_URL is missing', 'GW_SUPABASE_URL', ''],
    ['the anon key is a secret key', 'GW_SUPABASE_ANON_KEY', 'sb_secret_synthetic'],
    ['PCC_AUTH0_SECRET is missing', 'PCC_AUTH0_SECRET', ''],
  ])('reports host_session_unavailable without touching Valkey when %s', async (_label, name, value) => {
    vi.stubEnv(name, value);

    expect(isGatewazeHostSessionEnabled()).toBe(false);
    await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'host_session_unavailable' });
    expect(createKeyValue).not.toHaveBeenCalled();
    expect(upstreams.calls).toEqual([]);
  });

  it.each([
    ['no appSession cookie', null],
    ['a cookie-mode (JWE) appSession', 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..synthetic'],
  ])('reports host_session_unavailable for %s', async (_label, cookie) => {
    expect(isGatewazeHostSessionEnabled()).toBe(true);
    await expect(service.getGatewazeSession(buildReq(SUB_A, cookie))).resolves.toEqual({ outcome: 'host_session_unavailable' });
    expect(createKeyValue).not.toHaveBeenCalled();
  });
});
