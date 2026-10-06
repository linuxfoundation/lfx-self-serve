// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipProgramsResponse,
} from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipAdminService } from './mentorship-admin.service';

describe('MentorshipAdminService', () => {
  let service: MentorshipAdminService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipAdminService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipAdminService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('reads the program list from the admin endpoint with the filters as query params', () => {
    let total = -1;
    service.getPrograms({ search: 'grid', status: 'open', offset: 10, limit: 5 }).subscribe((response) => (total = response.total));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs');
    expect(req.request.params.get('search')).toBe('grid');
    expect(req.request.params.get('status')).toBe('open');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.get('limit')).toBe('5');
    req.flush({ data: [], total: 3 } satisfies MentorshipProgramsResponse);
    expect(total).toBe(3);
  });

  it('logs a program list failure by status only, never the search, and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getPrograms({ search: 'secret-name' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne((r) => r.url === '/api/mentorship/admin/programs').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getPrograms failed', { status: 503, statusText: 'Service Unavailable' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-name');
  });

  it('loads the program page from the admin endpoint, encoding the id', () => {
    let page: MentorshipAdminProgramPage | undefined;
    service.getProgram('grid flow').subscribe((value) => (page = value));

    http.expectOne('/api/mentorship/admin/programs/grid%20flow').flush({ program: { id: 'p1' }, tabCounts: {}, terms: [] });
    expect(page?.program.id).toBe('p1');
  });

  it('logs a program page failure by status and lets it reach the caller, a 404 included', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getProgram('nope').subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs/nope').flush('missing', { status: 404, statusText: 'Not Found' });
    expect(status).toBe(404);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getProgram failed', { status: 404, statusText: 'Not Found' });
  });

  it('reads one page of mentees with the set filters as query params', () => {
    let total = -1;
    service
      .getProgramMentees('p1', { type: 'current', status: 'accepted', termId: 'trm_1', search: 'ada', offset: 10, limit: 10 })
      .subscribe((response) => (total = response.total));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentees');
    expect(req.request.params.get('type')).toBe('current');
    expect(req.request.params.get('status')).toBe('accepted');
    expect(req.request.params.get('termId')).toBe('trm_1');
    expect(req.request.params.get('search')).toBe('ada');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ data: [], total: 42 } satisfies MentorshipAdminMenteesResponse);
    expect(total).toBe(42);
  });

  it('keeps a plus in the search text a plus on the wire, for both searches', () => {
    service.getPrograms({ search: 'c++' }).subscribe();
    service.getProgramMentees('p1', { type: 'current', search: 'ada+lfx@mentee.example' }).subscribe();

    const programs = http.expectOne((r) => r.url === '/api/mentorship/admin/programs');
    const mentees = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentees');
    expect(programs.request.urlWithParams).toContain('search=c%2B%2B');
    expect(mentees.request.urlWithParams).toContain('search=ada%2Blfx%40mentee.example');
    programs.flush({ data: [], total: 0 } satisfies MentorshipProgramsResponse);
    mentees.flush({ data: [], total: 0 } satisfies MentorshipAdminMenteesResponse);
  });

  it('leaves unset mentee filters off the query', () => {
    service.getProgramMentees('p1', { type: 'current' }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentees');
    expect(req.request.params.keys()).toEqual(['type']);
    req.flush({ data: [], total: 0 } satisfies MentorshipAdminMenteesResponse);
  });

  it('logs a mentees failure by status only, never the search', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getProgramMentees('p1', { type: 'current', search: 'secret-name' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentees').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-name');
  });

  it('reads one page of mentors with the set filters as query params, encoding the id', () => {
    let total = -1;
    service.getProgramMentors('grid flow', { status: 'active', search: 'ada+lfx', offset: 10, limit: 10 }).subscribe((response) => (total = response.total));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/grid%20flow/mentors');
    expect(req.request.params.get('status')).toBe('active');
    expect(req.request.params.get('search')).toBe('ada+lfx');
    expect(req.request.urlWithParams).toContain('search=ada%2Blfx');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({ data: [], total: 7 } satisfies MentorshipAdminMentorsResponse);
    expect(total).toBe(7);
  });

  it('leaves unset mentor filters off the query', () => {
    service.getProgramMentors('p1', {}).subscribe();

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentors');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ data: [], total: 0 } satisfies MentorshipAdminMentorsResponse);
  });

  it('logs a mentors failure by status only, never the search', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getProgramMentors('p1', { search: 'secret-name' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentors').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getProgramMentors failed', { status: 503, statusText: 'Service Unavailable' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-name');
  });

  it("reads one page of a program's terms with the paging as query params", () => {
    let total = -1;
    service.getProgramTerms('grid flow', { offset: 0, limit: 50 }).subscribe((response) => (total = response.total));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/grid%20flow/terms');
    expect(req.request.params.get('offset')).toBe('0');
    expect(req.request.params.get('limit')).toBe('50');
    req.flush({ data: [], total: 2 } satisfies MentorshipAdminTermsResponse);
    expect(total).toBe(2);
  });

  it("reads one application's tasks from the admin endpoint", () => {
    let tasks: MentorshipApplicantTask[] = [];
    service.getApplicationTasks('app 1').subscribe((value) => (tasks = value));

    http.expectOne('/api/mentorship/admin/applications/app%201/tasks').flush([{ id: 'tsk_1' }]);
    expect(tasks).toEqual([{ id: 'tsk_1' }]);
  });

  it('patches an application status with the attendance type for an accept', () => {
    let done = false;
    service.updateApplicationStatus('app 1', { status: 'accepted', attendanceType: 'full_time' }).subscribe(() => (done = true));

    const req = http.expectOne('/api/mentorship/admin/applications/app%201/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'accepted', attendanceType: 'full_time' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });

  it('withdraws an application on the mentee behalf with an empty body', () => {
    service.withdrawApplication('app_1').subscribe();

    const req = http.expectOne('/api/mentorship/admin/applications/app_1/withdraw');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('declines the pending applications of a term and returns the count', () => {
    let declined = -1;
    service.declinePendingForTerm('prog_1', 'trm_1').subscribe((response) => (declined = response.declinedCount));

    const req = http.expectOne('/api/mentorship/admin/programs/prog_1/terms/trm_1/decline-pending');
    expect(req.request.method).toBe('POST');
    req.flush({ declinedCount: 6 } satisfies MentorshipAdminDeclinePendingResponse);
    expect(declined).toBe(6);
  });

  it('logs a failed decision by status only and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.withdrawApplication('app_1').subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/applications/app_1/withdraw').flush({ message: 'changed' }, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
    expect(JSON.stringify(logged.mock.calls)).toContain('409');
  });
});
