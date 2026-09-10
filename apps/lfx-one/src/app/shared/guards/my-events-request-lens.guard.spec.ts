// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Lens } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

import { LensService } from '../services/lens.service';
import { myEventsRequestLensGuard } from './my-events-request-lens.guard';

// Regression coverage for PR #2247 review (Cursor Bugbot): setLens('me') must run unconditionally
// for a qualifying deep link, not gated on activeLens() — activeLens() clamps to 'me' transiently
// before writer grants load, even while the persisted lens is still 'foundation'/'project', so
// gating on it would skip the very correction this guard exists to make.
describe('myEventsRequestLensGuard', () => {
  const route = (queryParams: Record<string, string>): ActivatedRouteSnapshot => ({ queryParams }) as unknown as ActivatedRouteSnapshot;

  const runGuard = (queryParams: Record<string, string>, activeLens: Lens) => {
    const setLens = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: LensService, useValue: { activeLens: () => activeLens, setLens } }],
    });

    const result = TestBed.runInInjectionContext(() => myEventsRequestLensGuard(route(queryParams), {} as RouterStateSnapshot));
    return { result, setLens };
  };

  it.each(['me', 'foundation', 'project', 'org'] as Lens[])('forces the me lens for a visa-letters deep link regardless of activeLens() (%s)', (activeLens) => {
    const { result, setLens } = runGuard({ tab: 'visa-letters', event: 'evt-1' }, activeLens);

    expect(result).toBe(true);
    expect(setLens).toHaveBeenCalledWith('me');
  });

  it('forces the me lens for a travel-funding deep link', () => {
    const { setLens } = runGuard({ tab: 'travel-funding', event: 'evt-1' }, 'foundation');

    expect(setLens).toHaveBeenCalledWith('me');
  });

  it('does not touch the lens when the tab is not a request tab', () => {
    const { result, setLens } = runGuard({ tab: 'upcoming', event: 'evt-1' }, 'foundation');

    expect(result).toBe(true);
    expect(setLens).not.toHaveBeenCalled();
  });

  it('does not touch the lens when there is no event id', () => {
    const { setLens } = runGuard({ tab: 'visa-letters' }, 'foundation');

    expect(setLens).not.toHaveBeenCalled();
  });

  it('does not touch the lens when there is no tab', () => {
    const { setLens } = runGuard({ event: 'evt-1' }, 'foundation');

    expect(setLens).not.toHaveBeenCalled();
  });
});
