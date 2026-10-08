// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { init, initialized, waitForInitialization, boolVariation, close, loggerWarning, isImpersonating, getEffectiveUsername } = vi.hoisted(() => ({
  init: vi.fn(),
  initialized: vi.fn(),
  waitForInitialization: vi.fn(),
  boolVariation: vi.fn(),
  close: vi.fn(),
  loggerWarning: vi.fn(),
  isImpersonating: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('@launchdarkly/node-server-sdk', () => ({ init }));
vi.mock('./logger.service', () => ({ logger: { warning: loggerWarning, debug: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating, getEffectiveUsername }));
// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config.
vi.mock('@lfx-one/shared/constants', () => ({ LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS: 3 }));

import type { Request } from 'express';

import { LaunchDarklyServerService } from './launchdarkly-server.service';

const req = { oidc: { user: { preferred_username: 'jdoe' } } } as unknown as Request;
const LF_USERNAME_CLAIM = 'https://sso.linuxfoundation.org/claims/username';

describe('LaunchDarklyServerService', () => {
  let service: LaunchDarklyServerService;

  beforeEach(() => {
    process.env['LD_SDK_KEY'] = 'sdk-test-key';
    // Mirrors the SDK: `initialized()` turns true once the initial connection succeeds.
    let ready = false;
    init.mockReset().mockReturnValue({ initialized, waitForInitialization, boolVariation, close });
    initialized.mockReset().mockImplementation(() => ready);
    waitForInitialization.mockReset().mockImplementation(() => {
      ready = true;
      return Promise.resolve();
    });
    boolVariation.mockReset().mockResolvedValue(true);
    close.mockReset();
    loggerWarning.mockReset();
    isImpersonating.mockReset().mockReturnValue(false);
    getEffectiveUsername.mockReset().mockReturnValue('target-user');
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

  it('derives the context key like the browser: preferred_username, then username, then the LF claim', async () => {
    const withUsername = { oidc: { user: { username: 'u-name', [LF_USERNAME_CLAIM]: 'lf-name' } } } as unknown as Request;
    const withClaimOnly = { oidc: { user: { [LF_USERNAME_CLAIM]: 'lf-name' } } } as unknown as Request;
    const withAll = { oidc: { user: { preferred_username: 'pref', username: 'u-name', [LF_USERNAME_CLAIM]: 'lf-name' } } } as unknown as Request;

    await service.isFlagEnabled(withAll, 'insights-public-api-token-access');
    await service.isFlagEnabled(withUsername, 'insights-public-api-token-access');
    await service.isFlagEnabled(withClaimOnly, 'insights-public-api-token-access');

    expect(boolVariation.mock.calls.map((call) => call[1].key)).toEqual(['pref', 'u-name', 'lf-name']);
  });

  it("uses the impersonated user's username while impersonating, never the impersonator's", async () => {
    isImpersonating.mockReturnValue(true);

    await service.isFlagEnabled(req, 'insights-public-api-token-access');

    expect(boolVariation).toHaveBeenCalledWith('insights-public-api-token-access', { kind: 'user', key: 'target-user' }, false);
  });

  it('returns the default when the session has no username', async () => {
    const anonymous = { oidc: { user: {} } } as unknown as Request;

    expect(await service.isFlagEnabled(anonymous, 'insights-public-api-token-access')).toBe(false);
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

  it('closes the client on shutdown when one was created', async () => {
    await service.isFlagEnabled(req, 'insights-public-api-token-access');
    await LaunchDarklyServerService.shutdownIfInitialized();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
