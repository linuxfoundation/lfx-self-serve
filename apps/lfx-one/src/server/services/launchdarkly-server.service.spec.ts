// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { init, waitForInitialization, boolVariation, close, loggerWarning, getUsernameFromAuth } = vi.hoisted(() => ({
  init: vi.fn(),
  waitForInitialization: vi.fn(),
  boolVariation: vi.fn(),
  close: vi.fn(),
  loggerWarning: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));

vi.mock('@launchdarkly/node-server-sdk', () => ({ init }));
vi.mock('./logger.service', () => ({ logger: { warning: loggerWarning, debug: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config.
vi.mock('@lfx-one/shared/constants', () => ({ LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS: 3 }));

import type { Request } from 'express';

import { LaunchDarklyServerService } from './launchdarkly-server.service';

const req = {} as unknown as Request;

describe('LaunchDarklyServerService', () => {
  let service: LaunchDarklyServerService;

  beforeEach(() => {
    process.env['LD_SDK_KEY'] = 'sdk-test-key';
    init.mockReset().mockReturnValue({ waitForInitialization, boolVariation, close });
    waitForInitialization.mockReset().mockResolvedValue(undefined);
    boolVariation.mockReset().mockResolvedValue(true);
    close.mockReset();
    loggerWarning.mockReset();
    getUsernameFromAuth.mockReset().mockResolvedValue('jdoe');
    LaunchDarklyServerService.resetInstance();
    service = LaunchDarklyServerService.getInstance();
  });

  afterEach(() => {
    delete process.env['LD_SDK_KEY'];
  });

  it('evaluates the flag for a user context keyed by the session username', async () => {
    expect(await service.isFlagEnabled(req, 'insights-public-api')).toBe(true);

    expect(init).toHaveBeenCalledWith('sdk-test-key');
    expect(waitForInitialization).toHaveBeenCalledWith({ timeout: 3 });
    expect(boolVariation).toHaveBeenCalledWith('insights-public-api', { kind: 'user', key: 'jdoe' }, false);
  });

  it('connects once and reuses the client across evaluations', async () => {
    await service.isFlagEnabled(req, 'insights-public-api');
    await service.isFlagEnabled(req, 'insights-public-api');

    expect(init).toHaveBeenCalledTimes(1);
    expect(boolVariation).toHaveBeenCalledTimes(2);
  });

  it('returns the default without connecting when LD_SDK_KEY is not set', async () => {
    delete process.env['LD_SDK_KEY'];

    expect(await service.isFlagEnabled(req, 'insights-public-api')).toBe(false);
    expect(init).not.toHaveBeenCalled();
    expect(loggerWarning).toHaveBeenCalled();
  });

  it('returns the default when the session has no username', async () => {
    getUsernameFromAuth.mockResolvedValue(null);

    expect(await service.isFlagEnabled(req, 'insights-public-api')).toBe(false);
    expect(boolVariation).not.toHaveBeenCalled();
  });

  it('returns the default when LaunchDarkly does not connect in time', async () => {
    waitForInitialization.mockRejectedValue(new Error('timeout'));

    expect(await service.isFlagEnabled(req, 'insights-public-api')).toBe(false);
    expect(boolVariation).not.toHaveBeenCalled();
  });

  it('returns the default when evaluation throws, instead of failing the request', async () => {
    boolVariation.mockRejectedValue(new Error('boom'));

    expect(await service.isFlagEnabled(req, 'insights-public-api')).toBe(false);
  });

  it('honours a caller-supplied default', async () => {
    delete process.env['LD_SDK_KEY'];

    expect(await service.isFlagEnabled(req, 'insights-public-api', true)).toBe(true);
  });

  it('closes the client on shutdown only if one was created', async () => {
    await LaunchDarklyServerService.shutdownIfInitialized();
    expect(close).not.toHaveBeenCalled();

    await service.isFlagEnabled(req, 'insights-public-api');
    await LaunchDarklyServerService.shutdownIfInitialized();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
