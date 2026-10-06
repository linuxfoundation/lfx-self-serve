// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { LENS_COOKIE_KEY, NAV_LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { Lens } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from '../services/cookie-registry.service';
import { FeatureFlagService } from '../services/feature-flag.service';
import { LensService } from '../services/lens.service';
import { PersonaService } from '../services/persona.service';
import { WriterGrantsService } from '../services/writer-grants.service';
import { meetupsLensGuard } from './meetups-lens.guard';

describe('meetupsLensGuard', () => {
  function setup(storedLens: Lens, grantsLoaded = true) {
    const hasWriterFoundation = signal(grantsLoaded);
    const hasWriterProject = signal(grantsLoaded);
    const cookies = {
      get: vi.fn((key: string) => (key === LENS_COOKIE_KEY ? storedLens : 'foundation')),
      set: vi.fn(),
    };
    const registerCookie = vi.fn();
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        LensService,
        { provide: SsrCookieService, useValue: cookies },
        { provide: CookieRegistryService, useValue: { registerCookie } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: Router, useValue: { navigate } },
        {
          provide: PersonaService,
          useValue: {
            hasBoardRole: signal(false),
            hasProjectRole: signal(false),
            isRootWriter: signal(false),
            isLFStaff: signal(false),
            isMarketingAuditor: signal(false),
            isCampaignManager: signal(false),
            isAuditor: signal(false),
          },
        },
        { provide: WriterGrantsService, useValue: { hasWriterFoundation, hasWriterProject } },
      ],
    });
    const lens = TestBed.inject(LensService);
    const setLens = vi.spyOn(lens, 'setLens');
    const runGuard = () => TestBed.runInInjectionContext(() => meetupsLensGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));
    return { lens, setLens, cookies, registerCookie, navigate, hasWriterFoundation, hasWriterProject, runGuard };
  }

  it.each(['foundation', 'project'] as const)('selects and persists Me from %s without navigating or changing lastNavLens', (storedLens) => {
    const { lens, cookies, registerCookie, navigate, runGuard } = setup(storedLens);
    expect(lens.activeLens()).toBe(storedLens);
    const lastNavLens = lens.lastNavLens();

    expect(runGuard()).toBe(true);

    expect(lens.activeLens()).toBe('me');
    expect(cookies.set).toHaveBeenCalledExactlyOnceWith(LENS_COOKIE_KEY, 'me', {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    expect(registerCookie).toHaveBeenCalledExactlyOnceWith(LENS_COOKIE_KEY);
    expect(cookies.set).not.toHaveBeenCalledWith(NAV_LENS_COOKIE_KEY, expect.anything(), expect.anything());
    expect(lens.lastNavLens()).toBe(lastNavLens);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reasserts an existing Me selection without rewriting cookies', () => {
    const { lens, setLens, cookies, registerCookie, navigate, runGuard } = setup('me');

    expect(runGuard()).toBe(true);

    expect(setLens).toHaveBeenCalledExactlyOnceWith('me');
    expect(lens.activeLens()).toBe('me');
    expect(cookies.set).not.toHaveBeenCalled();
    expect(registerCookie).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(lens.lastNavLens()).toBe('foundation');
  });

  it('preserves Org without selecting a lens or writing cookies', () => {
    const { lens, setLens, cookies, registerCookie, navigate, runGuard } = setup('org');

    expect(runGuard()).toBe(true);

    expect(lens.activeLens()).toBe('org');
    expect(setLens).not.toHaveBeenCalled();
    expect(cookies.set).not.toHaveBeenCalled();
    expect(registerCookie).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(lens.lastNavLens()).toBe('foundation');
  });

  it.each(['foundation', 'project'] as const)('corrects stored %s while clamped to Me before writer grants arrive', (storedLens) => {
    const { lens, cookies, hasWriterFoundation, hasWriterProject, runGuard } = setup(storedLens, false);
    expect(lens.activeLens()).toBe('me');
    expect(lens.availableLenses().map((option) => option.id)).not.toContain(storedLens);

    expect(runGuard()).toBe(true);
    expect(cookies.set).toHaveBeenCalledWith(LENS_COOKIE_KEY, 'me', expect.anything());
    if (storedLens === 'foundation') {
      hasWriterFoundation.set(true);
    } else {
      hasWriterProject.set(true);
    }

    expect(lens.availableLenses().map((option) => option.id)).toContain(storedLens);
    expect(lens.activeLens()).toBe('me');
    expect(lens.lastNavLens()).toBe('foundation');
  });
});
