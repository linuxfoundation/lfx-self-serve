// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts / session-store.service.spec.ts: the `@lfx-one/shared/*` alias
// isn't wired into this app's vitest config, so runtime collaborators need mocking. Only
// `AccessCheckAccessType`/`AccessCheckRequest`/etc. are imported from shared interfaces — all
// type-only, so no mock is needed for that subpath (esbuild elides type-only imports).
const { proxyRequest } = vi.hoisted(() => ({ proxyRequest: vi.fn() }));

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { AccessCheckService } from './access-check.service';
import { logger } from './logger.service';

const req = {} as unknown as Request;

describe('AccessCheckService.checkAccess', () => {
  let service: AccessCheckService;

  beforeEach(() => {
    proxyRequest.mockReset();
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
});

describe('AccessCheckService.checkAccessStrict / checkSingleAccessStrict', () => {
  let service: AccessCheckService;

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new AccessCheckService();
  });

  it('resolves the same as checkAccess on success', async () => {
    proxyRequest.mockResolvedValueOnce({ results: ['committee:x#viewer@user:alice\ttrue'] });

    const result = await service.checkSingleAccessStrict(req, { resource: 'committee', id: 'x', access: 'viewer' });

    expect(result).toBe(true);
  });

  it('propagates the upstream error instead of degrading to false, and still logs it', async () => {
    const upstreamError = new Error('boom');
    proxyRequest.mockRejectedValueOnce(upstreamError);

    await expect(service.checkSingleAccessStrict(req, { resource: 'committee', id: 'x', access: 'viewer' })).rejects.toThrow('boom');
    // checkAccess degrades and never throws, so its failure path always has a terminal log; a
    // rethrow path needs its own logger.error call or a failed strict check leaves a
    // started-but-never-finished operation with no error record.
    expect(logger.error).toHaveBeenCalledWith(req, expect.any(String), expect.any(Number), upstreamError, expect.objectContaining({ request_count: 1 }));
  });

  it('returns an empty map without calling upstream for an empty input', async () => {
    const result = await service.checkAccessStrict(req, []);

    expect(result.size).toBe(0);
    expect(proxyRequest).not.toHaveBeenCalled();
  });
});
