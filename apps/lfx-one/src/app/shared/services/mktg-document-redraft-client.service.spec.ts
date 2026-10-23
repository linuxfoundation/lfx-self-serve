// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import type { MktgObservedRunResult } from '@lfx-one/shared/interfaces';
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
