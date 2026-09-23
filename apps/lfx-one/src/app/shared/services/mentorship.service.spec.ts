// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  MentorshipMenteeOverviewAccepted,
  MentorshipMenteeOverviewApplicant,
  MentorshipMenteeOverviewResponse,
  MentorshipMenteeTasksResponse,
} from '@lfx-one/shared/interfaces';
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

describe('MentorshipService — mentee overview/tasks caching', () => {
  let service: MentorshipService;
  let http: HttpTestingController;

  const OVERVIEW_URL = '/api/mentorship/mentee/overview';
  const TASKS_URL = '/api/mentorship/mentee/tasks';
  const applicantOverview: MentorshipMenteeOverviewApplicant = {
    phase: 'applicant',
    applications: [],
    pastApplications: [],
    openTaskCount: 0,
  };
  const acceptedOverview: MentorshipMenteeOverviewAccepted = {
    phase: 'accepted',
    openTaskCount: 0,
    program: {
      id: 'prog-1',
      programId: 'mp-1',
      projectName: 'Project',
      programName: 'Program',
      tasksCompleted: 0,
      tasksTotal: 0,
      mentors: [],
      upNextTasks: [],
    },
  };

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

  it('serves the unparameterized mentee overview from one request across repeated reads (overview↔tasks tab switches)', () => {
    const seen: MentorshipMenteeOverviewResponse[] = [];
    // Two subscribers before the response resolves must share a single request.
    service.getMenteeOverview().subscribe((r) => seen.push(r));
    service.getMenteeOverview().subscribe((r) => seen.push(r));
    http.expectOne(OVERVIEW_URL).flush(applicantOverview);

    // A later read replays the cached value with no new request.
    service.getMenteeOverview().subscribe((r) => seen.push(r));
    http.expectNone(OVERVIEW_URL);

    expect(seen).toHaveLength(3);
    expect(seen.every((r) => r === applicantOverview)).toBe(true);
  });

  it('drops the cached overview after a failure so a retry re-fetches instead of replaying the error', () => {
    let failed = false;
    service.getMenteeOverview().subscribe({ next: () => undefined, error: () => (failed = true) });
    http.expectOne(OVERVIEW_URL).flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(failed).toBe(true);

    let recovered: unknown = 'unset';
    service.getMenteeOverview().subscribe((r) => (recovered = r));
    http.expectOne(OVERVIEW_URL).flush(applicantOverview);
    expect(recovered).toBe(applicantOverview);
  });

  it('bypasses the cache for phase-scoped overview reads (dev phase switcher)', () => {
    service.getMenteeOverview('accepted').subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === 'accepted').flush(acceptedOverview);

    // A second phase-scoped read issues its own request rather than replaying a cached one.
    service.getMenteeOverview('accepted').subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === 'accepted').flush(acceptedOverview);
  });

  it('does not let a phase-scoped overview read fill the unparameterized cache', () => {
    service.getMenteeOverview('accepted').subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === 'accepted').flush(acceptedOverview);

    service.getMenteeOverview().subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === null).flush(applicantOverview);
  });

  it('does not serve the unparameterized cache to a phase-scoped overview read', () => {
    service.getMenteeOverview().subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === null).flush(applicantOverview);

    service.getMenteeOverview('accepted').subscribe();
    http.expectOne((req) => req.url === OVERVIEW_URL && req.params.get('phase') === 'accepted').flush(acceptedOverview);
  });

  it('clearMenteeCaches drops a successful overview so the next read fetches again', () => {
    service.getMenteeOverview().subscribe();
    http.expectOne(OVERVIEW_URL).flush(applicantOverview);

    service.clearMenteeCaches();

    const refreshed: MentorshipMenteeOverviewAccepted = { ...acceptedOverview, openTaskCount: 1 };
    let seen: unknown = 'unset';
    service.getMenteeOverview().subscribe((response) => {
      seen = response;
    });
    http.expectOne(OVERVIEW_URL).flush(refreshed);
    expect(seen).toBe(refreshed);
  });

  it('serves mentee tasks from one request across repeated reads', () => {
    const tasks = { data: [], total: 0 } as MentorshipMenteeTasksResponse;
    service.getMenteeTasks().subscribe();
    service.getMenteeTasks().subscribe();
    http.expectOne(TASKS_URL).flush(tasks);

    service.getMenteeTasks().subscribe();
    http.expectNone(TASKS_URL);
  });

  it('drops the cached tasks after each failure so a later retry can succeed', () => {
    const tasks = { data: [], total: 0 } as MentorshipMenteeTasksResponse;
    const fail = { status: 503, statusText: 'Service Unavailable' };

    let failed = false;
    service.getMenteeTasks().subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });
    http.expectOne(TASKS_URL).flush('down', fail);
    expect(failed).toBe(true);

    failed = false;
    service.getMenteeTasks().subscribe({
      next: () => undefined,
      error: () => {
        failed = true;
      },
    });
    http.expectOne(TASKS_URL).flush('down', fail);
    expect(failed).toBe(true);

    let recovered: unknown = 'unset';
    service.getMenteeTasks().subscribe((response) => {
      recovered = response;
    });
    http.expectOne(TASKS_URL).flush(tasks);
    expect(recovered).toBe(tasks);
  });
});
