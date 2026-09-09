// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { natsRequest, logger } = vi.hoisted(() => ({
  natsRequest: vi.fn(),
  logger: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn(), startOperation: vi.fn(() => 0) },
}));

vi.mock('../services/logger.service', () => ({ logger }));

import { NatsService } from '../services/nats.service';
import { collapseRootParentUid, resetRootProjectUidCacheForTests, resolveRootProjectUid } from './root-project.helper';

const req = {} as unknown as Request;

// A trivial passthrough codec keeps encode/decode out of scope — these tests are about caching and
// fail-closed behavior, not wire encoding.
function buildNatsService(): NatsService {
  return {
    getCodec: () => ({ encode: (v: string) => v, decode: (v: unknown) => v as string }),
    request: natsRequest,
  } as unknown as NatsService;
}

describe('resolveRootProjectUid', () => {
  let natsService: NatsService;

  beforeEach(() => {
    natsRequest.mockReset();
    logger.warning.mockReset();
    resetRootProjectUidCacheForTests();
    natsService = buildNatsService();
  });

  it('resolves the ROOT slug to its uid', async () => {
    natsRequest.mockResolvedValue({ data: 'uid-root' });

    await expect(resolveRootProjectUid(req, natsService)).resolves.toBe('uid-root');
  });

  it('caches a resolved uid within the TTL, issuing only one NATS request', async () => {
    natsRequest.mockResolvedValue({ data: 'uid-root' });

    await resolveRootProjectUid(req, natsService);
    await resolveRootProjectUid(req, natsService);

    expect(natsRequest).toHaveBeenCalledTimes(1);
  });

  it('re-resolves after the cache is reset via the test hook', async () => {
    natsRequest.mockResolvedValue({ data: 'uid-root' });
    await resolveRootProjectUid(req, natsService);

    resetRootProjectUidCacheForTests();
    await resolveRootProjectUid(req, natsService);

    expect(natsRequest).toHaveBeenCalledTimes(2);
  });

  it('fails closed to null on a NATS lookup failure, without caching the failure', async () => {
    natsRequest.mockRejectedValueOnce(new Error('nats unavailable'));
    await expect(resolveRootProjectUid(req, natsService)).resolves.toBeNull();
    expect(logger.warning).toHaveBeenCalled();

    natsRequest.mockResolvedValue({ data: 'uid-root' });
    await expect(resolveRootProjectUid(req, natsService)).resolves.toBe('uid-root');
    expect(natsRequest).toHaveBeenCalledTimes(2);
  });

  it('fails closed to null on an empty response, without caching the empty result', async () => {
    natsRequest.mockResolvedValueOnce({ data: '' });
    await expect(resolveRootProjectUid(req, natsService)).resolves.toBeNull();

    natsRequest.mockResolvedValue({ data: 'uid-root' });
    await expect(resolveRootProjectUid(req, natsService)).resolves.toBe('uid-root');
    expect(natsRequest).toHaveBeenCalledTimes(2);
  });
});

describe('collapseRootParentUid', () => {
  it('collapses a parent_uid matching the resolved ROOT uid to null', () => {
    expect(collapseRootParentUid('uid-root', 'uid-root')).toBeNull();
  });

  it('passes through a parent_uid that does not match ROOT', () => {
    expect(collapseRootParentUid('uid-parent', 'uid-root')).toBe('uid-parent');
  });

  it('passes through unchanged when the ROOT uid could not be resolved', () => {
    expect(collapseRootParentUid('uid-root', null)).toBe('uid-root');
    expect(collapseRootParentUid(null, null)).toBeNull();
  });
});
