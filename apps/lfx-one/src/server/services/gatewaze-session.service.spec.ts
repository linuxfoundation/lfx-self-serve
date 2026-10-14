// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHmac, hkdfSync } from 'node:crypto';

import type { KeyValue, SetIfLockHeldResult } from '@gatewaze/host-session';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loggerMock, lfxSessionGet } = vi.hoisted(() => ({
  loggerMock: { warning: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
  lfxSessionGet: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: loggerMock }));
// The LFX session a Realtime socket checks before each refresh.
vi.mock('./session-store.service', () => ({ sessionStoreService: { get: lfxSessionGet } }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
// The utils barrel pulls in @angular/forms. valkey.service.ts (for the key prefix) needs only these
// two modules from it, as valkey.service.spec.ts does.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
}));

import { deriveKeys, SessionStore } from '@gatewaze/host-session';

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
const USER_EMAIL = 'synthetic.user@example.test';
const OTHER_LFX_SID = 'b'.repeat(64);

/** In-memory KeyValue with the same semantics as the package's Redis one (TTLs are not modelled). */
class FakeKeyValue implements KeyValue {
  public readonly data = new Map<string, string>();
  public readonly published: string[] = [];
  public failSubscribe = false;
  public failGet = false;
  /** Every call hangs, as a Valkey that accepted the connection and stopped answering would. */
  public hang = false;
  public closed = false;
  private readonly listeners: { channel: string; onMessage: (message: string) => void }[] = [];

  public async get(key: string) {
    if (this.hang) return new Promise<string | null>(() => undefined);
    if (this.failGet) throw new Error('synthetic valkey outage');
    return this.data.get(key) ?? null;
  }
  public async set(key: string, value: string) {
    if (this.hang) return new Promise<void>(() => undefined);
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
    if (this.data.get(key) !== value) return false;
    this.data.delete(key);
    return true;
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
    adminStatus: 200,
    adminActive: true,
    /** Statuses for successive GoTrue /user calls; 200 once the list runs out. */
    userStatuses: [] as number[],
    logoutStatus: 204,
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
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/admin_profiles`)) {
      return state.adminStatus === 200 ? json(200, [{ is_active: state.adminActive }]) : json(state.adminStatus, {});
    }
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      const status = state.userStatuses.shift() ?? 200;
      return status === 200 ? json(200, { id: 'gw-user-synthetic', email: USER_EMAIL }) : json(status, { msg: 'synthetic' });
    }
    if (url === `${SUPABASE_URL}/auth/v1/logout?scope=local`) return new Response(null, { status: state.logoutStatus });
    throw new Error(`unexpected fetch ${url}`);
  });
  return { state, calls, fetchMock, count: (url: string) => calls.filter((c) => c === url).length };
}

const AUTH0_TOKEN = `${AUTH0_URL}/oauth/token`;
const ID_TOKEN_GRANT = `${SUPABASE_URL}/auth/v1/token?grant_type=id_token`;
const LOGOUT = `${SUPABASE_URL}/auth/v1/logout?scope=local`;
const USER = `${SUPABASE_URL}/auth/v1/user`;
const GW_SID = deriveGatewazeSid(deriveGatewazeSidKey(SECRET), LFX_SID);
const SESSION_KEY = `lfx-ui:gatewaze:v1:session:${GW_SID}`;
const SIGNED_OUT_KEY = `lfx-ui:gatewaze:v1:signed-out:${GW_SID}`;

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

  it('warns once per process when only one of the two flags is on, and not when both are off', async () => {
    // A fresh module, so the once-per-process latch starts unset whatever ran before.
    vi.resetModules();
    const fresh = await import('./gatewaze-session.service');
    const mismatchWarnings = (): unknown[][] => loggerMock.warning.mock.calls.filter((call) => call[1] === 'resolve_gatewaze_host_session_config');
    loggerMock.warning.mockClear();

    vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', '');
    vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', '');
    expect(fresh.resolveGatewazeHostSessionConfig()).toBeNull();
    expect(mismatchWarnings()).toHaveLength(0);

    vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'true');
    expect(fresh.resolveGatewazeHostSessionConfig()).toBeNull();
    expect(fresh.resolveGatewazeHostSessionConfig()).toBeNull();
    expect(mismatchWarnings()).toHaveLength(1);
    expect(mismatchWarnings()[0][3]).toEqual({ flag_on: 'LFX_GATEWAZE_EMBED_ENABLED', flag_off: 'LFX_GATEWAZE_HOST_SESSION' });
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

describe('GatewazeSessionService me and logout', () => {
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
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** On the first GoTrue revoke, another request on the same LFX session mints a new record (grant 2). */
  function replaceRecordOnRevoke() {
    const fetchMock = upstreams.fetchMock.getMockImplementation()!;
    let replaced = false;
    upstreams.fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
      if (String(input) === LOGOUT && !replaced) {
        replaced = true;
        kv.data.delete(SESSION_KEY);
        await service.getGatewazeSession(buildReq());
      }
      return fetchMock(input, init);
    });
  }

  describe('getGatewazeMe', () => {
    it('answers ok with the GoTrue user for an admin', async () => {
      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({
        outcome: 'ok',
        user: { id: 'gw-user-synthetic', email: USER_EMAIL },
      });
      expect(upstreams.count(USER)).toBe(1);
    });

    it('answers not_admin with the email when admin_profiles has no active row', async () => {
      upstreams.state.adminActive = false;

      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({ outcome: 'not_admin', email: USER_EMAIL });
    });

    it('answers admin_check_pending with a positive Retry-After, before calling /user', async () => {
      upstreams.state.adminStatus = 503;

      const result = await service.getGatewazeMe(buildReq());

      expect(result).toEqual({ outcome: 'admin_check_pending', retryAfterSeconds: expect.any(Number) });
      expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(upstreams.count(USER)).toBe(0);
    });

    it.each([401, 403, 404])('revokes, drops the record and re-mints once when /user answers %i', async (status) => {
      upstreams.state.userStatuses = [status];

      const result = await service.getGatewazeMe(buildReq());

      expect(result).toEqual({ outcome: 'ok', user: expect.objectContaining({ id: 'gw-user-synthetic' }) });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
      expect(upstreams.count(LOGOUT)).toBe(1);
      // Dropped without the sign-out marker, which would have blocked the re-mint for 5 minutes.
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
      expect(kv.published).toContain(GW_SID);
    });

    it('keeps a session another request minted after /user refused the old one', async () => {
      upstreams.state.userStatuses = [401];
      replaceRecordOnRevoke();
      const discard = vi.spyOn(SessionStore.prototype, 'discard');

      const result = await service.getGatewazeMe(buildReq());

      expect(discard).toHaveBeenCalledWith(GW_SID, { onlyIfAccessToken: 'gw-access-1' });
      await expect(discard.mock.results[0].value).resolves.toBe(false);
      // The second pass uses the other request's session (grant 2) rather than minting a third.
      expect(result).toMatchObject({ outcome: 'ok' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
      discard.mockRestore();
    });

    it('answers unavailable when the refused record cannot be dropped', async () => {
      upstreams.state.userStatuses = [401];
      const discard = vi.spyOn(SessionStore.prototype, 'discard').mockRejectedValue(new Error('synthetic valkey outage'));

      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
      discard.mockRestore();
    });

    it('answers unavailable, never ended, and drops the record when /user refuses the re-minted session too', async () => {
      upstreams.state.userStatuses = [401, 401];

      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
      expect(upstreams.count(USER)).toBe(2);
      expect(upstreams.count(LOGOUT)).toBe(2);
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
      expect(loggerMock.warning).toHaveBeenCalledWith(expect.anything(), 'get_gatewaze_me', expect.stringContaining('refused a session minted'));
    });

    it('answers unavailable, without re-minting, when /user cannot answer', async () => {
      upstreams.state.userStatuses = [500];

      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({ outcome: 'unavailable' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
    });

    it('passes a session failure through unchanged', async () => {
      upstreams.state.grantStatus = 400;

      await expect(service.getGatewazeMe(buildReq())).resolves.toEqual({ outcome: 'refused' });
      expect(upstreams.count(USER)).toBe(0);
    });
  });

  describe('endGatewazeSession', () => {
    const LFX_LOGOUT = { blockReMint: true };
    const EMBED_SIGN_OUT = { blockReMint: false };

    it('revokes at GoTrue before it deletes the record, then publishes the sign-out', async () => {
      await service.getGatewazeSession(buildReq());
      let recordAtRevoke: boolean | null = null;
      const fetchMock = upstreams.fetchMock.getMockImplementation()!;
      upstreams.fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        if (String(input) === LOGOUT) recordAtRevoke = kv.data.has(SESSION_KEY);
        return fetchMock(input, init);
      });

      const result = await service.endGatewazeSession(buildReq(null), LFX_LOGOUT);

      expect(result).toEqual({ found: true, revoked: true, deleted: true });
      expect(recordAtRevoke).toBe(true);
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(true);
      expect(kv.published).toContain(GW_SID);
    });

    it('still deletes the record when GoTrue refuses the revoke, and logs it', async () => {
      await service.getGatewazeSession(buildReq());
      upstreams.state.logoutStatus = 500;

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: true, revoked: false, deleted: true });
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(loggerMock.warning).toHaveBeenCalledWith(expect.anything(), 'end_gatewaze_session', expect.stringContaining('GoTrue did not confirm'));
    });

    it('on LFX logout, sets the sign-out marker so nothing re-mints on the id', async () => {
      await service.getGatewazeSession(buildReq());
      await service.endGatewazeSession(buildReq(null), LFX_LOGOUT);

      await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'ended' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
    });

    it('on the embed sign-out, revokes and drops the record without the marker, so the next check mints again', async () => {
      await service.getGatewazeSession(buildReq());

      await expect(service.endGatewazeSession(buildReq(null), EMBED_SIGN_OUT)).resolves.toEqual({ found: true, revoked: true, deleted: true });
      expect(upstreams.count(LOGOUT)).toBe(1);
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
      expect(kv.published).toContain(GW_SID);

      await expect(service.getGatewazeSession(buildReq())).resolves.toMatchObject({ outcome: 'ok' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
    });

    it('on the embed sign-out, leaves a session another request minted after the revoke', async () => {
      await service.getGatewazeSession(buildReq());
      replaceRecordOnRevoke();

      await expect(service.endGatewazeSession(buildReq(null), EMBED_SIGN_OUT)).resolves.toEqual({ found: true, revoked: true, deleted: false });
      expect(kv.data.has(SESSION_KEY)).toBe(true);
      // The kept record is the other request's session: serving it needs no new grant.
      await expect(service.getGatewazeSession(buildReq())).resolves.toMatchObject({ outcome: 'ok', session: { access_token: 'gw-access-2' } });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(2);
    });

    it('on the embed sign-out, removes nothing when there is no stored session', async () => {
      await expect(service.endGatewazeSession(buildReq(null), EMBED_SIGN_OUT)).resolves.toEqual({ found: false, revoked: false, deleted: false });
      expect(upstreams.count(LOGOUT)).toBe(0);
      expect(kv.published).toEqual([]);
    });

    it('writes nothing to Valkey when there is no stored session, so a made-up cookie costs only a read', async () => {
      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: false, revoked: false, deleted: false });
      expect(upstreams.count(LOGOUT)).toBe(0);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
      expect(kv.published).toEqual([]);
    });

    it('on LFX logout, still writes the marker when GoTrue refuses the refresh outright', async () => {
      upstreams.state.grantExpiresIn = 1;
      await service.getGatewazeSession(buildReq());
      upstreams.state.refreshStatus = 400;

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: true, revoked: false, deleted: true });
      // The refused refresh token is already dead at GoTrue, so there is nothing to revoke.
      expect(upstreams.count(LOGOUT)).toBe(0);
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(true);
      // A mint after the logout is blocked, as it would be after any other LFX logout.
      upstreams.state.refreshStatus = 200;
      await expect(service.getGatewazeSession(buildReq())).resolves.toEqual({ outcome: 'ended' });
      expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
    });

    it('on the embed sign-out, writes no marker when GoTrue refuses the refresh outright', async () => {
      upstreams.state.grantExpiresIn = 1;
      await service.getGatewazeSession(buildReq());
      upstreams.state.refreshStatus = 400;

      await expect(service.endGatewazeSession(buildReq(null), EMBED_SIGN_OUT)).resolves.toEqual({ found: true, revoked: false, deleted: false });
      expect(kv.data.has(SESSION_KEY)).toBe(false);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
    });

    it('on LFX logout, writes nothing for an id with no record, even while other sessions are stored', async () => {
      await service.getGatewazeSession(buildReq(SUB_A, OTHER_LFX_SID));
      const before = new Map(kv.data);
      const publishedBefore = kv.published.length;

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: false, revoked: false, deleted: false });
      expect(kv.data).toEqual(before);
      expect(kv.published).toHaveLength(publishedBefore);
    });

    it('logs at WARN, and removes nothing, when the record cannot be read', async () => {
      await service.getGatewazeSession(buildReq());
      kv.failGet = true;

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: false, revoked: false, deleted: false });
      expect(loggerMock.warning).toHaveBeenCalledWith(expect.anything(), 'end_gatewaze_session', expect.stringContaining('Could not read'), {
        reason: 'synthetic valkey outage',
      });
      expect(upstreams.count(LOGOUT)).toBe(0);
      expect(kv.data.has(SIGNED_OUT_KEY)).toBe(false);
    });

    it('revokes with the stored token when GoTrue cannot refresh it first', async () => {
      upstreams.state.grantExpiresIn = 1;
      await service.getGatewazeSession(buildReq());
      upstreams.state.refreshStatus = 503;
      let revokedWith: string | null = null;
      const fetchMock = upstreams.fetchMock.getMockImplementation()!;
      upstreams.fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
        if (String(input) === LOGOUT) revokedWith = new Headers(init?.headers).get('authorization');
        return fetchMock(input, init);
      });

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: true, revoked: true, deleted: true });
      expect(revokedWith).toBe('Bearer gw-access-1');
      expect(loggerMock.warning).toHaveBeenCalledWith(
        expect.anything(),
        'end_gatewaze_session',
        expect.stringContaining('Refresh before revoke failed'),
        expect.anything()
      );
    });

    it('does nothing, and never connects, when host-session mode is off', async () => {
      vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', '');

      await expect(service.endGatewazeSession(buildReq(null), LFX_LOGOUT)).resolves.toEqual({ found: false, revoked: false, deleted: false });
      expect(createKeyValue).not.toHaveBeenCalled();
    });

    it('bounds every step, so a hung Valkey cannot hold the caller', async () => {
      await service.getGatewazeSession(buildReq());
      kv.hang = true;
      vi.useFakeTimers();

      const pending = service.endGatewazeSession(buildReq(null), LFX_LOGOUT);
      // The first read gives up after its bound; with no session found, nothing else runs.
      await vi.advanceTimersByTimeAsync(2_000 + 10);

      await expect(pending).resolves.toEqual({ found: false, revoked: false, deleted: false });
    });
  });
});

describe('GatewazeSessionService.openRealtimeSession', () => {
  let kv: FakeKeyValue;
  let upstreams: ReturnType<typeof fakeUpstreams>;
  let service: GatewazeSessionService;

  /** The LFX session record as the session store returns it. */
  function lfxSession(overrides: { exp?: number; data?: Record<string, unknown> } = {}) {
    const now = Math.floor(Date.now() / 1000);
    return { header: { iat: now, uat: now, exp: overrides.exp ?? now + 3600 }, data: overrides.data ?? {}, cookie: { expires: 0, maxAge: 0 } };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    enableHostSession();
    kv = new FakeKeyValue();
    upstreams = fakeUpstreams();
    vi.stubGlobal('fetch', upstreams.fetchMock);
    service = new GatewazeSessionService((() => kv) as unknown as (url: string) => KeyValue);
    lfxSessionGet.mockResolvedValue(lfxSession());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('opens with a stored or minted session and binds the bridge callbacks to it', async () => {
    const result = await service.openRealtimeSession(buildReq());

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(result.session.session).toEqual(expect.objectContaining({ access_token: 'gw-access-1', sub: SUB_A, is_admin: true }));
    await expect(result.session.fresh()).resolves.toEqual(expect.objectContaining({ access_token: 'gw-access-1' }));
    expect(lfxSessionGet).toHaveBeenCalledWith(LFX_SID);
    expect(upstreams.count(ID_TOKEN_GRANT)).toBe(1);
  });

  it('ends the socket at the next refresh once the LFX session is gone, expired or impersonating', async () => {
    const result = await service.openRealtimeSession(buildReq());
    if (result.outcome !== 'ok') throw new Error('expected a session');

    lfxSessionGet.mockResolvedValueOnce(null);
    await expect(result.session.fresh()).resolves.toBeNull();
    lfxSessionGet.mockResolvedValueOnce(lfxSession({ exp: Math.floor(Date.now() / 1000) - 1 }));
    await expect(result.session.fresh()).resolves.toBeNull();
    lfxSessionGet.mockResolvedValueOnce(
      lfxSession({ data: { impersonationToken: 'synthetic-target-token', impersonationExpiresAt: Date.now() + 60_000, impersonationUser: { sub: SUB_B } } })
    );
    await expect(result.session.fresh()).resolves.toBeNull();
    // The Gatewaze record itself is untouched: the LFX side decides, the HTTP routes still see it.
    expect(kv.data.has(SESSION_KEY)).toBe(true);
  });

  it('tells the bridge about a sign-out published by any pod', async () => {
    const result = await service.openRealtimeSession(buildReq());
    if (result.outcome !== 'ok') throw new Error('expected a session');
    const listener = vi.fn();
    result.session.onSignedOut(listener);

    await service.endGatewazeSession(buildReq(null), { blockReMint: true });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('records a sign-out that lands before the bridge listens, until release', async () => {
    const result = await service.openRealtimeSession(buildReq());
    if (result.outcome !== 'ok') throw new Error('expected a session');
    expect(result.session.signedOut()).toBe(false);

    await service.endGatewazeSession(buildReq(null), { blockReMint: false });
    expect(result.session.signedOut()).toBe(true);

    const second = await service.openRealtimeSession(buildReq());
    if (second.outcome !== 'ok') throw new Error('expected a session');
    second.session.release();
    second.session.release();
    await service.endGatewazeSession(buildReq(null), { blockReMint: false });
    expect(second.session.signedOut()).toBe(false);
  });

  it('a repeated release does not drop another socket listening on the same session', async () => {
    const first = await service.openRealtimeSession(buildReq());
    if (first.outcome !== 'ok') throw new Error('expected a session');
    first.session.release();
    const second = await service.openRealtimeSession(buildReq());
    if (second.outcome !== 'ok') throw new Error('expected a session');

    first.session.release();
    await service.endGatewazeSession(buildReq(null), { blockReMint: true });

    expect(second.session.signedOut()).toBe(true);
  });

  it('maps the failures as getGatewazeSession does', async () => {
    await expect(service.openRealtimeSession(buildReq(SUB_A, null))).resolves.toEqual({ outcome: 'host_session_unavailable' });
    await expect(service.openRealtimeSession(buildReq(null))).resolves.toEqual({ outcome: 'ended' });

    await service.getGatewazeSession(buildReq());
    await service.endGatewazeSession(buildReq(null), { blockReMint: true });
    await expect(service.openRealtimeSession(buildReq())).resolves.toEqual({ outcome: 'ended' });

    kv.failGet = true;
    await expect(service.openRealtimeSession(buildReq(SUB_A, OTHER_LFX_SID))).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('is host_session_unavailable with the flag off, without touching Valkey', async () => {
    vi.stubEnv('LFX_GATEWAZE_HOST_SESSION', 'false');

    await expect(service.openRealtimeSession(buildReq())).resolves.toEqual({ outcome: 'host_session_unavailable' });
    expect(kv.data.size).toBe(0);
    expect(upstreams.fetchMock).not.toHaveBeenCalled();
  });
});
