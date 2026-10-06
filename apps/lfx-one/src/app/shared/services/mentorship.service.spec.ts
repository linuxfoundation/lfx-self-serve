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

describe('MentorshipService — program review', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
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

  it('reads the review from the program-review endpoint', () => {
    let name = '';
    service.getProgramReview(programId).subscribe((review) => (name = review.name));

    http.expectOne(`/api/mentorship/program-review/${programId}`).flush({ id: programId, name: 'Test Program', status: 'pending' });

    expect(name).toBe('Test Program');
  });

  it('posts the decision and surfaces a 409 to the caller', () => {
    let status = 0;
    service.submitProgramDecision(programId, 'reject').subscribe({ error: (err) => (status = err.status) });

    const req = http.expectOne(`/api/mentorship/program-review/${programId}/decision`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ decision: 'reject' });
    req.flush({ error: 'cannot transition program from rejected to rejected' }, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
  });
});

describe('MentorshipService — LFX profile sync', () => {
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

  it('patches the fields onto the caller mentorship profiles and surfaces a failure', () => {
    const fields = { firstName: 'Test', lastName: 'User' };
    let status = 0;
    service.syncLfxProfileFields(fields).subscribe({ error: (err) => (status = err.status) });

    const req = http.expectOne('/api/mentorship/me/lfx-profile');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(fields);
    req.flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });

    expect(status).toBe(403);
  });
});
