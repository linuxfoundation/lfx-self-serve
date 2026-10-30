// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FOUNDATION_MESSAGE_INTAKE,
  ICP_INTAKE,
  LINKEDIN_POST_INTAKE,
  MKTG_RUN_FAILURE_REASON,
  MKTG_RUN_ACTIVE,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_KEY_PREFIX,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  MktgAgentIntake,
  MktgFrameworkAsset,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgPendingGeneration,
  MktgRunActivity,
  MktgRunQuestion,
  MktgRunQuestionsPending,
  MktgRunResultResponse,
  MktgStoredAgentRun,
  MktgDocumentPersistLocation,
  User,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { ProjectContextService } from '@services/project-context.service';
import { concatMap, NEVER, of, Subject, throwError, TimeoutError, timer } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgAgentRunService } from './mktg-agent-run.service';
import { MktgRunAttemptService } from './mktg-run-attempt.service';

/**
 * The generic chat follow-up intake: the ICP's form (a batch preamble, a flat
 * question list, a persisting result) without its regenerate-via-generate
 * flag, so the default path — a chat follow-up on the stored session — is
 * what these cases exercise. No catalog intake takes that path any more.
 */
const CHAT_INTAKE: MktgAgentIntake = { ...ICP_INTAKE, regenerateViaGenerate: undefined, attachments: undefined };

/**
 * Locks the run flow to the real BFF contract: the validated generate/result
 * endpoint pair is always POSTed with the owner token in the BODY (never a GET,
 * never a query string), regenerations ride the chat/session contract on the
 * stored session, and only a `ready` result with a strictly newer envelope
 * version is accepted as the document — a stale prior draft or `pending` poll
 * must never be stored as a new version. Stored runs are keyed to the
 * EFFECTIVE user's sub (impersonation swaps `user()` with no reload), and a
 * follow-up whose stored session the server rejects (401/403 — the HMAC-bound
 * ownerToken no longer verifies) must drop the session and fall back to a
 * fresh run instead of dead-ending every subsequent submit.
 */
describe('MktgAgentRunService', () => {
  const USER_SUB = 'auth0|user-1';
  const STORAGE_KEY = `${MKTG_RUN_STORAGE_KEY_PREFIX}:${USER_SUB}:proj-1:brand-kit`;
  const ANSWERS: Record<string, string> = Object.fromEntries(CHAT_INTAKE.fields.map((field) => [field.key, `Answer for ${field.key}`]));

  let service: MktgAgentRunService;
  let userSignal: WritableSignal<User | null>;
  let projectUid: WritableSignal<string>;
  let httpPost: ReturnType<typeof vi.fn>;
  /** Result-endpoint responses, consumed one per poll (last one repeats). An HttpErrorResponse entry makes that poll attempt error. */
  let resultResponses: (MktgRunResultResponse | HttpErrorResponse)[];
  /** When > 0, each result-endpoint response resolves only after this many fake-timer ms — simulates a slow poll. */
  let resultDelayMs: number;
  /** When set, the chat endpoint errors with this instead of succeeding. */
  let chatError: HttpErrorResponse | null;

  const generateRequest = (feedback?: string): MktgGenerateRequest => ({
    agentId: 'brand-kit',
    projectUid: 'proj-1',
    intake: CHAT_INTAKE,
    answers: ANSWERS,
    feedback,
  });

  const storedV1Run = (): MktgStoredAgentRun => ({
    agentId: 'brand-kit',
    projectUid: 'proj-1',
    sessionId: 'sess-1',
    ownerToken: 'token-1',
    answers: ANSWERS,
    versions: [{ version: 1, document: '# v1', createdAt: '2026-08-19T00:00:00.000Z' }],
    // Freshly saved — well inside the storage TTL (fake timers pin Date.now to real time).
    savedAt: new Date().toISOString(),
  });

  it.each(['provider', 'idle'] as const)('stops on %s failure without losing history and retries with a fresh session', (kind) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    const failure =
      kind === 'provider'
        ? { eventType: 'runtime_error', reason: 'The agent could not complete this run. Retry.' }
        : { eventType: 'session_failed', reason: MKTG_RUN_FAILURE_REASON };
    resultResponses = [kind === 'provider' ? { status: 'failed', failure } : { status: 'failed', failureText: 'Synthetic idle-runtime reply.' }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toEqual([{ type: 'submitted' }, { type: 'failed', failureText: kind === 'provider' ? '' : 'Synthetic idle-runtime reply.', failure }]);
    expect(service.loadRun('proj-1', 'brand-kit')).toMatchObject({ sessionFailed: true, versions: storedV1Run().versions });
    httpPost.mockClear();
    vi.advanceTimersByTime(MKTG_RUN_POLL.intervalMs * 2);
    expect(httpPost).not.toHaveBeenCalled();
    resultResponses = [{ status: 'ready', version: 2, documentMarkdown: '# v2' }];
    service.generate(generateRequest('Keep this feedback.')).subscribe();
    expect(httpPost).toHaveBeenCalledWith(
      CHAT_INTAKE.endpoints.generate,
      expect.objectContaining({ answers: ANSWERS, priorVersion: 1, feedback: 'Keep this feedback.' })
    );
    expect(httpPost).not.toHaveBeenCalledWith('/api/mktg-agents/chat', expect.anything());
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs);
    expect(service.loadRun('proj-1', 'brand-kit')?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(service.loadRun('proj-1', 'brand-kit')?.sessionFailed).toBeUndefined();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    resultResponses = [];
    resultDelayMs = 0;
    chatError = null;
    userSignal = signal<User | null>({ sub: USER_SUB } as User);
    projectUid = signal('proj-1');
    httpPost = vi.fn((url: string) => {
      if (url === CHAT_INTAKE.endpoints.generate) {
        return of({ sessionId: 'sess-1', ownerToken: 'token-1' });
      }
      if (url === '/api/mktg-agents/chat') {
        return chatError ? throwError(() => chatError) : of({ success: true });
      }
      if (url === CHAT_INTAKE.endpoints.result) {
        const next = resultResponses.length > 1 ? resultResponses.shift() : resultResponses[0];
        const response$ = next instanceof HttpErrorResponse ? throwError(() => next) : of(next ?? { status: 'pending' });
        return resultDelayMs > 0 ? timer(resultDelayMs).pipe(concatMap(() => response$)) : response$;
      }
      throw new Error(`Unexpected POST to ${url}`);
    });
    TestBed.configureTestingModule({
      providers: [
        // Only `post` exists on the mock — any GET (the bug this spec guards
        // against) or other verb fails loudly instead of silently passing.
        { provide: HttpClient, useValue: { post: httpPost } },
        { provide: UserService, useValue: { user: userSignal } },
        { provide: ProjectContextService, useValue: { activeContextUid: projectUid } },
      ],
    });
    service = TestBed.inject(MktgAgentRunService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('observes an accepted redraft with the existing receipt budget without generating or overwriting intake history', async () => {
    const original = storedV1Run();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
    const result: MktgRunResultResponse = { status: 'ready', version: 2, documentMarkdown: '# Redraft' };
    resultResponses = [
      result,
      {
        ...result,
        persistence: {
          project: 'proj-1',
          version: 2,
          s3_key: 'synthetic',
          content_sha256: 'b'.repeat(64),
          document_location: { agent_key: 'brand-kit', document_id: 'living', revision_id: `000002-${'b'.repeat(64)}` },
        },
      },
    ];
    const received: MktgRunResultResponse[] = [];
    service
      .observeAccepted(
        CHAT_INTAKE,
        { session: { agentId: 'brand-kit', sessionId: 'accepted-session', ownerToken: 'synthetic-proof' }, priorVersion: 1 },
        'proj-1'
      )
      .subscribe((event) => received.push(event.result));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs * 2);
    expect(received).toHaveLength(2);
    expect(received[0].persistence).toBeUndefined();
    expect(received[1].persistence).toBeDefined();
    expect(httpPost.mock.calls.every(([url]) => url === CHAT_INTAKE.endpoints.result)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(original);
  });

  it('never POSTs a dedicated one-off Generate through the shared resume service', () => {
    const error = vi.fn();
    service.generate({ ...generateRequest(), agentId: LINKEDIN_POST_INTAKE.agentId, intake: LINKEDIN_POST_INTAKE }).subscribe({ error });
    expect(error).toHaveBeenCalled();
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('resumes an accepted one-off with only session proof, preserves its receipt/profile warning, and never persists personalized history', async () => {
    const intake = LINKEDIN_POST_INTAKE;
    const documentId = 'run-' + 'a'.repeat(24);
    const request = { ...generateRequest(), agentId: intake.agentId, intake, documentId, answers: { content_text: 'private-source-marker' } };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.prepareAccepted(request, { documentId, runId: 'b'.repeat(64), sessionId: 'oneoff-session', ownerToken: 'oneoff-proof' });
    const pending = attempts.load(request.projectUid, intake.agentId, documentId);
    if (!pending) throw new Error('Missing synthetic accepted attempt');
    const receipt = {
      project: request.projectUid,
      version: 1,
      s3_key: 'synthetic-key',
      content_sha256: 'c'.repeat(64),
      document_location: { agent_key: 'linkedin-post' as const, document_id: documentId, revision_id: '000001-' + 'c'.repeat(64) },
    };
    httpPost.mockReturnValue(of({ status: 'ready', version: 1, documentMarkdown: '# private-personalized-marker', profileSaved: false, persistence: receipt }));
    const events: MktgGenerateProgress[] = [];
    service.resume(pending).subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(httpPost).toHaveBeenCalledExactlyOnceWith(intake.endpoints.result, {
      sessionId: 'oneoff-session',
      ownerToken: 'oneoff-proof',
      project: request.projectUid,
    });
    expect(events.at(-1)).toMatchObject({ type: 'document', profileSaved: false, documentLocation: { agentKey: 'linkedin-post', documentId } });
    expect(localStorage.length).toBe(0);
    expect(service.loadRun(request.projectUid, intake.agentId)).toBeNull();
    expect(service.loadRun(request.projectUid, intake.agentId, documentId)?.versions[0].document).toContain('private-personalized-marker');
    expect(service.loadRun(request.projectUid, intake.agentId, 'run-' + 'd'.repeat(24))).toBeNull();
    expect(TestBed.runInInjectionContext(() => new MktgAgentRunService()).loadRun(request.projectUid, intake.agentId, documentId)).toBeNull();
  });

  it('ignores a reloaded one-off answered digest without retaining private Q&A or posting answers again', async () => {
    const intake = LINKEDIN_POST_INTAKE;
    const documentId = 'run-' + 'a'.repeat(24);
    const request = { ...generateRequest(), agentId: intake.agentId, intake, documentId, answers: {} };
    const attempts = TestBed.inject(MktgRunAttemptService);
    attempts.prepareAccepted(request, { documentId, runId: 'b'.repeat(64), sessionId: 'oneoff-session', ownerToken: 'oneoff-proof' });
    const pending = attempts.load(request.projectUid, intake.agentId, documentId);
    if (!pending) throw new Error('Missing synthetic accepted attempt');
    attempts.save({ ...pending, answeredQuestionsId: 'c'.repeat(64) });
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load(request.projectUid, intake.agentId, documentId);
    if (!restored) throw new Error('Missing synthetic reload proof');
    httpPost
      .mockReturnValueOnce(of({ status: 'questions', questionsId: 'c'.repeat(64), questions: [{ key: 'gap', question: 'private-question-marker' }] }))
      .mockReturnValue(of({ status: 'failed', failureText: 'Synthetic stopped run' }));
    const events: MktgGenerateProgress[] = [];
    service.resume(restored).subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
    expect(events.some((event) => event.type === 'questions')).toBe(false);
    expect(events.at(-1)?.type).toBe('failed');
    expect(httpPost.mock.calls.every(([url]) => url === intake.endpoints.result)).toBe(true);
    const serialized = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index) ?? '')).join('');
    expect(serialized).not.toContain('private-question-marker');
  });

  it.each([
    ['foundation-setup', 'foundation-message'],
    ['linkedin-post', 'linkedin-post'],
  ])('reads %s scalar history using its catalog key, never a POST', (agentId, key) => {
    const get = vi.fn(() => of({ intake: null }));
    Object.assign(TestBed.inject(HttpClient), { get });
    const received = vi.fn();
    service.lastIntake('synthetic-project', agentId).subscribe(received);
    expect(get).toHaveBeenCalledWith(`/api/mktg-agents/intakes/${key}/last`, { params: { project: 'synthetic-project' }, transferCache: false });
    expect(received).toHaveBeenCalledWith(null);
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('propagates unavailable history instead of inventing empty prefill', () => {
    const failure = new HttpErrorResponse({ status: 503 });
    Object.assign(TestBed.inject(HttpClient), { get: vi.fn(() => throwError(() => failure)) });
    const error = vi.fn();
    service.lastIntake('synthetic-project', 'brand-kit').subscribe({ error });
    expect(error).toHaveBeenCalledWith(failure);
  });

  it('keeps the Generate ACK subscribed after its page leaves, tracks the attempt and does not poll without a page', () => {
    const ack = new Subject<{ sessionId: string; ownerToken: string; runId: string }>();
    httpPost.mockReturnValueOnce(ack);
    const attempts = TestBed.inject(MktgRunAttemptService);
    const page = service.generate(generateRequest()).subscribe();
    expect(attempts.load('proj-1', 'brand-kit')?.state).toBe('draft');
    page.unsubscribe();
    expect(ack.observed).toBe(true);
    ack.next({ sessionId: 'synthetic-accepted', ownerToken: 'synthetic-proof', runId: 'b'.repeat(64) });
    expect(attempts.load('proj-1', 'brand-kit')).toMatchObject({ state: 'writing', attempt: { runId: 'b'.repeat(64) } });
    expect(service.acknowledgementVersion()).toBe(1);
    expect(ack.observed).toBe(false); // The held leg drops at its first ACK.
    vi.advanceTimersByTime(MKTG_RUN_POLL.initialDelayMs * 2);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.generate)).toHaveLength(1);
    expect(httpPost.mock.calls.some(([url]) => url === CHAT_INTAKE.endpoints.result)).toBe(false);
  });

  it('records a failed ACK even after the page unsubscribes', () => {
    const ack = new Subject<never>();
    httpPost.mockReturnValueOnce(ack);
    const page = service.generate(generateRequest()).subscribe({ error: vi.fn() });
    page.unsubscribe();
    ack.error(new HttpErrorResponse({ status: 503 }));
    expect(TestBed.inject(MktgRunAttemptService).load('proj-1', 'brand-kit')?.state).toBe('failed');
    expect(ack.observed).toBe(false);
    expect(service.acknowledgementVersion()).toBe(0);
  });

  it.each(['subject', 'project'] as const)('drops a held ACK on %s change without recording it in the new scope', (change) => {
    const ack = new Subject<{ sessionId: string; ownerToken: string; runId: string }>();
    httpPost.mockReturnValueOnce(ack);
    const page = service.generate(generateRequest()).subscribe();
    page.unsubscribe();
    TestBed.tick();
    if (change === 'subject') userSignal.set({ sub: 'synthetic-other-subject' } as User);
    else projectUid.set('synthetic-other-project');
    TestBed.tick();
    expect(ack.observed).toBe(false);
    ack.next({ sessionId: 'synthetic-late-session', ownerToken: 'synthetic-late-proof', runId: 'c'.repeat(64) });
    expect(service.acknowledgementVersion()).toBe(0);
    expect(TestBed.inject(MktgRunAttemptService).load(projectUid(), 'brand-kit')?.attempt).toBeUndefined();
  });

  it('does not cancel a new-project POST because the scope observable still replays the prior project', () => {
    TestBed.tick();
    projectUid.set('synthetic-next-project'); // Generate may happen before toObservable's effect flushes.
    const ack = new Subject<{ sessionId: string; ownerToken: string; runId: string }>();
    httpPost.mockReturnValueOnce(ack);
    const page = service.generate({ ...generateRequest(), projectUid: projectUid() }).subscribe();
    expect(ack.observed).toBe(true);
    page.unsubscribe();
    ack.next({ sessionId: 'synthetic-new-project', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64) });
    expect(TestBed.inject(MktgRunAttemptService).load(projectUid(), 'brand-kit')).toMatchObject({ state: 'writing', attempt: { runId: 'c'.repeat(64) } });
  });

  it('replays a fully retained direct-start body after 409, adding only the explicit discard ID', () => {
    const request: MktgGenerateRequest = {
      ...generateRequest(),
      documents: [{ kind: 'file', title: 'Synthetic source', text: 'Synthetic retained bytes.' }],
      logoFiles: [{ name: 'synthetic.svg', text: '<svg />' }],
    };
    const conflict = {
      code: MKTG_RUN_ACTIVE,
      message: 'Another writer has a run in progress.',
      activeRunId: 'b'.repeat(64),
      state: 'writing',
      agentKey: 'brand-kit',
      documentId: 'living',
      startedBy: 'Another writer',
      startedByViewer: false,
      startedAt: '2026-10-19T12:00:00.000Z',
    };
    const failure = new HttpErrorResponse({ status: 409, error: conflict });
    httpPost.mockReturnValueOnce(throwError(() => failure));
    const error = vi.fn();
    service.generate(request).subscribe({ error });
    expect(error).toHaveBeenCalledWith(failure);
    expect(service.activeRunConflict(failure, request)).toEqual(conflict);
    const retained = TestBed.inject(MktgRunAttemptService).load(request.projectUid, request.agentId)?.request;
    if (!retained) throw new Error('Missing synthetic retained start');
    expect(service.canRetryActiveConflict(retained)).toBe(true);
    expect(JSON.stringify({ ...localStorage })).not.toContain('Synthetic retained bytes.');
    const originalBody = httpPost.mock.calls[0][1];
    httpPost.mockReturnValueOnce(throwError(() => failure));
    service.recheckActiveConflict(retained).subscribe({ error });
    expect(httpPost.mock.calls[1][1]).toEqual(originalBody);
    expect(httpPost.mock.calls[1][1]).not.toHaveProperty('discard');
    httpPost.mockReturnValueOnce(of({ sessionId: 'synthetic-new-session', ownerToken: 'synthetic-proof', runId: 'c'.repeat(64) }));
    const retry = service.generate(retained, conflict.activeRunId).subscribe();
    expect(httpPost.mock.calls[2][1]).toEqual({ ...originalBody, discard: conflict.activeRunId });
    retry.unsubscribe();
  });

  it.each(['missing-body', 'reattach'] as const)('refuses silent replay when %s makes the original start unreconstructible', (kind) => {
    const request = generateRequest();
    if (kind === 'reattach')
      TestBed.inject(MktgRunAttemptService).save({ request, state: 'failed', requiresReattachment: true, updatedAt: new Date().toISOString() });
    expect(service.canRetryActiveConflict(request)).toBe(false);
    const error = vi.fn();
    service.generate(request, 'b'.repeat(64)).subscribe({ error });
    expect(error).toHaveBeenCalledOnce();
    expect(httpPost).not.toHaveBeenCalled();
  });

  it('retains the actual priorVersion and feedback rather than rebuilding a retry from changed version history', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    const request = { ...generateRequest('Retained synthetic feedback'), intake: { ...CHAT_INTAKE, regenerateViaGenerate: true } };
    httpPost.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
    service.generate(request).subscribe({ error: vi.fn() });
    const body = httpPost.mock.calls[0][1];
    expect(body).toMatchObject({ priorVersion: 1, feedback: 'Retained synthetic feedback' });
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...storedV1Run(),
        versions: [...storedV1Run().versions, { ...storedV1Run().versions[0], version: 2, document: 'Other synthetic version' }],
      })
    );
    httpPost.mockReturnValueOnce(of({ sessionId: 'synthetic-retry', ownerToken: 'synthetic-proof' }));
    const retry = service.generate(request, 'b'.repeat(64)).subscribe();
    expect(httpPost.mock.calls[1][1]).toEqual({ ...body, discard: 'b'.repeat(64) });
    retry.unsubscribe();
  });

  it('allows an explicit reviewed fresh request to carry discard without claiming an identical-body replay', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    const request = { ...generateRequest(), newRun: true, discard: 'b'.repeat(64) };
    const start = service.generate(request).subscribe();
    expect(httpPost).toHaveBeenCalledWith(
      CHAT_INTAKE.endpoints.generate,
      expect.objectContaining({ answers: ANSWERS, project: 'proj-1', discard: request.discard })
    );
    expect(httpPost).not.toHaveBeenCalledWith('/api/mktg-agents/chat', expect.anything());
    start.unsubscribe();
  });

  it.each([
    { code: 'OTHER' },
    { activeRunId: 'not-an-opaque-run' },
    { state: 'failed' },
    { agentKey: 'synthetic-other' },
    { documentId: 'other' },
    { startedBy: undefined },
    { startedByViewer: undefined },
    { startedByViewer: 'true' },
  ])('rejects malformed or out-of-scope active conflict metadata: %j', (override) => {
    const body = {
      code: MKTG_RUN_ACTIVE,
      message: 'Synthetic conflict',
      activeRunId: 'b'.repeat(64),
      state: 'writing',
      agentKey: 'brand-kit',
      documentId: 'living',
      startedBy: 'Another writer',
      startedByViewer: false,
      startedAt: '2026-10-19T12:00:00.000Z',
      ...override,
    };
    expect(service.activeRunConflict(new HttpErrorResponse({ status: 409, error: body }), generateRequest())).toBeNull();
  });

  it('starts a new session without changing previous history before any result arrives', () => {
    const original = JSON.stringify(storedV1Run());
    window.localStorage.setItem(STORAGE_KEY, original);
    const subscription = service.generate({ ...generateRequest(), newRun: true }).subscribe();
    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, expect.objectContaining({ answers: ANSWERS }));
    expect(httpPost.mock.calls.some(([url]) => url === '/api/mktg-agents/chat')).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(original);
    expect(TestBed.inject(MktgRunAttemptService).load('proj-1', 'brand-kit')?.state).toBe('writing');
    subscription.unsubscribe();
  });

  it.each([false, true])('numbers a fresh v1 after existing v3 without collisions, including resumed requests (resume=%s)', async (resume) => {
    const prior = storedV1Run();
    prior.versions = [1, 2, 3].map((version) => ({ version, document: '# prior ' + version, createdAt: new Date().toISOString() }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prior));
    resultResponses = [{ status: 'ready', documentMarkdown: '# Fresh session output', version: 1 }];
    let subscription = service.generate({ ...generateRequest(), newRun: true }).subscribe();
    if (resume) {
      subscription.unsubscribe();
      const pending = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load('proj-1', 'brand-kit');
      if (!pending) throw new Error('Missing synthetic accepted attempt');
      expect(pending.request.newRun).toBeUndefined();
      // The synthetic follow-up intake differs from the live registry pinned by load().
      subscription = service.resume({ ...pending, request: { ...pending.request, intake: CHAT_INTAKE } }).subscribe();
    }
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    subscription.unsubscribe();
    const fresh = service.loadRun('proj-1', 'brand-kit');
    expect(fresh?.versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
    expect(fresh?.versions[3]).toMatchObject({ document: '# Fresh session output', source: { version: 1 } });
    resultResponses = [
      { status: 'ready', documentMarkdown: '# Stale v4', version: 4 },
      { status: 'ready', documentMarkdown: '# Next v5', version: 5 },
    ];
    const next = service.generate(generateRequest('Next change')).subscribe();
    expect(httpPost).toHaveBeenCalledWith(
      '/api/mktg-agents/chat',
      expect.objectContaining({
        message: renderMktgIntakeMessage(CHAT_INTAKE, ANSWERS, 'Next change', 4),
      })
    );
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(service.loadRun('proj-1', 'brand-kit')?.versions).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(service.loadRun('proj-1', 'brand-kit')?.versions.map((version) => version.version)).toEqual([1, 2, 3, 4, 5]);
    next.unsubscribe();
  });

  it('retries a failed fresh-mode session through Generate with continuous history, never the failed chat session', async () => {
    const prior = storedV1Run();
    prior.versions = [1, 2, 3].map((version) => ({ version, document: '# prior ' + version, createdAt: new Date().toISOString() }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prior));
    const request = { ...generateRequest('Old feedback must not be replayed'), newRun: true };
    resultResponses = [{ status: 'failed', failure: { eventType: 'runtime_error', reason: 'Synthetic terminal failure. Retry.' } }];
    const first = service.generate(request).subscribe();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    first.unsubscribe();
    expect(service.loadRun('proj-1', 'brand-kit')).toMatchObject({ sessionFailed: true });
    expect(service.loadRun('proj-1', 'brand-kit')?.versions.map((version) => version.version)).toEqual([1, 2, 3]);
    httpPost.mockClear();
    resultResponses = [{ status: 'ready', version: 4, documentMarkdown: '# Retried fresh output' }];
    const retry = service.generate(request).subscribe();
    const submitted = httpPost.mock.calls.find(([url]) => url === CHAT_INTAKE.endpoints.generate)?.[1];
    expect(submitted).toMatchObject({ answers: ANSWERS, project: 'proj-1', priorVersion: 3 });
    expect(submitted).not.toHaveProperty('feedback');
    expect(httpPost).not.toHaveBeenCalledWith('/api/mktg-agents/chat', expect.anything());
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(service.loadRun('proj-1', 'brand-kit')?.versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
    expect(service.loadRun('proj-1', 'brand-kit')?.sessionFailed).toBeUndefined();
    retry.unsubscribe();
  });

  it.each(['draft', 'failed'] as const)('restores a %s pending after reload without any POST', (state) => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    const pending: MktgPendingGeneration = { request: generateRequest(), state, updatedAt: new Date().toISOString(), requiresReattachment: state === 'failed' };
    attempts.save(pending);
    const restored = TestBed.runInInjectionContext(() => new MktgRunAttemptService()).load('proj-1', 'brand-kit');
    if (!restored) throw new Error('Missing synthetic restored draft');
    const next = vi.fn();
    service.resume(restored).subscribe(next);
    expect(httpPost).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ type: 'restored', message: expect.stringContaining('Generate explicitly') }));
    if (state === 'failed') expect(next.mock.calls[0][0].message).toContain('Reattach');
  });

  it('allows only one POST from a freshly prepared in-memory draft', () => {
    const attempts = TestBed.inject(MktgRunAttemptService);
    const token = attempts.prepare(generateRequest());
    const prepared = attempts.consume(token, 'proj-1', 'brand-kit');
    if (!prepared) throw new Error('Missing synthetic handoff');
    service.resume(prepared.pending).subscribe();
    service.resume(prepared.pending).subscribe();
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.generate)).toHaveLength(1);
  });

  it('preserves the recorded run selector on a same-session chat follow-up', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...storedV1Run(), runId: 'b'.repeat(64) }));
    resultResponses = [{ status: 'ready', documentMarkdown: '# Follow-up', version: 2 }];
    service.generate(generateRequest('Synthetic feedback')).subscribe();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(service.loadRun('proj-1', 'brand-kit')?.runId).toBe('b'.repeat(64));
  });

  it('keeps the scoped intake when the first POST fails before an ACK', () => {
    httpPost.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 503 })));
    service.generate(generateRequest()).subscribe({ error: () => undefined });
    const pending = TestBed.inject(MktgRunAttemptService).load('proj-1', 'brand-kit');
    expect(pending).toMatchObject({ state: 'failed', request: { answers: ANSWERS } });
    expect(pending?.attempt).toBeUndefined();
  });

  it('starts a first run via POST to the validated generate endpoint with the full answers', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, { answers: ANSWERS, project: 'proj-1' });
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('document');
  });

  it('polls the result endpoint via POST with sessionId AND ownerToken in the body — never the query string', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    service.generate(generateRequest()).subscribe();

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    // The run's project uid rides the poll too: agents that persist their
    // output partition storage by the SERVER-resolved project and check the
    // caller's writer grant on it before writing.
    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.result, { sessionId: 'sess-1', ownerToken: 'token-1', project: 'proj-1' });
  });

  it('keeps polling through pending results and stores the ready document under the user-scoped key', async () => {
    resultResponses = [{ status: 'pending' }, { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toHaveLength(1);
    expect(stored.versions[0]).toMatchObject({ version: 1, document: '# Brand Kit' });
    expect(stored).toMatchObject({ sessionId: 'sess-1', ownerToken: 'token-1', answers: ANSWERS });
    // The TTL clock is persisted with the record — without it the run could never be pruned.
    expect(Date.parse(stored.savedAt)).not.toBeNaN();
  });

  /**
   * The BFF fetches the README while composing the submission, so its outcome
   * is known at generate time and settled long before the document is polled.
   * Storing it WITH the version it produced is what lets the result say the
   * document was written without a README instead of leaving a thin document
   * unexplained — and keeps a later version, generated with one, from
   * inheriting the note.
   */
  it('carries the generate response’s README outcome onto the version it produced', async () => {
    httpPost.mockImplementation((url: string) => {
      if (url === CHAT_INTAKE.endpoints.generate) {
        return of({ sessionId: 'sess-1', ownerToken: 'token-1', readme: { fetched: false, skipReason: 'not-a-repo-url' } });
      }
      return of<MktgRunResultResponse>({ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 });
    });

    service.generate(generateRequest()).subscribe();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions[0].readme).toEqual({ fetched: false, skipReason: 'not-a-repo-url' });
  });

  it('leaves the version’s README outcome unset for agents whose BFF fetches no README', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];

    service.generate(generateRequest()).subscribe();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions[0].readme).toBeUndefined();
  });

  it('treats a `questions` result as pending for an intake with no answers endpoint — only the document ends the poll', async () => {
    resultResponses = [
      { status: 'questions', questions: [{ key: 'q', label: 'Q', question: 'Q?', why: '', suggestedAnswer: '', basis: [] }], questionsId: 'abc' },
      { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 },
    ];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('document');
  });

  it('prunes an expired stored run on load — the persisted ownerToken never outlives the storage TTL', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...storedV1Run(), savedAt: new Date(Date.now() - MKTG_RUN_STORAGE_TTL_MS - 1000).toISOString() })
    );

    expect(service.loadRun('proj-1', 'brand-kit')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('treats a legacy record without savedAt as expired and starts a fresh run instead of a follow-up', async () => {
    const legacy: Partial<MktgStoredAgentRun> = storedV1Run();
    delete legacy.savedAt;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    resultResponses = [{ status: 'ready', documentMarkdown: '# Fresh', version: 1 }];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    // No TTL clock means the token's age is unknowable — never ride that session.
    expect(httpPost).not.toHaveBeenCalledWith('/api/mktg-agents/chat', expect.anything());
    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, { answers: ANSWERS, project: 'proj-1' });

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toHaveLength(2);
  });

  it('regenerates as a chat follow-up on the stored session (full form + feedback + derived prior version) and rejects the stale prior draft', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    // The session's prior envelope is still `ready` at v1 — only v2 may count.
    resultResponses = [
      { status: 'ready', documentMarkdown: '# v1', version: 1 },
      { status: 'ready', documentMarkdown: '# v2', version: 2 },
    ];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest('Tighten the taglines.')).subscribe((event) => events.push(event));

    // prior_version is derived from the STORED run, never passed by the caller.
    expect(httpPost).toHaveBeenCalledWith('/api/mktg-agents/chat', {
      agentId: 'brand-kit',
      project: 'proj-1',
      message: renderMktgIntakeMessage(CHAT_INTAKE, ANSWERS, 'Tighten the taglines.', 1),
      sessionId: 'sess-1',
      ownerToken: 'token-1',
    });

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    // Stale v1 poll response — still no document event.
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions[1]).toMatchObject({ version: 2, document: '# v2', feedback: 'Tighten the taglines.' });
  });

  it('bumps the version on an edit-inputs resubmit WITHOUT feedback so the poll gate can be satisfied', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    resultResponses = [
      { status: 'ready', documentMarkdown: '# v1', version: 1 },
      { status: 'ready', documentMarkdown: '# v2', version: 2 },
    ];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    // The follow-up message must carry the version directive even with no
    // feedback — the poll below only accepts > v1, so a message that lets the
    // agent finalize as v1 again would spin until timeout.
    const chatCall = httpPost.mock.calls.find(([url]) => url === '/api/mktg-agents/chat');
    expect(chatCall?.[1]).toEqual({
      agentId: 'brand-kit',
      project: 'proj-1',
      message: renderMktgIntakeMessage(CHAT_INTAKE, ANSWERS, undefined, 1),
      sessionId: 'sess-1',
      ownerToken: 'token-1',
    });
    expect(chatCall?.[1].message).toContain('finalize as version 2');

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    // Stale v1 poll response — still no document event.
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions[1]).toMatchObject({ version: 2, document: '# v2' });
    expect(stored.versions[1].feedback).toBeUndefined();
  });

  it('scopes stored runs to the effective user — an impersonation sub swap starts a fresh run, never a follow-up on the other sub session', async () => {
    // A run stored while user-1 was authenticated…
    const user1Run = storedV1Run();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user1Run));
    // …then impersonation swaps the effective user in place (no reload).
    userSignal.set({ sub: 'auth0|user-2' } as User);
    resultResponses = [{ status: 'ready', documentMarkdown: '# Fresh', version: 1 }];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    // user-1's session must never be replayed as user-2: no chat follow-up,
    // a brand-new validated generate instead.
    expect(httpPost).not.toHaveBeenCalledWith('/api/mktg-agents/chat', expect.anything());
    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, { answers: ANSWERS, project: 'proj-1' });

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toHaveLength(2);

    // The fresh run lands under user-2's key; user-1's stored run is untouched.
    const storedForUser2 = JSON.parse(
      window.localStorage.getItem(`${MKTG_RUN_STORAGE_KEY_PREFIX}:auth0|user-2:proj-1:brand-kit`) ?? 'null'
    ) as MktgStoredAgentRun;
    expect(storedForUser2.versions).toEqual([expect.objectContaining({ version: 1, document: '# Fresh' })]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject(user1Run);
  });

  it('returns no stored run when signed out — a keyless read can never surface another user record', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    userSignal.set(null);

    expect(service.loadRun('proj-1', 'brand-kit')).toBeNull();
  });

  it('recovers from a 401/403 follow-up: drops the stale stored session and falls back to a fresh run whose v1 is accepted', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    // The stored ownerToken no longer verifies (e.g. it was minted under a
    // different session binding) — the chat BFF rejects the follow-up.
    chatError = new HttpErrorResponse({ status: 403, statusText: 'Forbidden' });
    // The fresh session's first envelope is v1 — the fallback poll gate must be
    // 0 (a fresh session), NOT the dropped run's v1, or this would spin forever.
    resultResponses = [{ status: 'ready', documentMarkdown: '# Fresh v1', version: 1 }];

    const events: MktgGenerateProgress[] = [];
    let error: unknown;
    service.generate(generateRequest('Tighten the taglines.')).subscribe({ next: (event) => events.push(event), error: (err) => (error = err) });

    // The follow-up was attempted, rejected, and replaced by a fresh validated
    // generate — the user is never dead-ended on the unusable session.
    expect(error).toBeUndefined();
    expect(httpPost).toHaveBeenCalledWith('/api/mktg-agents/chat', expect.objectContaining({ sessionId: 'sess-1', ownerToken: 'token-1' }));
    expect(httpPost).toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, { answers: ANSWERS, project: 'proj-1' });
    expect(events).toEqual([{ type: 'submitted' }]);

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toHaveLength(2);

    // The dead session (and its versions) is gone; the fresh run replaces it.
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toEqual([expect.objectContaining({ version: 1, document: '# Fresh v1' })]);
  });

  it('survives a transient poll failure — one 5xx never aborts the generation, the next interval retries', async () => {
    resultResponses = [new HttpErrorResponse({ status: 500, statusText: 'Server Error' }), { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];

    const events: MktgGenerateProgress[] = [];
    let error: unknown;
    service.generate(generateRequest()).subscribe({ next: (event) => events.push(event), error: (err) => (error = err) });

    // First poll attempt errors transiently — the stream must stay alive.
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(error).toBeUndefined();
    expect(events).toEqual([{ type: 'submitted' }]);

    // The next interval's poll lands the document.
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(events).toHaveLength(2);
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
    expect(stored.versions).toEqual([expect.objectContaining({ version: 1, document: '# Brand Kit' })]);
  });

  it('never cancels an in-flight poll — a result endpoint slower than the interval still lands the document', async () => {
    // Each poll takes longer than the tick interval. With switchMap every tick
    // would abort the pending POST, no attempt could ever resolve, and the run
    // would time out even though the document is ready — the tick must be
    // dropped (exhaustMap) instead.
    resultDelayMs = MKTG_RUN_POLL.intervalMs + 2000;
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];

    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(events).toEqual([{ type: 'submitted' }]);

    // The next tick fires while the first poll is still in flight — it must be
    // ignored: no second POST, and no cancellation of the first.
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.result)).toHaveLength(1);
    expect(events).toEqual([{ type: 'submitted' }]);

    // The slow first attempt resolves and its document is accepted.
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('document');
  });

  it('pauses private result reads while hidden and rechecks the same accepted session on focus', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    resultResponses = [{ status: 'pending' }, { status: 'ready', documentMarkdown: '# Synthetic current draft', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    const subscription = service.generate(generateRequest()).subscribe((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.result)).toHaveLength(1);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 4);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.result)).toHaveLength(1);
    visibility.mockReturnValue('visible');
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.result)).toHaveLength(2);
    expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.generate)).toHaveLength(1);
    expect(events.some((event) => event.type === 'document')).toBe(true);
    subscription.unsubscribe();
    visibility.mockRestore();
  });

  it('fails a poll fast on a non-transient response — a 403 means the owner token stopped verifying, not a blip', async () => {
    resultResponses = [new HttpErrorResponse({ status: 403, statusText: 'Forbidden' })];

    const events: MktgGenerateProgress[] = [];
    let error: unknown;
    service.generate(generateRequest()).subscribe({ next: (event) => events.push(event), error: (err) => (error = err) });

    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

    expect(events).toEqual([{ type: 'submitted' }]);
    expect(error).toBeInstanceOf(HttpErrorResponse);
    expect((error as HttpErrorResponse).status).toBe(403);
  });

  it('keeps the run coherent when localStorage persistence fails — the next follow-up rides the in-memory run', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      resultResponses = [{ status: 'ready', documentMarkdown: '# v1', version: 1 }];
      service.generate(generateRequest()).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

      // The next submission must be a follow-up on the displayed run's session
      // with its version gate — never a fresh v1 session that could hand back
      // the already-displayed draft as if it were the regeneration.
      resultResponses = [{ status: 'ready', documentMarkdown: '# v2', version: 2 }];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest('Tighten the taglines.')).subscribe((event) => events.push(event));

      expect(httpPost).toHaveBeenCalledWith('/api/mktg-agents/chat', {
        agentId: 'brand-kit',
        project: 'proj-1',
        message: renderMktgIntakeMessage(CHAT_INTAKE, ANSWERS, 'Tighten the taglines.', 1),
        sessionId: 'sess-1',
        ownerToken: 'token-1',
      });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(events).toHaveLength(2);
      expect((events[1] as { type: 'document'; run: MktgStoredAgentRun }).run.versions).toHaveLength(2);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('propagates a non-auth follow-up failure and keeps the stored run — only 401/403 mean the session is unusable', () => {
    const existingRun = storedV1Run();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(existingRun));
    chatError = new HttpErrorResponse({ status: 500, statusText: 'Server Error' });

    let error: unknown;
    service.generate(generateRequest()).subscribe({ error: (err) => (error = err) });

    expect(error).toBe(chatError);
    expect(httpPost).not.toHaveBeenCalledWith(CHAT_INTAKE.endpoints.generate, expect.anything());
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject(existingRun);
  });

  /**
   * Bounded background persistence retry (dec-brand-kit-storage-v2) for
   * intakes whose result endpoint persists the document
   * (`MktgAgentIntake.persistsDocument`). A `ready` result with NO receipt
   * means the server-side write did not happen: the document is this
   * browser's only copy, so the project's stored kit — what dependency gating
   * serves every OTHER browser and user — silently does not exist. Because
   * the write is content-addressed and idempotent, extra polls re-run it.
   * The marketplace run shell (`/mktg-os-agents/brand-kit`) is the only
   * Brand Kit path, and the only one that retries the persistence receipt.
   */
  describe('persistence-receipt retry', () => {
    const READY_NO_RECEIPT: MktgRunResultResponse = { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 };
    const READY_WITH_RECEIPT: MktgRunResultResponse = {
      ...READY_NO_RECEIPT,
      persistence: { s3_key: 'brand-kit/proj-1/abc.md', content_sha256: 'abc', project: 'proj-1', version: 1 },
    };
    const resultCalls = (): unknown[][] => httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.result);

    it('keeps polling a receipt-less ready result so the idempotent server write is retried, and stops once the receipt lands', async () => {
      resultResponses = [READY_NO_RECEIPT, READY_WITH_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest()).subscribe((event) => events.push(event));

      // The document is emitted immediately — the retry is background work and
      // never delays what the user sees.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe('document');
      expect(resultCalls()).toHaveLength(1);

      // One extra poll re-runs the write; it comes back with a receipt.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(resultCalls()).toHaveLength(2);
      // The retry poll is the same owner-token-in-body, project-scoped POST.
      expect(resultCalls()[1][1]).toEqual({ sessionId: 'sess-1', ownerToken: 'token-1', project: 'proj-1' });

      // Receipt in hand: polling stops, and the ONE extra event says the
      // server copy now exists — dependency resolution prefers it over any
      // browser-stored run, so consumers have to be told it caught up.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 5);
      expect(resultCalls()).toHaveLength(2);
      expect(events).toHaveLength(3);
      expect(events[2].type).toBe('persisted');
    });

    it('attaches an older replay’s late receipt only to its matched saved version, never the newest one', async () => {
      resultResponses = [READY_NO_RECEIPT];
      const first = service.generate(generateRequest()).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      first.unsubscribe();
      const oldLocation: MktgDocumentPersistLocation = { agent_key: 'brand-kit', document_id: 'living', revision_id: `000001-${'a'.repeat(64)}` };
      const newLocation = { ...oldLocation, revision_id: `000002-${'b'.repeat(64)}` };
      resultResponses = [
        {
          status: 'ready',
          documentMarkdown: '# Newer saved version',
          version: 2,
          persistence: { project: 'proj-1', version: 2, s3_key: 'synthetic-new-key', content_sha256: 'b'.repeat(64), document_location: newLocation },
        },
      ];
      service.generate(generateRequest('Synthetic newer feedback')).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      const newer = service.loadRun('proj-1', 'brand-kit')?.versions[1];
      expect(newer?.documentLocation?.revisionId).toBe(newLocation.revision_id);
      const generateCalls = httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.generate).length;
      resultResponses = [
        READY_NO_RECEIPT,
        {
          ...READY_NO_RECEIPT,
          persistence: { project: 'proj-1', version: 1, s3_key: 'synthetic-old-key', content_sha256: 'a'.repeat(64), document_location: oldLocation },
        },
      ];
      const events: MktgGenerateProgress[] = [];
      service
        .resume({
          request: generateRequest(),
          state: 'writing',
          updatedAt: new Date().toISOString(),
          attempt: { session: { agentId: 'brand-kit', sessionId: 'sess-1', ownerToken: 'token-1' }, priorVersion: 0 },
        })
        .subscribe((event) => events.push(event));
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(service.loadRun('proj-1', 'brand-kit')?.versions).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: 'document',
        documentLocation: null,
        attempt: { session: { sessionId: 'sess-1', ownerToken: 'token-1' }, priorVersion: 0 },
      });
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(events[1]).toMatchObject({
        type: 'persisted',
        documentLocation: { revisionId: oldLocation.revision_id },
        attempt: { session: { sessionId: 'sess-1', ownerToken: 'token-1' }, priorVersion: 0 },
      });
      const versions = service.loadRun('proj-1', 'brand-kit')?.versions;
      expect(versions).toHaveLength(2);
      expect(versions?.[0]).toMatchObject({ version: 1, contentSha256: 'a'.repeat(64), documentLocation: { revisionId: oldLocation.revision_id } });
      expect(versions?.[1]).toEqual(newer);
      expect(versions?.[1]).toMatchObject({ version: 2, contentSha256: 'b'.repeat(64), documentLocation: { revisionId: newLocation.revision_id } });
      expect(events.map((event) => event.type)).toEqual(['document', 'persisted']);
      expect(httpPost.mock.calls.filter(([url]) => url === CHAT_INTAKE.endpoints.generate)).toHaveLength(generateCalls);
    });

    it('does not expose the prior subject’s attempt or location when a receipt arrives after identity changes', async () => {
      resultResponses = [READY_NO_RECEIPT, READY_WITH_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest()).subscribe((event) => events.push(event));
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      resultDelayMs = 100;
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      userSignal.set({ sub: 'synthetic-other-user' } as User);
      await vi.advanceTimersByTimeAsync(100);
      expect(events.find((event) => event.type === 'persisted')).toEqual({ type: 'persisted', run: null, documentLocation: null, attempt: null });
    });

    it('preserves the existing late content digest without treating it as revision identity', async () => {
      resultResponses = [READY_NO_RECEIPT, READY_WITH_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest()).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      const document = events.find((event) => event.type === 'document');
      expect(document?.type === 'document' ? document.run.versions.at(-1)?.contentSha256 : 'missing').toBeUndefined();

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      const persisted = events.find((event) => event.type === 'persisted');
      expect(persisted?.type === 'persisted' ? persisted.run?.versions.at(-1)?.contentSha256 : undefined).toBe('abc');
      // Digest persistence remains compatible; document identity comes only from a receipt key.
      expect(service.loadRun('proj-1', generateRequest().agentId)?.versions.at(-1)?.contentSha256).toBe('abc');
    });

    it('keeps the existing content digest with the version', async () => {
      resultResponses = [READY_WITH_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest()).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

      const document = events.find((event) => event.type === 'document');
      expect(document?.type === 'document' ? document.run.versions.at(-1)?.contentSha256 : undefined).toBe('abc');
    });

    it.each([false, true])('retains canonical locations without raw receipt keys for immediate/late document navigation (late=%s)', async (late) => {
      const key = `documents/proj-1/brand-kit/living/000001-${'a'.repeat(64)}.json`;
      const ready: MktgRunResultResponse = {
        ...READY_NO_RECEIPT,
        persistence: {
          s3_key: key,
          content_sha256: 'a'.repeat(64),
          project: 'proj-1',
          version: 1,
          document_location: { agent_key: 'brand-kit', document_id: 'living', revision_id: `000001-${'a'.repeat(64)}` },
        },
      };
      resultResponses = late ? [READY_NO_RECEIPT, ready] : [ready];
      service.generate(generateRequest()).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      if (late) {
        const first = service.loadRun('proj-1', generateRequest().agentId)?.versions.at(-1);
        if (!first) throw new Error('Missing synthetic run');
        expect(first.documentLocation).toBeUndefined();
        await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      }
      const version = service.loadRun('proj-1', generateRequest().agentId)?.versions.at(-1);
      if (!version) throw new Error('Missing synthetic run');
      expect(version.documentLocation?.revisionId).toBe(`000001-${'a'.repeat(64)}`);
      expect(version.documentLocation).toEqual({ agentKey: 'brand-kit', documentId: 'living', revisionId: `000001-${'a'.repeat(64)}` });
      expect(version.source?.identity).toBe('a'.repeat(64));
      expect(JSON.stringify(version)).not.toContain(key);
      expect(JSON.parse(JSON.stringify(version)).documentLocation).toEqual(version.documentLocation);
    });

    it.each([false, true])('never stores a foreign-project receipt location (late=%s)', async (late) => {
      const foreign: MktgRunResultResponse = {
        ...READY_NO_RECEIPT,
        persistence: {
          project: 'synthetic-other-project',
          version: 1,
          content_sha256: 'a'.repeat(64),
          s3_key: 'synthetic-foreign-key',
          document_location: { agent_key: 'brand-kit', document_id: 'living', revision_id: `000001-${'a'.repeat(64)}` },
        },
      };
      resultResponses = late ? [READY_NO_RECEIPT, foreign] : [foreign];
      service.generate(generateRequest()).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      if (late) await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      const version = service.loadRun('proj-1', generateRequest().agentId)?.versions.at(-1);
      if (!version) throw new Error('Missing synthetic run version');
      expect(version.documentLocation).toBeUndefined();
      expect(JSON.stringify(version)).not.toContain('synthetic-foreign-key');
    });

    it('bounds the retry — a permanently receipt-less result never polls beyond the shared budget', async () => {
      // The bucket-unconfigured / over-the-size-cap case: no poll will ever
      // produce a receipt, so only the budget can end the loop.
      resultResponses = [READY_NO_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate(generateRequest()).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(resultCalls()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);
      expect(resultCalls()).toHaveLength(1 + MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS);
      // No receipt ever arrived, so nothing claims the server copy exists.
      expect(events.some((event) => event.type === 'persisted')).toBe(false);
    });

    it('never fails a run that already produced its document when a retry poll errors — the attempt is spent, the next one retries', async () => {
      resultResponses = [READY_NO_RECEIPT, new HttpErrorResponse({ status: 500, statusText: 'Server Error' }), READY_WITH_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      let error: unknown;
      service.generate(generateRequest()).subscribe({ next: (event) => events.push(event), error: (err) => (error = err) });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(events).toHaveLength(2);

      // The failing retry poll must not surface as a run failure over a
      // document the user is already reading.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(error).toBeUndefined();
      expect(resultCalls()).toHaveLength(2);

      // The budget is not abandoned on one blip: the next poll gets the receipt.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(resultCalls()).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 5);
      expect(resultCalls()).toHaveLength(3);
      expect(error).toBeUndefined();
      expect(events).toHaveLength(3);
      expect(events[2].type).toBe('persisted');
    });

    it('does not retry a run with no project scope — the BFF never persists without one, so there is nothing to write', async () => {
      resultResponses = [READY_NO_RECEIPT];
      const events: MktgGenerateProgress[] = [];
      service.generate({ ...generateRequest(), projectUid: '' }).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(resultCalls()).toHaveLength(1);
      expect(events.map((event) => event.type)).toEqual(['submitted', 'document']);
      // The poll carries no project, and no retry poll follows it.
      expect(resultCalls()[0][1]).toEqual({ sessionId: 'sess-1', ownerToken: 'token-1' });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);
      expect(resultCalls()).toHaveLength(1);
      expect(events.some((event) => event.type === 'persisted')).toBe(false);
    });

    it('does not retry a receipted result — a successful write is terminal', async () => {
      resultResponses = [READY_WITH_RECEIPT];
      service.generate(generateRequest()).subscribe();

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);
      expect(resultCalls()).toHaveLength(1);
    });
  });

  describe('fresh-run intakes that research first (Messaging Framework)', () => {
    const MF_STORAGE_KEY = `${MKTG_RUN_STORAGE_KEY_PREFIX}:${USER_SUB}:proj-1:foundation-setup`;
    const MF_ANSWERS: Record<string, string> = {
      project_name: 'TestOrbit',
      website_url: 'https://testorbit.example.org',
      links: 'https://blog.example.org/launch',
    };
    const QUESTIONS: MktgRunQuestion[] = [
      {
        key: 'ranked-goals',
        label: 'Ranked goals',
        question: 'Which goals?',
        why: 'Unclear.',
        suggestedAnswer: 'Adoption first.',
        basis: ['https://testorbit.example.org'],
      },
      { key: 'words-to-avoid', label: 'Words to avoid', question: 'Which words?', why: '', suggestedAnswer: '', basis: [] },
    ];
    const QUESTIONS_RESULT: MktgRunResultResponse = { status: 'questions', questions: QUESTIONS, questionsId: 'abc12345' };
    const ANSWERS = [
      { key: 'ranked-goals', text: 'Adoption first.', origin: 'accepted' as const },
      { key: 'words-to-avoid', text: 'Avoid "synergy".', origin: 'requester' as const },
    ];
    /** Where answers POSTs went. */
    let answersCalls: unknown[][];

    const mfRequest = (feedback?: string): MktgGenerateRequest => ({
      agentId: 'foundation-setup',
      projectUid: 'proj-1',
      intake: FOUNDATION_MESSAGE_INTAKE,
      answers: MF_ANSWERS,
      feedback,
    });

    const mfStoredV1Run = (): MktgStoredAgentRun => ({
      agentId: 'foundation-setup',
      projectUid: 'proj-1',
      sessionId: 'sess-1',
      ownerToken: 'token-1',
      answers: MF_ANSWERS,
      versions: [{ version: 1, document: '# v1', createdAt: '2026-08-19T00:00:00.000Z' }],
      savedAt: new Date().toISOString(),
    });

    const mfResultCalls = (): unknown[][] => httpPost.mock.calls.filter(([url]) => url === FOUNDATION_MESSAGE_INTAKE.endpoints.result);

    beforeEach(() => {
      answersCalls = [];
      // Same contract-locked mock, retargeted at the Messaging Framework
      // endpoints: every submission is a generate POST on a FRESH session;
      // posting to the chat endpoint would be the regression. Answers go to
      // the answers endpoint, on the same session.
      httpPost.mockImplementation((url: string, body: unknown) => {
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.generate) {
          return of({ sessionId: 'sess-2', ownerToken: 'token-2' });
        }
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.answers) {
          answersCalls.push([url, body]);
          return of({ success: true });
        }
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.result) {
          const next = resultResponses.length > 1 ? resultResponses.shift() : resultResponses[0];
          return next instanceof HttpErrorResponse ? throwError(() => next) : of(next ?? { status: 'pending' });
        }
        throw new Error(`Unexpected POST to ${url}`);
      });
    });

    it('resubmits as a FRESH run — no priorVersion, no feedback — with the project uid, and numbers the run’s own history', async () => {
      window.localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(mfStoredV1Run()));
      // The generate envelope always says version 1; the poll's gate stays 0 so it is accepted.
      resultResponses = [{ status: 'ready', documentMarkdown: '# second run', version: 1 }];
      const documents = [{ kind: 'link' as const, title: 'Note', url: 'https://wiki.example.org/note' }];

      const events: MktgGenerateProgress[] = [];
      service.generate({ ...mfRequest(), documents }).subscribe((event) => events.push(event));

      // The agent's own LFX lookups need the project; it rides the generate body for this intake.
      expect(httpPost).toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.generate, { answers: MF_ANSWERS, documents, project: 'proj-1' });
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(events).toHaveLength(2);

      const stored = JSON.parse(window.localStorage.getItem(MF_STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
      expect(stored).toMatchObject({ sessionId: 'sess-2', ownerToken: 'token-2' });
      expect(stored.versions.map((version) => version.version)).toEqual([1, 2]);
      expect(stored.versions[1].document).toBe('# second run');
    });

    it('treats a first run normally — no priorVersion, plain generate body plus the project', async () => {
      resultResponses = [{ status: 'ready', documentMarkdown: '# v1', version: 1 }];

      service.generate(mfRequest()).subscribe();

      expect(httpPost).toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.generate, { answers: MF_ANSWERS, project: 'proj-1' });
    });

    it('ends the poll on a ready result that carries the framework as an asset — no document at all — and stores the asset with the version', async () => {
      const asset: MktgFrameworkAsset = {
        kind: 'messaging-framework',
        content: { mf: { tagline: 'Release, open.' }, icp: [], mh: {}, nums: [] } as unknown as MktgFrameworkAsset['content'],
        report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
        checks: { findings: [] },
        mode: 'draft',
      };
      resultResponses = [{ status: 'pending' }, { status: 'ready', asset, version: 1 }];
      const events: MktgGenerateProgress[] = [];
      service.generate(mfRequest()).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);

      const landed = events.find((event) => event.type === 'document');
      expect(landed).toBeDefined();
      const stored = JSON.parse(window.localStorage.getItem(MF_STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
      expect(stored.versions).toHaveLength(1);
      expect(stored.versions[0]).toMatchObject({ version: 1, document: '', asset });
    });

    it('stops at the agent’s questions: emits them with the session to continue and completes, storing no version', async () => {
      resultResponses = [{ status: 'pending' }, QUESTIONS_RESULT];
      const events: MktgGenerateProgress[] = [];
      let completed = false;
      service.generate(mfRequest()).subscribe({ next: (event) => events.push(event), complete: () => (completed = true) });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);

      expect(events).toEqual([
        { type: 'submitted' },
        {
          type: 'questions',
          pending: {
            attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-2', ownerToken: 'token-2' }, priorVersion: 0 },
            questionsId: 'abc12345',
            questions: QUESTIONS,
          },
        },
      ]);
      expect(completed).toBe(true);
      expect(window.localStorage.getItem(MF_STORAGE_KEY)).toBeNull();
      // Polling stopped with the questions: nothing more is asked of the result endpoint.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 3);
      expect(mfResultCalls()).toHaveLength(2);
    });

    it('stops at the agent’s refusal: emits the reply as the outcome and completes, storing no version', async () => {
      const reply = 'The Brand Kit request for TestOrbit has no approved messaging framework attached, so this run was not started.';
      resultResponses = [{ status: 'pending' }, { status: 'refused', reply }];
      const events: MktgGenerateProgress[] = [];
      let completed = false;
      service.generate(mfRequest()).subscribe({ next: (event) => events.push(event), complete: () => (completed = true) });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);

      expect(events).toEqual([{ type: 'submitted' }, { type: 'refused', reply }]);
      expect(completed).toBe(true);
      expect(window.localStorage.getItem(MF_STORAGE_KEY)).toBeNull();
      // The session is over: nothing more is asked of the result endpoint.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 3);
      expect(mfResultCalls()).toHaveLength(2);
    });

    it('streams the agent’s live feed — only when it changed — ahead of the questions', async () => {
      const reading: MktgRunActivity = {
        id: 'step-1',
        kind: 'reading',
        label: 'Looking through aaif on GitHub',
        status: 'running',
        startedAt: '2026-10-16T08:00:00Z',
      };
      const searching: MktgRunActivity = { id: 'step-2', kind: 'search', label: 'Searching the web', status: 'running', startedAt: '2026-10-16T08:00:05Z' };
      resultResponses = [
        { status: 'pending', activity: [reading] },
        { status: 'pending', activity: [reading] },
        { status: 'pending', activity: [{ ...reading, status: 'done' }, searching] },
        {
          ...QUESTIONS_RESULT,
          activity: [
            { ...reading, status: 'done' },
            { ...searching, status: 'done' },
          ],
        },
      ];
      const events: MktgGenerateProgress[] = [];
      service.generate(mfRequest()).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs * 3);

      expect(events.map((event) => event.type)).toEqual(['submitted', 'activity', 'activity', 'activity', 'questions']);
      expect(events[1]).toEqual({ type: 'activity', activity: [reading] });
      // The repeated feed of the second poll was not emitted again.
      expect(events[2]).toEqual({ type: 'activity', activity: [{ ...reading, status: 'done' }, searching] });
    });

    it('still gives up after the overall deadline while the feed keeps arriving', async () => {
      let tick = 0;
      httpPost.mockImplementation((url: string) => {
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.generate) {
          return of({ sessionId: 'sess-2', ownerToken: 'token-2' });
        }
        tick += 1;
        return of({
          status: 'pending',
          activity: [{ id: 'step-1', kind: 'reading', label: `Reading page ${tick}`, status: 'running', startedAt: '2026-10-16T08:00:00Z' }],
        });
      });
      let failed: unknown = null;
      service.generate(mfRequest()).subscribe({ error: (error: unknown) => (failed = error) });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs * 2);

      expect(failed).not.toBeNull();
    });

    it('gives up at the deadline even when a result request never answers — a stalled poll cannot hide it', async () => {
      httpPost.mockImplementation((url: string) => {
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.generate) {
          return of({ sessionId: 'sess-2', ownerToken: 'token-2' });
        }
        return NEVER;
      });
      let failed: unknown = null;
      service.generate(mfRequest()).subscribe({ error: (error: unknown) => (failed = error) });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
      // One request went out and is still hanging; the ticks after it are dropped, not the deadline.
      expect(mfResultCalls()).toHaveLength(1);
      expect(failed).toBeNull();

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs);

      expect(failed).toBeInstanceOf(TimeoutError);
      expect(mfResultCalls()).toHaveLength(1);
    });

    it('resumes a failed answers poll with its accepted block and the same attempt, not another answers POST', async () => {
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId: mfRequest().agentId, sessionId: 'sess-2', ownerToken: 'token-2' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: QUESTIONS,
      };
      resultResponses = [{ status: 'pending' }];
      const first = service.answerQuestions(mfRequest(), pending, ANSWERS).subscribe();
      first.unsubscribe(); // Leaving immediately after ACK must still keep accepted answers.
      const state = TestBed.inject(MktgRunAttemptService).load('proj-1', mfRequest().agentId);
      expect(state?.answered).toEqual({ questions: QUESTIONS, answers: ANSWERS, questionsId: 'abc12345' });
      resultResponses = [QUESTIONS_RESULT, { status: 'ready', documentMarkdown: '# From resumed answers', version: 1 }];
      if (!state) {
        throw new Error('Missing synthetic pending attempt');
      }
      service.resume(state).subscribe();
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs + MKTG_RUN_POLL.intervalMs);
      expect(answersCalls).toHaveLength(1);
      expect(service.loadRun('proj-1', mfRequest().agentId)?.versions.at(-1)).toMatchObject({ questions: QUESTIONS, answers: ANSWERS });
    });

    it('distinguishes JSON bytes even when both versions have empty Markdown and restarted envelope counters', async () => {
      const asset = (tagline: string): MktgFrameworkAsset => ({
        kind: 'messaging-framework',
        content: { mf: { tagline }, icp: [], mh: {}, nums: [] } as unknown as MktgFrameworkAsset['content'],
        report: { sources_read: [], sources_failed: [], gaps: [], notes: '' },
        checks: { findings: [] },
        mode: 'draft',
      });
      for (const [tagline, persisted] of [
        ['First.', false],
        ['Second.', false],
        ['Second.', true],
      ] as const) {
        resultResponses = [
          {
            status: 'ready',
            asset: asset(tagline),
            version: 1,
            ...(persisted && {
              persistence: {
                s3_key: 'synthetic-key',
                project: 'proj-1',
                version: 1,
                content_sha256: 'c'.repeat(64),
                document_location: { agent_key: 'foundation-message' as const, document_id: 'living', revision_id: '000001-' + 'c'.repeat(64) },
              },
            }),
          },
        ];
        service.generate(mfRequest()).subscribe();
        await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      }
      const run = service.loadRun('proj-1', mfRequest().agentId);
      expect(run?.versions).toHaveLength(2);
      expect(run?.versions.map((version) => version.document)).toEqual(['', '']);
      expect(run?.versions[0].source?.identity).not.toBe(run?.versions[1].source?.identity);
      expect(run?.versions[0].contentSha256).toBeUndefined();
      expect(run?.versions[1].contentSha256).toBe('c'.repeat(64));
      expect(run?.versions[1].source?.identity).toBe('c'.repeat(64));
      expect(run?.versions.every((entry) => (entry.source?.identity.length ?? 0) <= 64)).toBe(true);
      expect(run?.versions[1].documentLocation).toEqual({ agentKey: 'foundation-message', documentId: 'living', revisionId: '000001-' + 'c'.repeat(64) });
    });

    it('answers on the SAME session, ignores the block it just answered, and stores the questions and answers with the version', async () => {
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-2', ownerToken: 'token-2' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: QUESTIONS,
      };
      // The result endpoint keeps reporting the answered block until the agent writes something newer.
      resultResponses = [QUESTIONS_RESULT, { status: 'ready', documentMarkdown: '# From answers', version: 1 }];
      const events: MktgGenerateProgress[] = [];
      service.answerQuestions(mfRequest(), pending, ANSWERS).subscribe((event) => events.push(event));

      expect(answersCalls).toEqual([
        [
          FOUNDATION_MESSAGE_INTAKE.endpoints.answers,
          { sessionId: 'sess-2', ownerToken: 'token-2', answers: ANSWERS, project: 'proj-1', questionsId: 'abc12345' },
        ],
      ]);
      expect(httpPost).not.toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.generate, expect.anything());
      expect(events).toEqual([{ type: 'submitted' }]);

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      // The answered block came back once more — still no document, no new questions.
      expect(events).toEqual([{ type: 'submitted' }]);

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe('document');

      const stored = JSON.parse(window.localStorage.getItem(MF_STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
      expect(stored).toMatchObject({ sessionId: 'sess-2', ownerToken: 'token-2' });
      expect(stored.versions).toHaveLength(1);
      expect(stored.versions[0]).toMatchObject({ version: 1, document: '# From answers', questions: QUESTIONS, answers: ANSWERS });
    });

    it('surfaces a second, different questions block after the answers as a new round', async () => {
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-2', ownerToken: 'token-2' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: QUESTIONS,
      };
      const second: MktgRunResultResponse = { status: 'questions', questions: [QUESTIONS[1]], questionsId: 'def67890' };
      resultResponses = [second];
      const events: MktgGenerateProgress[] = [];
      service.answerQuestions(mfRequest(), pending, ANSWERS).subscribe((event) => events.push(event));

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);

      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ type: 'questions', pending: { questionsId: 'def67890', questions: [QUESTIONS[1]] } });
    });

    it('fails the answers round on a rejected POST without touching the stored run', () => {
      const existing = mfStoredV1Run();
      window.localStorage.setItem(MF_STORAGE_KEY, JSON.stringify(existing));
      const rejection = new HttpErrorResponse({ status: 403, statusText: 'Forbidden' });
      httpPost.mockImplementation((url: string) => {
        if (url === FOUNDATION_MESSAGE_INTAKE.endpoints.answers) {
          return throwError(() => rejection);
        }
        throw new Error(`Unexpected POST to ${url}`);
      });
      const pending: MktgRunQuestionsPending = {
        attempt: { session: { agentId: 'foundation-setup', sessionId: 'sess-2', ownerToken: 'token-2' }, priorVersion: 0 },
        questionsId: 'abc12345',
        questions: QUESTIONS,
      };

      let error: unknown;
      service.answerQuestions(mfRequest(), pending, ANSWERS).subscribe({ error: (err) => (error = err) });

      expect(error).toBe(rejection);
      expect(JSON.parse(window.localStorage.getItem(MF_STORAGE_KEY) ?? 'null')).toMatchObject(existing);
    });

    it('poll-retries a receipt-less ready result — this intake now persists, so a missing receipt is a failed write', async () => {
      // Was: "this intake persists nothing, so a receipt would never arrive".
      // The Messaging Framework's result endpoint writes through the shared
      // agent-artifact layer, so a ready result WITHOUT a receipt is a failed
      // server-side write — exactly the Brand Kit case, recovered by the same
      // bounded, idempotent retry. Without it the only copy of the document
      // would be this browser's TTL-bounded stored run.
      const readyNoReceipt: MktgRunResultResponse = { status: 'ready', documentMarkdown: '# v1', version: 1 };
      resultResponses = [
        readyNoReceipt,
        {
          ...readyNoReceipt,
          persistence: { s3_key: 'foundation-message/proj-1/abc.md', content_sha256: 'abc', project: 'proj-1', version: 1 },
        },
      ];

      const events: MktgGenerateProgress[] = [];
      service.generate(mfRequest()).subscribe((event) => events.push(event));

      // The document is emitted immediately — the retry is background work.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(events).toHaveLength(2);
      expect(mfResultCalls()).toHaveLength(1);

      // One extra poll re-runs the idempotent write; it returns the receipt.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(mfResultCalls()).toHaveLength(2);
      expect(mfResultCalls()[1][1]).toEqual({ sessionId: 'sess-2', ownerToken: 'token-2', project: 'proj-1' });

      // Receipt in hand: polling stops and consumers are told the SERVER copy
      // — the one every other browser and user reads — has caught up.
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);
      expect(mfResultCalls()).toHaveLength(2);
      expect(events).toHaveLength(3);
      expect(events[2].type).toBe('persisted');
    });

    it('bounds the Messaging Framework retry to the same shared budget', async () => {
      resultResponses = [{ status: 'ready', documentMarkdown: '# v1', version: 1 }];
      service.generate(mfRequest()).subscribe();

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);

      expect(mfResultCalls()).toHaveLength(1 + MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS);
    });
  });

  describe('regenerate-via-generate intakes (ICP)', () => {
    const ICP_STORAGE_KEY = `${MKTG_RUN_STORAGE_KEY_PREFIX}:${USER_SUB}:proj-1:icp`;
    const ICP_ANSWERS: Record<string, string> = {
      project_name: 'TestOrbit',
      github_url: 'https://github.com/example-org/testorbit',
      business_outcome: 'Membership growth',
    };

    const icpRequest = (feedback?: string): MktgGenerateRequest => ({
      agentId: 'icp',
      projectUid: 'proj-1',
      intake: ICP_INTAKE,
      answers: ICP_ANSWERS,
      feedback,
    });

    const icpStoredV1Run = (): MktgStoredAgentRun => ({
      agentId: 'icp',
      projectUid: 'proj-1',
      sessionId: 'sess-1',
      ownerToken: 'token-1',
      answers: ICP_ANSWERS,
      versions: [{ version: 1, document: '# v1', createdAt: '2026-08-19T00:00:00.000Z' }],
      savedAt: new Date().toISOString(),
    });

    beforeEach(() => {
      httpPost.mockImplementation((url: string) => {
        if (url === ICP_INTAKE.endpoints.generate) {
          return of({ sessionId: 'sess-2', ownerToken: 'token-2' });
        }
        if (url === ICP_INTAKE.endpoints.result) {
          const next = resultResponses.length > 1 ? resultResponses.shift() : resultResponses[0];
          return next instanceof HttpErrorResponse ? throwError(() => next) : of(next ?? { status: 'pending' });
        }
        throw new Error(`Unexpected POST to ${url}`);
      });
    });

    it('keeps explicit newRun ICP versions monotonic and derives the next regenerate version', async () => {
      const prior = icpStoredV1Run();
      prior.versions = [1, 2, 3].map((version) => ({ version, document: '# Synthetic prior', createdAt: '2026-08-19T00:00:00.000Z' }));
      window.localStorage.setItem(ICP_STORAGE_KEY, JSON.stringify(prior));
      resultResponses = [{ status: 'ready', documentMarkdown: '# Synthetic v4', version: 4 }];
      const first = service.generate({ ...icpRequest('Not sent for a new run'), newRun: true }).subscribe();
      expect(httpPost).toHaveBeenCalledWith(ICP_INTAKE.endpoints.generate, { answers: ICP_ANSWERS, priorVersion: 3, project: 'proj-1' });
      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      first.unsubscribe();
      const stored = service.loadRun('proj-1', 'icp');
      expect(stored?.versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
      expect(stored?.versions.at(-1)?.feedback).toBeUndefined();
      const second = service.generate(icpRequest()).subscribe();
      const posts = httpPost.mock.calls.filter(([url]) => url === ICP_INTAKE.endpoints.generate);
      expect(posts.at(-1)?.[1]).toEqual({ answers: ICP_ANSWERS, priorVersion: 4, project: 'proj-1' });
      second.unsubscribe();
    });

    it('regenerates through the generate endpoint with the full answers + feedback + derived priorVersion — never the chat endpoint', async () => {
      window.localStorage.setItem(ICP_STORAGE_KEY, JSON.stringify(icpStoredV1Run()));
      resultResponses = [
        { status: 'ready', documentMarkdown: '# v1', version: 1 },
        { status: 'ready', documentMarkdown: '# v2', version: 2, derivatives: { summary_25: 'New 25.' } },
      ];

      const events: MktgGenerateProgress[] = [];
      service.generate(icpRequest('Sharpen the pitch.')).subscribe((event) => events.push(event));

      // priorVersion is derived from the STORED run, never passed by the caller.
      expect(httpPost).toHaveBeenCalledWith(ICP_INTAKE.endpoints.generate, {
        answers: ICP_ANSWERS,
        feedback: 'Sharpen the pitch.',
        priorVersion: 1,
        project: 'proj-1',
      });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      // Stale v1 poll response (the fresh session's poll gate is still v1) — no document event yet.
      expect(events).toEqual([{ type: 'submitted' }]);

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
      expect(events).toHaveLength(2);

      const stored = JSON.parse(window.localStorage.getItem(ICP_STORAGE_KEY) ?? 'null') as MktgStoredAgentRun;
      // Version history is kept; the run now rides the FRESH session, and the
      // envelope's derivatives are persisted with the version for the chips.
      expect(stored).toMatchObject({ sessionId: 'sess-2', ownerToken: 'token-2' });
      expect(stored.versions).toHaveLength(2);
      expect(stored.versions[1]).toMatchObject({ version: 2, document: '# v2', feedback: 'Sharpen the pitch.', derivatives: { summary_25: 'New 25.' } });
    });

    it('resubmits an edit-inputs change with priorVersion but no feedback (the BFF synthesizes the revision directive)', async () => {
      window.localStorage.setItem(ICP_STORAGE_KEY, JSON.stringify(icpStoredV1Run()));
      resultResponses = [{ status: 'ready', documentMarkdown: '# v2', version: 2 }];

      service.generate(icpRequest()).subscribe();

      expect(httpPost).toHaveBeenCalledWith(ICP_INTAKE.endpoints.generate, { answers: ICP_ANSWERS, priorVersion: 1, project: 'proj-1' });
    });
  });
});
