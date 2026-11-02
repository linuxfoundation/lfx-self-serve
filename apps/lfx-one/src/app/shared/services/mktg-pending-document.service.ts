// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  AEO_GEO_REFUSAL_MAX_CHARS,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_PENDING_DOCUMENT_STORAGE_PREFIX,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  AeoGeoAnswer,
  MktgAgentIntake,
  MktgPendingDocumentRun,
  MktgRunActivity,
  MktgRunQuestionDraft,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, exhaustMap, filter, map, Observable, of, take, tap, throwError, timeout, TimeoutError, timer } from 'rxjs';

import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { UserService } from './user.service';

/** A terminal agent reply, distinct from retryable transport or storage failures. */
export class MktgRunRefusalError extends Error {
  public constructor(reply: string) {
    super((reply || 'The run did not produce a report.').slice(0, AEO_GEO_REFUSAL_MAX_CHARS));
    this.name = 'MktgRunRefusalError';
  }
}

/** User-scoped one-off capabilities and polling shared by research, questions and the Document route. */
@Injectable({ providedIn: 'root' })
export class MktgPendingDocumentService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly user = inject(UserService);
  private readonly memory = new Map<string, MktgPendingDocumentRun>();

  public start(intake: MktgAgentIntake, projectUid: string, answers: Record<string, string>): Observable<MktgPendingDocumentRun> {
    // Capture ownership before the HTTP call. An impersonation switch must not
    // save the previous user's capability into the replacement user's storage.
    this.sweepExpiredRuns();
    const owner = this.user.user()?.sub;
    return this.http.post<MktgRunSessionResponse>(intake.endpoints.generate, { answers, project: projectUid }).pipe(
      take(1),
      map((response) => {
        if (
          !response.documentId ||
          !MKTG_DOCUMENT_ID_REGEX.test(response.documentId) ||
          !response.sessionId ||
          !response.ownerToken ||
          !owner ||
          owner !== this.user.user()?.sub
        ) {
          throw new Error('The run did not return a document destination for this user.');
        }
        const run: MktgPendingDocumentRun = {
          agentId: intake.agentId,
          projectUid,
          documentId: response.documentId,
          sessionId: response.sessionId,
          ownerToken: response.ownerToken,
          savedAt: new Date().toISOString(),
        };
        const key = this.key(projectUid, run.documentId);
        if (key && isPlatformBrowser(this.platformId)) {
          this.memory.set(key, run);
          try {
            localStorage.setItem(key, JSON.stringify(run));
          } catch {
            /* In-memory recovery still works for this visit. */
          }
        }
        return run;
      })
    );
  }

  public load(project: string, documentId: string): MktgPendingDocumentRun | null {
    this.sweepExpiredRuns();
    const key = this.key(project, documentId);
    if (!key || !isPlatformBrowser(this.platformId)) {
      return null;
    }
    try {
      const run: MktgPendingDocumentRun | null = this.memory.get(key) ?? JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        !run ||
        run.projectUid !== project ||
        run.documentId !== documentId ||
        typeof run.agentId !== 'string' ||
        typeof run.sessionId !== 'string' ||
        !run.sessionId ||
        typeof run.ownerToken !== 'string' ||
        !run.ownerToken ||
        (run.phase !== undefined && run.phase !== 'research' && run.phase !== 'writing') ||
        (run.questionDraft !== undefined &&
          (!Number.isInteger(run.questionDraft.index) ||
            !run.questionDraft.answers ||
            Object.values(run.questionDraft.answers).some((value) => typeof value !== 'string'))) ||
        this.isExpired(run.savedAt)
      ) {
        this.clear(project, documentId);
        return null;
      }
      return run;
    } catch {
      this.clear(project, documentId);
      return null;
    }
  }

  /** Newest resumable run of this effective user/project/agent, including after a browser reload. */
  public loadActive(project: string, agentId: string): MktgPendingDocumentRun | null {
    const sub = this.user.user()?.sub;
    if (!sub || !isPlatformBrowser(this.platformId)) {
      return null;
    }
    const prefix = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:${sub}:${project}:`;
    const keys = new Set(this.memory.keys());
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          keys.add(key);
        }
      }
    } catch {
      /* Memory remains available. */
    }
    const runs: MktgPendingDocumentRun[] = [];
    for (const key of keys) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const id = key.slice(prefix.length);
      const run = MKTG_DOCUMENT_ID_REGEX.test(id) ? this.load(project, id) : null;
      if (run?.agentId === agentId) {
        runs.push(run);
      }
    }
    return runs.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null;
  }

  public saveQuestionDraft(run: MktgPendingDocumentRun, questionDraft: MktgRunQuestionDraft | null): void {
    const current = this.load(run.projectUid, run.documentId);
    const key = this.key(run.projectUid, run.documentId);
    if (!key || !current || current.sessionId !== run.sessionId || current.ownerToken !== run.ownerToken || current.phase === 'writing') return;
    const next = { ...current, questionDraft: questionDraft ?? undefined };
    this.memory.set(key, next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* In-memory recovery remains available. */
    }
  }

  public markWriting(run: MktgPendingDocumentRun): boolean {
    const key = this.key(run.projectUid, run.documentId);
    const current = this.load(run.projectUid, run.documentId);
    if (!key || !current || current.ownerToken !== run.ownerToken) {
      return false;
    }
    const next: MktgPendingDocumentRun = { ...current, phase: 'writing', questionDraft: undefined };
    this.memory.set(key, next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* In-memory recovery still works. */
    }
    return true;
  }

  public answerQuestions(run: MktgPendingDocumentRun, intake: MktgAgentIntake, answers: AeoGeoAnswer[]): Observable<void> {
    if (!intake.endpoints.answers) {
      return throwError(() => new Error('This run takes no answers.'));
    }
    return this.http
      .post(intake.endpoints.answers, { project: run.projectUid, documentId: run.documentId, sessionId: run.sessionId, ownerToken: run.ownerToken, answers })
      .pipe(
        take(1),
        tap(() => this.saveQuestionDraft(run, null)),
        map(() => undefined)
      );
  }

  /** Shared polling for the research/questions page and the storage-gated Document handoff. */
  public poll(run: MktgPendingDocumentRun, intake: MktgAgentIntake): Observable<MktgRunResultResponse> {
    const started = Date.now();
    return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
      tap(() => {
        if (Date.now() - started > MKTG_RUN_POLL.timeoutMs) {
          throw new TimeoutError();
        }
      }),
      exhaustMap(() =>
        this.http
          .post<MktgRunResultResponse>(intake.endpoints.result, {
            sessionId: run.sessionId,
            ownerToken: run.ownerToken,
            project: run.projectUid,
          })
          .pipe(
            catchError((error: unknown) => {
              if (!isTransientHttpError(error)) return throwError(() => error);
              console.warn('Transient audit poll failure; retrying', error);
              return of<MktgRunResultResponse>({ status: 'pending', transient: true });
            })
          )
      ),
      catchError((error: unknown) => {
        if (!(error instanceof TimeoutError)) this.clear(run.projectUid, run.documentId);
        return throwError(() => error);
      })
    );
  }

  /** A ready report without a persistence receipt is NOT a stored Document. */
  public waitForStorage(run: MktgPendingDocumentRun, intake: MktgAgentIntake, onActivity?: (activity: MktgRunActivity[]) => void): Observable<void> {
    return this.poll(run, intake).pipe(
      // Activity is optional on old runs and the first poll; storage remains the completion gate.
      tap((result) => {
        if (result.status === 'refused' || result.status === 'failed') {
          this.clear(run.projectUid, run.documentId);
          throw new MktgRunRefusalError(
            result.status === 'failed'
              ? result.failure?.reason || result.failureText || 'The audit ended without a report. Start a new audit.'
              : (result.reply ?? '')
          );
        }
        if (intake.liveActivity && result.activity) {
          onActivity?.(result.activity);
        }
      }),
      filter((result) => result.status === 'ready' && !!result.persistence),
      take(1),
      timeout(MKTG_RUN_POLL.timeoutMs),
      map(() => undefined),
      catchError((error: unknown) => {
        if (!(error instanceof TimeoutError)) this.clear(run.projectUid, run.documentId);
        return throwError(() => error);
      })
    );
  }

  public clear(project: string, documentId: string): void {
    const key = this.key(project, documentId);
    if (!key || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.removeKey(key);
  }

  /** Prune this user's entire pending namespace, including documents never reopened. */
  private sweepExpiredRuns(): void {
    const sub = this.user.user()?.sub;
    if (!sub || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const prefix = `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:${sub}:`;
    for (const [key, run] of this.memory) {
      if (key.startsWith(prefix) && this.isExpired(run.savedAt)) {
        this.removeKey(key);
      }
    }
    try {
      // Snapshot before removing entries, so shifted indices cannot skip a key.
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) {
        if (!key?.startsWith(prefix)) {
          continue;
        }
        try {
          const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
          const savedAt = typeof stored === 'object' && stored !== null && 'savedAt' in stored ? stored.savedAt : undefined;
          if (this.isExpired(savedAt)) {
            this.removeKey(key);
          }
        } catch {
          this.removeKey(key);
        }
      }
    } catch {
      // Disabled storage cannot be enumerated; expired in-memory capabilities
      // were still pruned above. No persistent storage is available to read.
    }
  }

  private isExpired(savedAt: unknown): boolean {
    return typeof savedAt !== 'string' || !Number.isFinite(Date.parse(savedAt)) || Date.now() - Date.parse(savedAt) > MKTG_RUN_STORAGE_TTL_MS;
  }

  private removeKey(key: string): void {
    this.memory.delete(key);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* Storage may be disabled. */
    }
  }

  private key(project: string, documentId: string): string | null {
    const sub = this.user.user()?.sub;
    return sub ? `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:${sub}:${project}:${documentId}` : null;
  }
}
