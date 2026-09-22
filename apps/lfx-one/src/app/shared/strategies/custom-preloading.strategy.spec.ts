// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Route } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomPreloadingStrategy } from './custom-preloading.strategy';

describe('CustomPreloadingStrategy', () => {
  let strategy: CustomPreloadingStrategy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CustomPreloadingStrategy],
    });
    strategy = TestBed.inject(CustomPreloadingStrategy);
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('returns of(null) and does not load on /invite (GH-2290)', async () => {
    window.history.pushState({}, '', '/invite');
    const load = vi.fn(() => of('chunk'));
    const route = { data: { preload: true, preloadDelay: 0 } } as Route;

    await expect(firstValueFrom(strategy.preload(route, load))).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('preloads a flagged route on a product path', async () => {
    window.history.pushState({}, '', '/meetings');
    const load = vi.fn(() => of('chunk'));
    const route = { data: { preload: true, preloadDelay: 0 } } as Route;

    await expect(firstValueFrom(strategy.preload(route, load))).resolves.toBe('chunk');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
