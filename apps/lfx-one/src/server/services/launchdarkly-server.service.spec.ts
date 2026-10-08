// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { init, initialized, waitForInitialization, boolVariation, flush, close, loggerWarning, getEffectiveUsername } = vi.hoisted(() => ({
  init: vi.fn(),
  initialized: vi.fn(),
  waitForInitialization: vi.fn(),
  boolVariation: vi.fn(),
  flush: vi.fn(),
  close: vi.fn(),
  loggerWarning: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('@launchdarkly/node-server-sdk', () => ({ init }));
vi.mock('./logger.service', () => ({ logger: { warning: loggerWarning, debug: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));
// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config.
vi.mock('@lfx-one/shared/constants', () => ({ LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS: 3 }));

import type { Request } from 'express';

import { LaunchDarklyServerService } from './launchdarkly-server.service';

// Display claims differ from the LFID on purpose: only `getEffectiveUsername` may key the context.
const req = { oidc: { user: { preferred_username: 'display-name', username: 'display-name' } } } as unknown as Request;

describe('LaunchDarklyServerService', () => {
  let service: LaunchDarklyServerService;

  beforeEach(() => {
    process.env['LD_SDK_KEY'] = 'sdk-test-key';
    // Mirrors the SDK: `initialized()` turns true once the initial connection succeeds.
    let ready = false;
    init.mockReset().mockReturnValue({ initialized, waitForInitialization, boolVariation, flush, close });
    initialized.mockReset().mockImplementation(() => ready);
    waitForInitialization.mockReset().mockImplementation(() => {
      ready = true;
      return Promise.resolve();
    });
    boolVariation.mockReset().mockResolvedValue(true);
    flush.mockReset().mockResolvedValue(undefined);
    close.mockReset();
    loggerWarning.mockReset();
    getEffectiveUsername.mockReset().mockReturnValue('jdoe');
    LaunchDarklyServerService.resetInstance();
    service = LaunchDarklyServerService.getInstance();
  });

  afterEach(() => {
    delete process.env['LD_SDK_KEY'];
  });

  it('evaluates the flag for a user context keyed by the session username', async () => {
    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(true);

    expect(init).toHaveBeenCalledWith('sdk-test-key');
    expect(waitForInitialization).toHaveBeenCalledWith({ timeout: 3 });
    expect(boolVariation).toHaveBeenCalledWith('insights-public-api-token-access', { kind: 'user', key: 'jdoe' }, false);
  });

  it('connects once and reuses the client across evaluations', async () => {
    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    expect(init).toHaveBeenCalledTimes(1);
    expect(boolVariation).toHaveBeenCalledTimes(2);
  });

  it('returns the default without connecting when LD_SDK_KEY is not set', async () => {
    delete process.env['LD_SDK_KEY'];

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(false);
    expect(init).not.toHaveBeenCalled();
    expect(loggerWarning).toHaveBeenCalled();
  });

  it('warns about a missing LD_SDK_KEY only once', async () => {
    delete process.env['LD_SDK_KEY'];

    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    expect(loggerWarning).toHaveBeenCalledTimes(1);
  });

  it('keys the context by the trusted LF username, never by display claims', async () => {
    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    expect(getEffectiveUsername).toHaveBeenCalledWith(req);
    expect(boolVariation.mock.calls[0][1]).toEqual({ kind: 'user', key: 'jdoe' });
  });

  it('returns the default when the session has no username', async () => {
    getEffectiveUsername.mockReturnValue(null);

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(false);
    expect(boolVariation).not.toHaveBeenCalled();
  });

  it('returns the default when LaunchDarkly does not connect in time', async () => {
    waitForInitialization.mockRejectedValue(new Error('timeout'));

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(false);
    expect(boolVariation).not.toHaveBeenCalled();
  });

  it('waits for LaunchDarkly only once while it stays unreachable', async () => {
    waitForInitialization.mockReset().mockRejectedValue(new Error('timeout'));

    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    expect(waitForInitialization).toHaveBeenCalledTimes(1);
    expect(boolVariation).not.toHaveBeenCalled();
  });

  it('does not open a new connection after shutdown', async () => {
    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await LaunchDarklyServerService.shutdownIfInitialized();
    init.mockClear();

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('returns the default when evaluation throws, instead of failing the request', async () => {
    boolVariation.mockRejectedValue(new Error('boom'));

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access')).toBe(false);
  });

  it('honours a caller-supplied default', async () => {
    delete process.env['LD_SDK_KEY'];

    expect(await service.isFlagEnabled(req, 'insights-public-api-token-access', true)).toBe(true);
  });

  it('does not create a client just to close it on shutdown', async () => {
    await LaunchDarklyServerService.shutdownIfInitialized();

    expect(init).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('flushes pending events, then closes the client on shutdown', async () => {
    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await LaunchDarklyServerService.shutdownIfInitialized();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
  });

  it('still closes the client when the flush fails', async () => {
    flush.mockRejectedValue(new Error('network'));
    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    await LaunchDarklyServerService.shutdownIfInitialized();

    expect(close).toHaveBeenCalledTimes(1);
    expect(loggerWarning).toHaveBeenCalled();
  });
});
