// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
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
});
