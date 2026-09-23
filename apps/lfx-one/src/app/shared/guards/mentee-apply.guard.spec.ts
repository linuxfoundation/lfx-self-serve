// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { convertToParamMap, Router, UrlTree } from '@angular/router';
import { MentorshipService } from '@services/mentorship.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { menteeApplyGuard } from './mentee-apply.guard';

const routeWith = (params: Record<string, string> = {}) => ({ queryParamMap: convertToParamMap(params) }) as never;

describe('menteeApplyGuard', () => {
  const setup = (hasMenteeProfile: ReturnType<typeof vi.fn>, navigationState?: Record<string, unknown>) => {
    const createUrlTree = vi.fn().mockReturnValue({ toString: () => '/mentorship/mentee' } as unknown as UrlTree);
    const getCurrentNavigation = vi.fn().mockReturnValue(navigationState ? { extras: { state: navigationState } } : null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MentorshipService, useValue: { hasMenteeProfile } },
        { provide: Router, useValue: { createUrlTree, getCurrentNavigation } },
      ],
    });

    return { hasMenteeProfile, createUrlTree };
  };

  it('allows the page when the signed-in user already has a mentee profile', async () => {
    const hasMenteeProfile = vi.fn().mockReturnValue(of({ hasProfile: true }));
    const { createUrlTree } = setup(hasMenteeProfile);

    const result = await TestBed.runInInjectionContext(() => menteeApplyGuard(routeWith(), {} as never));

    expect(result).toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('allows the return trip after registration without asking the profile check', async () => {
    const hasMenteeProfile = vi.fn();
    setup(hasMenteeProfile, { menteeProfileCreated: true });

    const result = await TestBed.runInInjectionContext(() =>
      menteeApplyGuard(routeWith({ programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' }), {} as never)
    );

    expect(result).toBe(true);
    expect(hasMenteeProfile).not.toHaveBeenCalled();
  });

  it('sends a mentee with no profile to register and keeps both ids', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: false })));

    const result = await TestBed.runInInjectionContext(() =>
      menteeApplyGuard(routeWith({ programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' }), {} as never)
    );

    expect(result).not.toBe(true);
    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentee'], {
      queryParams: { programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' },
    });
  });

  it('keeps a single id when the apply link only has one', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: false })));

    await TestBed.runInInjectionContext(() => menteeApplyGuard(routeWith({ programId: 'mp_apicurio_winter26' }), {} as never));

    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentee'], {
      queryParams: { programId: 'mp_apicurio_winter26' },
    });
  });
});
