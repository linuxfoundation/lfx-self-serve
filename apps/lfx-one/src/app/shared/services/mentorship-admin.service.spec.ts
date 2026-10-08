// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE } from '@lfx-one/shared/constants';
import {
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorCandidatesResponse,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipEnrollCreateRequest,
  MentorshipEnrollImport,
  MentorshipEnrollProgramRef,
  MentorshipProgramLogoUploadResult,
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

  it('reads the enroll template from the admin endpoint, encoding the id', () => {
    let name: string | undefined;
    service.getEnrollTemplate('grid flow').subscribe((value) => (name = value.name));

    const req = http.expectOne('/api/mentorship/admin/programs/grid%20flow/enroll-template');
    expect(req.request.method).toBe('GET');
    req.flush({ name: 'Example Program', project: null, technologies: [], skills: [], prerequisites: [] } satisfies Partial<MentorshipEnrollImport>);
    expect(name).toBe('Example Program');
  });

  it('logs an enroll template failure by status and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getEnrollTemplate('nope').subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs/nope/enroll-template').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getEnrollTemplate failed', { status: 503, statusText: 'Service Unavailable' });
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

  it('searches mentor candidates with the search in the POST body, never the URL, encoding the id', () => {
    let names: string[] = [];
    service.getMentorCandidates('grid flow', 'ada+lfx@example.org').subscribe((response) => (names = response.data.map((candidate) => candidate.name)));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs/grid%20flow/mentor-candidates');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ search: 'ada+lfx@example.org' });
    expect(req.request.urlWithParams).not.toContain('example.org');
    req.flush({ data: [{ lfid: 'ada', name: 'Ada Mentor' }] } satisfies MentorshipAdminMentorCandidatesResponse);
    expect(names).toEqual(['Ada Mentor']);
  });

  it('logs a mentor-candidates failure by status only, never the search', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getMentorCandidates('p1', 'secret-name').subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne((r) => r.url === '/api/mentorship/admin/programs/p1/mentor-candidates').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getMentorCandidates failed', { status: 503, statusText: 'Service Unavailable' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-name');
  });

  it('invites a mentor by LFID, encoding the id, and resolves on 204', () => {
    let done = 0;
    service.inviteProgramMentor('prog 1', { lfid: 'ada' }).subscribe(() => done++);

    const req = http.expectOne('/api/mentorship/admin/programs/prog%201/mentors');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ lfid: 'ada' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(1);
  });

  it('passes an invite failure on with its status', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.inviteProgramMentor('p1', { lfid: 'ada' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs/p1/mentors').flush({ error: 'exists' }, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
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

  it('puts a reviewer note for one application, and an empty one to clear it', () => {
    let done = 0;
    service.updateApplicationNote('app 1', 'needs a second look').subscribe(() => done++);
    service.updateApplicationNote('app 1', '').subscribe(() => done++);

    const requests = http.match('/api/mentorship/admin/applications/app%201/note');
    expect(requests.map((req) => [req.request.method, req.request.body])).toEqual([
      ['PUT', { note: 'needs a second look' }],
      ['PUT', { note: '' }],
    ]);
    requests.forEach((req) => req.flush(null, { status: 204, statusText: 'No Content' }));
    expect(done).toBe(2);
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

  it('patches the status of one mentor, with encoded ids', () => {
    let done = 0;
    service.updateProgramMentor('prog 1', 'mem/1', { status: 'withdrawn' }).subscribe(() => done++);

    const req = http.expectOne('/api/mentorship/admin/programs/prog%201/mentors/mem%2F1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'withdrawn' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(1);
  });

  it('posts the program create body and resolves with the program ref', () => {
    const body: MentorshipEnrollCreateRequest = {
      projectId: '3f2c1a9e-7b4d-4c1e-9a55-0d6e8f1a2b3c',
      projectSlug: 'example-project',
      projectName: 'Example Project',
      name: 'Example Program',
      description: '<p>Build things.</p>',
      repositoryUrl: 'https://github.com/example/repo',
      skills: ['Go'],
      terms: [{ name: 'Term 1', startDate: '2030-03-01', endDate: '2030-05-31', applicationStartDate: '2030-01-01', applicationEndDate: '2030-02-28' }],
      prerequisites: [],
      termsAccepted: true,
    };
    let ref: MentorshipEnrollProgramRef | undefined;
    service.createProgram(body).subscribe((value) => (ref = value));

    const req = http.expectOne('/api/mentorship/admin/programs');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ id: 'prog_1', slug: 'example-program', status: 'pending' } satisfies MentorshipEnrollProgramRef);
    expect(ref).toEqual({ id: 'prog_1', slug: 'example-program', status: 'pending' });
  });

  it('logs a failed program create by status only and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.createProgram({ name: 'secret-program' } as MentorshipEnrollCreateRequest).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs').flush({ message: 'bad' }, { status: 400, statusText: 'Bad Request' });

    expect(status).toBe(400);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] createProgram failed', { status: 400, statusText: 'Bad Request' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-program');
  });

  it('uploads the logo file as the raw body with its own content type, encoding the program id', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'secret-logo.png', { type: 'image/png' });
    let logoUrl: string | undefined;
    service.uploadProgramLogo('prog 1', file).subscribe((value) => (logoUrl = value.logoUrl));

    const req = http.expectOne('/api/mentorship/admin/programs/prog%201/logo');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe(file);
    expect(req.request.headers.get('Content-Type')).toBe('image/png');
    req.flush({ logoUrl: 'https://cdn.example/logo.png' } satisfies MentorshipProgramLogoUploadResult);
    expect(logoUrl).toBe('https://cdn.example/logo.png');
  });

  it('logs a failed logo upload by status only and lets a 413 reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = new File([new Uint8Array([1])], 'secret-logo.png', { type: 'image/png' });
    let status: number | undefined;
    service.uploadProgramLogo('prog_1', file).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs/prog_1/logo').flush({ message: 'big' }, { status: 413, statusText: 'Payload Too Large' });

    expect(status).toBe(413);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] uploadProgramLogo failed', { status: 413, statusText: 'Payload Too Large' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-logo');
  });

  describe('uploadProgramLogo retries', () => {
    const logoUrl = '/api/mentorship/admin/programs/prog_1/logo';
    const file = new File([new Uint8Array([1])], 'logo.png', { type: 'image/png' });

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('backs a 403 off by 1 s, 2 s and 4 s, then gives up with the 403', () => {
      let status: number | undefined;
      service.uploadProgramLogo('prog_1', file).subscribe({ error: (err: { status: number }) => (status = err.status) });

      for (const delay of [0, 1000, 2000, 4000]) {
        vi.advanceTimersByTime(delay);
        http.expectOne(logoUrl).flush({}, { status: 403, statusText: 'Forbidden' });
      }

      expect(status).toBe(403);
    });

    it('succeeds when a 403 clears on a later attempt', () => {
      let result: string | undefined;
      service.uploadProgramLogo('prog_1', file).subscribe((value) => (result = value.logoUrl));

      http.expectOne(logoUrl).flush({}, { status: 403, statusText: 'Forbidden' });
      vi.advanceTimersByTime(1000);
      http.expectOne(logoUrl).flush({ logoUrl: 'https://cdn.example/logo.png' });

      expect(result).toBe('https://cdn.example/logo.png');
    });

    it('does not back off the impersonation read-only 403', () => {
      let status: number | undefined;
      service.uploadProgramLogo('prog_1', file).subscribe({ error: (err: { status: number }) => (status = err.status) });

      http.expectOne(logoUrl).flush({ code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE }, { status: 403, statusText: 'Forbidden' });
      vi.advanceTimersByTime(10000);

      http.expectNone(logoUrl);
      expect(status).toBe(403);
    });

    it('does not back a 403 off when retryForbidden is false', () => {
      let status: number | undefined;
      service.uploadProgramLogo('prog_1', file, false).subscribe({ error: (err: { status: number }) => (status = err.status) });

      http.expectOne(logoUrl).flush({}, { status: 403, statusText: 'Forbidden' });
      vi.advanceTimersByTime(10000);

      http.expectNone(logoUrl);
      expect(status).toBe(403);
    });

    it('retries another failure once after a short delay', () => {
      let status: number | undefined;
      service.uploadProgramLogo('prog_1', file).subscribe({ error: (err: { status: number }) => (status = err.status) });

      http.expectOne(logoUrl).flush({}, { status: 502, statusText: 'Bad Gateway' });
      expect(status).toBeUndefined();
      vi.advanceTimersByTime(1000);
      http.expectOne(logoUrl).flush({}, { status: 502, statusText: 'Bad Gateway' });
      vi.advanceTimersByTime(10000);

      http.expectNone(logoUrl);
      expect(status).toBe(502);
    });

    it.each([400, 401, 413, 415])('does not retry a %i', (code) => {
      let status: number | undefined;
      service.uploadProgramLogo('prog_1', file).subscribe({ error: (err: { status: number }) => (status = err.status) });

      http.expectOne(logoUrl).flush({}, { status: code, statusText: 'Refused' });
      vi.advanceTimersByTime(10000);

      http.expectNone(logoUrl);
      expect(status).toBe(code);
    });
  });

  it('logs a failed mentor change by status only and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.updateProgramMentor('prog_1', 'mem_1', { status: 'active' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne('/api/mentorship/admin/programs/prog_1/mentors/mem_1').flush({ message: 'changed' }, { status: 409, statusText: 'Conflict' });

    expect(status).toBe(409);
    expect(JSON.stringify(logged.mock.calls)).toContain('409');
  });
});
