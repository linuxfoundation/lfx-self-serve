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
});

describe('MentorshipMenteeService — mentee overview/tasks caching', () => {
  let service: MentorshipMenteeService;
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
      providers: [MentorshipMenteeService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipMenteeService);
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
