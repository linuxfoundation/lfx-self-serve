// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as gatewaze.route.spec.ts: the import graph reaches Angular's partially-compiled packages.
import '@angular/compiler';

import { createServer, request as httpRequest, Server } from 'node:http';
import { AddressInfo } from 'node:net';

import compression from 'compression';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

/**
 * Real-socket tests for the Realtime upgrade. A genuine `http.Server` runs the real `/api/gatewaze`
 * router, `requireGatewazeHostSession`, `requireGwEmbedAccess` and `apiErrorHandler`, and a genuine
 * `ws` server stands in for Supabase Realtime. Only the LFX session (authMiddleware), the FGA
 * lookups and the Gatewaze session are stubbed, so each refusal below is the one a browser gets.
 */

const { hostSessionEnabled, isImpersonating, getPersonas, getWriterSummary, openRealtimeSession, shutdownHooks, shuttingDown } = vi.hoisted(() => ({
  hostSessionEnabled: vi.fn(() => true),
  isImpersonating: vi.fn(() => false),
  getPersonas: vi.fn(),
  getWriterSummary: vi.fn(),
  openRealtimeSession: vi.fn(),
  shutdownHooks: [] as (() => unknown)[],
  shuttingDown: { value: false },
}));

const ANON_KEY = 'sb_publishable_synthetic';
const SITE_ORIGIN = 'https://app.example.test';
const LFX_SID = 'a'.repeat(64);
const SUB = 'auth0|synthetic-user-a';
const REAL_TOKEN = 'gw-access-synthetic-real';
let upstreamOrigin = '';

vi.mock('./gatewaze-session.service', () => ({
  isGatewazeHostSessionEnabled: hostSessionEnabled,
  resolveGatewazeHostSessionConfig: () => ({ supabaseUrl: upstreamOrigin, anonKey: ANON_KEY }),
  getGatewazeSessionService: () => ({ openRealtimeSession }),
  hostSessionCoreLogger: () => ({ warn: vi.fn() }),
}));
vi.mock('../utils/shutdown', () => ({
  addShutdownHook: (hook: () => unknown) => shutdownHooks.push(hook),
  isShuttingDown: () => shuttingDown.value,
}));
vi.mock('../utils/auth-helper', async () => ({
  ...(await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper')),
  isImpersonating,
}));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { getPersonas } }));
vi.mock('./project.service', () => ({
  ProjectService: vi.fn(function () {
    return { getWriterSummary };
  }),
}));
vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));
// The router reaches the service through its singleton getter; each test gets its own instance.
let current: import('./gatewaze-realtime.service').GatewazeRealtimeService;
vi.mock('./gatewaze-realtime.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gatewaze-realtime.service')>()),
  getGatewazeRealtimeService: () => current,
}));

const { GatewazeRealtimeService } = await import('./gatewaze-realtime.service');
const gatewazeRouter = (await import('../routes/gatewaze.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

/** Fake Supabase Realtime: records the URL each socket opened with and every message it got, and echoes a reply. */
let upstream: WebSocketServer;
const upstreamUrls: string[] = [];
const upstreamMessages: string[] = [];

let server: Server;
let wsBase: string;
let httpBase: string;
let signOutListeners: Set<() => void>;

function sessionResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'ok',
    session: {
      session: {
        access_token: REAL_TOKEN,
        refresh_token: 'gw-refresh-synthetic',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_id: 'gw-user-synthetic',
        is_admin: true,
        ...overrides,
      },
      fresh: vi.fn(),
      onSignedOut: (listener: () => void) => {
        signOutListeners.add(listener);
        return () => signOutListeners.delete(listener);
      },
      signedOut: () => false,
      release: vi.fn(),
    },
  };
}

beforeAll(async () => {
  upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  upstream.on('connection', (socket, req) => {
    upstreamUrls.push(req.url ?? '');
    socket.on('message', (data) => {
      upstreamMessages.push(data.toString());
      const [joinRef, ref, topic] = JSON.parse(data.toString()) as [string, string, string];
      socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
    });
  });
  await new Promise<void>((resolve) => upstream.once('listening', () => resolve()));
  upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const app = express();
  // Wrap res.end the way production middleware does, so the refusal still has to come through them:
  // compression, and an asynchronous session save like express-openid-connect's.
  // @types/compression is typed against another @types/express, as server.ts notes.
  app.use(compression() as unknown as express.RequestHandler);
  app.use((_req, res, next) => {
    const end = res.end.bind(res) as (...args: unknown[]) => typeof res;
    res.end = ((...args: unknown[]) => {
      setImmediate(() => end(...args));
      return res;
    }) as typeof res.end;
    next();
  });
  // A gate that never answers, for the deadline test.
  app.use((req, _res, next) => {
    if (!req.headers['x-test-hang']) next();
  });
  // Stands in for auth() and authMiddleware: a caller with the cookie is signed in, as the user the
  // test names; anyone else gets authMiddleware's 401.
  app.use((req, res, next) => {
    if (!req.headers.cookie?.includes(`appSession=${LFX_SID}`)) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.bearerToken = 'synthetic-bearer';
    (req as unknown as { oidc: unknown }).oidc = { user: { sub: req.headers['x-test-sub'] ?? SUB } };
    next();
  });
  app.use('/api/gatewaze', gatewazeRouter);
  app.use(apiErrorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  wsBase = `ws://127.0.0.1:${port}`;
  httpBase = `http://127.0.0.1:${port}`;
  // attach() adds the upgrade listener each time; one listener dispatches to the current instance.
  server.on('upgrade', (req, socket, head) => current.onUpgrade(req, socket, head, app));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'true');
  vi.stubEnv('PCC_BASE_URL', `${SITE_ORIGIN}/`);
  current = new GatewazeRealtimeService({ perUser: 2, total: 3 });
  signOutListeners = new Set();
  shuttingDown.value = false;
  upstreamUrls.length = 0;
  upstreamMessages.length = 0;
  hostSessionEnabled.mockReturnValue(true);
  isImpersonating.mockReturnValue(false);
  getPersonas.mockResolvedValue({ isRootWriter: true, personas: [] });
  openRealtimeSession.mockImplementation(async () => sessionResult());
});

afterEach(async () => {
  await current.closeAll();
  vi.unstubAllEnvs();
});

interface Connected {
  ws: WebSocket;
}
interface Refused {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

const REALTIME_PATH = '/api/gatewaze/supabase/realtime/v1/websocket?apikey=sb_publishable_synthetic&vsn=1.0.0';

/** Opens a socket the way the embed's realtime-js does, and reports either the open socket or the refusal. */
function connect(options: { path?: string; origin?: string | null; cookie?: string | null; sub?: string; hang?: boolean } = {}): Promise<Connected | Refused> {
  const headers: Record<string, string> = {};
  if (options.origin !== null) headers['origin'] = options.origin ?? SITE_ORIGIN;
  if (options.cookie !== null) headers['cookie'] = options.cookie ?? `other=1; appSession=${LFX_SID}`;
  if (options.sub) headers['x-test-sub'] = options.sub;
  if (options.hang) headers['x-test-hang'] = '1';
  const ws = new WebSocket(`${wsBase}${options.path ?? REALTIME_PATH}`, { headers });
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.resume();
    });
    ws.once('error', reject);
  });
}

async function refusal(options: Parameters<typeof connect>[0] = {}): Promise<Refused> {
  const result = await connect(options);
  if ('ws' in result) {
    result.ws.close();
    throw new Error('expected the upgrade to be refused');
  }
  return result;
}

async function opened(options: Parameters<typeof connect>[0] = {}): Promise<WebSocket> {
  const result = await connect(options);
  if (!('ws' in result)) throw new Error(`expected the upgrade to succeed, got ${result.status}`);
  return result.ws;
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.once('message', (data) => resolve(data.toString())));
}

function closed(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
}

describe('GatewazeRealtimeService upgrade over a real socket', () => {
  it('bridges to Realtime and puts the real access token into phx_join, never the placeholder', async () => {
    const ws = await opened({ path: `${REALTIME_PATH}&access_token=host-session` });
    const reply = nextMessage(ws);

    ws.send(JSON.stringify(['1', '1', 'realtime:public:newsletters', 'phx_join', { config: {}, access_token: 'host-session' }]));

    expect(JSON.parse(await reply)).toEqual(['1', '1', 'realtime:public:newsletters', 'phx_reply', { status: 'ok', response: {} }]);
    expect(JSON.parse(upstreamMessages[0])).toEqual(['1', '1', 'realtime:public:newsletters', 'phx_join', { config: {}, access_token: REAL_TOKEN }]);
    // The upstream URL keeps the Realtime path and vsn, carries the anon key, and drops the URL-borne token.
    const url = new URL(upstreamUrls[0], 'ws://upstream');
    expect(url.pathname).toBe('/realtime/v1/websocket');
    expect(url.searchParams.get('apikey')).toBe(ANON_KEY);
    expect(url.searchParams.get('vsn')).toBe('1.0.0');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(current.openSocketCount()).toBe(1);
    ws.close();
  });

  it('refreshes before the token expires and pushes the new token to every joined channel', async () => {
    // Inside the package's 60 s refresh skew, so the bridge refreshes after its 1 s floor.
    const expiring = sessionResult({ expires_at: Math.floor(Date.now() / 1000) + 61 });
    expiring.session.fresh.mockResolvedValue({
      ...expiring.session.session,
      access_token: 'gw-access-synthetic-rotated',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    openRealtimeSession.mockResolvedValueOnce(expiring);
    const ws = await opened();
    const joined = nextMessage(ws);
    ws.send(JSON.stringify(['1', '1', 'realtime:public:newsletters', 'phx_join', { access_token: 'host-session' }]));
    await joined;
    const relayed: string[] = [];
    ws.on('message', (data) => relayed.push(data.toString()));

    await vi.waitFor(() => expect(upstreamMessages).toHaveLength(2), { timeout: 3_000 });

    expect(expiring.session.fresh).toHaveBeenCalled();
    const [, ref, topic, event, payload] = JSON.parse(upstreamMessages[1]) as [string, string, string, string, Record<string, unknown>];
    expect({ topic, event, payload }).toEqual({
      topic: 'realtime:public:newsletters',
      event: 'access_token',
      payload: { access_token: 'gw-access-synthetic-rotated' },
    });
    // Realtime's reply to the bridge's own push is not relayed to the browser.
    expect(ref.startsWith('bff-')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(relayed).toEqual([]);
    ws.close();
  });

  it('closes the socket with 4001 when the refresh finds the session gone', async () => {
    const expiring = sessionResult({ expires_at: Math.floor(Date.now() / 1000) + 61 });
    expiring.session.fresh.mockResolvedValue(null);
    openRealtimeSession.mockResolvedValueOnce(expiring);
    const ws = await opened();

    expect(await closed(ws)).toEqual({ code: 4001, reason: 'session ended' });
  });

  it('refuses any other upgrade path with 404 before Express or Valkey', async () => {
    expect((await refusal({ path: '/api/gatewaze/session/me' })).status).toBe(404);
    expect((await refusal({ path: '/api/gw/realtime/v1/websocket' })).status).toBe(404);
    // Only the socket realtime-js opens, not any other Realtime path.
    expect((await refusal({ path: '/api/gatewaze/supabase/realtime/v1/api/broadcast' })).status).toBe(404);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('refuses with the uniform 404 while host-session mode is off', async () => {
    hostSessionEnabled.mockReturnValue(false);

    expect((await refusal()).status).toBe(404);
    expect(getPersonas).not.toHaveBeenCalled();
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', 'https://evil.example.test'],
    ['a different port', `${SITE_ORIGIN}:8443`],
    ['no Origin', null],
  ])('refuses an upgrade from %s with 403', async (_label, origin) => {
    expect((await refusal({ origin })).status).toBe(403);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('refuses a caller with no LFX session with authMiddleware 401', async () => {
    expect((await refusal({ cookie: null })).status).toBe(401);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('refuses while impersonating with 403, without loading a Gatewaze session', async () => {
    isImpersonating.mockReturnValue(true);

    expect((await refusal()).status).toBe(403);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('refuses a caller with no ED, root or writer access with 403', async () => {
    getPersonas.mockResolvedValue({ isRootWriter: false, personas: [] });
    getWriterSummary.mockResolvedValue({ hasWriterFoundation: false, hasWriterProject: false });

    expect((await refusal()).status).toBe(403);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it.each([
    ['host_session_unavailable', 404, undefined],
    ['ended', 401, 'expired'],
    ['refused', 503, undefined],
    ['unavailable', 503, undefined],
  ])('maps a %s session to %i', async (outcome, status, marker) => {
    openRealtimeSession.mockResolvedValue({ outcome });

    const result = await refusal();

    expect(result.status).toBe(status);
    expect(result.headers['x-gw-session']).toBe(marker);
  });

  it('refuses a non-admin with 403, and a pending admin check with 503 and Retry-After', async () => {
    const notAdmin = sessionResult({ is_admin: false, admin_check: 'ok' });
    openRealtimeSession.mockResolvedValueOnce(notAdmin);
    expect((await refusal()).status).toBe(403);
    expect(notAdmin.session.release).toHaveBeenCalled();

    openRealtimeSession.mockResolvedValueOnce(sessionResult({ is_admin: false, admin_check: 'pending', expires_at: Math.floor(Date.now() / 1000) + 20 }));
    const pending = await refusal();
    expect(pending.status).toBe(503);
    expect(Number(pending.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refuses a raw traversal path that only starts like the Realtime path with 404', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      // A raw path: a URL string would be normalised by the client before it is sent.
      const req = httpRequest({
        host: '127.0.0.1',
        port: new URL(httpBase).port,
        path: '/api/gatewaze/supabase/realtime/v1/websocket/%2e%2e/%2e%2e/%2e%2e/rest/v1/admin_profiles',
        headers: {
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': Buffer.alloc(16, 1).toString('base64'),
          'sec-websocket-version': '13',
          origin: SITE_ORIGIN,
          cookie: `appSession=${LFX_SID}`,
        },
      });
      req.once('response', (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      req.once('upgrade', (_res, socket) => {
        socket.destroy();
        reject(new Error('expected a refusal'));
      });
      req.once('error', reject);
      req.end();
    });

    expect(status).toBe(404);
    expect(upstreamUrls).toHaveLength(0);
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('answers a plain GET on the Realtime path with the uniform 404', async () => {
    const res = await fetch(`${httpBase}${REALTIME_PATH}`, { headers: { cookie: `appSession=${LFX_SID}` } });

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
    expect(openRealtimeSession).not.toHaveBeenCalled();
  });

  it('caps sockets per user, and frees the slot when one closes', async () => {
    const first = await opened();
    await opened();

    expect((await refusal()).status).toBe(429);
    // Another user is not affected by this user's cap.
    const other = await opened({ sub: 'auth0|synthetic-user-b' });

    const wasClosed = closed(first);
    first.close();
    await wasClosed;
    await vi.waitFor(() => expect(current.openSocketCount()).toBe(2));
    other.close();
    await opened();
  });

  it('caps sockets per pod across users with 503', async () => {
    await opened({ sub: 'auth0|synthetic-user-a' });
    await opened({ sub: 'auth0|synthetic-user-b' });
    await opened({ sub: 'auth0|synthetic-user-c' });

    expect((await refusal({ sub: 'auth0|synthetic-user-d' })).status).toBe(503);
  });

  it('frees both slots when an upgrade is refused', async () => {
    openRealtimeSession.mockResolvedValue({ outcome: 'unavailable' });
    for (let i = 0; i < 4; i++) expect((await refusal()).status).toBe(503);

    openRealtimeSession.mockImplementation(async () => sessionResult());
    await opened();
    await opened();
  });

  it('closes the socket with 4001 when the session is signed out on any pod', async () => {
    const ws = await opened();
    const wasClosed = closed(ws);

    for (const listener of signOutListeners) listener();

    expect(await wasClosed).toEqual({ code: 4001, reason: 'signed out' });
  });

  it('closes at once when the sign-out landed while the socket was opening', async () => {
    const early = sessionResult();
    early.session.signedOut = () => true;
    openRealtimeSession.mockResolvedValueOnce(early);

    const ws = await opened();

    expect((await closed(ws)).code).toBe(4001);
    expect(early.session.release).toHaveBeenCalled();
  });

  it('closes every socket with 1001 on shutdown and refuses new upgrades', async () => {
    const ws = await opened();
    const wasClosed = closed(ws);

    await current.closeAll();

    expect((await wasClosed).code).toBe(1001);
    expect((await refusal()).status).toBe(503);
  });

  it('refuses with 503 and frees the slot when the gates never answer', async () => {
    current = new GatewazeRealtimeService({ perUser: 2, total: 1 }, 100);

    expect((await refusal({ hang: true })).status).toBe(503);
    // The one pod slot is free again.
    await opened();
  });

  it('refuses with 503 when the session load outlasts the deadline, and releases it when it lands', async () => {
    current = new GatewazeRealtimeService({ perUser: 2, total: 1 }, 100);
    const late = sessionResult();
    let land: (value: unknown) => void = () => undefined;
    openRealtimeSession.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));

    expect((await refusal()).status).toBe(503);
    land(late);
    await vi.waitFor(() => expect(late.session.release).toHaveBeenCalled());
    expect(upstreamUrls).toHaveLength(0);
    await opened();
  });

  it('closes a socket with 1001 after its maximum age, so it reconnects through every check', async () => {
    current = new GatewazeRealtimeService({ perUser: 2, total: 3 }, 30_000, 100);
    const ws = await opened();

    expect(await closed(ws)).toEqual({ code: 1001, reason: 'reauthorize' });
  });

  it('refuses with 503 and frees the slots when shutdown starts while the session loads', async () => {
    current = new GatewazeRealtimeService({ perUser: 1, total: 1 });
    const late = sessionResult();
    let land: (value: unknown) => void = () => undefined;
    openRealtimeSession.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));

    const pending = refusal();
    await vi.waitFor(() => expect(openRealtimeSession).toHaveBeenCalled());
    await current.closeAll();
    land(late);

    expect((await pending).status).toBe(503);
    expect(late.session.release).toHaveBeenCalled();
    expect(upstreamUrls).toHaveLength(0);
    expect(current.openSocketCount()).toBe(0);
    // Both the pod slot and the per-user slot were freed.
    expect((current as unknown as { totalSockets: number }).totalSockets).toBe(0);
    expect((current as unknown as { socketsPerUser: Map<string, number> }).socketsPerUser.size).toBe(0);
  });

  it('refuses with 503 once the pod is shutting down', async () => {
    shuttingDown.value = true;

    expect((await refusal()).status).toBe(503);
  });

  it('attach registers the upgrade listener and a shutdown hook that closes the sockets', async () => {
    const service = new GatewazeRealtimeService();
    const fakeServer = { on: vi.fn() } as unknown as Server;
    shutdownHooks.length = 0;

    expect(service.attach(fakeServer, vi.fn())).toBe(true);

    expect(fakeServer.on).toHaveBeenCalledWith('upgrade', expect.any(Function));
    expect(shutdownHooks).toHaveLength(1);
    const closeAll = vi.spyOn(service, 'closeAll');
    await shutdownHooks[0]();
    expect(closeAll).toHaveBeenCalled();
  });

  it('attaches nothing while host-session mode is off, so Node serves upgrade requests as before', async () => {
    hostSessionEnabled.mockReturnValue(false);
    const plain = createServer((_req, res) => res.end('ok'));
    shutdownHooks.length = 0;

    expect(new GatewazeRealtimeService().attach(plain, vi.fn())).toBe(false);

    expect(plain.listenerCount('upgrade')).toBe(0);
    expect(shutdownHooks).toHaveLength(0);
    // Without a listener, Node answers an h2c upgrade on a normal path as a plain request.
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port: (plain.address() as AddressInfo).port,
        path: '/livez',
        headers: { connection: 'Upgrade', upgrade: 'h2c' },
      });
      req.once('response', (res) => {
        resolve(res.statusCode ?? 0);
        res.resume();
      });
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(200);
    await new Promise<void>((resolve) => plain.close(() => resolve()));
  });
});
