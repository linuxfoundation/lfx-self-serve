// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { setMock, evalMock } = vi.hoisted(() => ({
  setMock: vi.fn(),
  evalMock: vi.fn(),
}));

// `@lfx-one/shared/utils`'s real barrel transitively pulls in Angular-only code that fails
// to load under vitest's node environment — confirmed by trying it (JIT compiler error from
// `@angular/common`'s `PlatformLocation`). These stubs are a necessary workaround, not drift.
// Keep the submodules spread here in sync with whichever `@lfx-one/shared/utils` exports
// `valkey.service.ts` actually imports — a new one added there and missed here resolves to
// `undefined` here instead of failing at the source.
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
}));
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

    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('redis.call'), 1, 'lock:key', 'my-token');
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

  it('best-effort releases the just-acquired token when the SET call errors after possibly landing', async () => {
    setMock.mockRejectedValue(new Error('connection reset'));
    evalMock.mockResolvedValue(1);

    const result = await ValkeyService.getInstance().acquireLock('lock:key', 25000);

    expect(result).toEqual({ status: 'unavailable', token: expect.any(String) });
    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining('redis.call'), 1, 'lock:key', expect.any(String));
  });

  it('retries the release once after the op-timeout window in case the SET lands just after the immediate attempt', async () => {
    vi.useFakeTimers();
    try {
      setMock.mockRejectedValue(new Error('connection reset'));
      evalMock.mockResolvedValue(1);

      await ValkeyService.getInstance().acquireLock('lock:key', 25000, 3000);
      expect(evalMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3000);
      expect(evalMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('buildMeetingInviteLockCacheKey (LFXV2 #2241)', () => {
  it('builds a namespaced key for a filter-safe username', () => {
    expect(buildMeetingInviteLockCacheKey('alice')).toBe('lfx-ui:meeting-invite-lock:v1:alice');
  });

  it('fails closed (returns null) for an unsafe username', () => {
    expect(buildMeetingInviteLockCacheKey('alice:bob')).toBeNull();
  });
});
