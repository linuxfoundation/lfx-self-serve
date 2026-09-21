// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MentorshipService } from './mentorship.service';

describe('MentorshipService — lookup error mapping', () => {
  let service: MentorshipService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('lets a name-availability outage fail instead of reporting the name as free', () => {
    let failed = false;
    service.isProgramNameAvailable('GridFlow').subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });

    http.expectOne((req) => req.url === '/api/mentorship/programs/name-available').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);
  });

  it('maps a missing CII project to null and lets other CII failures propagate', () => {
    let missing: unknown = 'unset';
    service.getCiiBadge('1842').subscribe((badge) => {
      missing = badge;
    });
    http.expectOne('/api/mentorship/cii/1842').flush('missing', { status: 404, statusText: 'Not Found' });
    expect(missing).toBeNull();

    let failed = false;
    service.getCiiBadge('1842').subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });
    http.expectOne('/api/mentorship/cii/1842').flush('down', { status: 502, statusText: 'Bad Gateway' });
    expect(failed).toBe(true);
  });

  it('lets mentor-program loading failures propagate so the page can render a retry state', () => {
    let failed = false;
    service.getMentorPrograms().subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });

    http.expectOne('/api/mentorship/mentor/programs').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);
  });

  it('lets mentor-profile loading failures propagate so the page can render a retry state', () => {
    // Parallels the mentor-programs test above — a future `catchError` refactor in
    // `MentorshipService` must not silently swallow profile errors, or the profile page
    // would degrade to the empty-response shape without ever surfacing the retry state.
    let failed = false;
    service.getMentorProfile().subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });

    http.expectOne('/api/mentorship/mentor/profile').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);
  });

  it('lets mentee-profile loading failures propagate so the page can render a retry state', () => {
    let failed = false;
    service.getMenteeProfile().subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });

    http.expectOne('/api/mentorship/mentee/profile').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);
  });

  it('encodes the mentor program id in the detail URL', () => {
    let loaded: unknown = 'unset';
    service.getMentorProgram('mp_apicurio/fall26').subscribe((detail) => {
      loaded = detail;
    });

    const detail = { id: 'mp_apicurio/fall26' };
    http.expectOne('/api/mentorship/mentor/programs/mp_apicurio%2Ffall26').flush(detail);
    expect(loaded).toEqual(detail);
  });

  it('lets mentor-program detail 503 and 404 errors propagate so the page can distinguish retry from not-found', () => {
    // Unlike getProgram, getMentorProgram must not swallow 404 into a null fallback.
    // MentorProgramDetailComponent depends on the error status for not-found vs retry.
    let failed = false;
    service.getMentorProgram('mp_gridflow_fall26').subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });
    http.expectOne('/api/mentorship/mentor/programs/mp_gridflow_fall26').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);

    failed = false;
    service.getMentorProgram('missing').subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });
    http.expectOne('/api/mentorship/mentor/programs/missing').flush('missing', { status: 404, statusText: 'Not Found' });
    expect(failed).toBe(true);
  });
});
