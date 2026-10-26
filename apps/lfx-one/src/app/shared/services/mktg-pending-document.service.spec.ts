// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AEO_GEO_INTAKE,
  AEO_GEO_REFUSAL_MAX_CHARS,
  MKTG_PENDING_DOCUMENT_STORAGE_PREFIX,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import { MktgPendingDocumentRun, MktgRunResultResponse } from '@lfx-one/shared/interfaces';
import { NEVER, of, take, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from './user.service';
import { MktgPendingDocumentService, MktgRunRefusalError } from './mktg-pending-document.service';

const DOCUMENT_ID = 'run-012345678901234567890123';
function run(): MktgPendingDocumentRun {
  return {
    agentId: AEO_GEO_INTAKE.agentId,
    projectUid: 'project-1',
    documentId: DOCUMENT_ID,
    sessionId: 'session-1',
    ownerToken: 'owner-proof',
    savedAt: new Date().toISOString(),
  };
}

describe('MktgPendingDocumentService', () => {
  const user = signal({ sub: 'synthetic-user' });
  let post: ReturnType<typeof vi.fn>;
  let service: MktgPendingDocumentService;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    user.set({ sub: 'synthetic-user' });
    post = vi.fn(() => of({ sessionId: 'session-1', ownerToken: 'owner-proof', documentId: DOCUMENT_ID }));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { post } },
        { provide: UserService, useValue: { user } },
      ],
    });
    service = TestBed.inject(MktgPendingDocumentService);
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('starts every audit as a fresh session and saves the destination before navigation', () => {
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    expect(post).toHaveBeenCalledWith(AEO_GEO_INTAKE.endpoints.generate, { project: 'project-1', answers: { domain: 'project.example' } });
    expect(service.load('project-1', DOCUMENT_ID)).toMatchObject(run());
    const resumed = TestBed.runInInjectionContext(() => new MktgPendingDocumentService());
    expect(resumed.load('project-1', DOCUMENT_ID)?.ownerToken).toBe('owner-proof');
  });
  it('finds the active research run after reload and persists its writing handoff within the same user scope', () => {
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    const restored = TestBed.runInInjectionContext(() => new MktgPendingDocumentService());
    expect(restored.loadActive('project-1', AEO_GEO_INTAKE.agentId)).toMatchObject({ documentId: DOCUMENT_ID });
    expect(restored.markWriting(run())).toBe(true);
    expect(restored.loadActive('project-1', AEO_GEO_INTAKE.agentId)?.phase).toBe('writing');
    user.set({ sub: 'another-user' });
    expect(restored.loadActive('project-1', AEO_GEO_INTAKE.agentId)).toBeNull();
    expect(restored.markWriting(run())).toBe(false);
  });
  it('posts answers to the existing session and document without generating again', () => {
    const answers = [{ id: 'audience', text: 'Platform engineers.', origin: 'requester' as const }];
    service.answerQuestions(run(), AEO_GEO_INTAKE, answers).subscribe();
    expect(post).toHaveBeenCalledExactlyOnceWith(AEO_GEO_INTAKE.endpoints.answers, {
      project: 'project-1',
      documentId: DOCUMENT_ID,
      sessionId: 'session-1',
      ownerToken: 'owner-proof',
      answers,
    });
  });
  it.each(['refused', 'bad-request', 'timeout'])('handles a writing %s with terminal cleanup or resumable timeout', (failure) => {
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    service.markWriting(run());
    if (failure === 'refused') post.mockReturnValue(of({ status: 'refused', reply: 'x'.repeat(AEO_GEO_REFUSAL_MAX_CHARS + 100) }));
    else if (failure === 'bad-request') post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    else post.mockReturnValue(NEVER);
    const error = vi.fn();
    service.waitForStorage(run(), AEO_GEO_INTAKE).subscribe({ error });
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs);
    expect(error).toHaveBeenCalledOnce();
    if (failure === 'refused') {
      expect(error.mock.calls[0][0]).toBeInstanceOf(MktgRunRefusalError);
      expect(error.mock.calls[0][0].message).toHaveLength(AEO_GEO_REFUSAL_MAX_CHARS);
    }
    const reloaded = TestBed.runInInjectionContext(() => new MktgPendingDocumentService());
    if (failure === 'timeout') {
      expect(service.loadActive('project-1', AEO_GEO_INTAKE.agentId)?.phase).toBe('writing');
      expect(reloaded.loadActive('project-1', AEO_GEO_INTAKE.agentId)?.phase).toBe('writing');
      post.mockReturnValue(of({ status: 'ready', persistence: { project: 'project-1' } }));
      const done = vi.fn();
      reloaded.waitForStorage(run(), AEO_GEO_INTAKE).subscribe(done);
      vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
      expect(done).toHaveBeenCalledOnce();
    } else {
      expect(service.loadActive('project-1', AEO_GEO_INTAKE.agentId)).toBeNull();
      expect(reloaded.loadActive('project-1', AEO_GEO_INTAKE.agentId)).toBeNull();
    }
  });

  it('marks a transient fallback distinctly from the next real pending result', () => {
    post.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 }))).mockReturnValueOnce(of({ status: 'pending' }));
    const values: MktgRunResultResponse[] = [];
    service
      .poll(run(), AEO_GEO_INTAKE)
      .pipe(take(2))
      .subscribe((value) => values.push(value));
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
    expect(values).toEqual([{ status: 'pending', transient: true }, { status: 'pending' }]);
  });

  it('ends a stalled poll at the wall-clock deadline', () => {
    post.mockReturnValue(NEVER);
    const error = vi.fn();
    service.poll(run(), AEO_GEO_INTAKE).subscribe({ error });
    vi.advanceTimersByTime(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs + MKTG_RUN_POLL.initialDelayMs);
    expect(error).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledOnce();
  });
  it('isolates capabilities by user, project and document and expires them', () => {
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    expect(service.load('project-2', DOCUMENT_ID)).toBeNull();
    user.set({ sub: 'another-synthetic-user' });
    expect(service.load('project-1', DOCUMENT_ID)).toBeNull();
    user.set({ sub: 'synthetic-user' });
    vi.advanceTimersByTime(MKTG_RUN_STORAGE_TTL_MS + 1);
    expect(service.load('project-1', DOCUMENT_ID)).toBeNull();
  });
  it.each(['start', 'load'] as const)('sweeps abandoned and corrupt records across this user’s projects on %s', (operation) => {
    const prefix = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:synthetic-user:`;
    const expired = new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1).toISOString();
    localStorage.setItem(`${prefix}other-project:abandoned`, JSON.stringify({ ...run(), savedAt: expired }));
    localStorage.setItem(`${prefix}other-project:corrupt`, '{broken JSON');
    localStorage.setItem(`${prefix}other-project:undated`, JSON.stringify({ ownerToken: 'old-proof' }));
    const otherUser = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:other-user:project:abandoned`;
    localStorage.setItem(otherUser, JSON.stringify({ ...run(), savedAt: expired }));
    if (operation === 'start') {
      service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    } else {
      service.load('project-1', DOCUMENT_ID);
    }
    expect(localStorage.getItem(`${prefix}other-project:abandoned`)).toBeNull();
    expect(localStorage.getItem(`${prefix}other-project:corrupt`)).toBeNull();
    expect(localStorage.getItem(`${prefix}other-project:undated`)).toBeNull();
    expect(localStorage.getItem(otherUser)).not.toBeNull();
  });
  it('removes a corrupt exact record instead of keeping its capability at rest', () => {
    const key = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:synthetic-user:project-1:${DOCUMENT_ID}`;
    localStorage.setItem(key, '{broken JSON');
    expect(service.load('project-1', DOCUMENT_ID)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('prunes expired in-memory capabilities when a different document is started', () => {
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    vi.advanceTimersByTime(MKTG_RUN_STORAGE_TTL_MS + 1);
    post.mockReturnValue(of({ sessionId: 'session-2', ownerToken: 'new-proof', documentId: 'run-999999999999999999999999' }));
    service.start(AEO_GEO_INTAKE, 'project-1', { domain: 'project.example' }).subscribe();
    expect(service.load('project-1', DOCUMENT_ID)).toBeNull();
  });
  it('requires a persistence receipt and tolerates transient poll errors', () => {
    const ready: MktgRunResultResponse = { status: 'ready', documentMarkdown: '# Report', version: 1 };
    post
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })))
      .mockReturnValueOnce(of(ready))
      .mockReturnValueOnce(of({ ...ready, persistence: { project: 'project-1' } }));
    const done = vi.fn();
    service.waitForStorage(run(), AEO_GEO_INTAKE).subscribe(done);
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs);
    expect(done).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(AEO_GEO_INTAKE.endpoints.result, { sessionId: 'session-1', ownerToken: 'owner-proof', project: 'project-1' });
  });
  it('forwards optional activity before storage without completing the pending run', () => {
    const activity = [{ id: 'step-1', kind: 'reading', label: 'Reading project.example', status: 'running', startedAt: '2026-10-19T10:00:00Z' }];
    post.mockReturnValueOnce(of({ status: 'pending', activity })).mockReturnValueOnce(of({ status: 'pending' }));
    const onActivity = vi.fn();
    const done = vi.fn();
    const subscription = service.waitForStorage(run(), AEO_GEO_INTAKE, onActivity).subscribe(done);
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
    expect(onActivity).toHaveBeenCalledExactlyOnceWith(activity);
    expect(done).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
  it('does not forward activity when the intake has not opted into a live feed', () => {
    post.mockReturnValue(of({ status: 'pending', activity: [] }));
    const onActivity = vi.fn();
    const subscription = service.waitForStorage(run(), { ...AEO_GEO_INTAKE, liveActivity: false }, onActivity).subscribe();
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    expect(onActivity).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });
  it('fails fast on owner-proof or entitlement denial', () => {
    post.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const error = vi.fn();
    service.waitForStorage(run(), AEO_GEO_INTAKE).subscribe({ error });
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
