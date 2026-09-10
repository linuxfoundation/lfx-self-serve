// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FEATURE_FLAG_READY_TIMEOUT_MS } from '@lfx-one/shared';
import { LaunchDarklyClientProvider } from '@openfeature/launchdarkly-client-provider';
import { OpenFeature, Provider, ProviderStatus } from '@openfeature/web-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataDogRumService } from './datadog-rum.service';
import { FeatureFlagService } from './feature-flag.service';

/**
 * Covers waitForReady() — the shared wait every flag-gated guard uses to survive a provider
 * that's still initializing, including both `CanMatch` guards (e.g. `mktgOsAgentsEnabledGuard`)
 * and the two `CanActivateFn` guards (`campaignAccessGuard`, `marketingImpactAccessGuard`).
 * `providerReady$` is built once as a service field at construction time, so `waitForReady()`
 * itself has no injection-context requirement and can be awaited from any async context.
 */
describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let addError: ReturnType<typeof vi.fn>;

  const context = { guard: 'testGuard', flag: 'test-flag' };

  beforeEach(() => {
    addError = vi.fn();

    TestBed.configureTestingModule({
      providers: [{ provide: DataDogRumService, useValue: { addError } }],
    });

    service = TestBed.inject(FeatureFlagService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves true immediately without reporting when the provider is already ready', async () => {
    (service as unknown as { isProviderReady: { set: (value: boolean) => void } }).isProviderReady.set(true);

    const result = await service.waitForReady(context, 5000);

    expect(result).toBe(true);
    expect(addError).not.toHaveBeenCalled();
  });

  it('resolves true if the provider becomes ready before the timeout, without reporting', async () => {
    vi.useFakeTimers();
    const isProviderReady = (service as unknown as { isProviderReady: { set: (value: boolean) => void } }).isProviderReady;

    const pending = service.waitForReady(context, 5000);
    isProviderReady.set(true);
    TestBed.tick();
    const result = await pending;

    expect(result).toBe(true);
    expect(addError).not.toHaveBeenCalled();
  });

  it('resolves false and reports to RUM exactly once when the provider never becomes ready before the timeout', async () => {
    vi.useFakeTimers();

    const pending = service.waitForReady(context, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await pending;

    expect(result).toBe(false);
    expect(addError).toHaveBeenCalledTimes(1);
    expect(addError).toHaveBeenCalledWith(expect.any(Error), context);
  });

  it('defaults to FEATURE_FLAG_READY_TIMEOUT_MS when no timeout is passed', async () => {
    vi.useFakeTimers();

    const pending = service.waitForReady(context);

    // Still pending just short of the default budget — proves the default isn't a shorter literal.
    await vi.advanceTimersByTimeAsync(FEATURE_FLAG_READY_TIMEOUT_MS - 1);
    let settled = false;
    pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result).toBe(false);
    expect(addError).toHaveBeenCalledTimes(1);
  });

  it('resolves false immediately, without waiting out timeoutMs, when the raw LaunchDarkly provider is in ERROR status', async () => {
    vi.useFakeTimers();
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);

    const pending = service.waitForReady(context, 5000);
    // No timers advanced — a pending promise here would mean this path fell through to the rxjs wait.
    const result = await pending;

    expect(result).toBe(false);
    expect(addError).toHaveBeenCalledTimes(1);
  });

  it('does not seed isProviderReady from client.providerStatus when the raw LaunchDarkly provider is in ERROR status', async () => {
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue({
      providerStatus: ProviderStatus.READY,
      addHandler: vi.fn(),
    } as never);

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);

    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(false);
  });

  it('ignores a Ready event fired while the raw LaunchDarkly provider is in ERROR status', async () => {
    const handlers: Record<string, () => void> = {};
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue({
      providerStatus: ProviderStatus.STALE,
      addHandler: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
    } as never);

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);

    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);

    handlers['PROVIDER_READY']?.();

    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(false);
  });

  it('does not seed isProviderReady, and reports to RUM, when the wrapper client is in ERROR status despite a READY raw provider', async () => {
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.READY },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue({
      providerStatus: ProviderStatus.ERROR,
      addHandler: vi.fn(),
    } as never);

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);

    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(false);
    expect(addError).toHaveBeenCalledTimes(1);
  });

  it('resolves false immediately, without waiting out timeoutMs, when the wrapper client is in ERROR status despite a READY raw provider', async () => {
    vi.useFakeTimers();
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.READY },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue({
      providerStatus: ProviderStatus.ERROR,
      addHandler: vi.fn(),
    } as never);

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);
    addError.mockClear();

    const pending = service.waitForReady(context, 5000);
    // No timers advanced — a pending promise here would mean this path fell through to the rxjs wait.
    const result = await pending;

    expect(result).toBe(false);
    expect(addError).toHaveBeenCalledTimes(1);
  });

  it("recovers once the raw LaunchDarkly client's waitForInitialization() settles after a bootstrap ERROR", async () => {
    let resolveInit: (() => void) | undefined;
    const rawClient = {
      waitForInitialization: vi.fn(() => new Promise<void>((resolve) => (resolveInit = resolve))),
    };
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
      client: { value: rawClient },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    const clientMock = { providerStatus: ProviderStatus.STALE, addHandler: vi.fn() };
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue(clientMock as never);
    // Models the context successfully reapplying once the raw client recovers.
    vi.spyOn(OpenFeature, 'setContext').mockImplementation(async () => {
      clientMock.providerStatus = ProviderStatus.READY;
    });

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);

    // The bootstrap ERROR still fails the first wait — recovery only affects later calls.
    const first = await service.waitForReady(context, 5000);
    expect(first).toBe(false);
    expect(rawClient.waitForInitialization).toHaveBeenCalledTimes(1);

    resolveInit?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(true);
    const second = await service.waitForReady(context, 5000);
    expect(second).toBe(true);
  });

  it('recovers immediately when the raw LaunchDarkly client already finished initializing before recovery was registered', async () => {
    // Models the race the fix closes: the client's connection completed in the background before
    // attachErrorRecoveryListener() was ever called, so there is no live event left to listen for —
    // only waitForInitialization()'s already-settled Promise can still report the outcome.
    const rawClient = {
      waitForInitialization: vi.fn(() => Promise.resolve()),
    };
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
      client: { value: rawClient },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    const clientMock = { providerStatus: ProviderStatus.STALE, addHandler: vi.fn() };
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue(clientMock as never);
    vi.spyOn(OpenFeature, 'setContext').mockImplementation(async () => {
      clientMock.providerStatus = ProviderStatus.READY;
    });

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);

    // Unlike the still-connecting case above, an already-settled waitForInitialization() resolves
    // recovery within the same microtask flush as initialize() itself. The recovery callback now also
    // awaits reapplying the context, so a couple more microtask flushes are needed before it settles.
    await Promise.resolve();
    await Promise.resolve();

    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(true);
    const result = await service.waitForReady(context, 5000);
    expect(result).toBe(true);
  });

  it('does not mark ready when raw recovery succeeds but the reapplied context still leaves the wrapper in ERROR', async () => {
    // Regression test for the finding that recovery previously trusted the raw client's anonymous
    // bootstrap connection alone, without confirming the authenticated user context — reapplied via
    // OpenFeature.setContext() once the raw client recovers — actually took effect on the wrapper.
    const rawClient = {
      waitForInitialization: vi.fn(() => Promise.resolve()),
    };
    const rawProvider = Object.create(LaunchDarklyClientProvider.prototype, {
      status: { value: ProviderStatus.ERROR },
      client: { value: rawClient },
    }) as Provider;
    vi.spyOn(OpenFeature, 'getProvider').mockReturnValue(rawProvider);
    const clientMock = { providerStatus: ProviderStatus.ERROR, addHandler: vi.fn() };
    vi.spyOn(OpenFeature, 'getClient').mockReturnValue(clientMock as never);
    // The reapplied setContext() call still fails to bring the wrapper to READY.
    const setContextSpy = vi.spyOn(OpenFeature, 'setContext').mockResolvedValue(undefined);

    await service.initialize({ name: 'Test User', email: 'test@example.com', username: 'test' } as never);
    addError.mockClear();

    // Initial raw+wrapper ERROR combination — recovery arms, isProviderReady stays false.
    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Raw client recovered and reapplied the stored context, but the wrapper is still ERROR —
    // must NOT be marked ready, and the failure must be reported.
    expect(setContextSpy).toHaveBeenCalledTimes(2); // once in initialize(), once on recovery
    expect((service as unknown as { isProviderReady: () => boolean }).isProviderReady()).toBe(false);
    expect(addError).toHaveBeenCalledWith(expect.any(Error), { source: 'attachErrorRecoveryListener' });
  });
});
