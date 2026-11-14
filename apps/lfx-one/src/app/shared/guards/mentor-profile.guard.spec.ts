// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { mentorRegisterGuard } from './mentor-profile.guard';

describe('mentorRegisterGuard', () => {
  const setup = (hasMentorProfile: ReturnType<typeof vi.fn>) => {
    const urlTree = { toString: () => '/mentorship/mentor/programs' } as unknown as UrlTree;
    const createUrlTree = vi.fn().mockReturnValue(urlTree);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: MentorshipMentorService, useValue: { hasMentorProfile } },
        { provide: Router, useValue: { createUrlTree } },
      ],
    });

    return { createUrlTree, urlTree };
  };

  const runGuard = () => TestBed.runInInjectionContext(() => mentorRegisterGuard({} as never, {} as never));

  it('redirects to My Programs when the user has a mentor profile', async () => {
    const { createUrlTree, urlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: true })));

    const result = await runGuard();

    expect(createUrlTree).toHaveBeenCalledWith(['/mentorship/mentor/programs']);
    expect(result).toBe(urlTree);
  });

  it('allows the register page when the user has no mentor profile', async () => {
    const { createUrlTree } = setup(vi.fn().mockReturnValue(of({ hasProfile: false })));

    const result = await runGuard();

    expect(result).toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('allows the register page during SSR without asking the profile check, so the browser run decides', async () => {
    const hasMentorProfile = vi.fn();
    const { createUrlTree } = setup(hasMentorProfile);
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(hasMentorProfile).not.toHaveBeenCalled();
    expect(createUrlTree).not.toHaveBeenCalled();
  });

  it('rejects when the service throws (guard has no catchError)', async () => {
    setup(vi.fn().mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 }))));

    await expect(runGuard()).rejects.toThrow();
  });
});
