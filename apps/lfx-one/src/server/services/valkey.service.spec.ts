// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import crypto from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setMock, evalMock, getdelMock, getMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  evalMock: vi.fn(),
  getdelMock: vi.fn(),
  getMock: vi.fn(),
}));

// `@lfx-one/shared/constants` is left unmocked — the barrel it resolves to (via the
// `@lfx-one/shared` alias in vitest.config.ts) has no Angular-only imports, so the real
// `VALKEY_CACHE` loads fine here and this spec can't silently drift from it.
//
// `@lfx-one/shared/utils`'s real barrel, unlike constants', transitively pulls in Angular-only
// code that fails to load under vitest's node environment — confirmed by trying it (JIT compiler
// error from `@angular/common`'s `PlatformLocation`). These stubs are a necessary workaround, not
// drift. Keep the submodules spread here in sync with whichever `@lfx-one/shared/utils` exports
// `valkey.service.ts` actually imports — a new one added there and missed here resolves to
// `undefined` here instead of failing at the source.
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/identity.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-selector.utils')),
}));
vi.mock('ioredis', () => ({
  default: class {
    public status = 'ready';
    public set = setMock;
    public eval = evalMock;
    public get = getMock;
    public getdel = getdelMock;
    public on(): this {
      return this;
    }
    public async quit(): Promise<void> {
      /* No real connection in this fixture. */
    }
  },
}));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn() }));
vi.mock('./logger.service', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
  },
}));

// Imported after the mocks above so the class picks up the mocked `ioredis`.
import { VALKEY_CACHE } from '@lfx-one/shared/constants';

import { buildAuthStateCacheKey, buildMeetingInviteLockCacheKey, buildOrgCacheKey, buildPerUserOrgKey, ValkeyService } from './valkey.service';

import { logger } from './logger.service';

describe('ValkeyService — acquireLock / releaseLock (LFXV2 #2241)', () => {
  beforeEach(() => {
    vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
    setMock.mockReset();
    evalMock.mockReset();
    ValkeyService.resetInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('acquires the lock and returns a token when the key is unset', async () => {
    setMock.mockResolvedValue('OK');

    const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000);

    expect(result.status).toBe('acquired');
    expect(result.status === 'acquired' && result.token).toEqual(expect.any(String));
    expect(setMock).toHaveBeenCalledWith('lock:key', expect.any(String), 'PX', 25000, 'NX');
  });

  it('reports contention when the key is already held (SET NX returns null)', async () => {
    setMock.mockResolvedValue(null);

    const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000);

    expect(result).toEqual({ status: 'contended' });
  });

  it('reports unavailable with the generated token (the SET may have landed) when the client throws', async () => {
    setMock.mockRejectedValue(new Error('connection reset'));

    const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000);

    expect(result).toEqual({ status: 'unavailable', token: expect.any(String) });
  });

  it('reports unavailable when Valkey is disabled (no VALKEY_URL)', async () => {
    vi.stubEnv('VALKEY_URL', '');
    ValkeyService.resetInstance();

    const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000);

    expect(result).toEqual({ status: 'unavailable' });
    expect(setMock).not.toHaveBeenCalled();
  });

  it('releases the lock via the compare-and-delete script with the acquired token', async () => {
    evalMock.mockResolvedValue(1);

    await ValkeyService.getInstance().releaseLock('lock:key', 'my-token');

    // Asserts the actual compare-and-delete shape, not just "some redis.call happened" — a
    // regression to a bare `redis.call("del", KEYS[1])` would still satisfy a plain
    // `stringContaining('redis.call')` check but would delete unconditionally.
    expect(evalMock).toHaveBeenCalledWith(expect.stringMatching(/get.*KEYS\[1\].*==.*ARGV\[1\].*del.*KEYS\[1\]/s), 1, 'lock:key', 'my-token');
  });

  it('does not delete the key when the release script is given a non-matching token', async () => {
    // A minimal fake of Redis's real compare-and-delete evaluation, keyed off the same store the
    // `set` mock would populate, so a regression to an unconditional `del` (which would still pass
    // the shape assertion above if it also happened to interpolate the same script text some other
    // way) is caught by its actual behavior instead.
    const store = new Map<string, string>([['lock:key', 'real-token']]);
    evalMock.mockImplementation(async (_script: string, _numKeys: number, key: string, token: string) => {
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    });

    await ValkeyService.getInstance().releaseLock('lock:key', 'wrong-token');

    expect(store.get('lock:key')).toBe('real-token');
  });

  it('swallows a release failure instead of throwing (entry ages out via TTL)', async () => {
    evalMock.mockRejectedValue(new Error('connection reset'));

    await expect(ValkeyService.getInstance().releaseLock('lock:key', 'my-token')).resolves.toBeUndefined();
  });

  it('is a no-op when Valkey is disabled (no VALKEY_URL)', async () => {
    vi.stubEnv('VALKEY_URL', '');
    ValkeyService.resetInstance();

    await ValkeyService.getInstance().releaseLock('lock:key', 'my-token');

    expect(evalMock).not.toHaveBeenCalled();
  });

  it('hands the just-generated token back without releasing it when the SET call errors (may have landed)', async () => {
    vi.useFakeTimers();
    try {
      setMock.mockRejectedValue(new Error('connection reset'));

      const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000, 3000);

      expect(result).toEqual({ status: 'unavailable', token: expect.any(String) });
      // No eager release here — see acquireLock's catch block: it would delete a lock that did
      // land, re-opening the cross-replica race. Advancing well past the op-timeout window
      // confirms no delayed retry-release was scheduled either.
      await vi.advanceTimersByTimeAsync(30000);
      expect(evalMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ValkeyService — getdelJson (#1938)', () => {
  beforeEach(() => {
    vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
    getdelMock.mockReset();
    ValkeyService.resetInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a hit with the parsed value', async () => {
    getdelMock.mockResolvedValue(JSON.stringify({ sub: 'sub-1' }));

    const result = await ValkeyService.getInstance().getdelJson<{ sub: string }>('some:key');

    expect(result).toEqual({ status: 'hit', value: { sub: 'sub-1' } });
    expect(getdelMock).toHaveBeenCalledWith('some:key');
  });

  it('returns a miss without calling accept', async () => {
    getdelMock.mockResolvedValue(null);
    const accept = vi.fn();

    const result = await ValkeyService.getInstance().getdelJson('some:key', accept);

    expect(result).toEqual({ status: 'miss' });
    expect(accept).not.toHaveBeenCalled();
  });

  it('treats an oversized value as a miss rather than parsing it', async () => {
    getdelMock.mockResolvedValue(JSON.stringify({ padding: 'x'.repeat(VALKEY_CACHE.MAX_VALUE_BYTES) }));

    const result = await ValkeyService.getInstance().getdelJson('some:key');

    expect(result).toEqual({ status: 'miss' });
  });

  it('treats a value failing the shape check as a miss', async () => {
    getdelMock.mockResolvedValue(JSON.stringify({ unexpected: true }));

    const result = await ValkeyService.getInstance().getdelJson('some:key', (value): value is never => false);

    expect(result).toEqual({ status: 'miss' });
  });

  it('treats malformed JSON as a miss rather than a fault (#1938 review)', async () => {
    // A miss lets AuthStateService.consume() reject outright; a fault lets it fall back to the
    // TTL-less session — a corrupt record must not be able to force the fault path (#1938 review).
    getdelMock.mockResolvedValue('{not valid json');

    const result = await ValkeyService.getInstance().getdelJson('some:key');

    expect(result).toEqual({ status: 'miss' });
  });

  it('reports a client fault distinctly from a miss, instead of throwing', async () => {
    getdelMock.mockRejectedValue(new Error('connection reset'));

    await expect(ValkeyService.getInstance().getdelJson('some:key')).resolves.toEqual({ status: 'fault' });
  });

  it('returns a miss without calling Valkey when disabled (no VALKEY_URL)', async () => {
    vi.stubEnv('VALKEY_URL', '');
    ValkeyService.resetInstance();

    const result = await ValkeyService.getInstance().getdelJson('some:key');

    expect(result).toEqual({ status: 'miss' });
    expect(getdelMock).not.toHaveBeenCalled();
  });
});

describe('buildAuthStateCacheKey (#1938)', () => {
  beforeEach(() => {
    vi.stubEnv('VALKEY_KEY_NAMESPACE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a namespaced key for a real 64-hex-char nonce (the length isFilterSafeIdentifier caps at)', () => {
    const nonce = crypto.randomBytes(32).toString('hex');

    expect(buildAuthStateCacheKey(nonce)).toBe(`lfx-ui:auth-state:v1:${nonce}`);
  });

  it('fails closed (returns null) for a nonce containing a key-delimiter character', () => {
    expect(buildAuthStateCacheKey('abc:def')).toBeNull();
  });

  it('fails closed (returns null) for a nonce containing a wildcard', () => {
    expect(buildAuthStateCacheKey('abc*def')).toBeNull();
  });
});

describe('buildMeetingInviteLockCacheKey (LFXV2 #2241)', () => {
  beforeEach(() => {
    // Pin the deployment namespace segment so this doesn't flake under a developer/CI
    // environment that happens to export VALKEY_KEY_NAMESPACE (see `cacheKeyNamespace`).
    vi.stubEnv('VALKEY_KEY_NAMESPACE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a namespaced key for a filter-safe username', () => {
    expect(buildMeetingInviteLockCacheKey('alice')).toBe('lfx-ui:meeting-invite-lock:v1:alice');
  });

  it('fails closed (returns null) for an unsafe username', () => {
    expect(buildMeetingInviteLockCacheKey('alice:bob')).toBeNull();
  });
});

describe('ValkeyService — oversize attribution and per-sub-resource caps (GH-1906)', () => {
  const ACCOUNT_ID = '0014100000Te2ovAAB';
  const ORG_UID = 'a092M00001abcdEQAQ';
  const oversized = { padding: 'x'.repeat(VALKEY_CACHE.MAX_VALUE_BYTES) };
  // `projects:v7` deliberately has no entry in `MAX_VALUE_BYTES_BY_SUBRESOURCE`, so the tests below
  // assert default-cap behaviour without depending on which caches currently need an exception —
  // the table is expected to change as payloads do.
  const UNCAPPED_LABEL = 'projects:v7';
  const UNCAPPED_SUB_RESOURCE = `${UNCAPPED_LABEL}:Acme%20Corp|__top__`;

  const warningPayload = (): Record<string, unknown> => {
    const call = vi.mocked(logger.warning).mock.calls.at(-1);
    return (call?.[3] ?? {}) as Record<string, unknown>;
  };

  beforeEach(() => {
    // Pin the deployment namespace so a developer/CI environment exporting VALKEY_KEY_NAMESPACE
    // can't shift the segment positions these assertions depend on (see `cacheKeyNamespace`).
    vi.stubEnv('VALKEY_KEY_NAMESPACE', '');
    vi.stubEnv('VALKEY_URL', 'redis://localhost:6379');
    setMock.mockReset();
    getMock.mockReset();
    vi.mocked(logger.warning).mockClear();
    ValkeyService.resetInstance();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('names the sub-resource an oversize write belongs to, so the event is attributable without an APM trace', async () => {
    await ValkeyService.getInstance().setJson(buildOrgCacheKey(ACCOUNT_ID, UNCAPPED_SUB_RESOURCE)!, oversized, 60);

    expect(warningPayload()).toMatchObject({
      cache_namespace: VALKEY_CACHE.ORG_LENS_SNOWFLAKE_NAMESPACE,
      cache_subresource: 'projects',
      max_bytes: VALKEY_CACHE.MAX_VALUE_BYTES,
    });
  });

  it('reports only the label of a sub-resource that carries a person key, never the key itself', async () => {
    const personKey = 'person-9f3c2a';

    await ValkeyService.getInstance().setJson(buildOrgCacheKey(ACCOUNT_ID, `people-detail:${personKey}`)!, oversized, 60);

    const payload = warningPayload();
    expect(payload['cache_subresource']).toBe('people-detail');
    expect(JSON.stringify(payload)).not.toContain(personKey);
  });

  it('reports no sub-resource for a namespace whose post-principal segment is an identifier rather than a label', async () => {
    // `org-seats:v1` puts the org uid where the Org Lens namespaces put a code-defined label.
    // Reporting it would put an identifier into a field whose whole point is that it is safe to log.
    await ValkeyService.getInstance().setJson(buildPerUserOrgKey(VALKEY_CACHE.ORG_SEATS_NAMESPACE, 'alice', ORG_UID)!, oversized, 60);

    const payload = warningPayload();
    expect(payload['cache_subresource']).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(ORG_UID);
  });

  it('writes AND reads back a value over the global cap but under a configured per-sub-resource cap', async () => {
    // The cap is enforced on both the write and the read. Raising it in only one place yields a
    // cache that stores entries every subsequent read then rejects as oversized — a silent
    // permanent miss, which is exactly the class of bug this work exists to remove. Driven through
    // a REAL table entry rather than one installed here: `MAX_VALUE_BYTES_BY_SUBRESOURCE` is a
    // release decision, not a runtime knob, and a test that overwrote it would be changing
    // production behaviour for every later test in the run.
    const key = buildOrgCacheKey(ACCOUNT_ID, 'people-all:v2')!;
    const serialized = JSON.stringify(oversized);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(VALKEY_CACHE.MAX_VALUE_BYTES);
    setMock.mockResolvedValue('OK');
    getMock.mockResolvedValue(serialized);

    await expect(ValkeyService.getInstance().setJson(key, oversized, 60)).resolves.toBe(true);
    await expect(ValkeyService.getInstance().getJson(key)).resolves.toEqual(oversized);
  });

  it('still applies the global cap to a sub-resource with no configured cap', async () => {
    setMock.mockResolvedValue('OK');

    await expect(ValkeyService.getInstance().setJson(buildOrgCacheKey(ACCOUNT_ID, UNCAPPED_SUB_RESOURCE)!, oversized, 60)).resolves.toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('applies a configured cap to every cache measured to need one, and to no other', async () => {
    // Guards the table itself, not the mechanism: each entry exists because that cache's largest
    // measured value does not fit under the 1 MiB default, so a value just over the default must be
    // storable for exactly these sub-resources and refused for their siblings.
    setMock.mockResolvedValue('OK');

    for (const subResource of ['people-all:v2', 'people-event-attendees:v2', 'people-trainees:v2']) {
      await expect(ValkeyService.getInstance().setJson(buildOrgCacheKey(ACCOUNT_ID, subResource)!, oversized, 60)).resolves.toBe(true);
    }
    for (const subResource of [UNCAPPED_SUB_RESOURCE, 'people-contributors:v2:all']) {
      await expect(ValkeyService.getInstance().setJson(buildOrgCacheKey(ACCOUNT_ID, subResource)!, oversized, 60)).resolves.toBe(false);
    }
  });
});
