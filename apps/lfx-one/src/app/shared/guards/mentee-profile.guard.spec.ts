// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { MentorshipService } from '@services/mentorship.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { menteeRegisterGuard } from './mentee-profile.guard';

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

  it('redirects to overview when user has a mentee profile', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: true })));

    const result = await TestBed.runInInjectionContext(() => menteeRegisterGuard({} as never, {} as never));

    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentee/overview']);
    expect(result).not.toBe(true);
  });

  it('allows the register page when user has no mentee profile', async () => {
    setup(vi.fn().mockReturnValue(of({ hasProfile: false })));

    const result = await TestBed.runInInjectionContext(() => menteeRegisterGuard({} as never, {} as never));

    expect(result).toBe(true);
  });

  it('rejects when the service throws (guard has no catchError)', async () => {
    setup(vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))));

    await expect(TestBed.runInInjectionContext(() => menteeRegisterGuard({} as never, {} as never))).rejects.toThrow();
  });
});
