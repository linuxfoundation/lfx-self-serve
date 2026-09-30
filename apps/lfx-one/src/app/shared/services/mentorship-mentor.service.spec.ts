// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipMentorRegisterRequest } from '@lfx-one/shared/interfaces';
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

  it('reads the has-profile check', () => {
    let result: unknown = 'unset';
    service.hasMentorProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentor/has-profile').flush({ hasProfile: true });
    expect(result).toEqual({ hasProfile: true });
  });

  it('reads a failed has-profile check as "no profile" so the guard opens the register page', () => {
    let result: unknown = 'unset';
    service.hasMentorProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentor/has-profile').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(result).toEqual({ hasProfile: false });
  });

  describe('registerMentorProfile', () => {
    const request: MentorshipMentorRegisterRequest = {
      introduction: '<p>Test intro</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    };

    it('posts the request to the mentor profile endpoint and completes after one emission', () => {
      let emissions = 0;
      let completed = false;
      service.registerMentorProfile(request).subscribe({
        next: () => {
          emissions += 1;
        },
        complete: () => {
          completed = true;
        },
      });

      const req = http.expectOne('/api/mentorship/mentor/profile');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(null, { status: 204, statusText: 'No Content' });

      expect(emissions).toBe(1);
      expect(completed).toBe(true);
    });

    it('propagates the raw HttpErrorResponse so the page can read the status and code', () => {
      let error: unknown;
      service.registerMentorProfile(request).subscribe({
        error: (err: unknown) => {
          error = err;
        },
      });

      http.expectOne('/api/mentorship/mentor/profile').flush({ code: 'MENTOR_PROFILE_EXISTS' }, { status: 409, statusText: 'Conflict' });

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(error).toMatchObject({ status: 409, error: { code: 'MENTOR_PROFILE_EXISTS' } });
    });
  });
});
