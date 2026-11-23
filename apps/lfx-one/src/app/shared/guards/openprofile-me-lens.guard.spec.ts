// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import { LensService } from '../services/lens.service';
import { openprofileMeLensGuard } from './openprofile-me-lens.guard';

describe('openprofileMeLensGuard', () => {
  const runGuard = (queryParams: Record<string, string>) => {
    const setLens = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: LensService, useValue: { setLens } }] });
    const route = { queryParams } as unknown as ActivatedRouteSnapshot;
    const result = TestBed.runInInjectionContext(() => openprofileMeLensGuard(route, {} as RouterStateSnapshot));
    return { result, setLens };
  };

  it('forces the me lens for an old openprofile.dev link', () => {
    const { result, setLens } = runGuard({ from: 'openprofile' });

    expect(result).toBe(true);
    expect(setLens).toHaveBeenCalledWith('me');
  });

  it.each<Record<string, string>>([{}, { from: 'elsewhere' }])('leaves the lens alone without the openprofile marker (%o)', (queryParams) => {
    const { result, setLens } = runGuard(queryParams);

    expect(result).toBe(true);
    expect(setLens).not.toHaveBeenCalled();
  });
});
