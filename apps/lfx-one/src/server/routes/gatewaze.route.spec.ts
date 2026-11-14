// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.route.spec.ts: the import graph reaches Angular's partially-compiled packages.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for /api/gatewaze: the gates are registered, in order, ahead of the session
 * and proxy routes, and every /session answer carries `Cache-Control: no-store`. The gates and the
 * controllers have their own specs; these protect the wiring, which a unit test of either would not
 * notice losing.
 */

const { hostSessionEnabled, isImpersonating, getPersonas, getWriterSummary, getGatewazeMe, endGatewazeSession, getGatewazeSession, bearer } = vi.hoisted(
  () => ({
    bearer: { value: 'synthetic-bearer' as string | undefined },
    getGatewazeSession: vi.fn(),
    hostSessionEnabled: vi.fn(() => true),
    isImpersonating: vi.fn(() => false),
    getPersonas: vi.fn(),
    getWriterSummary: vi.fn(),
    getGatewazeMe: vi.fn(),
    endGatewazeSession: vi.fn(),
  })
);

vi.mock('../services/gatewaze-session.service', () => ({
  isGatewazeHostSessionEnabled: hostSessionEnabled,
  getGatewazeSessionService: () => ({ getGatewazeMe, endGatewazeSession, getGatewazeSession }),
  // An unreachable upstream: these tests stop at the gates or assert the session was loaded.
  resolveGatewazeHostSessionConfig: () => ({ anonKey: 'sb_publishable_synthetic', supabaseUrl: 'http://127.0.0.1:1' }),
}));
vi.mock('../utils/auth-helper', async () => ({
  ...(await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper')),
  isImpersonating,
}));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { getPersonas } }));
vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn(function () {
    return { getWriterSummary };
  }),
}));
vi.mock('../services/logger.service', () => ({
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

const gatewazeRouter = (await import('./gatewaze.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stands in for authMiddleware: requireGwEmbedAccess checks the bearer before anything else.
  app.use((req, _res, next) => {
    req.bearerToken = bearer.value;
    next();
  });
  app.use('/api/gatewaze', gatewazeRouter);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'true');
  vi.stubEnv('PCC_BASE_URL', 'https://app.example.test');
  vi.stubEnv('GW_API_URL', 'http://127.0.0.1:1');
  bearer.value = 'synthetic-bearer';
  getGatewazeSession.mockResolvedValue({ outcome: 'ended' });
  hostSessionEnabled.mockReturnValue(true);
  isImpersonating.mockReturnValue(false);
  getPersonas.mockResolvedValue({ isRootWriter: true, personas: [] });
  getGatewazeMe.mockResolvedValue({ outcome: 'ok', user: { id: 'gw-user-synthetic' } });
  endGatewazeSession.mockResolvedValue({ found: true, revoked: true, deleted: true });
});

afterEach(() => vi.unstubAllEnvs());

const me = () => fetch(`${baseUrl}/api/gatewaze/session/me`);

describe('/api/gatewaze router', () => {
  it('serves /session/me to an authorized caller, with no-store', async () => {
    const res = await me();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { id: 'gw-user-synthetic' } });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves /session/logout as a POST', async () => {
    const res = await fetch(`${baseUrl}/api/gatewaze/session/logout`, { method: 'POST', headers: { apikey: 'sb_publishable_synthetic' } });

    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(endGatewazeSession).toHaveBeenCalledOnce();
  });

  it('answers the same 404 body from every gate, so a prober cannot tell which one it hit', async () => {
    // Host-session mode off: requireGatewazeHostSession.
    hostSessionEnabled.mockReturnValue(false);
    const offRes = await me();
    // No bearer token: requireGatewazeBearer.
    hostSessionEnabled.mockReturnValue(true);
    bearer.value = undefined;
    const noBearerRes = await me();
    // The embed flag off with the gates before it passing: requireGwEmbedAccess's own 404.
    bearer.value = 'synthetic-bearer';
    vi.stubEnv('LFX_GATEWAZE_EMBED_ENABLED', 'false');
    const flagOffRes = await me();

    expect([offRes.status, noBearerRes.status, flagOffRes.status]).toEqual([404, 404, 404]);
    const [offBody, noBearerBody, flagOffBody] = [await offRes.json(), await noBearerRes.json(), await flagOffRes.json()];
    expect(offBody.code).toBe('NOT_FOUND');
    expect(noBearerBody).toEqual(offBody);
    expect(flagOffBody).toEqual(offBody);
    expect(getPersonas).not.toHaveBeenCalled();
  });

  it('answers the uniform 404 while host-session mode is off, before any authorization', async () => {
    hostSessionEnabled.mockReturnValue(false);
    const res = await me();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NOT_FOUND');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(getPersonas).not.toHaveBeenCalled();
    expect(getGatewazeMe).not.toHaveBeenCalled();
  });

  it.each([
    ['me', () => me()],
    ['logout', () => fetch(`${baseUrl}/api/gatewaze/session/logout`, { method: 'POST', headers: { apikey: 'sb_publishable_synthetic' } })],
  ])('refuses a signed-in caller with no ED, root or writer access on %s with 403', async (_route, send) => {
    getPersonas.mockResolvedValue({ isRootWriter: false, personas: [] });
    getWriterSummary.mockResolvedValue({ hasWriterFoundation: false, hasWriterProject: false });

    const res = await send();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('GW_EMBED_ACCESS_REQUIRED');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(getGatewazeMe).not.toHaveBeenCalled();
    expect(endGatewazeSession).not.toHaveBeenCalled();
  });

  it('refuses an impersonating caller with 403 before any session is touched', async () => {
    isImpersonating.mockReturnValue(true);

    const res = await me();

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('GW_EMBED_IMPERSONATION_BLOCKED');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(getGatewazeMe).not.toHaveBeenCalled();
  });

  describe('proxy routes', () => {
    const shim = { authorization: 'Bearer host-session', apikey: 'sb_publishable_synthetic' };
    const rest = () => fetch(`${baseUrl}/api/gatewaze/supabase/rest/v1/newsletters`, { headers: shim });
    const api = () => fetch(`${baseUrl}/api/gatewaze/api/modules/newsletters/editions`, { headers: shim });

    it.each([
      ['supabase', rest],
      ['api', api],
    ])('reach the %s proxy past the gates, which loads the session', async (_label, send) => {
      const res = await send();

      // The 'ended' outcome set in beforeEach: the proxy's own answer, so every gate let it through.
      expect(res.status).toBe(401);
      expect(res.headers.get('x-gw-session')).toBe('expired');
      expect(getGatewazeSession).toHaveBeenCalledOnce();
    });

    it('answers the uniform 404 with host-session mode off, before any authorization, with no-store', async () => {
      hostSessionEnabled.mockReturnValue(false);

      const res = await rest();

      expect(res.status).toBe(404);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).code).toBe('NOT_FOUND');
      expect(getPersonas).not.toHaveBeenCalled();
      expect(getGatewazeSession).not.toHaveBeenCalled();
    });

    it.each([
      ['me', () => me()],
      ['the supabase proxy', rest],
    ])('answer the uniform 404 on %s when the request has no LFX bearer token', async (_label, send) => {
      bearer.value = undefined;

      const res = await send();

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('NOT_FOUND');
      expect(getPersonas).not.toHaveBeenCalled();
      expect(getGatewazeMe).not.toHaveBeenCalled();
      expect(getGatewazeSession).not.toHaveBeenCalled();
    });

    it('refuses an impersonating caller with 403 before any session is loaded', async () => {
      isImpersonating.mockReturnValue(true);

      const res = await rest();

      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await res.json()).code).toBe('GW_EMBED_IMPERSONATION_BLOCKED');
      expect(getGatewazeSession).not.toHaveBeenCalled();
    });

    it('refuses a caller with no ED, root or writer access with 403 before any session is loaded', async () => {
      getPersonas.mockResolvedValue({ isRootWriter: false, personas: [] });
      getWriterSummary.mockResolvedValue({ hasWriterFoundation: false, hasWriterProject: false });

      const res = await api();

      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('GW_EMBED_ACCESS_REQUIRED');
      expect(getGatewazeSession).not.toHaveBeenCalled();
    });

    it.each([
      ['GoTrue', '/api/gatewaze/supabase/auth/v1/user'],
      ['Realtime over plain HTTP', '/api/gatewaze/supabase/realtime/v1/websocket'],
    ])('does not proxy %s', async (_label, path) => {
      const res = await fetch(`${baseUrl}${path}`, { headers: shim });

      expect(res.status).toBe(404);
      expect(getGatewazeSession).not.toHaveBeenCalled();
    });
  });

  it.each(['/api/gatewaze/supabase/REST/v1/newsletters', '/api/gatewaze/API/modules/x'])(
    'answers 400 for the upper-cased %s, before any session is loaded',
    async (path) => {
      const res = await fetch(`${baseUrl}${path}`, { headers: { authorization: 'Bearer host-session', apikey: 'sb_publishable_synthetic' } });

      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('GW_BAD_PATH');
      expect(getGatewazeSession).not.toHaveBeenCalled();
    }
  );
});
