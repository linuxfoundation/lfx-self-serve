// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { MktgObservedRunResult } from '@lfx-one/shared/interfaces';
import { FOUNDATION_MESSAGE_INTAKE, MKTG_RUN_CLOSED, MKTG_RUN_POLL, MKTG_RUN_STORAGE_TTL_MS } from '@lfx-one/shared/constants';
import { mktgCommentFixture, mktgCommentScopeFixture } from '@shared/testing/mktg-comments-test-service';
import { MktgDocumentRedraftClientService } from './mktg-document-redraft-client.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { MktgRunAttemptService } from './mktg-run-attempt.service';
import { MktgAgentRunService } from './mktg-agent-run.service';
import { UserService } from './user.service';
import { ProjectContextService } from './project-context.service';

describe('comments-only redraft transport/recovery', () => {
  const scope = mktgCommentScopeFixture();
  const path = '/api/mktg-agents/documents/foundation-message/living/revise';
  const subject = signal({ sub: 'synthetic-viewer' });
  const project = signal(scope.projectUid);
  const rows = signal([mktgCommentFixture()]);
  const refresh = vi.fn();
  const observe = vi.fn();
  let result: Subject<MktgObservedRunResult>;
  let http: HttpTestingController;
  let client: MktgDocumentRedraftClientService;
  beforeEach(() => {
    window.localStorage.clear();
    subject.set({ sub: 'synthetic-viewer' });
    project.set(scope.projectUid);
    rows.set([mktgCommentFixture()]);
    vi.clearAllMocks();
    result = new Subject();
    observe.mockReturnValue(result);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { user: subject } },
        { provide: ProjectContextService, useValue: { activeContextUid: project } },
        { provide: MktgAgentRunService, useValue: { observeAccepted: observe } },
        {
          provide: MktgDocumentCommentsService,
          useValue: { loaded: () => true, loading: () => false, saving: () => false, selectedScope: () => scope, threads: rows, refresh },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(MktgDocumentRedraftClientService);
    TestBed.tick();
  });
  afterEach(() => http.verify());
  it.each([false, true])('reconciles an expired nonce without POST and drops it only if terminal=%s', (terminal) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    const intent = {
      scope,
      clientRequestId: 'expired-send',
      commentIds: [rows()[0].id],
      priorVersion: 1,
      updatedAt: new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1).toISOString(),
      releaseAllowed: true,
    };
    attempts.saveRedraft(intent);
    rows.set([...rows(), mktgCommentFixture({ id: 'new-open-comment' })]);
    client.resume(scope).subscribe();
    const state = http.expectOne((request) => request.url === `${path}/expired-send/state`);
    expect(state.request.method).toBe('GET');
    expect(state.request.params.get('project')).toBe(scope.projectUid);
    expect(state.request.params.get('revision')).toBe(scope.revisionId);
    state.flush({ terminal });
    expect(client.hasIntent(scope)).toBe(!terminal);
    http.expectNone((request) => request.method === 'POST');
    if (!terminal) {
      client.send(scope, 1).subscribe({ error: () => undefined });
      const retry = http.expectOne(path);
      expect(retry.request.body.clientRequestId).toBe(intent.clientRequestId);
      expect(retry.request.body.commentIds).toEqual(intent.commentIds);
      retry.flush({}, { status: 503, statusText: 'Still uncertain' });
      client.release(scope).subscribe();
      http.expectOne(`${path}/expired-send/release`).flush({ success: true });
      expect(client.hasIntent(scope)).toBe(false);
    }
  });
  it('keeps expired recovery and never posts when the authoritative ledger read fails', () => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.saveRedraft({
      scope,
      clientRequestId: 'expired-send',
      commentIds: [rows()[0].id],
      priorVersion: 1,
      updatedAt: new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1).toISOString(),
    });
    client.resume(scope).subscribe({ error: () => undefined });
    http.expectOne((request) => request.url.endsWith('/expired-send/state')).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(attempts.loadRedraft(scope)?.clientRequestId).toBe('expired-send');
    http.expectNone((request) => request.method === 'POST');
  });
  it('freezes IDs and stores the nonce BEFORE POST; uncertainty/new comments/retry reuse it, restore never posts', () => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    const first = http.expectOne(path);
    const body = first.request.body;
    expect(TestBed.inject(MktgRunAttemptService).loadRedraft(scope)?.clientRequestId).toBe(body.clientRequestId);
    expect(Object.keys(body).sort()).toEqual(['clientRequestId', 'commentIds', 'project', 'revisionId']);
    first.flush({ code: 'MKTG_REDRAFT_START_UNCERTAIN' }, { status: 503, statusText: 'Synthetic uncertain' });
    rows.set([...rows(), mktgCommentFixture({ id: 'new-comment' })]);
    client.resume(scope).subscribe();
    http.expectNone(path);
    client.send(scope, 1).subscribe({ error: () => undefined });
    const retry = http.expectOne(path);
    expect(retry.request.body).toEqual(body);
    retry.flush({ code: 'MKTG_REDRAFT_START_UNCERTAIN' }, { status: 503, statusText: 'Synthetic uncertain' });
  });
  it('deduplicates concurrent clicks, resumes a known ACK without POST and lands only an exact new Draft receipt', () => {
    const progress: string[] = [];
    const first = client.send(scope, 1).subscribe((value) => progress.push(value.type));
    client.send(scope, 1).subscribe();
    const request = http.expectOne(path);
    request.flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 7 });
    expect(TestBed.inject(MktgRunAttemptService).loadRedraft(scope)?.priorVersion).toBe(7);
    expect(observe.mock.calls[0][1].priorVersion).toBe(7);
    expect(client.hasAcceptedAttempt(scope)).toBe(true);
    expect(client.canRelease(scope)).toBe(false);
    first.unsubscribe();
    client.resume(scope).subscribe((value) => progress.push(value.type));
    http.expectNone(path);
    result.next({ terminal: false, result: { status: 'pending', activity: [] } });
    result.next({ terminal: true, result: { status: 'ready', version: 8 } });
    expect(progress).toContain('storing');
    result.next({
      terminal: true,
      result: {
        status: 'ready',
        version: 8,
        persistence: {
          project: scope.projectUid,
          version: 8,
          s3_key: 'synthetic',
          content_sha256: 'b'.repeat(64),
          document_location: { agent_key: scope.agentKey, document_id: 'living', revision_id: `000002-${'b'.repeat(64)}` },
        },
      },
    });
    expect(progress).toContain('ready');
    expect(client.hasIntent(scope)).toBe(false);
    result.complete();
  });
  it('preserves intent on release409 and clears it only after explicit release succeeds', () => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    const post = http.expectOne(path);
    const id = post.request.body.clientRequestId;
    post.flush({}, { status: 503, statusText: 'Synthetic uncertain' });
    client.release(scope).subscribe({ error: () => undefined });
    http.expectOne(`${path}/${id}/release`).flush({ code: 'MKTG_REDRAFT_COMMENTS_BUSY' }, { status: 409, statusText: 'Starting' });
    expect(client.hasIntent(scope)).toBe(true);
    client.release(scope).subscribe();
    http.expectOne(`${path}/${id}/release`).flush({ success: true });
    expect(client.hasIntent(scope)).toBe(false);
    http.expectNone(path);
  });
  it.each([
    [400, 'VALIDATION_ERROR'],
    [404, 'NOT_FOUND'],
    [409, 'MKTG_REDRAFT_COMMENTS_BUSY'],
    [409, 'MKTG_RUN_ACTIVE'],
  ] as const)('clears allow-listed primary %s/%s and lets a new explicit send freeze new open IDs', (status, code) => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    const first = http.expectOne(path);
    const id = first.request.body.clientRequestId;
    first.flush({ code }, { status, statusText: 'Not accepted' });
    expect(client.hasIntent(scope)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    rows.set([mktgCommentFixture({ id: 'new-open-comment' })]);
    client.send(scope, 1).subscribe({ error: () => undefined });
    const next = http.expectOne(path);
    expect(next.request.body.clientRequestId).not.toBe(id);
    expect(next.request.body.commentIds).toEqual(['new-open-comment']);
    next.flush({ code: 'MKTG_REDRAFT_REQUEST_FAILED' }, { status: 409, statusText: 'Failed send' });
    expect(client.hasIntent(scope)).toBe(false);
  });
  it.each([
    [
      'the named sender of the same comments',
      { code: 'MKTG_REDRAFT_COMMENTS_BUSY', sentBy: 'Synthetic sender', sentByViewer: false, sentAt: '2026-10-21T12:00:00.000Z', runId: 'c'.repeat(64) },
      { message: 'Synthetic sender already sent these — the agent is redrafting.', runId: 'c'.repeat(64) },
    ],
    [
      'a send that has no recorded run yet',
      { code: 'MKTG_REDRAFT_COMMENTS_BUSY', sentBy: null, sentByViewer: true, sentAt: '2026-10-21T12:00:00.000Z', runId: null },
      { message: 'You already sent these — the agent is redrafting.', runId: null },
    ],
    [
      'the active run of the document',
      {
        code: 'MKTG_RUN_ACTIVE',
        message: 'A run is in progress.',
        startedBy: 'Synthetic writer',
        startedByViewer: false,
        startedAt: '2026-10-21T12:00:00',
        activeRunId: 'b'.repeat(64),
        state: 'writing',
        agentKey: scope.agentKey,
        documentId: scope.documentId,
      },
      {
        message: "Synthetic writer's Messaging framework run is in progress (started 21 Oct 2026, 12:00). Your comments were not sent.",
        runId: 'b'.repeat(64),
      },
    ],
  ] as const)('answers a 409 that names %s as one elsewhere event, with nothing left to retry or release', (_case, conflict, expected) => {
    const progress: unknown[] = [];
    const failed = vi.fn();
    const done = vi.fn();
    client.send(scope, 1).subscribe({ next: (value) => progress.push(value), error: failed, complete: done });
    http.expectOne(path).flush(conflict, { status: 409, statusText: 'Conflict' });
    expect(progress).toEqual([{ type: 'elsewhere', ...expected }]);
    expect(failed).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
    expect(client.hasIntent(scope)).toBe(false);
    expect(client.canRelease(scope)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(observe).not.toHaveBeenCalled();
    http.expectNone(path);
  });
  it.each([
    { code: 'MKTG_REDRAFT_COMMENTS_BUSY' },
    { code: 'MKTG_RUN_ACTIVE', startedBy: 'Synthetic writer', activeRunId: '../unsafe' },
    { code: 'MKTG_RUN_ACTIVE', startedBy: 'Synthetic writer', activeRunId: 'b'.repeat(64), agentKey: 'faq', documentId: 'living' },
  ])('names nobody and follows no run for an unvalidated conflict %j', (conflict) => {
    const next = vi.fn();
    const failed = vi.fn();
    client.send(scope, 1).subscribe({ next, error: failed });
    http.expectOne(path).flush(conflict, { status: 409, statusText: 'Conflict' });
    expect(next).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(client.hasIntent(scope)).toBe(false);
  });
  it.each([
    [400, 'OTHER_VALIDATION'],
    [404, 'OTHER_NOT_FOUND'],
    [409, 'MKTG_REDRAFT_CONTEXT_CONFLICT'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [503, undefined],
  ] as const)('retains uncertain primary %s/%s with creator release and the original nonce', (status, code) => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    const post = http.expectOne(path);
    const body = post.request.body;
    post.flush(code ? { code } : {}, { status, statusText: 'Unconfirmed' });
    expect(client.hasIntent(scope)).toBe(true);
    expect(client.canRelease(scope)).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    client.resume(scope).subscribe();
    http.expectNone(path);
    client.send(scope, 1).subscribe({ error: () => undefined });
    const retry = http.expectOne(path);
    expect(retry.request.body).toEqual(body);
    retry.flush({ code: 'MKTG_REDRAFT_START_UNCERTAIN' }, { status: 503, statusText: 'Uncertain' });
  });

  it('clears an unknown release after a transport failure without another revise POST', () => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    const post = http.expectOne(path);
    const id = post.request.body.clientRequestId;
    post.error(new ProgressEvent('error'));
    expect(client.canRelease(scope)).toBe(true);
    client.release(scope).subscribe();
    http.expectOne(`${path}/${id}/release`).flush({ state: 'unknown' });
    expect(client.hasIntent(scope)).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);
    http.expectNone(path);
  });
  it('retains accepted attempts after poll4xx and disallows release or another revise POST', () => {
    client.send(scope, 1).subscribe({ error: () => undefined });
    http.expectOne(path).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 });
    result.error(new HttpErrorResponse({ status: 401 }));
    expect(client.hasAcceptedAttempt(scope)).toBe(true);
    expect(client.canRelease(scope)).toBe(false);
    client.release(scope).subscribe({ error: () => undefined });
    http.expectNone((request) => request.url.includes('/release'));
    http.expectNone(path);
  });
  it('ends a redraft whose run the server closed (409 MKTG_RUN_CLOSED): the intent goes, the comments are read again, nothing is re-sent', () => {
    const progress: unknown[] = [];
    const done = vi.fn();
    client.send(scope, 1).subscribe({ next: (event) => progress.push(event), error: done, complete: done });
    http.expectOne(path).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 });
    refresh.mockClear();
    result.error(new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_CLOSED } }));
    expect(progress.at(-1)).toEqual({ type: 'failed', message: 'This redraft was closed. The comments are reopened; send again explicitly.' });
    expect(done).toHaveBeenCalledExactlyOnceWith();
    expect(client.hasAcceptedAttempt(scope)).toBe(false);
    expect(client.hasIntent(scope)).toBe(false);
    expect(window.localStorage.length).toBe(0);
    expect(refresh).toHaveBeenCalledOnce();
    http.expectNone(path);
  });
  it.each(['another window', 'this window'] as const)(
    'leaves a newer send that %s stored for the same revision alone when the closed send hears its late 409',
    (where) => {
      const attempts = TestBed.inject(MktgRunAttemptService);
      const progress: unknown[] = [];
      client.send(scope, 1).subscribe((event) => progress.push(event));
      http.expectOne(path).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 });
      const newer = {
        scope,
        clientRequestId: 'replacement-send',
        commentIds: [rows()[0].id],
        priorVersion: 1,
        updatedAt: new Date().toISOString(),
        attempt: { runId: 'd'.repeat(64), priorVersion: 1, session: { agentId: 'foundation-setup', sessionId: 'newer-session', ownerToken: 'newer-proof' } },
      };
      // Another window keeps its own memory: it shares only storage with this one, which still remembers the closed send.
      const writer = where === 'this window' ? attempts : TestBed.runInInjectionContext(() => new MktgRunAttemptService());
      writer.clearRedraft(scope);
      writer.saveRedraft(newer);
      const stored = Object.values(window.localStorage);
      expect(stored).toHaveLength(1);
      result.error(new HttpErrorResponse({ status: 409, error: { code: MKTG_RUN_CLOSED } }));
      expect(progress.at(-1)).toEqual({ type: 'failed', message: 'This redraft was closed. The comments are reopened; send again explicitly.' });
      // Storage keeps the newer send's recovery ID and owner capability; this window no longer answers with the closed one.
      expect(Object.values(window.localStorage)).toEqual(stored);
      expect(attempts.loadRedraft(scope)).toEqual(newer);
      expect(client.hasAcceptedAttempt(scope)).toBe(true);
      if (where === 'this window') {
        window.localStorage.clear();
        expect(attempts.loadRedraft(scope)).toEqual(newer);
      }
    }
  );
  it('hears the closure on the receipt retry of a ready result with no receipt: the send is settled, with nothing left to retry', () => {
    vi.useFakeTimers();
    try {
      // The real accepted-run observer, over this spec's HTTP backend, in place of the stubbed stream.
      const runs = TestBed.runInInjectionContext(() => new MktgAgentRunService());
      observe.mockImplementation((...args: Parameters<MktgAgentRunService['observeAccepted']>) => runs.observeAccepted(...args));
      const resultPath = FOUNDATION_MESSAGE_INTAKE.endpoints.result;
      const progress: unknown[] = [];
      const done = vi.fn();
      client.send(scope, 1).subscribe({ next: (event) => progress.push(event), error: done, complete: done });
      http.expectOne(path).flush({ sessionId: 'synthetic-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64), priorVersion: 1 });
      vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
      http.expectOne(resultPath).flush({ status: 'ready', version: 2, documentMarkdown: '# Redraft' });
      expect(progress.at(-1)).toEqual({ type: 'storing' });
      expect(client.hasAcceptedAttempt(scope)).toBe(true);
      refresh.mockClear();
      vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
      http.expectOne(resultPath).flush({ code: MKTG_RUN_CLOSED }, { status: 409, statusText: 'Conflict' });
      expect(progress.at(-1)).toEqual({ type: 'failed', message: 'This redraft was closed. The comments are reopened; send again explicitly.' });
      expect(done).toHaveBeenCalledExactlyOnceWith();
      expect(client.hasIntent(scope)).toBe(false);
      expect(window.localStorage.length).toBe(0);
      expect(refresh).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs * 3);
      http.expectNone(resultPath);
      http.expectNone(path);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels on effective-subject change without exposing the prior capability or late landing', () => {
    const next = vi.fn();
    client.send(scope, 1).subscribe(next);
    const request = http.expectOne(path);
    subject.set({ sub: 'other-synthetic-viewer' });
    TestBed.tick();
    expect(request.cancelled).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(client.hasIntent(scope)).toBe(false);
  });
  it('does no browser storage or HTTP work during SSR', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: UserService, useValue: { user: subject } },
        { provide: ProjectContextService, useValue: { activeContextUid: project } },
        { provide: MktgAgentRunService, useValue: {} },
        { provide: MktgDocumentCommentsService, useValue: {} },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const server = TestBed.inject(MktgDocumentRedraftClientService);
    const next = vi.fn();
    server.send(scope, 1).subscribe(next);
    server.resume(scope).subscribe(next);
    server.release(scope).subscribe(next);
    expect(next).not.toHaveBeenCalled();
    http.expectNone(path);
  });
});
