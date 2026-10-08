// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipApplicantTask, MentorshipTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('keeps a plus sign in the name, the project search and the cursor instead of letting Express read it as a space', () => {
    service.isProgramNameAvailable('C++ Mentorship').subscribe();
    service.getLfProjects({ search: 'C++', pageToken: 'ab+cd/ef=' }).subscribe();

    expect(http.expectOne((req) => req.url === '/api/mentorship/programs/name-available').request.urlWithParams).toContain('name=C%2B%2B%20Mentorship');
    const projects = http.expectOne((req) => req.url === '/api/mentorship/lf-projects').request.urlWithParams;
    expect(projects).toContain('search=C%2B%2B');
    expect(projects).toContain('page_token=ab%2Bcd%2Fef%3D');
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

describe('MentorshipService — task writes', () => {
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
    vi.restoreAllMocks();
  });

  it('posts a task create and returns the created and failed ids', () => {
    const request = { applicationIds: ['app_1', 'app_2'], name: 'Read the guide', description: 'Start with chapter one', dueDate: '2030-01-31' };
    let result: MentorshipTaskCreateResponse | undefined;
    service.createTasks(request).subscribe((response) => (result = response));

    const req = http.expectOne('/api/mentorship/tasks');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(request);
    req.flush({ created: ['app_1'], failed: ['app_2'] } satisfies MentorshipTaskCreateResponse);
    expect(result).toEqual({ created: ['app_1'], failed: ['app_2'] });
  });

  it('logs a failed task create by status only and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service
      .createTasks({ applicationIds: ['app_1'], name: 'Read the guide', description: 'private-task-text' })
      .subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/tasks').flush({ message: 'private-task-text' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
    expect(logged).toHaveBeenCalledWith('[MentorshipService] createTasks failed', { status: 404, statusText: 'Not Found' });
  });

  it('patches one task, with an encoded id, and returns the updated task', () => {
    const body = { name: 'Read the guide', status: 'completed' } as const;
    const updated = { id: 'task 1', name: 'Read the guide', status: 'completed' } as MentorshipApplicantTask;
    let result: MentorshipApplicantTask | undefined;
    service.updateTask('task 1', body).subscribe((response) => (result = response));

    const req = http.expectOne('/api/mentorship/tasks/task%201');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(body);
    req.flush(updated);
    expect(result).toEqual(updated);
  });

  it('logs a failed task edit by status only and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.updateTask('task_1', { status: 'submitted' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/tasks/task_1').flush({ message: 'private-task-text' }, { status: 400, statusText: 'Bad Request' });

    expect(status).toBe(400);
    expect(logged).toHaveBeenCalledWith('[MentorshipService] updateTask failed', { status: 400, statusText: 'Bad Request' });
  });
});
