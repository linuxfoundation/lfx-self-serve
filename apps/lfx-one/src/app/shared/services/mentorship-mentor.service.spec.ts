// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipMentorProfileUpdateRequest, MentorshipMentorProfileUpdateResponse, MentorshipMentorRegisterRequest } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MentorshipMentorService } from './mentorship-mentor.service';

describe('MentorshipMentorService — read error mapping', () => {
  let service: MentorshipMentorService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipMentorService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipMentorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
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
    // `MentorshipMentorService` must not silently swallow profile errors, or the profile page
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
    // Unlike MentorshipAdminService.getProgram, getMentorProgram must not swallow 404 into a null fallback.
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

  it('reads the has-profile check', () => {
    let result: unknown = 'unset';
    service.hasMentorProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentor/has-profile').flush({ hasProfile: true });
    expect(result).toEqual({ hasProfile: true });
  });

  it('reads a failed has-profile check as "no profile" so the guard opens the register page', () => {
    let result: unknown = 'unset';
    service.hasMentorProfile().subscribe((response) => {
      result = response;
    });

    http.expectOne('/api/mentorship/mentor/has-profile').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(result).toEqual({ hasProfile: false });
  });

  describe('registerMentorProfile', () => {
    const request: MentorshipMentorRegisterRequest = {
      introduction: '<p>Test intro</p>',
      skills: ['Kubernetes'],
      complianceAccepted: true,
      termsAccepted: true,
    };

    it('posts the request to the mentor profile endpoint and completes after one emission', () => {
      let emissions = 0;
      let completed = false;
      service.registerMentorProfile(request).subscribe({
        next: () => {
          emissions += 1;
        },
        complete: () => {
          completed = true;
        },
      });

      const req = http.expectOne('/api/mentorship/mentor/profile');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(null, { status: 204, statusText: 'No Content' });

      expect(emissions).toBe(1);
      expect(completed).toBe(true);
    });

    it('propagates the raw HttpErrorResponse so the page can read the status and code', () => {
      let error: unknown;
      service.registerMentorProfile(request).subscribe({
        error: (err: unknown) => {
          error = err;
        },
      });

      http.expectOne('/api/mentorship/mentor/profile').flush({ code: 'MENTOR_PROFILE_EXISTS' }, { status: 409, statusText: 'Conflict' });

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(error).toMatchObject({ status: 409, error: { code: 'MENTOR_PROFILE_EXISTS' } });
    });
  });

  describe('updateMentorProfile', () => {
    const request: MentorshipMentorProfileUpdateRequest = { introduction: '<p>Updated</p>', skills: ['Kubernetes'] };
    const response: MentorshipMentorProfileUpdateResponse = { profile: { aboutMe: '<p>Updated</p>', skills: ['Kubernetes'] } };

    it('patches the mentor profile endpoint with the changed fields and emits the saved profile once', () => {
      const emitted: MentorshipMentorProfileUpdateResponse[] = [];
      let completed = false;
      service.updateMentorProfile(request).subscribe({ next: (value) => emitted.push(value), complete: () => (completed = true) });

      const req = http.expectOne('/api/mentorship/mentor/profile');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(request);
      req.flush(response);

      expect(emitted).toEqual([response]);
      expect(completed).toBe(true);
    });

    it('does not drop the cached requests or bump mentorRequestsRevision', () => {
      const revision = service.mentorRequestsRevision();
      service.updateMentorProfile(request).subscribe();

      http.expectOne('/api/mentorship/mentor/profile').flush(response);

      expect(service.mentorRequestsRevision()).toBe(revision);
    });

    it('rethrows the HttpErrorResponse unchanged', () => {
      let error: HttpErrorResponse | undefined;
      service.updateMentorProfile(request).subscribe({ error: (err: HttpErrorResponse) => (error = err) });

      http.expectOne('/api/mentorship/mentor/profile').flush({ error: 'conflict' }, { status: 409, statusText: 'Conflict' });

      expect(error).toBeInstanceOf(HttpErrorResponse);
      expect(error?.status).toBe(409);
      expect(error?.error).toEqual({ error: 'conflict' });
    });
  });

  describe('mentor requests', () => {
    const programId = '7b0f2a52-55a4-4a3e-9d8c-1f3a2b4c5d6e';
    const requests = { data: [{ id: 'app-1', programId, programName: 'Test Program', status: 'pending' as const }], invitedProgramIds: [] };

    it('reads the first page of open programs, sending no empty params', () => {
      let loaded: unknown;
      service.getOpenPrograms().subscribe((response) => (loaded = response));

      const read = http.expectOne((request) => request.url === '/api/mentorship/mentor/open-programs');
      expect(read.request.params.keys()).toEqual([]);
      read.flush({ data: [{ id: programId, name: 'Test Program' }], total: 1 });
      expect(loaded).toEqual({ data: [{ id: programId, name: 'Test Program' }], total: 1 });
    });

    it('sends the search and offset of a later page', () => {
      service.getOpenPrograms({ search: 'kube', offset: 20 }).subscribe();

      const read = http.expectOne((request) => request.url === '/api/mentorship/mentor/open-programs');
      expect(read.request.params.get('search')).toBe('kube');
      expect(read.request.params.get('offset')).toBe('20');
      read.flush({ data: [], total: 20 });
    });

    it('encodes a plus sign in the search, so the BFF does not read it as a space', () => {
      service.getOpenPrograms({ search: 'C++' }).subscribe();

      const read = http.expectOne((request) => request.url === '/api/mentorship/mentor/open-programs');
      expect(read.request.urlWithParams).toContain('search=C%2B%2B');
      read.flush({ data: [], total: 0 });
    });

    it('marks a program unavailable once, however often it is marked', () => {
      expect(service.unavailableProgramIds()).toEqual([]);

      service.markProgramUnavailable(programId);
      service.markProgramUnavailable(programId);

      expect(service.unavailableProgramIds()).toEqual([programId]);
    });

    it('caches the requests until a write clears them, and bumps the revision', () => {
      service.getMentorRequests().subscribe();
      http.expectOne('/api/mentorship/mentor/requests').flush(requests);
      service.getMentorRequests().subscribe();
      http.expectNone('/api/mentorship/mentor/requests');

      const revision = service.mentorRequestsRevision();
      service.requestToMentor(programId).subscribe();
      const post = http.expectOne('/api/mentorship/mentor/requests');
      expect(post.request.method).toBe('POST');
      expect(post.request.body).toEqual({ programId });
      post.flush(null, { status: 204, statusText: 'No Content' });

      expect(service.mentorRequestsRevision()).toBe(revision + 1);
      service.getMentorRequests().subscribe();
      http.expectOne('/api/mentorship/mentor/requests').flush(requests);
    });

    it('does not cache a failed requests read', () => {
      service.getMentorRequests().subscribe({ error: () => undefined });
      http.expectOne('/api/mentorship/mentor/requests').flush('down', { status: 503, statusText: 'Service Unavailable' });

      service.getMentorRequests().subscribe();
      http.expectOne('/api/mentorship/mentor/requests').flush(requests);
    });

    it('withdraws with the encoded request id and clears the cache', () => {
      const revision = service.mentorRequestsRevision();
      service.withdrawMentorRequest('app/1').subscribe();

      const req = http.expectOne('/api/mentorship/mentor/requests/app%2F1/withdraw');
      expect(req.request.method).toBe('POST');
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(service.mentorRequestsRevision()).toBe(revision + 1);
    });

    it('propagates a failed request as the raw HttpErrorResponse, without clearing the cache', () => {
      const revision = service.mentorRequestsRevision();
      let error: HttpErrorResponse | undefined;
      service.requestToMentor(programId).subscribe({ error: (err: HttpErrorResponse) => (error = err) });

      http.expectOne('/api/mentorship/mentor/requests').flush({ error: 'program membership already exists' }, { status: 409, statusText: 'Conflict' });
      expect(error?.status).toBe(409);
      expect(service.mentorRequestsRevision()).toBe(revision);
    });

    it.each(['accept', 'decline'] as const)('answers an invitation with %s, the token in the body, and clears the cache', (decision) => {
      const revision = service.mentorRequestsRevision();
      service.respondToMentorInvite('payload.sig', decision).subscribe();

      const req = http.expectOne(`/api/mentorship/mentor/invites/${decision}`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: 'payload.sig' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(service.mentorRequestsRevision()).toBe(revision + 1);
    });
  });

  describe('updateApplicationNote', () => {
    it('PUTs the note to the encoded application id', () => {
      let done = false;
      service.updateApplicationNote('app/1', 'Strong screening call.').subscribe({ complete: () => (done = true) });

      const req = http.expectOne('/api/mentorship/mentor/applications/app%2F1/note');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ note: 'Strong screening call.' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(done).toBe(true);
    });

    it('propagates a failed save as the raw HttpErrorResponse', () => {
      let error: HttpErrorResponse | undefined;
      service.updateApplicationNote('app-1', '').subscribe({ error: (err: HttpErrorResponse) => (error = err) });

      http.expectOne('/api/mentorship/mentor/applications/app-1/note').flush({ error: 'application not found' }, { status: 404, statusText: 'Not Found' });
      expect(error?.status).toBe(404);
    });
  });

  describe('reviewMenteeTask', () => {
    it.each(['complete', 'incomplete'] as const)('PATCHes %s to the encoded task review path', (status) => {
      let completed = false;
      service.reviewMenteeTask('tsk/1?x', status).subscribe({ complete: () => (completed = true) });

      const req = http.expectOne('/api/mentorship/mentor/tasks/tsk%2F1%3Fx/review');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status });
      req.flush(null, { status: 204, statusText: 'No Content' });
      expect(completed).toBe(true);
    });

    it('propagates a failed review as the raw HttpErrorResponse', () => {
      let error: HttpErrorResponse | undefined;
      service.reviewMenteeTask('tsk-1', 'complete').subscribe({ error: (err: HttpErrorResponse) => (error = err) });

      http
        .expectOne('/api/mentorship/mentor/tasks/tsk-1/review')
        .flush({ error: 'This task is no longer awaiting review.', code: 'TASK_NOT_SUBMITTED' }, { status: 409, statusText: 'Conflict' });
      expect(error?.status).toBe(409);
    });
  });
});
