// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipAdminMenteesResponse, MentorshipAdminProgramPage, MentorshipApplicantTask, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
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

  it("reads one application's tasks from the admin endpoint", () => {
    let tasks: MentorshipApplicantTask[] = [];
    service.getApplicationTasks('app 1').subscribe((value) => (tasks = value));

    http.expectOne('/api/mentorship/admin/applications/app%201/tasks').flush([{ id: 'tsk_1' }]);
    expect(tasks).toEqual([{ id: 'tsk_1' }]);
  });
});
