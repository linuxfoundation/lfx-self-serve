// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_INTAKE, MKTG_RUN_POLL, MKTG_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import { MktgGenerateProgress, MktgGenerateRequest, MktgRunResultResponse, MktgStoredAgentRun, User } from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
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
  /** Result-endpoint responses, consumed one per poll (last one repeats). */
  let resultResponses: MktgRunResultResponse[];
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
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    resultResponses = [];
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
        return of(next ?? { status: 'pending' });
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

    expect(httpPost).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.result, { sessionId: 'sess-1', ownerToken: 'token-1' });
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
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
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject(storedV1Run());
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

  it('propagates a non-auth follow-up failure and keeps the stored run — only 401/403 mean the session is unusable', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedV1Run()));
    chatError = new HttpErrorResponse({ status: 500, statusText: 'Server Error' });

    let error: unknown;
    service.generate(generateRequest()).subscribe({ error: (err) => (error = err) });

    expect(error).toBe(chatError);
    expect(httpPost).not.toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.generate, expect.anything());
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject(storedV1Run());
  });
});
