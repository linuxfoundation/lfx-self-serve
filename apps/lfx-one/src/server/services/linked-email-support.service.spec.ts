// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { VALKEY_CACHE } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store, cache } = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    cache: {
      isEnabled: vi.fn(() => true),
      setJson: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
        return true;
      }),
      getdelJson: vi.fn(async (key: string, accept?: (value: unknown) => boolean) => {
        const value = store.get(key);
        store.delete(key);
        return value !== undefined && (!accept || accept(value)) ? { status: 'hit', value } : { status: 'miss' };
      }),
    },
  };
});
vi.mock('./valkey.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./valkey.service')>()),
  valkeyService: cache,
}));

import { buildLinkedEmailSupportCacheKey } from './valkey.service';
import { LinkedEmailSupportService } from './linked-email-support.service';

const service = new LinkedEmailSupportService();

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  cache.isEnabled.mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('LinkedEmailSupportService', () => {
  it('stores only the proven address with a five-minute TTL, then consumes it exactly once', async () => {
    const handle = await service.issue('synthetic-user', 'linked@example.test');
    expect(handle).toMatch(/^[a-f0-9]{64}$/);
    expect(cache.setJson).toHaveBeenCalledWith(
      buildLinkedEmailSupportCacheKey('synthetic-user', handle!),
      { email: 'linked@example.test', expiresAt: expect.any(Number) },
      VALKEY_CACHE.EMAIL_LINKED_SUPPORT_TTL_SECONDS,
      VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS
    );
    const results = await Promise.all([service.consume('synthetic-user', handle), service.consume('synthetic-user', handle)]);
    expect(results.filter(Boolean)).toEqual(['linked@example.test']);
    expect(await service.consume('synthetic-user', handle)).toBeUndefined();
  });

  it('cannot read or consume another user or attempt, including a newer attempt on the same user', async () => {
    const first = await service.issue('synthetic-user', 'first@example.test');
    const second = await service.issue('synthetic-user', 'second@example.test');
    expect(first).not.toBe(second);
    expect(await service.consume('other-synthetic-user', first)).toBeUndefined();
    expect(await service.consume('synthetic-user', 'a'.repeat(64))).toBeUndefined();
    expect(await service.consume('synthetic-user', first)).toBe('first@example.test');
    expect(await service.consume('synthetic-user', second)).toBe('second@example.test');
  });

  it('rejects expired context even if the backend has not removed it yet', async () => {
    const handle = await service.issue('synthetic-user', 'linked@example.test');
    vi.setSystemTime(Date.now() + VALKEY_CACHE.EMAIL_LINKED_SUPPORT_TTL_SECONDS * 1000 + 1);
    expect(await service.consume('synthetic-user', handle)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it.each([undefined, null, '', 'bad', ['a'.repeat(64)]])('never reads malformed handles %j', async (handle) => {
    expect(await service.consume('synthetic-user', handle)).toBeUndefined();
    expect(cache.getdelJson).not.toHaveBeenCalled();
  });

  it('fails softly without Valkey and on uncertain writes/reads, without another store', async () => {
    cache.isEnabled.mockReturnValue(false);
    expect(await service.issue('synthetic-user', 'linked@example.test')).toBeUndefined();
    expect(await service.consume('synthetic-user', 'a'.repeat(64))).toBeUndefined();
    expect(cache.setJson).not.toHaveBeenCalled();
    expect(cache.getdelJson).not.toHaveBeenCalled();
    cache.isEnabled.mockReturnValue(true);
    cache.setJson.mockResolvedValueOnce(false);
    expect(await service.issue('synthetic-user', 'linked@example.test')).toBeUndefined();
    cache.getdelJson.mockResolvedValueOnce({ status: 'fault' });
    expect(await service.consume('synthetic-user', 'a'.repeat(64))).toBeUndefined();
  });

  it('rejects malformed, future-dated or non-email cached records', async () => {
    for (const value of [
      null,
      {},
      { email: 'bad', expiresAt: Date.now() + 1000 },
      { email: 'linked@example.test', expiresAt: Infinity },
      { email: 'linked@example.test', expiresAt: Date.now() + 600000 },
    ]) {
      store.set(buildLinkedEmailSupportCacheKey('synthetic-user', 'a'.repeat(64)), value);
      expect(await service.consume('synthetic-user', 'a'.repeat(64))).toBeUndefined();
    }
  });

  it('keeps deployment namespaces and hashes all identity/handle material out of cache keys', () => {
    vi.stubEnv('VALKEY_KEY_NAMESPACE', 'review-5511');
    const key = buildLinkedEmailSupportCacheKey('synthetic-user', 'a'.repeat(64));
    expect(key).toMatch(/^lfx-ui:review-5511:email-linked-support:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain('synthetic-user');
    expect(key).not.toContain('a'.repeat(64));
  });
});
