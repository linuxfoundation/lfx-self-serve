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
});
