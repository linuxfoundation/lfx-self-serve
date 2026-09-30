// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MentorshipMentorService } from './mentorship-mentor.service';

describe('MentorshipMentorService — read error mapping', () => {
  let service: MentorshipMentorService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipMentorService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipMentorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
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
    // `MentorshipMentorService` must not silently swallow profile errors, or the profile page
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
    // Unlike MentorshipService.getProgram, getMentorProgram must not swallow 404 into a null fallback.
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
