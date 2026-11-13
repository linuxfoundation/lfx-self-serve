// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PersonaService } from '@shared/services/persona.service';
import { firstValueFrom, Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardAccessGuard } from './dashboard-access.guard';

describe('dashboardAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let canViewExecutiveDashboards: ReturnType<typeof signal<boolean>>;
  let refreshEnrichedPersonas: ReturnType<typeof vi.fn>;
  let router: { createUrlTree: ReturnType<typeof vi.fn> };

  const route = (data: Record<string, unknown> = {}): ActivatedRouteSnapshot =>
    ({ data, queryParamMap: convertToParamMap({ project: 'x' }) }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (r: ActivatedRouteSnapshot) => {
    const result = TestBed.runInInjectionContext(() => dashboardAccessGuard(r, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : await firstValueFrom(result as Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    currentPersona = signal('contributor');
    canViewExecutiveDashboards = signal(false);
    refreshEnrichedPersonas = vi.fn().mockReturnValue(of(null));
    router = { createUrlTree: vi.fn().mockImplementation((commands: string[], extras: unknown) => ({ to: commands[0], extras }) as unknown as UrlTree) };

    TestBed.configureTestingModule({
      providers: [
        { provide: PersonaService, useValue: { currentPersona, canViewExecutiveDashboards, refreshEnrichedPersonas } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('admits an executive director on the synchronous fast path', async () => {
    currentPersona.set('executive-director');
    expect(await runGuard(route())).toBe(true);
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('admits LF staff after the personas refresh', async () => {
    canViewExecutiveDashboards.set(true);
    expect(await runGuard(route())).toBe(true);
    expect(refreshEnrichedPersonas).toHaveBeenCalledOnce();
  });

  it('sends a denied user to the foundation overview when the route names no landing page', async () => {
    expect(await runGuard(route())).toEqual({ to: '/foundation/overview', extras: { queryParams: { project: 'x' } } });
  });

  it('sends a denied user to the route-specified landing page (accessDeniedRedirect)', async () => {
    expect(await runGuard(route({ accessDeniedRedirect: '/project/overview' }))).toEqual({
      to: '/project/overview',
      extras: { queryParams: { project: 'x' } },
    });
  });
});
