// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getJson, setJson, buildMemberV1MappingCacheKey, resolveV1MappingBatch, warning, debug } = vi.hoisted(() => ({
  getJson: vi.fn(),
  setJson: vi.fn(),
  // Defaults to a real-looking key so tests don't need to stub this per-case unless verifying the
  // fail-closed (unsafe-uid) path specifically.
  buildMemberV1MappingCacheKey: vi.fn<(memberUid: string) => string | null>((memberUid: string) => `cache:${memberUid}`),
  resolveV1MappingBatch: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  VALKEY_CACHE: { MEMBER_V1_MAPPING_TTL_SECONDS: 604800, MEMBER_V1_MAPPING_DEGRADE_TTL_SECONDS: 3600 },
}));
vi.mock('../services/valkey.service', () => ({ buildMemberV1MappingCacheKey, valkeyService: { getJson, setJson } }));
vi.mock('./v1-mapping-batch.helper', () => ({ resolveV1MappingBatch }));
vi.mock('../services/logger.service', () => ({ logger: { warning, debug } }));

import { parseMemberMappingResponse, resolveMemberV2UidsToV1Ids } from './member-v1-mapping.helper';

const req = {} as unknown as Request;
const natsService = {} as unknown as import('../services/nats.service').NatsService;

describe('parseMemberMappingResponse', () => {
  it('extracts the member sfid (third colon-delimited segment) from a well-formed 3-segment response', () => {
    expect(parseMemberMappingResponse('project-sfid:committee-sfid:0034100000dh2VLAAY')).toBe('0034100000dh2VLAAY');
  });

  it('rejects a response whose third segment is a bare UUID — the documented "poisoned" pre-backfill form (LFXV2-2673)', () => {
    // Per lfx-v1-sync-helper's contract, a UUID here is the platform-community__c *record* sfid, not
    // the member's contact identity — accepting it would report a successful resolution to a value
    // that can never join MEMBER_USER_ID, and positive-cache the wrong value for a week.
    expect(parseMemberMappingResponse('project-sfid:committee-sfid:123e4567-e89b-12d3-a456-426614174000')).toBeNull();
  });

  it('rejects a legacy 4-segment response instead of silently folding the extra segment into the 3rd field', () => {
    // "recordSFID:contactSFID" as an extra colon-delimited value would otherwise land its record sfid
    // in position 2 (this parser's expected member-sfid slot) rather than the real contact sfid.
    expect(parseMemberMappingResponse('project-sfid:committee-sfid:record-sfid:contact-sfid')).toBeNull();
  });

  it('rejects a response with fewer than 3 segments', () => {
    expect(parseMemberMappingResponse('project-sfid:committee-sfid')).toBeNull();
  });

  it('rejects a response with a blank third segment', () => {
    expect(parseMemberMappingResponse('project-sfid:committee-sfid:')).toBeNull();
  });
});

describe('resolveMemberV2UidsToV1Ids', () => {
  beforeEach(() => {
    getJson.mockReset();
    setJson.mockReset();
    buildMemberV1MappingCacheKey.mockReset().mockImplementation((memberUid: string) => `cache:${memberUid}`);
    resolveV1MappingBatch.mockReset().mockResolvedValue({ resolved: new Map(), confirmedUnresolved: new Set() });
    warning.mockReset();
    debug.mockReset();
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
    // Simulates a thrown/timed-out lookup, or a rejected parse: absent from both result buckets.
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
      expect.objectContaining({
        buildLookupKey: expect.any(Function),
        parseResponse: expect.any(Function),
        logOperation: expect.any(String),
        entityLabel: expect.any(String),
      })
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
    expect(resolveV1MappingBatch).toHaveBeenCalledWith(req, natsService, ['a'], expect.objectContaining({ logOperation: expect.any(String) }));
    expect(result.get('a')).toBe('v1-a');
  });

  it('bypasses the cache entirely (still attempts NATS, never writes back) for a uid that fails the cache-key safety check, and warns once', async () => {
    buildMemberV1MappingCacheKey.mockReturnValue(null);
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['unsafe uid', 'v1-a']]), confirmedUnresolved: new Set() });

    const result = await resolveMemberV2UidsToV1Ids(req, natsService, ['unsafe uid']);

    expect(getJson).not.toHaveBeenCalled();
    expect(result.get('unsafe uid')).toBe('v1-a');
    expect(setJson).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      req,
      'resolve_member_v1_mapping',
      'Member uid failed the cache-key safety check; bypassing cache for it',
      expect.objectContaining({ unsafe_uid_count: 1 })
    );
  });

  it('logs a debug summary of cache hits, negative hits, and NATS outcomes', async () => {
    getJson.mockImplementation(async (key: string) => (key === 'cache:cached' ? { v1Id: 'v1-cached' } : null));
    resolveV1MappingBatch.mockResolvedValueOnce({ resolved: new Map([['from-nats', 'v1-fresh']]), confirmedUnresolved: new Set(['unmapped']) });

    await resolveMemberV2UidsToV1Ids(req, natsService, ['cached', 'from-nats', 'unmapped']);

    expect(debug).toHaveBeenCalledWith(
      req,
      'resolve_member_v1_mapping',
      'Member v1-mapping resolution complete',
      expect.objectContaining({ requested_count: 3, cache_hits: 1, nats_resolved_count: 1, nats_confirmed_unresolved_count: 1, resolved_count: 2 })
    );
  });

  it('logs a debug summary (cache-only variant) when every uid resolves from cache without any NATS call', async () => {
    getJson.mockResolvedValueOnce({ v1Id: 'v1-a' });

    await resolveMemberV2UidsToV1Ids(req, natsService, ['a']);

    expect(resolveV1MappingBatch).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      req,
      'resolve_member_v1_mapping',
      'Member v1-mapping resolution complete (cache-only, no NATS calls)',
      expect.objectContaining({ requested_count: 1, cache_hits: 1, resolved_count: 1 })
    );
  });
});
