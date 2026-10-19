// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { endGatewazeSession, loggerMock } = vi.hoisted(() => ({
  endGatewazeSession: vi.fn(),
  loggerMock: { debug: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../services/gatewaze-session.service', () => ({ getGatewazeSessionService: () => ({ endGatewazeSession }) }));
vi.mock('../services/logger.service', () => ({ logger: loggerMock }));

import { endGatewazeSessionOnLogout } from './end-gatewaze-session-on-logout.middleware';

async function run(): Promise<{ req: Request; next: ReturnType<typeof vi.fn> }> {
  const req = { headers: { cookie: `appSession=${'a'.repeat(64)}` } } as unknown as Request;
  const next = vi.fn();
  await endGatewazeSessionOnLogout(req, {} as Response, next as unknown as NextFunction);
  return { req, next };
}

describe('endGatewazeSessionOnLogout', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('ends the Gatewaze session with the sign-out marker, then continues to the LFX logout', async () => {
    endGatewazeSession.mockResolvedValue({ found: true, revoked: true, deleted: true });

    const { req, next } = await run();

    expect(endGatewazeSession).toHaveBeenCalledWith(req, { blockReMint: true });
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    // next() comes after the end, so the revoke is not raced by the LFX session being destroyed.
    expect(endGatewazeSession.mock.invocationCallOrder[0]).toBeLessThan(next.mock.invocationCallOrder[0]);
  });

  it('continues when nothing could be ended', async () => {
    endGatewazeSession.mockResolvedValue({ found: false, revoked: false, deleted: false });

    const { next } = await run();

    expect(next).toHaveBeenCalledWith();
  });

  it('waits at most 3 s for Gatewaze, then continues to the LFX logout', async () => {
    vi.useFakeTimers();
    endGatewazeSession.mockReturnValue(new Promise(() => undefined));
    const next = vi.fn();

    const pending = endGatewazeSessionOnLogout({ headers: {} } as Request, {} as Response, next as unknown as NextFunction);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(loggerMock.warning).toHaveBeenCalledWith(expect.anything(), 'end_gatewaze_session', expect.stringContaining('slow'));
  });

  it('continues, with no error, even if ending the session throws', async () => {
    endGatewazeSession.mockRejectedValue(new Error('synthetic'));

    const { next } = await run();

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(loggerMock.warning).toHaveBeenCalledOnce();
  });
});
