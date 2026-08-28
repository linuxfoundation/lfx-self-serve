// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts / session-store.service.spec.ts: the `@lfx-one/shared/*` alias
// isn't wired into this app's vitest config, so runtime collaborators need mocking. Only
// `AccessCheckAccessType`/`AccessCheckRequest`/etc. are imported from shared interfaces — all
// type-only, so no mock is needed for that subpath (esbuild elides type-only imports).
//
// `loggerError` is hoisted (not left as an inline `vi.fn()` in the `vi.mock` factory below) so it
// can be reset per test — Vitest/Jest treat two `Error` instances as equal when their message
// matches, so an unreset mock lets an unrelated earlier test's `logger.error(..., new Error('boom'))`
// call silently satisfy a later `toHaveBeenCalledWith(..., new Error('boom'), ...)` assertion even
// if the code path under test never ran.
const { proxyRequest, loggerError, loggerWarning } = vi.hoisted(() => ({ proxyRequest: vi.fn(), loggerError: vi.fn(), loggerWarning: vi.fn() }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: loggerError,
    warning: loggerWarning,
    debug: vi.fn(),
    info: vi.fn(),
    sanitize: (v: unknown) => v,
  },
}));
// ACCESS_CHECK_BATCH_SIZE is imported at runtime by access-check.service.ts — the alias isn't
// wired into this app's vitest config, so it must be stubbed (same pattern as project.service.spec.ts).
vi.mock('@lfx-one/shared/constants', () => ({ ACCESS_CHECK_BATCH_SIZE: 100 }));

import type { Request } from 'express';

import { AccessCheckService } from './access-check.service';

const req = {} as unknown as Request;

describe('AccessCheckService.checkAccess', () => {
  let service: AccessCheckService;

  beforeEach(() => {
    proxyRequest.mockReset();
    loggerError.mockReset();
    loggerWarning.mockReset();
    service = new AccessCheckService();
  });

  it('matches results back to requests by tuple content, not array position', async () => {
    // Upstream reorders relative to the request order it was sent in.
    proxyRequest.mockResolvedValueOnce({
      results: ['project:b#writer@user:alice\ttrue', 'project:a#writer@user:alice\tfalse'],
    });

    const result = await service.checkAccess(req, [
      { resource: 'project', id: 'a', access: 'writer' },
      { resource: 'project', id: 'b', access: 'writer' },
    ]);

    expect(result.get('a#writer')).toBe(false);
    expect(result.get('b#writer')).toBe(true);
  });

  it('deduplicates identical tuples without misattributing them to different resources', async () => {
    // Two distinct resource ids requesting the exact same relation happen to produce the same
    // tuple string only when ids match — this checks the id is part of the matched key, not just
    // resource+access.
    proxyRequest.mockResolvedValueOnce({
      results: ['committee:x#writer@user:alice\ttrue', 'committee:y#writer@user:alice\tfalse'],
    });

    const result = await service.checkAccess(req, [
      { resource: 'committee', id: 'x', access: 'writer' },
      { resource: 'committee', id: 'y', access: 'writer' },
    ]);

    expect(result.get('x#writer')).toBe(true);
    expect(result.get('y#writer')).toBe(false);
  });

  it('does not let a duplicated request tuple misalign a later distinct resource', async () => {
    // 'a' is requested twice; upstream dedupes the repeated tuple server-side, returning only 2
    // result lines for 3 requests. The old index-based implementation would misalign
    // resources[1] (the duplicate 'a') against results[1] (actually resource 'b''s line),
    // corrupting 'a' and losing 'b' entirely.
    proxyRequest.mockResolvedValueOnce({
      results: ['project:a#writer@user:alice\ttrue', 'project:b#writer@user:alice\tfalse'],
    });

    const result = await service.checkAccess(req, [
      { resource: 'project', id: 'a', access: 'writer' },
      { resource: 'project', id: 'a', access: 'writer' },
      { resource: 'project', id: 'b', access: 'writer' },
    ]);

    expect(result.get('a#writer')).toBe(true);
    expect(result.get('b#writer')).toBe(false);
  });

  it('fails closed when the upstream response omits a tuple entirely', async () => {
    // Only one of two requested tuples came back — e.g. a partial/short response.
    proxyRequest.mockResolvedValueOnce({
      results: ['project:a#writer@user:alice\ttrue'],
    });

    const result = await service.checkAccess(req, [
      { resource: 'project', id: 'a', access: 'writer' },
      { resource: 'project', id: 'b', access: 'writer' },
    ]);

    expect(result.get('a#writer')).toBe(true);
    expect(result.get('b#writer')).toBe(false);
  });

  it('returns an empty map without calling upstream for an empty input', async () => {
    const result = await service.checkAccess(req, []);

    expect(result.size).toBe(0);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('falls back to all-false on upstream error', async () => {
    proxyRequest.mockRejectedValueOnce(new Error('boom'));

    const result = await service.checkAccess(req, [{ resource: 'project', id: 'a', access: 'writer' }]);

    expect(result.get('a#writer')).toBe(false);
  });

  it('threads options.bearerToken into the proxy call, distinct from req.bearerToken', async () => {
    const reqWithToken = { bearerToken: 'req-token' } as unknown as Request;
    proxyRequest.mockResolvedValueOnce({ results: ['project:a#writer@user:alice\ttrue'] });

    await service.checkAccess(reqWithToken, [{ resource: 'project', id: 'a', access: 'writer' }], { bearerToken: 'override-token' });

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    // proxyRequest signature: (req, service, path, method, query, data, customHeaders, options)
    const options = proxyRequest.mock.calls[0][7];
    expect(options).toEqual({ bearerToken: 'override-token' });
  });
});

describe('AccessCheckService.checkAccessStrict / checkSingleAccessStrict', () => {
  let service: AccessCheckService;

  beforeEach(() => {
    proxyRequest.mockReset();
    loggerError.mockReset();
    loggerWarning.mockReset();
    service = new AccessCheckService();
  });

  it('resolves the same as checkAccess on success', async () => {
    proxyRequest.mockResolvedValueOnce({ results: ['committee:x#viewer@user:alice\ttrue'] });

    const result = await service.checkSingleAccessStrict(req, { resource: 'committee', id: 'x', access: 'viewer' });

    expect(result).toBe(true);
  });

  it('propagates the upstream error instead of degrading to false, and still logs it', async () => {
    const upstreamError = new Error('strict-path-upstream-failure');
    proxyRequest.mockRejectedValueOnce(upstreamError);

    await expect(service.checkSingleAccessStrict(req, { resource: 'committee', id: 'x', access: 'viewer' })).rejects.toThrow('strict-path-upstream-failure');
    // checkAccess degrades and never throws, so its failure path always has a terminal log; a
    // rethrow path needs its own logger.error call or a failed strict check leaves a
    // started-but-never-finished operation with no error record. Asserts exactly one call (not
    // just "called with") since `loggerError` is reset per test in beforeEach.
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(req, expect.any(String), expect.any(Number), upstreamError, expect.objectContaining({ request_count: 1 }));
  });

  it('returns an empty map without calling upstream for an empty input', async () => {
    const result = await service.checkAccessStrict(req, []);

    expect(result.size).toBe(0);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});

describe('AccessCheckService — batching', () => {
  let service: AccessCheckService;

  // Build N access-check requests for distinct project IDs.
  function makeResources(count: number): Array<{ resource: 'project'; id: string; access: 'writer' }> {
    return Array.from({ length: count }, (_, i) => ({ resource: 'project' as const, id: `proj-${i}`, access: 'writer' as const }));
  }

  // Build a mock upstream response granting access to each of the given requests.
  function mockResponse(resources: Array<{ resource: string; id: string; access: string }>, granted = true): { results: string[] } {
    return { results: resources.map((r) => `${r.resource}:${r.id}#${r.access}@user:alice\t${granted}`) };
  }

  beforeEach(() => {
    proxyRequest.mockReset();
    loggerError.mockReset();
    loggerWarning.mockReset();
    service = new AccessCheckService();
  });

  it('issues exactly one POST when the resource count is at the batch size limit (100)', async () => {
    const resources = makeResources(100);
    proxyRequest.mockResolvedValueOnce(mockResponse(resources, true));

    const result = await service.checkAccess(req, resources);

    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(result.get('proj-0#writer')).toBe(true);
    expect(result.get('proj-99#writer')).toBe(true);
  });

  it('fans out to two POSTs when the resource count exceeds the batch size (101 resources → chunks of 100 and 1)', async () => {
    const resources = makeResources(101);
    // First chunk: resources 0–99, second chunk: resource 100.
    proxyRequest.mockResolvedValueOnce(mockResponse(resources.slice(0, 100), true));
    proxyRequest.mockResolvedValueOnce(mockResponse(resources.slice(100), false));

    const result = await service.checkAccess(req, resources);

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    // Results from both chunks are merged into one map.
    expect(result.get('proj-0#writer')).toBe(true);
    expect(result.get('proj-99#writer')).toBe(true);
    expect(result.get('proj-100#writer')).toBe(false);
  });

  it('fails the rejected chunk closed but preserves results from fulfilled chunks', async () => {
    const resources = makeResources(101);
    // Chunk 1 (resources 0–99) succeeds; chunk 2 (resource 100) fails.
    proxyRequest.mockResolvedValueOnce(mockResponse(resources.slice(0, 100), true));
    proxyRequest.mockRejectedValueOnce(new Error('chunk-failure'));

    const result = await service.checkAccess(req, resources);

    // Fulfilled chunk results are present.
    expect(result.get('proj-0#writer')).toBe(true);
    expect(result.get('proj-99#writer')).toBe(true);
    // The failed chunk's resource is absent from the result map → defaults to false for callers.
    expect(result.has('proj-100#writer')).toBe(false);
    // A warning is emitted for the failed chunk so the incident is traceable.
    expect(loggerWarning).toHaveBeenCalledTimes(1);
    expect(loggerWarning).toHaveBeenCalledWith(req, expect.any(String), expect.stringContaining('chunk 1 failed'), expect.objectContaining({ chunk_index: 1 }));
  });
});
