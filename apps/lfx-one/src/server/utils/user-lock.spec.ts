// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isEnabledMock, acquireLockMock, releaseLockMock, warningMock } = vi.hoisted(() => ({
  isEnabledMock: vi.fn(),
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock('../services/valkey.service', () => ({
  valkeyService: {
    isEnabled: isEnabledMock,
    acquireLock: acquireLockMock,
    releaseLock: releaseLockMock,
  },
  // Mirrors the real `isFilterSafeUsername` gate closely enough to exercise the null-key
  // (unsafe, non-empty username) degrade branch distinctly from the empty-username case.
  buildUserLockCacheKey: (username: string) => (username && /^[A-Za-z0-9._+\-@|]+$/.test(username) ? `lock:${username}` : null),
}));

vi.mock('../services/logger.service', () => ({
  logger: { warning: warningMock },
}));

import { withUserLock } from './user-lock';

describe('withUserLock (LFXV2 #2241)', () => {
  beforeEach(() => {
    isEnabledMock.mockReset();
    acquireLockMock.mockReset();
    releaseLockMock.mockReset();
    warningMock.mockReset();
  });

  describe('Valkey-backed path', () => {
    beforeEach(() => {
      isEnabledMock.mockReturnValue(true);
    });

    it('runs fn() and releases the lock with the acquired token on success', async () => {
      acquireLockMock.mockResolvedValue({ status: 'acquired', token: 'tok-1' });
      const fn = vi.fn().mockResolvedValue('result');

      const result = await withUserLock(undefined, 'alice', 25000, fn);

      expect(result).toBe('result');
      expect(acquireLockMock).toHaveBeenCalledWith('lock:alice', 25000);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(releaseLockMock).toHaveBeenCalledWith('lock:alice', 'tok-1');
    });

    it('releases the lock even when fn() throws', async () => {
      acquireLockMock.mockResolvedValue({ status: 'acquired', token: 'tok-1' });
      const fn = vi.fn().mockRejectedValue(new Error('boom'));

      await expect(withUserLock(undefined, 'alice', 25000, fn)).rejects.toThrow('boom');

      expect(releaseLockMock).toHaveBeenCalledWith('lock:alice', 'tok-1');
    });

    it('throws a 409 ConflictError without calling fn() when the lock is contended', async () => {
      acquireLockMock.mockResolvedValue({ status: 'contended' });
      const fn = vi.fn();

      await expect(withUserLock(undefined, 'alice', 25000, fn)).rejects.toMatchObject({ statusCode: 409, code: 'LOCK_CONTENTION' });

      expect(fn).not.toHaveBeenCalled();
      expect(releaseLockMock).not.toHaveBeenCalled();
    });

    it('falls back to the in-memory lock when Valkey reports unavailable', async () => {
      acquireLockMock.mockResolvedValue({ status: 'unavailable' });
      const fn = vi.fn().mockResolvedValue('via-fallback');

      const result = await withUserLock(undefined, 'bob', 25000, fn);

      expect(result).toBe('via-fallback');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(releaseLockMock).not.toHaveBeenCalled();
    });

    it('skips the lock entirely (never throws, never takes the in-memory mutex) for an empty username', async () => {
      const fn = vi.fn().mockResolvedValue('via-fallback');

      const result = await withUserLock(undefined, '', 25000, fn);

      expect(result).toBe('via-fallback');
      expect(acquireLockMock).not.toHaveBeenCalled();
      expect(warningMock).toHaveBeenCalledWith(undefined, 'with_user_lock', expect.any(String), expect.any(Object));
    });

    it('never contends two concurrent calls that both have an empty username, unlike a real shared key', async () => {
      let releaseFirst: () => void = () => undefined;
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const fn1 = vi.fn(() => first);
      const fn2 = vi.fn().mockResolvedValue('second');

      const call1 = withUserLock(undefined, '', 25000, fn1);
      await Promise.resolve();

      await expect(withUserLock(undefined, '', 25000, fn2)).resolves.toBe('second');
      expect(fn2).toHaveBeenCalledTimes(1);

      releaseFirst();
      await call1;
    });

    it('degrades to the in-memory lock (never throws) when a non-empty username fails the filter-safe check', async () => {
      const fn = vi.fn().mockResolvedValue('via-fallback');

      const result = await withUserLock(undefined, 'unsafe user!name', 25000, fn);

      expect(result).toBe('via-fallback');
      expect(acquireLockMock).not.toHaveBeenCalled();
      expect(warningMock).toHaveBeenCalledWith(undefined, 'with_user_lock', expect.any(String), expect.any(Object));
    });

    it('passes the caller’s req through to the degradation warning for request-correlated logging', async () => {
      acquireLockMock.mockResolvedValue({ status: 'unavailable' });
      const fn = vi.fn().mockResolvedValue('via-fallback');
      const fakeReq = { id: 'req-1' } as never;

      await withUserLock(fakeReq, 'jill', 25000, fn);

      expect(warningMock).toHaveBeenCalledWith(fakeReq, 'with_user_lock', expect.any(String), expect.any(Object));
    });

    it('still contends a same-replica second call when Valkey goes unavailable mid-flight (LFXV2 #2241)', async () => {
      acquireLockMock.mockResolvedValueOnce({ status: 'acquired', token: 'tok-1' });
      let releaseFirst: () => void = () => undefined;
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const fn1 = vi.fn(() => first);
      const call1 = withUserLock(undefined, 'kate', 25000, fn1);
      await Promise.resolve();

      acquireLockMock.mockResolvedValueOnce({ status: 'unavailable' });
      const fn2 = vi.fn().mockResolvedValue('second');

      await expect(withUserLock(undefined, 'kate', 25000, fn2)).rejects.toMatchObject({ statusCode: 409, code: 'LOCK_CONTENTION' });
      expect(fn2).not.toHaveBeenCalled();

      releaseFirst();
      await call1;
    });
  });

  describe('in-memory fallback (Valkey disabled)', () => {
    beforeEach(() => {
      isEnabledMock.mockReturnValue(false);
    });

    it('serializes two concurrent calls for the same user — the second is contended', async () => {
      let releaseFirst: () => void = () => undefined;
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const fn1 = vi.fn(() => first);
      const fn2 = vi.fn().mockResolvedValue('second');

      const call1 = withUserLock(undefined, 'carol', 25000, fn1);
      // Let the microtask queue settle so call1 has registered its lock before call2 starts.
      await Promise.resolve();

      await expect(withUserLock(undefined, 'carol', 25000, fn2)).rejects.toMatchObject({ statusCode: 409, code: 'LOCK_CONTENTION' });
      expect(fn2).not.toHaveBeenCalled();

      releaseFirst();
      await expect(call1).resolves.toBeUndefined();
    });

    it('allows a second call for the same user after the first completes', async () => {
      const fn1 = vi.fn().mockResolvedValue('first');
      const fn2 = vi.fn().mockResolvedValue('second');

      await expect(withUserLock(undefined, 'dave', 25000, fn1)).resolves.toBe('first');
      await expect(withUserLock(undefined, 'dave', 25000, fn2)).resolves.toBe('second');
    });

    it('does not let one user’s lock block a different user', async () => {
      let releaseFirst: () => void = () => undefined;
      const first = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const fn1 = vi.fn(() => first);
      const fn2 = vi.fn().mockResolvedValue('other-user');

      const call1 = withUserLock(undefined, 'erin', 25000, fn1);
      await Promise.resolve();

      await expect(withUserLock(undefined, 'frank', 25000, fn2)).resolves.toBe('other-user');

      releaseFirst();
      await call1;
    });

    it('auto-clears the lock via the TTL safety net if fn() never settles', async () => {
      vi.useFakeTimers();
      try {
        const hungFn = vi.fn(() => new Promise<void>(() => undefined));
        void withUserLock(undefined, 'gina', 1000, hungFn);

        await vi.advanceTimersByTimeAsync(1000);

        const fn2 = vi.fn().mockResolvedValue('after-ttl');
        await expect(withUserLock(undefined, 'gina', 1000, fn2)).resolves.toBe('after-ttl');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not let a stale caller release a lock a later caller acquired after its TTL fired', async () => {
      vi.useFakeTimers();
      try {
        let releaseHung: () => void = () => undefined;
        const hung = new Promise<void>((resolve) => {
          releaseHung = resolve;
        });
        const hungFn = vi.fn(() => hung);
        const call1 = withUserLock(undefined, 'hank', 1000, hungFn);

        // The safety net fires and clears call1's entry — a second caller may now acquire.
        await vi.advanceTimersByTimeAsync(1000);

        let releaseSecond: () => void = () => undefined;
        const second = new Promise<void>((resolve) => {
          releaseSecond = resolve;
        });
        const fn2 = vi.fn(() => second);
        const call2 = withUserLock(undefined, 'hank', 1000, fn2);
        await Promise.resolve();

        // call1's hung fn() finally settles — its `finally` must not delete call2's still-active lock.
        releaseHung();
        await call1;

        const fn3 = vi.fn();
        await expect(withUserLock(undefined, 'hank', 1000, fn3)).rejects.toMatchObject({ statusCode: 409, code: 'LOCK_CONTENTION' });
        expect(fn3).not.toHaveBeenCalled();

        releaseSecond();
        await expect(call2).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
