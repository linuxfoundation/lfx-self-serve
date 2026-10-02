// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  MentorshipMenteeApplicationsResponse,
  MentorshipMenteeProfileUpdateRequest,
  MentorshipMenteeProfileUpdateResponse,
  MentorshipMenteeRegisterRequest,
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

  it('reads a failed has-profile check as "no profile" so the guards open the register page', () => {
    let result: unknown = 'unset';
    service.hasMenteeProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentee/has-profile').flush('conflict', { status: 409, statusText: 'Conflict' });
    expect(result).toEqual({ hasProfile: false });
  });

  describe('registerMenteeProfile', () => {
    const request: MentorshipMenteeRegisterRequest = {
      introduction: '<p>Test intro</p>',
      skillsHave: ['Java'],
      skillsWant: ['Python'],
      additionalNotes: '',
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    };

    it('posts the request to the mentee profile endpoint and completes after one emission', () => {
      let emissions = 0;
      let completed = false;
      service.registerMenteeProfile(request).subscribe({
        next: () => {
          emissions += 1;
        },
        complete: () => {
          completed = true;
        },
      });

      const req = http.expectOne('/api/mentorship/mentee/profile');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(null, { status: 204, statusText: 'No Content' });

      expect(emissions).toBe(1);
      expect(completed).toBe(true);
    });

    it('propagates the raw HttpErrorResponse so the page can read the status and code', () => {
      let error: unknown;
      service.registerMenteeProfile(request).subscribe({
        error: (err: unknown) => {
          error = err;
        },
      });

      http.expectOne('/api/mentorship/mentee/profile').flush({ code: 'MENTEE_PROFILE_EXISTS' }, { status: 409, statusText: 'Conflict' });

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(error).toMatchObject({ status: 409, error: { code: 'MENTEE_PROFILE_EXISTS' } });
    });
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

describe('MentorshipMenteeService — withdrawMenteeApplication', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  const APPLICATION_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const WITHDRAW_URL = `/api/mentorship/mentee/applications/${APPLICATION_ID}/withdraw`;

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

  it('posts an empty body to the withdraw route and refreshes the cached applications', () => {
    const before = service.menteeApplicationsRevision();
    let done = false;
    service.withdrawMenteeApplication(APPLICATION_ID).subscribe({ complete: () => (done = true) });

    const req = http.expectOne(WITHDRAW_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(service.menteeApplicationsRevision()).toBe(before + 1);
  });

  it('leaves the cache alone and passes the failure on when the withdraw fails', () => {
    const before = service.menteeApplicationsRevision();
    let status = 0;
    service.withdrawMenteeApplication(APPLICATION_ID).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne(WITHDRAW_URL).flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
    expect(service.menteeApplicationsRevision()).toBe(before);
  });
});

describe('MentorshipMenteeService — updateMenteeTaskStatus', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  const TASK_ID = '7a9b1c3d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
  const TASK_URL = `/api/mentorship/mentee/tasks/${TASK_ID}`;

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

  it('patches only the status to the task route and refreshes the cached applications', () => {
    const before = service.menteeApplicationsRevision();
    let done = false;
    service.updateMenteeTaskStatus(TASK_ID, 'in_progress').subscribe({ complete: () => (done = true) });

    const req = http.expectOne(TASK_URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'in_progress' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(service.menteeApplicationsRevision()).toBe(before + 1);
  });

  it('drops the cached applications so the next read fetches them again', () => {
    service.getMenteeApplications().subscribe();
    http.expectOne('/api/mentorship/mentee/applications?withTasks=true').flush({ data: [], total: 0 });

    service.updateMenteeTaskStatus(TASK_ID, 'submitted').subscribe();
    http.expectOne(TASK_URL).flush(null, { status: 204, statusText: 'No Content' });
    service.getMenteeApplications().subscribe();

    http.expectOne('/api/mentorship/mentee/applications?withTasks=true').flush({ data: [], total: 0 });
  });

  it('encodes the task id in the path', () => {
    service.updateMenteeTaskStatus('a/b?c', 'in_progress').subscribe();

    http.expectOne('/api/mentorship/mentee/tasks/a%2Fb%3Fc').flush(null, { status: 204, statusText: 'No Content' });
  });

  it('leaves the cache alone and passes the failure on when the update fails', () => {
    const before = service.menteeApplicationsRevision();
    let status = 0;
    service.updateMenteeTaskStatus(TASK_ID, 'submitted').subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne(TASK_URL).flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
    expect(service.menteeApplicationsRevision()).toBe(before);
  });
});

describe('MentorshipMenteeService — applyToMenteeTerm', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  const APPLY_URL = '/api/mentorship/mentee/apply';
  const APPLY_IDS = { programId: '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e', programTermId: '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e' };

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

  it('posts the program and term ids and refreshes the cached applications', () => {
    const before = service.menteeApplicationsRevision();
    let done = false;
    service.applyToMenteeTerm(APPLY_IDS).subscribe({ complete: () => (done = true) });

    const req = http.expectOne(APPLY_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(APPLY_IDS);
    req.flush(null, { status: 204, statusText: 'No Content' });

    expect(done).toBe(true);
    expect(service.menteeApplicationsRevision()).toBe(before + 1);
  });

  it('leaves the cache alone and passes the failure on when the application is refused', () => {
    const before = service.menteeApplicationsRevision();
    let status = 0;
    service.applyToMenteeTerm(APPLY_IDS).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne(APPLY_URL).flush({ error: 'term is not accepting applications' }, { status: 422, statusText: 'Unprocessable Entity' });

    expect(status).toBe(422);
    expect(service.menteeApplicationsRevision()).toBe(before);
  });
});

describe('MentorshipMenteeService — updateMenteeProfile', () => {
  let service: MentorshipMenteeService;
  let http: HttpTestingController;

  const PROFILE_URL = '/api/mentorship/mentee/profile';
  const request: MentorshipMenteeProfileUpdateRequest = { skillSet: { skillsHave: ['Go'], skillsWant: ['Rust'], additionalNotes: 'Test notes.' } };
  const response: MentorshipMenteeProfileUpdateResponse = { profile: { aboutMe: '<p>Test</p>', skillsHave: ['Go'], skillsWant: ['Rust'] } };

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

  it('sends PATCH /api/mentorship/mentee/profile with the request body and returns the saved profile', () => {
    let result: MentorshipMenteeProfileUpdateResponse | undefined;
    service.updateMenteeProfile(request).subscribe((value) => (result = value));

    const req = http.expectOne(PROFILE_URL);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(request);
    req.flush(response);

    expect(result).toEqual(response);
  });

  it('does not clear the applications cache or bump menteeApplicationsRevision', () => {
    const before = service.menteeApplicationsRevision();
    service.updateMenteeProfile(request).subscribe();

    http.expectOne(PROFILE_URL).flush(response);

    expect(service.menteeApplicationsRevision()).toBe(before);
  });

  it('rethrows the HttpErrorResponse unchanged', () => {
    let error: HttpErrorResponse | undefined;
    service.updateMenteeProfile(request).subscribe({ error: (err: HttpErrorResponse) => (error = err) });

    http.expectOne(PROFILE_URL).flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });

    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect(error?.status).toBe(409);
    expect(error?.error).toEqual({ error: 'conflict' });
  });
});
