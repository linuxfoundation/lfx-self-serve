// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, Router, UrlTree } from '@angular/router';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { menteeRegisterGuard } from './mentee-profile.guard';

const routeWith = (params: Record<string, string> = {}) => ({ queryParamMap: convertToParamMap(params) }) as never;

describe('menteeRegisterGuard', () => {
  const setup = (hasMenteeProfile: ReturnType<typeof vi.fn>) => {
    const createUrlTree = vi.fn().mockReturnValue({ toString: () => '/mentorship/mentee/overview' } as unknown as UrlTree);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MentorshipService, useValue: { hasMenteeProfile } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });

    return { hasMenteeProfile, createUrlTree };
  };

  it('redirects to overview when user has a mentee profile and no apply ids', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: true })));

    const result = await TestBed.runInInjectionContext(() => menteeRegisterGuard(routeWith(), {} as never));

    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    expect(result).not.toBe(true);
  });

  it('redirects to apply with both ids when user has a mentee profile and a complete apply link', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: true })));

    const result = await TestBed.runInInjectionContext(() =>
      menteeRegisterGuard(routeWith({ programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' }), {} as never)
    );

    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentee/apply'], {
      queryParams: { programId: 'mp_apicurio_winter26', programTermId: 'trm_apicurio_winter26' },
    });
    expect(result).not.toBe(true);
  });

  it('allows the register page when user has no mentee profile', async () => {
    setup(vi.fn().mockReturnValue(of({ hasProfile: false })));

    const result = await TestBed.runInInjectionContext(() => menteeRegisterGuard(routeWith(), {} as never));

    expect(result).toBe(true);
  });

  it('rejects when the service throws (guard has no catchError)', async () => {
    setup(vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))));

    await expect(TestBed.runInInjectionContext(() => menteeRegisterGuard(routeWith(), {} as never))).rejects.toThrow();
  });
});
