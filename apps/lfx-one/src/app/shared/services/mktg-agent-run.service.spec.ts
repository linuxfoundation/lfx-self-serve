// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BRAND_KIT_INTAKE,
  FOUNDATION_MESSAGE_INTAKE,
  ICP_INTAKE,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_KEY_PREFIX,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgRunActivity,
  MktgRunAsset,
  MktgRunQuestion,
  MktgRunQuestionsPending,
  MktgRunResultResponse,
  MktgStoredAgentRun,
  User,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { concatMap, NEVER, of, throwError, TimeoutError, timer } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgAgentRunService } from './mktg-agent-run.service';

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
  const ANSWERS: Record<string, string> = Object.fromEntries(BRAND_KIT_INTAKE.fields.map((field) => [field.key, `Answer for ${field.key}`]));

  let service: MktgAgentRunService;
  let userSignal: WritableSignal<User | null>;
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
    intake: BRAND_KIT_INTAKE,
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

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    resultResponses = [];
    resultDelayMs = 0;
    chatError = null;
    userSignal = signal<User | null>({ sub: USER_SUB } as User);
    httpPost = vi.fn((url: string) => {
      if (url === BRAND_KIT_INTAKE.endpoints.generate) {
        return of({ sessionId: 'sess-1', ownerToken: 'token-1' });
      }
      if (url === '/api/mktg-agents/chat') {
        return chatError ? throwError(() => chatError) : of({ success: true });
      }
      if (url === BRAND_KIT_INTAKE.endpoints.result) {
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
      ],
    });
    service = TestBed.inject(MktgAgentRunService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a first run via POST to the validated generate endpoint with the full answers', async () => {
    resultResponses = [{ status: 'ready', documentMarkdown: '# Brand Kit', version: 1 }];
    const events: MktgGenerateProgress[] = [];
    service.generate(generateRequest()).subscribe((event) => events.push(event));

    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, { answers: ANSWERS });
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
    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.result, { sessionId: 'sess-1', ownerToken: 'token-1', project: 'proj-1' });
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
      if (url === BRAND_KIT_INTAKE.endpoints.generate) {
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
    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, { answers: ANSWERS });

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
      message: renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, 'Tighten the taglines.', 1),
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
      message: renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, undefined, 1),
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
    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, { answers: ANSWERS });

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
    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, { answers: ANSWERS });
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
    expect(httpPost.mock.calls.filter(([url]) => url === BRAND_KIT_INTAKE.endpoints.result)).toHaveLength(1);
    expect(events).toEqual([{ type: 'submitted' }]);

    // The slow first attempt resolves and its document is accepted.
    await vi.advanceTimersByTimeAsync(2000);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('document');
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
        message: renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, 'Tighten the taglines.', 1),
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
    expect(httpPost).not.toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, expect.anything());
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
   * This is the marketplace path (`/mktg-os-agents/brand-kit` → the generic
   * run shell); the standalone brand-kit-form route already retried, and both
   * now spend the same budget.
   */
  describe('persistence-receipt retry', () => {
    const READY_NO_RECEIPT: MktgRunResultResponse = { status: 'ready', documentMarkdown: '# Brand Kit', version: 1 };
    const READY_WITH_RECEIPT: MktgRunResultResponse = {
      ...READY_NO_RECEIPT,
      persistence: { s3_key: 'brand-kit/proj-1/abc.md', content_sha256: 'abc', project: 'proj-1', version: 1 },
    };
    const resultCalls = (): unknown[][] => httpPost.mock.calls.filter(([url]) => url === BRAND_KIT_INTAKE.endpoints.result);

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
      expect(events[2]).toEqual({ type: 'persisted' });
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
      expect(events[2]).toEqual({ type: 'persisted' });
    });

    it('does not retry a run with no project scope — the BFF never persists without one, so there is nothing to write', async () => {
      resultResponses = [READY_NO_RECEIPT];
      service.generate({ ...generateRequest(), projectUid: '' }).subscribe();

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
      expect(resultCalls()).toHaveLength(1);
      // The poll carries no project, and no retry poll follows it.
      expect(resultCalls()[0][1]).toEqual({ sessionId: 'sess-1', ownerToken: 'token-1' });

      await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 10);
      expect(resultCalls()).toHaveLength(1);
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
      const asset: MktgRunAsset = {
        kind: 'messaging-framework',
        content: { mf: { tagline: 'Release, open.' }, icp: [], mh: {}, nums: [] } as unknown as MktgRunAsset['content'],
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

      expect(answersCalls).toEqual([[FOUNDATION_MESSAGE_INTAKE.endpoints.answers, { sessionId: 'sess-2', ownerToken: 'token-2', answers: ANSWERS }]]);
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
      expect(events[2]).toEqual({ type: 'persisted' });
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

      expect(httpPost).toHaveBeenCalledWith(ICP_INTAKE.endpoints.generate, { answers: ICP_ANSWERS, priorVersion: 1 });
    });
  });
});
