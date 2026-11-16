// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A Valkey shared by every replica: entries with an expiry, switches for an outage and a lost write, and a count of lock calls.
const sharedValkey = vi.hoisted(() => {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  const state = { available: true, writesFail: false, lockCalls: 0 };
  const live = (key: string) => {
    const entry = entries.get(key);
    return entry && entry.expiresAt > Date.now() ? entry : undefined;
  };
  return { entries, state, live };
});

vi.mock('../services/valkey.service', () => ({
  buildMentorshipUserSyncKey: (loginId: string) => `test:mentorship-user-sync:${loginId}`,
  valkeyService: {
    acquireLock: async (key: string, ttlMs: number) => {
      sharedValkey.state.lockCalls++;
      if (!sharedValkey.state.available) return { status: 'unavailable' };
      if (sharedValkey.live(key)) return { status: 'contended' };
      sharedValkey.entries.set(key, { value: 'lock-token', expiresAt: Date.now() + ttlMs });
      return { status: 'acquired', token: 'lock-token' };
    },
    setJson: async (key: string, value: unknown, ttlSeconds: number) => {
      if (!sharedValkey.state.available || sharedValkey.state.writesFail) return false;
      sharedValkey.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return true;
    },
  },
}));

vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MicroserviceError } = await import('../errors');
const { logger } = await import('../services/logger.service');
const { listAllMentorshipPages, proxyMentorshipRequest, readMentorshipPages, withMentorshipLoginId } = await import('./mentorship-api.helper');

type Proxy = Parameters<typeof proxyMentorshipRequest>[0];

const req = { path: '/api/mentorship/mentee/applications' } as Request;
const path = '/mentorship/v1/me/applications';

function upstream401(message: string) {
  return MicroserviceError.fromMicroserviceResponse(401, 'Unauthorized', { error: message }, 'LFX_V2_SERVICE', path);
}

describe('proxyMentorshipRequest', () => {
  let proxyRequest: ReturnType<typeof vi.fn>;
  let proxy: Proxy;

  beforeEach(() => {
    proxyRequest = vi.fn();
    proxy = { proxyRequest } as unknown as Proxy;
  });

  it('returns the upstream body when the user is already provisioned', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [] });

    await expect(proxyMentorshipRequest(proxy, req, path)).resolves.toEqual({ data: [] });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', path, 'GET', undefined, undefined);
  });

  it('provisions the user with PUT /me and retries once on the not-provisioned 401', async () => {
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 'app-1' });

    const body = { status: 'withdrawn' };
    await expect(proxyMentorshipRequest(proxy, req, path, 'PATCH', { limit: 5 }, body)).resolves.toEqual({ id: 'app-1' });

    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', path, 'PATCH', { limit: 5 }, body);
  });

  it('sends the custom headers on the request and its retry, not on the PUT /me provisioning call', async () => {
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockResolvedValueOnce({ ok: true });
    const bytes = Buffer.from('png');
    const headers = { 'Content-Type': 'image/png' };

    await expect(proxyMentorshipRequest(proxy, req, path, 'POST', undefined, bytes, path, headers)).resolves.toEqual({ ok: true });

    expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', path, 'POST', undefined, bytes, headers);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', path, 'POST', undefined, bytes, headers);
  });

  it('applies the request options to the request and its retry, not to the PUT /me provisioning call', async () => {
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockResolvedValueOnce({ ok: true });
    const form = { file: 'bytes' };
    const options = { timeoutMs: 120_000 };

    await expect(proxyMentorshipRequest(proxy, req, path, 'POST', undefined, form, undefined, undefined, options)).resolves.toEqual({ ok: true });

    expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', path, 'POST', undefined, form, undefined, options);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(proxyRequest.mock.calls[1]).toHaveLength(6);
    expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', path, 'POST', undefined, form, undefined, options);
  });

  it('sends both the custom headers and the request options when both are set', async () => {
    proxyRequest.mockResolvedValueOnce({ ok: true });
    const headers = { 'Content-Type': 'image/png' };
    const options = { timeoutMs: 120_000 };

    await proxyMentorshipRequest(proxy, req, path, 'POST', undefined, Buffer.from('png'), path, headers, options);

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', path, 'POST', undefined, Buffer.from('png'), headers, options);
  });

  it('calls the proxy with its original six arguments when neither headers nor options are set', async () => {
    proxyRequest.mockResolvedValueOnce({ ok: true });

    await proxyMentorshipRequest(proxy, req, path, 'DELETE');

    expect(proxyRequest.mock.calls[0]).toHaveLength(6);
  });

  it('does not provision an impersonated user, since impersonation is read-only', async () => {
    const error = upstream401('local user is not provisioned');
    proxyRequest.mockRejectedValueOnce(error);
    const impersonatedReq = { ...req, impersonationActive: true } as Request;

    await expect(proxyMentorshipRequest(proxy, impersonatedReq, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry any other 401', async () => {
    const error = upstream401('authenticated gateway principal is required');
    proxyRequest.mockRejectedValueOnce(error);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-401 error', async () => {
    const error = MicroserviceError.fromMicroserviceResponse(403, 'Forbidden', { error: 'local user is not provisioned' }, 'LFX_V2_SERVICE', path);
    proxyRequest.mockRejectedValueOnce(error);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(error);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second time when the retry is also not provisioned', async () => {
    const second = upstream401('local user is not provisioned');
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockResolvedValueOnce({}).mockRejectedValueOnce(second);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(second);
    expect(proxyRequest).toHaveBeenCalledTimes(3);
  });

  it('propagates a PUT /me failure without retrying the original request', async () => {
    const bootstrapError = MicroserviceError.fromMicroserviceResponse(400, 'Bad Request', { error: 'invalid body' }, 'LFX_V2_SERVICE', '/mentorship/v1/me');
    proxyRequest.mockRejectedValueOnce(upstream401('local user is not provisioned')).mockRejectedValueOnce(bootstrapError);

    await expect(proxyMentorshipRequest(proxy, req, path)).rejects.toBe(bootstrapError);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });
});

describe('withMentorshipLoginId', () => {
  it('starts a new login: keeps the session and sets a fresh login id each time', () => {
    const session = { id_token: 'id', access_token: 'access', impersonationUser: 'kept' };

    const first = withMentorshipLoginId(session);
    const second = withMentorshipLoginId(first);

    expect(first).toMatchObject(session);
    expect(first.mentorshipLoginId).toEqual(expect.any(String));
    expect(second.mentorshipLoginId).not.toBe(first.mentorshipLoginId);
    expect(session).not.toHaveProperty('mentorshipLoginId');
  });
});

describe('proxyMentorshipRequest per-login refresh', () => {
  const retryMs = 60_000;
  let proxyRequest: ReturnType<typeof vi.fn>;
  let proxy: Proxy;
  let logins = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    sharedValkey.entries.clear();
    Object.assign(sharedValkey.state, { available: true, writesFail: false, lockCalls: 0 });
    proxyRequest = vi.fn((_req: Request, _service: string, calledPath: string) => Promise.resolve(calledPath === path ? { data: [] } : {}));
    proxy = { proxyRequest } as unknown as Proxy;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A new login id: the replica fallback remembers logins for the whole module, so tests never share one. */
  function newLogin(): string {
    return `login-${++logins}`;
  }

  /** A request carrying its own copy of the login's session, as each request reads the session separately. */
  function requestFor(loginId: string | undefined, extra: Record<string, unknown> = {}): Request {
    const session = loginId ? { mentorshipLoginId: loginId } : {};
    return { ...req, appSession: session, oidc: { user: { sub: 'auth0|alice' } }, ...extra } as unknown as Request;
  }

  function refreshes(): number {
    return proxyRequest.mock.calls.filter((call) => call[2] === '/mentorship/v1/me' && call[3] === 'PUT').length;
  }

  it('refreshes once before the first request of a login, and not for a later request with its own session copy', async () => {
    const loginId = newLogin();
    const first = requestFor(loginId);

    await expect(proxyMentorshipRequest(proxy, first, path)).resolves.toEqual({ data: [] });
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(proxyRequest).toHaveBeenNthCalledWith(1, first, 'LFX_V2_SERVICE', '/mentorship/v1/me', 'PUT', undefined, {});
    expect(refreshes()).toBe(1);
    expect(first.appSession).toEqual({ mentorshipLoginId: loginId });
    expect(sharedValkey.live(`test:mentorship-user-sync:${loginId}`)?.value).toBe(true);
  });

  it('refreshes again for a new login', async () => {
    await proxyMentorshipRequest(proxy, requestFor(newLogin()), path);
    await proxyMentorshipRequest(proxy, requestFor(newLogin()), path);

    expect(refreshes()).toBe(2);
  });

  it('shares one PUT /me between parallel requests on one replica', async () => {
    const loginId = newLogin();

    await Promise.all([proxyMentorshipRequest(proxy, requestFor(loginId), path), proxyMentorshipRequest(proxy, requestFor(loginId), path)]);

    expect(refreshes()).toBe(1);
  });

  it('refreshes once across replicas, including while another replica is still refreshing', async () => {
    vi.resetModules();
    const otherReplica = await import('./mentorship-api.helper');
    const loginId = newLogin();
    let finishRefresh: (value: unknown) => void = () => undefined;
    proxyRequest.mockImplementationOnce(() => new Promise((resolve) => (finishRefresh = resolve)));

    const refreshing = proxyMentorshipRequest(proxy, requestFor(loginId), path);
    await vi.waitFor(() => expect(refreshes()).toBe(1));
    await expect(otherReplica.proxyMentorshipRequest(proxy, requestFor(loginId), path)).resolves.toEqual({ data: [] });
    finishRefresh({});
    await refreshing;
    await otherReplica.proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(refreshes()).toBe(1);
  });

  it('still sends the request when the refresh fails, and retries only after the backoff', async () => {
    const loginId = newLogin();
    const refreshError = MicroserviceError.fromMicroserviceResponse(503, 'Service Unavailable', {}, 'LFX_V2_SERVICE', '/mentorship/v1/me');
    proxyRequest.mockRejectedValueOnce(refreshError);

    await expect(proxyMentorshipRequest(proxy, requestFor(loginId), path)).resolves.toEqual({ data: [] });
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(1);
    expect(logger.warning).toHaveBeenCalledWith(expect.anything(), 'mentorship_session_sync', expect.any(String), {
      err: refreshError,
      retry_after_ms: retryMs,
    });

    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(2);
  });

  it('falls back to this replica while Valkey is unavailable, with the same once-per-login and backoff rules', async () => {
    sharedValkey.state.available = false;
    const loginId = newLogin();
    proxyRequest.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(503, 'Service Unavailable', {}, 'LFX_V2_SERVICE', '/mentorship/v1/me'));

    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(1);

    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(2);
  });

  it('asks Valkey nothing for a later request on this replica once the login is refreshed', async () => {
    const loginId = newLogin();

    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(refreshes()).toBe(1);
    expect(sharedValkey.state.lockCalls).toBe(1);
  });

  it('asks an unreachable Valkey once per backoff window, not on every request', async () => {
    sharedValkey.state.available = false;
    const loginId = newLogin();
    proxyRequest.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(503, 'Service Unavailable', {}, 'LFX_V2_SERVICE', '/mentorship/v1/me'));

    for (let i = 0; i < 3; i++) await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(sharedValkey.state.lockCalls).toBe(1);
  });

  it('does not refresh again when Valkey recovers after a refresh done during the outage', async () => {
    sharedValkey.state.available = false;
    const loginId = newLogin();
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    sharedValkey.state.available = true;
    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(refreshes()).toBe(1);
  });

  it('keeps the backoff of a refresh that failed during the outage when Valkey recovers', async () => {
    sharedValkey.state.available = false;
    const loginId = newLogin();
    proxyRequest.mockRejectedValueOnce(MicroserviceError.fromMicroserviceResponse(503, 'Service Unavailable', {}, 'LFX_V2_SERVICE', '/mentorship/v1/me'));
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    sharedValkey.state.available = true;
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(1);

    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    expect(refreshes()).toBe(2);
  });

  it('does not repeat the refresh on this replica when the done marker is not written to Valkey', async () => {
    sharedValkey.state.writesFail = true;
    const loginId = newLogin();

    await proxyMentorshipRequest(proxy, requestFor(loginId), path);
    vi.setSystemTime(Date.now() + retryMs + 1);
    await proxyMentorshipRequest(proxy, requestFor(loginId), path);

    expect(refreshes()).toBe(1);
  });

  it('does not refresh while impersonating, or for a session without a login id', async () => {
    await proxyMentorshipRequest(proxy, requestFor(newLogin(), { impersonationActive: true }), path);
    await proxyMentorshipRequest(proxy, requestFor(undefined), path);

    expect(refreshes()).toBe(0);
  });
});

describe('listAllMentorshipPages', () => {
  let proxyRequest: ReturnType<typeof vi.fn>;
  let proxy: Proxy;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequest = vi.fn();
    proxy = { proxyRequest } as unknown as Proxy;
  });

  it('reads every page at the largest page size, keeping the query', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `row-${index}` }));
    proxyRequest
      .mockResolvedValueOnce({ data: firstPage, meta: { total: 101, limit: 100, offset: 0 } })
      .mockResolvedValueOnce({ data: [{ id: 'row-last' }], meta: { total: 101, limit: 100, offset: 100 } });

    const rows = await listAllMentorshipPages<{ id: string }>(proxy, req, path, { role: 'mentee' });

    expect(rows).toHaveLength(101);
    expect(rows.at(-1)).toEqual({ id: 'row-last' });
    expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', path, 'GET', { role: 'mentee', limit: 100, offset: 0 }, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', path, 'GET', { role: 'mentee', limit: 100, offset: 100 }, undefined);
  });

  it('reads at a smaller page size when the route takes one', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `row-${index}` }));
    proxyRequest
      .mockResolvedValueOnce({ data: firstPage, meta: { total: 51, limit: 50, offset: 0 } })
      .mockResolvedValueOnce({ data: [{ id: 'row-last' }], meta: { total: 51, limit: 50, offset: 50 } });

    await expect(listAllMentorshipPages(proxy, req, path, {}, 50)).resolves.toHaveLength(51);
    expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', path, 'GET', { limit: 50, offset: 0 }, undefined);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', path, 'GET', { limit: 50, offset: 50 }, undefined);
  });

  it('stops on an empty page even when the total says there are more', async () => {
    proxyRequest
      .mockResolvedValueOnce({ data: [{ id: 'row-1' }], meta: { total: 5, limit: 100, offset: 0 } })
      .mockResolvedValueOnce({ data: [], meta: { total: 5, limit: 100, offset: 1 } });

    await expect(listAllMentorshipPages(proxy, req, path)).resolves.toEqual([{ id: 'row-1' }]);
    expect(proxyRequest).toHaveBeenCalledTimes(2);
  });

  it('stops after one page when the page carries no total', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [{ id: 'row-1' }] });

    await expect(listAllMentorshipPages(proxy, req, path)).resolves.toEqual([{ id: 'row-1' }]);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('stops at the page cap and warns when upstream keeps returning rows', async () => {
    proxyRequest.mockResolvedValue({ data: [{ id: 'row' }], meta: { total: Number.MAX_SAFE_INTEGER, limit: 100, offset: 0 } });

    await expect(listAllMentorshipPages(proxy, req, path)).resolves.toHaveLength(50);
    expect(proxyRequest).toHaveBeenCalledTimes(50);
    expect(logger.warning).toHaveBeenCalledWith(req, 'mentorship_list_all_pages', expect.any(String), { path, max_pages: 50, count: 50 });
  });
});

describe('readMentorshipPages', () => {
  let proxyRequest: ReturnType<typeof vi.fn>;
  let proxy: Proxy;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequest = vi.fn();
    proxy = { proxyRequest } as unknown as Proxy;
  });

  it('says the read is complete when it reaches the total', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [{ id: 'row-1' }], meta: { total: 1, limit: 100, offset: 0 } });

    await expect(readMentorshipPages(proxy, req, path)).resolves.toEqual({ items: [{ id: 'row-1' }], truncated: false });
  });

  it('says the read is truncated when it stops at the page cap with rows still to come', async () => {
    proxyRequest.mockResolvedValue({ data: [{ id: 'row' }], meta: { total: Number.MAX_SAFE_INTEGER, limit: 100, offset: 0 } });

    const { items, truncated } = await readMentorshipPages(proxy, req, path);

    expect(items).toHaveLength(50);
    expect(truncated).toBe(true);
  });
});
