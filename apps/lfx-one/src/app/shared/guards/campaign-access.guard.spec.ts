// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { PersonaService } from '@shared/services/persona.service';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { campaignAccessGuard } from './campaign-access.guard';

// Covers only the localStorage-override branch before this file existed (round-4 review on
// PR #1585). Now also exercises: the SSR fast path, the provider-ready flag-on/off branches, and
// the mid-flight ED promotion that can happen as a side effect of `refreshEnrichedPersonas`.
describe('campaignAccessGuard', () => {
  let currentPersona: ReturnType<typeof signal<string>>;
  let isCampaignManager: ReturnType<typeof signal<boolean>>;
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
    const result = TestBed.runInInjectionContext(() => campaignAccessGuard(r, {} as RouterStateSnapshot));
    // The guard returns `true` synchronously for the ED/SSR fast paths, a bare UrlTree
    // synchronously for the override-off redirect, and an Observable for every other branch.
    if (typeof result === 'boolean' || !('subscribe' in (result as object))) {
      return result as boolean | UrlTree;
    }
    return firstValueFrom(result as import('rxjs').Observable<boolean | UrlTree>);
  };

  beforeEach(() => {
    currentPersona = signal('maintainer');
    isCampaignManager = signal(false);
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
          useValue: { currentPersona, isCampaignManager, refreshEnrichedPersonas },
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

  it('redirects when the local override says the flag is off, preserving the project query param', async () => {
    getFlagOverride.mockReturnValue(false);

    const result = await runGuard(route({ project: 'my-project' }));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/foundation/overview'], { queryParams: { project: 'my-project' } });
    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: 'my-project' } } });
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('allows a campaign manager when the local override says the flag is on', async () => {
    getFlagOverride.mockReturnValue(true);
    refreshEnrichedPersonas.mockImplementation(() => {
      isCampaignManager.set(true);
      return of(null);
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects a non-campaign-manager when the local override says the flag is on', async () => {
    getFlagOverride.mockReturnValue(true);

    const result = await runGuard();

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: null } } });
  });

  it('allows a campaign manager once the provider is ready and the flag is on', async () => {
    getBooleanFlag.mockReturnValue(signal(true));
    refreshEnrichedPersonas.mockImplementation(() => {
      isCampaignManager.set(true);
      return of(null);
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('redirects once the provider is ready and the flag is off, preserving the project query param', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    const result = await runGuard(route({ project: 'my-project' }));

    expect(result).toEqual({ denied: '/foundation/overview', opts: { queryParams: { project: 'my-project' } } });
    expect(refreshEnrichedPersonas).not.toHaveBeenCalled();
  });

  it('allows when the refetch promotes currentPersona to executive-director as a side effect', async () => {
    getBooleanFlag.mockReturnValue(signal(true));
    refreshEnrichedPersonas.mockImplementation(() => {
      currentPersona.set('executive-director');
      return of(null);
    });

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('allows a previously-confirmed campaign manager when the refetch returns an errored response', async () => {
    getBooleanFlag.mockReturnValue(signal(true));
    isCampaignManager.set(true);
    refreshEnrichedPersonas.mockReturnValue(of({ isCampaignManager: false, error: 'nats_error' }));

    const result = await runGuard();

    expect(result).toBe(true);
  });

  it('forces a refetch unless the caller is already known to be a campaign manager', async () => {
    getFlagOverride.mockReturnValue(true);
    isCampaignManager.set(true);

    await runGuard();

    expect(refreshEnrichedPersonas).toHaveBeenCalledWith(false, undefined);
  });

  it('passes the project query param through to the refetch', async () => {
    getFlagOverride.mockReturnValue(true);

    await runGuard(route({ project: 'my-project' }));

    expect(refreshEnrichedPersonas).toHaveBeenCalledWith(true, 'my-project');
  });

  it("allows a campaign manager based on this call's own response even if a newer probe elsewhere already overwrote the shared signal back to false (LFXV2-2235 probe-race regression)", async () => {
    getFlagOverride.mockReturnValue(true);
    // Simulate PersonaService.applyPersonaResponse discarding this response's write because a
    // newer probeId (from e.g. sidebar-nav) was issued before it resolved — the shared signal
    // never gets set to true, but the response this guard receives directly still carries the truth.
    refreshEnrichedPersonas.mockReturnValue(of({ isCampaignManager: true }));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(isCampaignManager()).toBe(false);
  });
});
