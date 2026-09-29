// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipMenteeApplicationsResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MentorshipMenteeService } from './mentorship-mentee.service';

describe('MentorshipMenteeService — error mapping', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipMenteeService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipMenteeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
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

  it('reads a failed has-profile check as "no profile" so the guards open the register page', () => {
    let result: unknown = 'unset';
    service.hasMenteeProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentee/has-profile').flush('conflict', { status: 409, statusText: 'Conflict' });
    expect(result).toEqual({ hasProfile: false });
  });
});

describe('MentorshipMenteeService — mentee applications caching', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  const APPLICATIONS_URL = '/api/mentorship/mentee/applications';
  const matchApplications = (req: { url: string; params: { get(name: string): string | null } }) =>
    req.url === APPLICATIONS_URL && req.params.get('withTasks') === 'true';
  const applications: MentorshipMenteeApplicationsResponse = { data: [], total: 0 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipMenteeService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipMenteeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reads the applications with their tasks from one request across repeated reads (tab switches)', () => {
    const seen: MentorshipMenteeApplicationsResponse[] = [];
    // Two subscribers before the response resolves must share a single request.
    service.getMenteeApplications().subscribe((r) => seen.push(r));
    service.getMenteeApplications().subscribe((r) => seen.push(r));
    http.expectOne(matchApplications).flush(applications);

    // A later read replays the cached value with no new request.
    service.getMenteeApplications().subscribe((r) => seen.push(r));
    http.expectNone(APPLICATIONS_URL);

    expect(seen).toHaveLength(3);
    expect(seen.every((r) => r === applications)).toBe(true);
  });

  it('drops the cached applications after each failure so a later retry can succeed', () => {
    const fail = { status: 503, statusText: 'Service Unavailable' };

    for (let attempt = 0; attempt < 2; attempt++) {
      let failed = false;
      service.getMenteeApplications().subscribe({ next: () => undefined, error: () => (failed = true) });
      http.expectOne(matchApplications).flush('down', fail);
      expect(failed).toBe(true);
    }

    let recovered: unknown = 'unset';
    service.getMenteeApplications().subscribe((r) => (recovered = r));
    http.expectOne(matchApplications).flush(applications);
    expect(recovered).toBe(applications);
  });

  it('clearMenteeCaches drops a successful response so the next read fetches again', () => {
    service.getMenteeApplications().subscribe();
    http.expectOne(matchApplications).flush(applications);

    service.clearMenteeCaches();

    const refreshed: MentorshipMenteeApplicationsResponse = { data: [], total: 1 };
    let seen: unknown = 'unset';
    service.getMenteeApplications().subscribe((r) => (seen = r));
    http.expectOne(matchApplications).flush(refreshed);
    expect(seen).toBe(refreshed);
  });

  it('clearMenteeCaches bumps the applications revision so every reader re-reads', () => {
    const before = service.menteeApplicationsRevision();
    service.clearMenteeCaches();
    service.clearMenteeCaches();
    expect(service.menteeApplicationsRevision()).toBe(before + 2);
  });
});
