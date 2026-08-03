// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getJson, setJson, buildMemberV1MappingCacheKey, resolveV1MappingBatch } = vi.hoisted(() => ({
  getJson: vi.fn(),
  setJson: vi.fn(),
  // Defaults to a real-looking key so tests don't need to stub this per-case unless verifying the
  // fail-closed (unsafe-uid) path specifically.
  buildMemberV1MappingCacheKey: vi.fn<(memberUid: string) => string | null>((memberUid: string) => `cache:${memberUid}`),
  resolveV1MappingBatch: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  VALKEY_CACHE: { MEMBER_V1_MAPPING_TTL_SECONDS: 604800, MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS: 3600 },
}));
vi.mock('../services/valkey.service', () => ({ buildMemberV1MappingCacheKey, valkeyService: { getJson, setJson } }));
vi.mock('./v1-mapping-batch.helper', () => ({ resolveV1MappingBatch }));

import { resolveMemberV2UidsToV1Ids } from './member-v1-mapping.helper';

const req = {} as unknown as Request;
const natsService = {} as unknown as import('../services/nats.service').NatsService;

describe('resolveMemberV2UidsToV1Ids', () => {
  beforeEach(() => {
    getJson.mockReset();
    setJson.mockReset();
    buildMemberV1MappingCacheKey.mockReset().mockImplementation((memberUid: string) => `cache:${memberUid}`);
    resolveV1MappingBatch.mockReset().mockResolvedValue({ resolved: new Map(), confirmedUnresolved: new Set() });
  });

  it('resolves entirely from a positive cache hit, without calling NATS', async () => {
    getJson.mockResolvedValueOnce({ v1Id: 'v1-a' });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(result.get('a')).toBe('v1-a');
    expect(resolveV1MappingBatch).not.toHaveBeenCalled();
  });

  it('resolves a cache miss via NATS and populates the positive cache at the long TTL', async () => {
    getJson.mockResolvedValueOnce(null);
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['a', 'v1-a']]), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(result.get('a')).toBe('v1-a');
    expect(setJson).toHaveBeenCalledWith('cache:a', { v1Id: 'v1-a' }, 604800);
  });

  it('skips NATS and leaves the uid unresolved on a confirmed-negative cache hit', async () => {
    getJson.mockResolvedValueOnce({ v1Id: null });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(result.has('a')).toBe(false);
    expect(resolveV1MappingBatch).not.toHaveBeenCalled();
  });

  it('negative-caches a confirmed-unresolved NATS result at the short degrade TTL', async () => {
    getJson.mockResolvedValueOnce(null);
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map(), confirmedUnresolved: new Set(['a']) });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(result.has('a')).toBe(false);
    expect(setJson).toHaveBeenCalledWith('cache:a', { v1Id: null }, 3600);
  });

  it('does NOT write any cache entry for an indeterminate NATS outcome (neither resolved nor confirmed-unresolved)', async () => {
    getJson.mockResolvedValueOnce(null);
    // Simulates a thrown/timed-out lookup: absent from both result buckets.
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map(), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(result.has('a')).toBe(false);
    expect(setJson).not.toHaveBeenCalled();
  });

  it('resolves a mix of positive cache hit, negative cache hit, and NATS-resolved miss in one call', async () => {
    getJson.mockImplementation(async (key: string) => {
      if (key === 'cache:cached-positive') return { v1Id: 'v1-cached' };
      if (key === 'cache:cached-negative') return { v1Id: null };
      return null; // cache:needs-nats
    });
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['needs-nats', 'v1-fresh']]), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['cached-positive', 'cached-negative', 'needs-nats']);

    expect(result.get('cached-positive')).toBe('v1-cached');
    expect(result.has('cached-negative')).toBe(false);
    expect(result.get('needs-nats')).toBe('v1-fresh');
    // Only the genuine cache miss should ever reach the NATS phase.
    expect(resolveV1MappingBatch).toHaveBeenCalledWith(
      req,
      natsService,
      ['needs-nats'],
      expect.any(Function),
      expect.any(Function),
      expect.any(String),
      expect.any(String)
    );
  });

  it('returns an empty map for an empty input list, calling neither the cache nor NATS', async () => {
    const result = await resolveMemberV2UidsToV1Ids(req, natsService, []);

    expect(result.size).toBe(0);
    expect(getJson).not.toHaveBeenCalled();
    expect(resolveV1MappingBatch).not.toHaveBeenCalled();
  });

  it('dedupes duplicate uids in the input before checking the cache or calling NATS', async () => {
    getJson.mockResolvedValue(null);
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['a', 'v1-a']]), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['a', 'a', 'a']);

    expect(getJson).toHaveBeenCalledTimes(1);
    expect(resolveV1MappingBatch).toHaveBeenCalledWith(
      req,
      natsService,
      ['a'],
      expect.any(Function),
      expect.any(Function),
      expect.any(String),
      expect.any(String)
    );
    expect(result.get('a')).toBe('v1-a');
  });

  it('bypasses the cache entirely (still attempts NATS, never writes back) for a uid that fails the cache-key safety check', async () => {
    buildMemberV1MappingCacheKey.mockReturnValue(null);
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['unsafe uid', 'v1-a']]), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['unsafe uid']);

    expect(getJson).not.toHaveBeenCalled();
    expect(result.get('unsafe uid')).toBe('v1-a');
    expect(setJson).not.toHaveBeenCalled();
  });
});
