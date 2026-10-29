// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { UserService } from './user.service';
import { MktgRunAttemptService } from './mktg-run-attempt.service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Member360Service } from './member-360.service';
import { MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import { MktgPendingGeneration } from '@lfx-one/shared/interfaces';

describe('Member360Service dedicated transports', () => {
  let api: Member360Service;
  let http: HttpTestingController;
  const user = signal({ sub: 'synthetic-creator' });
  beforeEach(() => {
    user.set({ sub: 'synthetic-creator' });
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: UserService, useValue: { user } }] });
    api = TestBed.inject(Member360Service);
    http = TestBed.inject(HttpTestingController);
    sessionStorage.clear();
  });
  afterEach(() => http.verify());

  it('retains the minimal creator capability without session storage or tracker prose', () => {
    const session = { sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567', runId: 'a'.repeat(64) };
    let received: unknown;
    api.generate({ project: 'sample-project' }).subscribe((result) => {
      received = result;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/generate');
    expect(request.request.body).toEqual({ project: 'sample-project' });
    request.flush(session);
    expect(received).toEqual(session);
    expect(sessionStorage.length).toBe(0);
    const attempts = TestBed.inject(MktgRunAttemptService);
    const pending = attempts.load('sample-project', 'member-360', session.documentId);
    expect(pending?.attempt?.session.ownerToken).toBe('synthetic-token');
    expect(pending?.request.answers).toEqual({});
    user.set({ sub: 'another-creator' });
    expect(attempts.load('sample-project', 'member-360', session.documentId)).toBeNull();
    http.expectNone('/api/mktg-agents/member-360/result');
  });

  it('adapts question keys to ids and keeps failure answers retryable on the same session', () => {
    const session = { sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567', runId: 'a'.repeat(64) };
    api.generate({ project: 'sample-project' }).subscribe();
    http.expectOne('/api/mktg-agents/member-360/generate').flush(session);
    const pending = TestBed.inject(MktgRunAttemptService).load('sample-project', 'member-360', session.documentId);
    if (!pending) throw new Error('Missing fixture capability');
    const answers = [{ key: 'tracker-window', text: 'Use the current window.', origin: 'accepted' as const }];
    api.answer(pending, 'b'.repeat(64), answers).subscribe({ error: () => undefined });
    const failed = http.expectOne('/api/mktg-agents/member-360/answers');
    expect(failed.request.body).toEqual({
      project: 'sample-project',
      sessionId: 'session-1',
      ownerToken: 'synthetic-token',
      questionsId: 'b'.repeat(64),
      answers: [{ id: 'tracker-window', text: answers[0].text, origin: 'accepted' }],
    });
    failed.flush({}, { status: 503, statusText: 'Unavailable' });
    expect(TestBed.inject(MktgRunAttemptService).load('sample-project', 'member-360', session.documentId)?.answeredQuestionsId).toBeUndefined();
    api.answer(pending, 'b'.repeat(64), answers).subscribe();
    http.expectOne('/api/mktg-agents/member-360/answers').flush({ success: true });
    expect(TestBed.inject(MktgRunAttemptService).load('sample-project', 'member-360', session.documentId)?.answeredQuestionsId).toBe('b'.repeat(64));
  });

  it('uses only public selectors for server-owned runs and never fabricates or persists a capability', () => {
    const pending: MktgPendingGeneration = {
      request: {
        projectUid: 'sample-project',
        agentId: 'member-360',
        documentId: 'run-0123456789abcdef01234567',
        intake: MKTG_AGENT_INTAKES['member-360'],
        answers: {},
      },
      state: 'questions',
      updatedAt: new Date().toISOString(),
    };
    const runId = 'a'.repeat(64);
    api.questions(pending, runId).subscribe();
    const read = http.expectOne('/api/mktg-agents/member-360/result');
    expect(read.request.body).toEqual({ project: 'sample-project', runId });
    read.flush({ status: 'pending' });
    api.answer(pending, 'b'.repeat(64), [{ key: 'window', text: 'Use the current window.', origin: 'accepted' }], runId).subscribe();
    const write = http.expectOne('/api/mktg-agents/member-360/answers');
    expect(write.request.body).toEqual({
      project: 'sample-project',
      runId,
      questionsId: 'b'.repeat(64),
      answers: [{ id: 'window', text: 'Use the current window.', origin: 'accepted' }],
    });
    write.flush({ success: true });
    expect(localStorage.length).toBe(0);
  });
  it('passes URI-encoded tracker filenames in the upload header, never the URL', () => {
    const filename = 'Q3+sponsors — draft.csv';
    api.parseTracker('sample-project', new File(['company\nSample Org'], filename)).subscribe();
    const request = http.expectOne('/api/mktg-agents/member-360/tracker?project=sample-project');
    expect(request.request.headers.get('X-File-Name')).toBe(encodeURIComponent(filename));
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBeInstanceOf(File);
    expect(request.request.urlWithParams).not.toContain('filename');
    request.flush({ filename, rows: [{ company: 'Sample Org' }] });
  });

  it('downloads a stored document through the BFF without sending client tabs', () => {
    const blob = new Blob(['synthetic workbook']);
    let received: Blob | undefined;
    api.download('sample-project', 'run-0123456789abcdef01234567').subscribe((value) => {
      received = value;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/documents/run-0123456789abcdef01234567/workbook?project=sample-project');
    expect(request.request.method).toBe('GET');
    expect(request.request.body).toBeNull();
    expect(request.request.responseType).toBe('blob');
    request.flush(blob);
    expect(received).toBe(blob);
  });
});
