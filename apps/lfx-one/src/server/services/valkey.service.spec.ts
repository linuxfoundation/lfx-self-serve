// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setMock, evalMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  evalMock: vi.fn(),
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
import { buildMeetingInviteLockCacheKey, ValkeyService } from './valkey.service';

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
