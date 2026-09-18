// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceValidationError } from '../errors/service-validation.error';
import { OrgSlugResolverService } from './org-slug-resolver.service';

// The resolver is access-sensitive (spec 050, DR-002/DR-003/DR-007): these specs pin the outcome
// decisions — which rows count, when a slug is a tie, what the cache may store — against a stubbed
// query-service. `valkey.service` is mocked whole: it reaches the Angular-tainted shared utils barrel.
const { proxyRequest, getEffectiveUsername, withCache, buildPerUserOrgKey } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  getEffectiveUsername: vi.fn(),
  withCache: vi.fn(),
  buildPerUserOrgKey: vi.fn(),
}));

vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), startOperation: vi.fn(), success: vi.fn() } }));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./valkey.service', () => ({ buildPerUserOrgKey, valkeyService: { withCache } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));

const req = { path: '/api/orgs/resolve/x' } as Request;
const UID_A = '0014100000MgaAAAAA';
const UID_B = '0014100000MgbBBBBB';
const UID_C = '0014100000MgcCCCCC';

/** One query-service page as the BFF sees it: readable rows only, plus the cursor upstream built before access filtering. */
function page(rows: { uid: string; slug?: string | null; name?: string }[], pageToken: string | null = null) {
  return {
    resources: rows.map((row) => ({
      id: `b2b_org:${row.uid}`,
      data: { name: row.name ?? `Org ${row.uid}`, slug: row.slug === undefined ? 'acme-inc' : row.slug },
    })),
    ...(pageToken ? { page_token: pageToken } : {}),
  };
}

/** The `accept` / `storable` predicates handed to the cache on the last slug lookup. */
function cachePredicates(): { accept: (value: unknown) => boolean; storable: (value: unknown) => boolean } {
  const call = withCache.mock.calls.at(-1);
  if (!call) throw new Error('withCache was not called');
  return { accept: call[3], storable: call[4] };
}

beforeEach(() => {
  vi.resetAllMocks();
  getEffectiveUsername.mockReturnValue('viewer');
  buildPerUserOrgKey.mockImplementation((namespace: string, username: string, segment: string) => `${namespace}:${username}:${segment}`);
  // Pass-through cache: the fetcher decides, the predicates are captured for assertion.
  withCache.mockImplementation((_key: string | null, _ttl: number, fetcher: () => Promise<unknown>) => fetcher());
});

describe('OrgSlugResolverService — input', () => {
  it.each(['overview', 'not-found', 'Bad Segment!', '-leading', ''])('rejects %p before any lookup', async (segment) => {
    await expect(new OrgSlugResolverService().resolveSegment(req, segment)).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('rejects a malformed `prefer` before any lookup — it is a tie-breaker, never a free-form filter', async () => {
    await expect(new OrgSlugResolverService().resolveSegment(req, 'acme-inc', 'not-an-sfid')).rejects.toBeInstanceOf(ServiceValidationError);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('matches a slug case-insensitively: the tag carries the lowercase form', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }]));
    await new OrgSlugResolverService().resolveSegment(req, 'ACME-Inc');
    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ type: 'b2b_org', tags: ['slug:acme-inc'] })
    );
  });
});

describe('OrgSlugResolverService — SFID segment', () => {
  it('resolves through the uid tag with the caller context and never consults the cache', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A, slug: 'acme-inc', name: 'Acme, Inc.' }]));

    const result = await new OrgSlugResolverService().resolveSegment(req, UID_A);

    expect(result).toEqual({ outcome: 'hit', org: { uid: UID_A, slug: 'acme-inc', name: 'Acme, Inc.' } });
    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ tags: [`b2b_org_uid:${UID_A}`], page_size: 1 })
    );
    expect(withCache).not.toHaveBeenCalled();
  });

  it('is a miss when query-service returns no readable row — unknown and no-access are the same answer', async () => {
    proxyRequest.mockResolvedValueOnce(page([]));
    expect(await new OrgSlugResolverService().resolveSegment(req, UID_A)).toEqual({ outcome: 'miss' });
  });

  it('maps a slugless organization to `slug: null`', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A, slug: null }]));
    expect(await new OrgSlugResolverService().resolveSegment(req, UID_A)).toEqual({ outcome: 'hit', org: { uid: UID_A, slug: null, name: `Org ${UID_A}` } });
  });
});

describe('OrgSlugResolverService — slug segment', () => {
  it('is a hit for a single readable row and stores only that shape in the per-viewer cache', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }]));

    const result = await new OrgSlugResolverService().resolveSegment(req, 'acme-inc');

    expect(result).toEqual({ outcome: 'hit', org: { uid: UID_A, slug: 'acme-inc', name: `Org ${UID_A}` } });
    expect(buildPerUserOrgKey).toHaveBeenCalledWith(expect.any(String), 'viewer', 'acme-inc');
    const { accept, storable } = cachePredicates();
    expect(storable(result)).toBe(true);
    expect(storable({ outcome: 'miss' })).toBe(false);
    expect(storable({ outcome: 'ambiguous' })).toBe(false);
    expect(storable({ outcome: 'hit', org: { uid: 'not-an-sfid' } })).toBe(false);
    expect(accept({ outcome: 'miss' })).toBe(false);
  });

  it('is a miss when no page holds a readable row', async () => {
    proxyRequest.mockResolvedValueOnce(page([]));
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc')).toEqual({ outcome: 'miss' });
  });

  // Query-service pages the raw hits before the access check: the readable row can sit behind a
  // page that filtered down to nothing but still carries a cursor.
  it('follows the cursor past a filtered-empty page instead of reporting a false miss', async () => {
    proxyRequest.mockResolvedValueOnce(page([], 'cursor-2')).mockResolvedValueOnce(page([{ uid: UID_B }]));

    const result = await new OrgSlugResolverService().resolveSegment(req, 'acme-inc');

    expect(result).toEqual(expect.objectContaining({ outcome: 'hit', org: expect.objectContaining({ uid: UID_B }) }));
    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest.mock.calls[1][4]).toEqual(expect.objectContaining({ page_token: 'cursor-2' }));
    expect(proxyRequest.mock.calls[0][4]).not.toHaveProperty('page_token');
  });

  it('keeps reading while a cursor remains so a second readable row on a later page makes the slug ambiguous, not a cached unique hit', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }], 'cursor-2')).mockResolvedValueOnce(page([{ uid: UID_B }]));

    const result = await new OrgSlugResolverService().resolveSegment(req, 'acme-inc');

    expect(result).toEqual({ outcome: 'ambiguous' });
    expect(cachePredicates().storable(result)).toBe(false);
  });

  it('stops reading once two readable rows are in hand', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }, { uid: UID_B }], 'cursor-2'));
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc')).toEqual({ outcome: 'ambiguous' });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('fails closed as ambiguous when the page cap is reached with a cursor still pending', async () => {
    for (let i = 0; i < 5; i += 1) proxyRequest.mockResolvedValueOnce(page(i === 0 ? [{ uid: UID_A }] : [], `cursor-${i + 2}`));

    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc')).toEqual({ outcome: 'ambiguous' });
    expect(proxyRequest).toHaveBeenCalledTimes(5);
  });

  it('skips the cache (direct fetch) when the key builder cannot produce a key', async () => {
    buildPerUserOrgKey.mockReturnValue(null);
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }]));
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc')).toEqual(expect.objectContaining({ outcome: 'hit' }));
    expect(withCache).toHaveBeenCalledWith(null, expect.any(Number), expect.any(Function), expect.any(Function), expect.any(Function));
  });
});

describe('OrgSlugResolverService — `prefer` tie-break (DR-007 §4)', () => {
  beforeEach(() => {
    // Two readable organizations share the slug.
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_A }, { uid: UID_B }]));
  });

  it('stays ambiguous without a selection to prefer', async () => {
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc')).toEqual({ outcome: 'ambiguous' });
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it('resolves to the preferred organization when query-service confirms it is readable and carries this very slug', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_B, slug: 'acme-inc', name: 'Acme B' }]));

    const result = await new OrgSlugResolverService().resolveSegment(req, 'acme-inc', UID_B);

    expect(result).toEqual({ outcome: 'hit', org: { uid: UID_B, slug: 'acme-inc', name: 'Acme B' } });
    expect(proxyRequest.mock.calls[1][4]).toEqual(expect.objectContaining({ tags: [`b2b_org_uid:${UID_B}`] }));
  });

  it('does not let `prefer` pick an organization whose published slug is different', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: UID_C, slug: 'other-slug' }]));
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc', UID_C)).toEqual({ outcome: 'ambiguous' });
  });

  it('does not let `prefer` widen access: an unreadable preferred organization leaves the tie unbroken', async () => {
    proxyRequest.mockResolvedValueOnce(page([]));
    expect(await new OrgSlugResolverService().resolveSegment(req, 'acme-inc', UID_C)).toEqual({ outcome: 'ambiguous' });
  });
});
