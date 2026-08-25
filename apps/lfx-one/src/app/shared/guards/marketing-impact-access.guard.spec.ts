// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { PersonaService } from '@shared/services/persona.service';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketingImpactAccessGuard } from './marketing-impact-access.guard';

// Covers only the localStorage-override branch before this file existed (round-4 review on
// PR #1585). Now also exercises the SSR fast path, the provider-ready flag-on/off branches, and
// that LF Staff (canViewExecutiveDashboards) keep admitting once the flag is on, not just
// marketing_auditor.
describe('marketingImpactAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let isMarketingAuditor: ReturnType<typeof signal<boolean>>;
  let canViewExecutiveDashboards: ReturnType<typeof signal<boolean>>;
  let refreshEnrichedPersonas: ReturnType<typeof vi.fn>;
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let router: { parseUrl: ReturnType<typeof vi.fn>; createUrlTree: ReturnType<typeof vi.fn> };

  const route = (params: Record<string, string> = {}): ActivatedRouteSnapshot =>
    ({
      queryParamMap: convertToParamMap(params),
    }) as unknown as ActivatedRouteSnapshot;

  const runGuard = async (r: ActivatedRouteSnapshot = route()) => {
    const result = TestBed.runInInjectionContext(() => marketingImpactAccessGuard(r, {} as RouterStateSnapshot));
    return typeof result === 'boolean' ? result : firstValueFrom(result as import('rxjs').Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    currentPersona = signal('maintainer');
    isMarketingAuditor = signal(false);
    canViewExecutiveDashboards = signal(false);
    refreshEnrichedPersonas = vi.fn().mockReturnValue(of(null));
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(false));

    router = {
      parseUrl: vi.fn().mockImplementation((url: string) => ({ redirect: url }) as unknown as UrlTree),
      createUrlTree: vi.fn().mockImplementation((commands: string[], opts: unknown) => ({ denied: commands[0], opts }) as unknown as UrlTree),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: PersonaService,
          useValue: { currentPersona, isMarketingAuditor, canViewExecutiveDashboards, refreshEnrichedPersonas },
        },
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag },
        },
        { provide: Router, useValue: router },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('allows the executive-director persona synchronously with no HTTP calls', async () => {
    currentPersona.set('executive-director');

    const result = await runGuard();

    expect(result).toBe(true);
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('allows on the server without evaluating the flag (SSR fast path)', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(getFlagOverride).not.toHaveBeenCalled();
  });

  it('redirects a non-LF-staff, non-auditor user when the local override says the flag is off', async () => {
    getFlagOverride.mockReturnValue(false);

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: null } } });
  });

  it('allows a marketing auditor when the local override says the flag is on', async () => {
    getFlagOverride.mockReturnValue(true);
    refreshEnrichedPersonas.mockImplementation(() => {
      isMarketingAuditor.set(true);
      return of(null);
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects a non-auditor when the local override says the flag is on', async () => {
    getFlagOverride.mockReturnValue(true);

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: null } } });
  });

  it('still allows LF Staff when the local override says the flag is off (pre-existing gate, unaffected by FGA)', async () => {
    getFlagOverride.mockReturnValue(false);
    canViewExecutiveDashboards.set(true);

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('allows a marketing auditor once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));
    refreshEnrichedPersonas.mockImplementation(() => {
      isMarketingAuditor.set(true);
      return of(null);
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects once the provider is ready and the flag is off, even without re-probing FGA', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: null } } });
  });

  it('forces a refetch unless the caller is already known to be a marketing auditor', async () => {
    getFlagOverride.mockReturnValue(true);
    isMarketingAuditor.set(true);

    await runGuard();

    expect(refreshEnrichedPersonas).toHaveBeenCalledWith(false, undefined);
  });

  it('passes the project query param through to the refetch only when the flag is on', async () => {
    getFlagOverride.mockReturnValue(true);

    await runGuard(route({ project: 'my-project' }));

    expect(refreshEnrichedPersonas).toHaveBeenCalledWith(true, 'my-project');
  });

  it('does not scope the refetch to a project when the local override says the flag is off', async () => {
    getFlagOverride.mockReturnValue(false);

    await runGuard(route({ project: 'my-project' }));

    expect(refreshEnrichedPersonas).toHaveBeenCalledWith(false, undefined);
  });

  it("allows a marketing auditor based on this call's own response even if a newer probe elsewhere already overwrote the shared signal back to false (LFXV2-2235 probe-race regression)", async () => {
    getFlagOverride.mockReturnValue(true);
    // Simulate PersonaService.applyPersonaResponse discarding this response's write because a
    // newer probeId (from e.g. sidebar-nav) was issued before it resolved — the shared signal
    // never gets set to true, but the response this guard receives directly still carries the truth.
    refreshEnrichedPersonas.mockReturnValue(of({ isMarketingAuditor: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(isMarketingAuditor()).toBe(false);
  });
});
