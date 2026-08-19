// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { MKTG_RUN_POLL, MKTG_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import {
  MktgChatRequest,
  MktgChatResponse,
  MktgGenerateProgress,
  MktgGenerateRequest,
  MktgRunAttempt,
  MktgRunGenerateBody,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
  MktgRunVersion,
  MktgSessionInfo,
  MktgStoredAgentRun,
} from '@lfx-one/shared/interfaces';
import { renderMktgIntakeMessage } from '@lfx-one/shared/utils';
import { catchError, concat, exhaustMap, filter, map, Observable, of, switchMap, take, throwError, timeout, timer } from 'rxjs';

import { isTransientHttpError } from '@shared/utils/http-error.utils';

import { UserService } from './user.service';

/**
 * Form-first agent runs for the Marketing OS marketplace. A first run submits
 * the batch intake answers to the agent's validated generate endpoint (the BFF
 * renders the batch message server-side); every follow-up — edit-inputs
 * resubmit or feedback regeneration — resubmits the full form plus the stored
 * run's prior version (and feedback, when given) on the run's existing Guild
 * session via the chat/session BFF. Either way the document comes exclusively
 * from the agent's result endpoint, which returns only schema-validated,
 * sha256-verified envelopes — raw chat text is never treated as the document.
 * Each run (session + answers + versions) persists in localStorage, keyed to
 * the EFFECTIVE user (login/impersonation swaps `user` without a reload — the
 * user-keyed invalidation precedent in user.service.ts), so one user's stored
 * session — whose ownerToken is HMAC-bound to their sub — can never be replayed
 * as another's. If a stored session still turns stale (the server 401/403s the
 * follow-up), the run drops it and falls back to a fresh session instead of
 * dead-ending the user.
 */
@Injectable({ providedIn: 'root' })
export class MktgAgentRunService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);

  /**
   * In-memory runs, keyed exactly like localStorage. The authoritative record
   * for THIS page session: `loadRun` prefers it, so when `setItem` fails
   * (quota, disabled storage) the next follow-up still derives its version
   * directive and poll gate from the run the user is looking at — persistence
   * loss only ever costs cross-visit restore, never in-session correctness.
   */
  private readonly memoryRuns = new Map<string, MktgStoredAgentRun>();

  /**
   * Generates (or regenerates) an agent document. Emits `submitted` once the
   * generate/chat POST resolves, then `document` with the updated stored run
   * once the validated document lands.
   */
  public generate(request: MktgGenerateRequest): Observable<MktgGenerateProgress> {
    const stored = this.loadRun(request.projectUid, request.agentId);
    const attempt$: Observable<MktgRunAttempt> = stored ? this.followUp(request, stored) : this.startRun(request);

    return attempt$.pipe(
      switchMap(({ session, priorVersion }) =>
        concat(
          of<MktgGenerateProgress>({ type: 'submitted' }),
          this.pollForDocument(request.intake.endpoints.result, session, priorVersion).pipe(
            map((result) => ({ type: 'document' as const, run: this.appendVersion(request, session, result) }))
          )
        )
      )
    );
  }

  /** Reads the stored run for a project + agent. Returns null on the server, when signed out, or when nothing is stored. */
  public loadRun(projectUid: string, agentId: string): MktgStoredAgentRun | null {
    if (!isPlatformBrowser(this.platformId) || !projectUid) {
      return null;
    }
    const key = this.storageKey(projectUid, agentId);
    if (!key) {
      return null;
    }
    const cached = this.memoryRuns.get(key);
    if (cached) {
      return cached;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as MktgStoredAgentRun;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.versions) || !parsed.sessionId || !parsed.ownerToken) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * First run: one-shot form-mode generation through the agent's validated
   * generate endpoint. The BFF validates the answers against the agent's own
   * intake schema and renders the batch message server-side. A fresh session
   * has no prior draft, so the result poll's gate is 0.
   */
  private startRun(request: MktgGenerateRequest): Observable<MktgRunAttempt> {
    const body: MktgRunGenerateBody = { answers: request.answers };
    return this.http
      .post<MktgRunSessionResponse>(request.intake.endpoints.generate, body)
      .pipe(map((response) => ({ session: { agentId: request.agentId, sessionId: response.sessionId, ownerToken: response.ownerToken }, priorVersion: 0 })));
  }

  /**
   * Follow-up on the run's existing Guild session (edit-inputs resubmit or
   * "Request changes" regeneration): the full form — always with the
   * prior-version directive so the agent finalizes as v+1, plus the feedback
   * paragraph when regenerating — rendered as the agent's batch message and
   * posted through the chat/session BFF contract.
   *
   * The stored run's latest version is the single source of truth for BOTH the
   * message's "finalize as version N+1" directive and the result poll's gate —
   * deriving them together means the agent is always told to produce the exact
   * version the poll will accept. (The result endpoint reports the best
   * envelope in the WHOLE session, so on a follow-up the prior draft is
   * already `ready` — only a strictly newer version counts.)
   *
   * Recovery: a 401/403 means the stored session no longer belongs to this
   * browser's effective user (the HMAC-bound ownerToken stopped verifying —
   * e.g. a session written before runs were user-keyed). The stored run is
   * unusable forever, so it is dropped and the submission falls back to a
   * fresh run instead of dead-ending every subsequent submit.
   */
  private followUp(request: MktgGenerateRequest, stored: MktgStoredAgentRun): Observable<MktgRunAttempt> {
    const priorVersion = stored.versions.at(-1)?.version ?? 0;
    const body: MktgChatRequest = {
      agentId: request.agentId,
      message: renderMktgIntakeMessage(request.intake, request.answers, request.feedback, priorVersion || undefined),
      sessionId: stored.sessionId,
      ownerToken: stored.ownerToken,
    };
    return this.http.post<MktgChatResponse>('/api/mktg-agents/chat', body).pipe(
      map(() => ({ session: { agentId: request.agentId, sessionId: stored.sessionId, ownerToken: stored.ownerToken }, priorVersion })),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
          this.clearRun(request.projectUid, request.agentId);
          return this.startRun(request);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Polls the agent's validated result endpoint (owner token in the POST body,
   * never the query string) until it reports a `ready` document with a version
   * newer than the prior draft's. The endpoint surfaces only schema-validated,
   * sha256-verified envelopes, so agent status chatter can never be mistaken
   * for the document — anything else stays `pending`.
   *
   * A transient failure of one poll attempt (network drop, 408/429, upstream
   * 5xx — the app-wide `isTransientHttpError` policy) must never abort a
   * multi-minute generation whose session may not even be persisted yet, so it
   * degrades to a `pending` tick and the next interval retries; the overall
   * `timeout` still bounds the wait. Non-transient responses (401/403 — the
   * owner token stopped verifying) keep failing fast.
   *
   * `exhaustMap` — never `switchMap` — maps the ticks: a tick that fires while
   * a poll is still in flight is dropped instead of cancelling it. With
   * `switchMap`, result-endpoint latency consistently above the interval would
   * abort every attempt before it resolved, timing out a multi-minute
   * generation whose document may already be ready.
   */
  private pollForDocument(resultPath: string, session: MktgSessionInfo, priorVersion: number): Observable<MktgRunResultResponse> {
    const body: MktgRunResultBody = { sessionId: session.sessionId, ownerToken: session.ownerToken };
    return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
      exhaustMap(() =>
        this.http.post<MktgRunResultResponse>(resultPath, body).pipe(
          catchError((error: unknown) => {
            if (isTransientHttpError(error)) {
              return of<MktgRunResultResponse>({ status: 'pending' });
            }
            return throwError(() => error);
          })
        )
      ),
      filter((result) => result.status === 'ready' && typeof result.documentMarkdown === 'string' && (result.version ?? 0) > priorVersion),
      take(1),
      timeout(MKTG_RUN_POLL.timeoutMs)
    );
  }

  /** Appends the validated document as the next version and persists the run. */
  private appendVersion(request: MktgGenerateRequest, session: MktgSessionInfo, result: MktgRunResultResponse): MktgStoredAgentRun {
    const stored = this.loadRun(request.projectUid, request.agentId);
    const lastVersion = stored?.versions.length ? stored.versions[stored.versions.length - 1].version : 0;
    const version: MktgRunVersion = {
      // The envelope's own version is authoritative; pollForDocument guaranteed
      // it (and the document) is present, so the fallbacks are type-narrowing only.
      version: result.version ?? lastVersion + 1,
      document: result.documentMarkdown ?? '',
      feedback: request.feedback,
      createdAt: new Date().toISOString(),
    };
    const run: MktgStoredAgentRun = {
      agentId: request.agentId,
      projectUid: request.projectUid,
      sessionId: session.sessionId,
      ownerToken: session.ownerToken,
      answers: { ...request.answers },
      versions: [...(stored?.versions ?? []), version],
    };
    this.saveRun(run);
    return run;
  }

  /**
   * Saves to the in-memory cache (authoritative for this page session), then
   * best-effort to localStorage — a quota/disabled-storage failure never fails
   * the run and, thanks to the cache, never desyncs later follow-ups either.
   */
  private saveRun(run: MktgStoredAgentRun): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.storageKey(run.projectUid, run.agentId);
    if (!key) {
      return;
    }
    this.memoryRuns.set(key, run);
    try {
      window.localStorage.setItem(key, JSON.stringify(run));
    } catch {
      // Ignore — memoryRuns keeps this session coherent; only cross-visit restore is lost.
    }
  }

  /** Drops a stored run whose session the server no longer accepts. Storage removal is best-effort, like saveRun. */
  private clearRun(projectUid: string, agentId: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const key = this.storageKey(projectUid, agentId);
    if (!key) {
      return;
    }
    this.memoryRuns.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore — loadRun's validation treats an unremovable stale record as absent-on-error anyway.
    }
  }

  /**
   * Storage key scoped to the EFFECTIVE user's sub (impersonation swaps
   * `user()` in place), so a login or impersonation change can never surface —
   * or overwrite — another user's stored run. Null when signed out: stored
   * runs simply don't exist without an authenticated user to own them.
   */
  private storageKey(projectUid: string, agentId: string): string | null {
    const userSub = this.userService.user()?.sub;
    if (!userSub) {
      return null;
    }
    return `${MKTG_RUN_STORAGE_KEY_PREFIX}:${userSub}:${projectUid}:${agentId}`;
  }
}
