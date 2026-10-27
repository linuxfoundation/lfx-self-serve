// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { request, getUsernameFromAuth } = vi.hoisted(() => ({
  request: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));

vi.mock('../services/nats.service', () => ({
  NatsService: class {
    public request = request;
    public getCodec() {
      return { encode: (value: string) => new TextEncoder().encode(value), decode: (value: Uint8Array) => new TextDecoder().decode(value) };
    }
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { debug: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));

import { resolveStoredDisplayName } from './ssr-display-name.helper';

const req = {} as Request;
const reply = (body: unknown) => ({ data: new TextEncoder().encode(JSON.stringify(body)) });

describe('resolveStoredDisplayName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUsernameFromAuth.mockResolvedValue('ada');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the stored given and family name', async () => {
    request.mockResolvedValue(reply({ success: true, username: 'ada', data: { given_name: 'Ada', family_name: 'Byron' } }));

    await expect(resolveStoredDisplayName(req)).resolves.toBe('Ada Byron');
  });

  it('returns null when there is no username', async () => {
    getUsernameFromAuth.mockResolvedValue(null);

    await expect(resolveStoredDisplayName(req)).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('returns null when the read is unsuccessful or has no stored name', async () => {
    request.mockResolvedValueOnce(reply({ success: false, username: 'ada' }));
    await expect(resolveStoredDisplayName(req)).resolves.toBeNull();

    request.mockResolvedValueOnce(reply({ success: true, username: 'ada', data: {} }));
    await expect(resolveStoredDisplayName(req)).resolves.toBeNull();
  });

  it('falls back to null when NATS fails', async () => {
    request.mockRejectedValue(new Error('nats down'));

    await expect(resolveStoredDisplayName(req)).resolves.toBeNull();
  });

  it('gives up within the wall-clock budget even if the connection never resolves', async () => {
    vi.useFakeTimers();
    request.mockReturnValue(new Promise(() => undefined));

    const result = resolveStoredDisplayName(req);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBeNull();
  });

  it('fills a missing stored name part from the OIDC claims', async () => {
    request.mockResolvedValue(reply({ success: true, username: 'ada', data: { family_name: 'Byron' } }));

    await expect(resolveStoredDisplayName(req, { given_name: 'Ada', family_name: 'Lovelace' })).resolves.toBe('Ada Byron');
  });
});
