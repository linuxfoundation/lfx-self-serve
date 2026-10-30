// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Router, UrlSegment, UrlTree } from '@angular/router';
import { firstValueFrom, Observable, of, tap } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { PersonaService } from '../services/persona.service';
import { UserService } from '../services/user.service';
import { orgLensLfStaffOnlyGuard } from './org-lens-lf-staff-only.guard';

// The redirect must stay in the organization the address names (spec 050): this CanMatch runs before
// `orgPathParamGuard` adopts the segment, so an absolute `/org/overview` would land on the cookie organization.
describe('orgLensLfStaffOnlyGuard', () => {
  const route: Route = { path: 'roi' };
  const segments: UrlSegment[] = [];

  let isLFStaff: WritableSignal<boolean>;
  let impersonating: WritableSignal<boolean>;
  let refreshEnrichedPersonas: Mock;
  let router: Router;

  /** The guard's verdict for an address: `true` when the page renders, otherwise the redirect target. */
  const verdictFor = async (targetUrl: string): Promise<string | true> => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({ extractedUrl: router.parseUrl(targetUrl) } as never);
    const result = TestBed.runInInjectionContext(() => orgLensLfStaffOnlyGuard(route, segments));
    const resolved = result instanceof Observable ? await firstValueFrom(result) : result;
    return resolved === true ? true : router.serializeUrl(resolved as UrlTree);
  };

  beforeEach(() => {
    isLFStaff = signal(false);
    impersonating = signal(false);
    refreshEnrichedPersonas = vi.fn(() => of(null));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: PersonaService, useValue: { isLFStaff, refreshEnrichedPersonas } },
        { provide: UserService, useValue: { impersonating } },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('admits LF staff', async () => {
    isLFStaff.set(true);

    expect(await verdictFor('/org/acme-inc/roi')).toBe(true);
  });

  it('decides only after the personas lookup resolves', async () => {
    refreshEnrichedPersonas.mockImplementation(() => of(null).pipe(tap(() => isLFStaff.set(true))));

    expect(await verdictFor('/org/acme-inc/roi')).toBe(true);
  });

  it('sends a non-staff caller to the overview of the address they named', async () => {
    expect(await verdictFor('/org/acme-inc/roi')).toBe('/org/acme-inc/overview');
    expect(await verdictFor('/org/roi')).toBe('/org/overview');
  });

  it('sends a session acting as another user to the overview, even when that user is LF staff', async () => {
    isLFStaff.set(true);
    impersonating.set(true);

    expect(await verdictFor('/org/acme-inc/roi')).toBe('/org/acme-inc/overview');
  });
});
