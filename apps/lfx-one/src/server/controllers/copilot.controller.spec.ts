// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsernameMock, streamQueryMock } = vi.hoisted(() => ({
  getEffectiveUsernameMock: vi.fn(),
  streamQueryMock: vi.fn(),
}));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: getEffectiveUsernameMock }));
vi.mock('../utils/shutdown', () => ({ addShutdownHook: vi.fn(), isShuttingDown: vi.fn(() => false) }));
vi.mock('../services/copilot.service', () => ({
  CopilotService: vi.fn().mockImplementation(() => ({ streamQuery: streamQueryMock })),
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => Date.now()), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn() },
}));

import { CopilotController } from './copilot.controller';

describe('CopilotController.chat — caller identity', () => {
  let controller: CopilotController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new CopilotController();
  });

  it('rejects with a 401 and never opens the stream when no LFID resolves', async () => {
    getEffectiveUsernameMock.mockReturnValue(null);
    const req = { body: { message: 'hello', sessionId: 'shared-session' }, path: '/chat' } as any;
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    await controller.chat(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(streamQueryMock).not.toHaveBeenCalled();
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });
});
