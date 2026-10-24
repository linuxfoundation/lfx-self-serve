// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  LINKEDIN_API,
  LINKEDIN_SHARE_LINK_MAX_CHARS,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_PENDING_DOCUMENT_STORAGE_PREFIX,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  LinkedinGeneration,
  LinkedinPendingRun,
  LinkedinProfile,
  LinkedinResult,
  LinkedinSetup,
  LinkedinStoredProfile,
  MktgAgentIntake,
  MktgRunAnswer,
  MktgRunAnswersResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, exhaustMap, filter, map, Observable, of, take, tap, throwError, timeout, timer } from 'rxjs';
import { UserService } from './user.service';
import { isTransientHttpError } from '@shared/utils/http-error.utils';

/** Per-user profile client and bounded one-off generation poll. No feedback request exists here. */
@Injectable({ providedIn: 'root' })
export class LinkedinPostService {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PLATFORM_ID);
  private readonly user = inject(UserService);
  private readonly answeredRounds = new WeakMap<LinkedinGeneration, string>();
  private readonly unsavedSetup = new Map<string, { setup: LinkedinSetup; savedAt: number }>();

  public profile(): Observable<{ profile: LinkedinStoredProfile | null }> {
    return this.http.get<{ profile: LinkedinStoredProfile | null }>(`${LINKEDIN_API}/profile`).pipe(
      catchError((error) => {
        console.error('Could not load the LinkedIn profile');
        return throwError(() => error);
      })
    );
  }
  public save(body: { setup?: LinkedinSetup; profile?: LinkedinProfile }): Observable<{ profile: LinkedinStoredProfile }> {
    return this.http.put<{ profile: LinkedinStoredProfile }>(`${LINKEDIN_API}/profile`, body).pipe(take(1));
  }
  public startForDocument(intake: MktgAgentIntake, project: string, answers: Record<string, string>, setup?: LinkedinSetup): Observable<LinkedinGeneration> {
    return this.create(intake, project, answers, setup).pipe(
      tap((run) => {
        if (setup) this.unsavedSetup.set(this.setupKey(project, run.documentId), { setup: { ...setup }, savedAt: Date.now() });
      })
    );
  }

  /** Explicit profile editing only. A new client/browser cannot recover private setup. */
  public setupForDocument(project: string, documentId: string): LinkedinSetup | null {
    if (!isPlatformBrowser(this.platform) || !this.user.user()?.sub) return null;
    const key = this.setupKey(project, documentId);
    const value = this.unsavedSetup.get(key);
    if (!value || Date.now() - value.savedAt > MKTG_RUN_STORAGE_TTL_MS) {
      this.unsavedSetup.delete(key);
      return null;
    }
    return { ...value.setup };
  }

  /** @deprecated Removed with legacy pending/wait/cache APIs in the deletion-only L5 child. New forms use startForDocument. */
  public start(intake: MktgAgentIntake, project: string, answers: Record<string, string>, setup?: LinkedinSetup): Observable<LinkedinGeneration> {
    const owner = this.user.user()?.sub ?? '';
    return this.create(intake, project, answers, setup).pipe(
      tap((run) => {
        const pending: LinkedinPendingRun = {
          ...run,
          agentId: intake.agentId,
          projectUid: project,
          savedAt: new Date().toISOString(),
        };
        if (isPlatformBrowser(this.platform)) {
          try {
            localStorage.setItem(`${this.prefix(owner)}${project}:${run.documentId}`, this.serializePending(pending));
          } catch {
            console.warn('Pending-run recovery is unavailable in this browser.');
          }
        }
      })
    );
  }
  /** @deprecated Removed in the deletion-only L5 child; new forms use shared document-scoped attempts. */
  public pending(intake: MktgAgentIntake, project: string): LinkedinPendingRun | null {
    const owner = this.user.user()?.sub;
    if (!owner || !isPlatformBrowser(this.platform)) return null;
    let latest: LinkedinPendingRun | null = null;
    try {
      const prefix = this.prefix(owner);
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) {
        if (!key?.startsWith(prefix)) continue;
        try {
          const raw = localStorage.getItem(key) ?? 'null';
          const parsed = JSON.parse(raw) as LinkedinPendingRun | null;
          const sanitized = parsed ? this.serializePending(parsed) : 'null';
          const run = JSON.parse(sanitized) as LinkedinPendingRun | null;
          if (parsed && sanitized !== raw) localStorage.setItem(key, sanitized);
          if (!run || !Number.isFinite(Date.parse(run.savedAt)) || Date.now() - Date.parse(run.savedAt) > MKTG_RUN_STORAGE_TTL_MS) {
            localStorage.removeItem(key);
            continue;
          }
          if (
            run.agentId === intake.agentId &&
            run.projectUid === project &&
            MKTG_DOCUMENT_ID_REGEX.test(run.documentId) &&
            run.sessionId &&
            run.ownerToken &&
            run.source &&
            (!latest || run.savedAt > latest.savedAt)
          )
            latest = run;
        } catch {
          localStorage.removeItem(key);
        }
      }
    } catch {
      /* Disabled browser storage cannot restore a pending capability. */
    }
    return latest;
  }
  /** @deprecated Removed in the deletion-only L5 child; link editing now belongs to the document. */
  public rememberShareLink(project: string, run: LinkedinGeneration, link: string): void {
    const owner = this.user.user()?.sub;
    if (!owner || !isPlatformBrowser(this.platform)) return;
    try {
      const key = `${this.prefix(owner)}${project}:${run.documentId}`;
      const pending = JSON.parse(localStorage.getItem(key) ?? 'null') as LinkedinPendingRun | null;
      if (!pending || pending.projectUid !== project || pending.documentId !== run.documentId || pending.sessionId !== run.sessionId) return;
      localStorage.setItem(key, this.serializePending({ ...pending, answers: { ...pending.answers, [LINKEDIN_SHARE_LINK_ANSWER_KEY]: link } }));
    } catch {
      console.warn('Pending-run answer recovery is unavailable in this browser.');
    }
  }

  /** @deprecated Removed in the deletion-only L5 child; answers use the shared run service. */
  public answer(
    intake: MktgAgentIntake,
    project: string,
    run: LinkedinGeneration,
    questionsId: string,
    answers: MktgRunAnswer[]
  ): Observable<MktgRunAnswersResponse> {
    const owner = this.user.user()?.sub;
    return this.http
      .post<MktgRunAnswersResponse>(intake.endpoints.answers ?? `${LINKEDIN_API}/answers`, {
        sessionId: run.sessionId,
        ownerToken: run.ownerToken,
        project,
        questionsId,
        answers,
      })
      .pipe(
        take(1),
        tap(() => {
          if (owner !== this.user.user()?.sub) throw new Error('The effective user changed.');
          this.answeredRounds.set(run, questionsId);
          this.rememberQuestions(project, run, questionsId);
        })
      );
  }

  /** @deprecated Removed in the deletion-only L5 child; new forms never poll results. */
  public wait(intake: MktgAgentIntake, project: string, run: LinkedinGeneration, onProgress?: (result: LinkedinResult) => void): Observable<LinkedinResult> {
    const owner = this.user.user()?.sub;
    return timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs).pipe(
      exhaustMap(() =>
        this.http
          .post<LinkedinResult>(intake.endpoints.result, {
            sessionId: run.sessionId,
            ownerToken: run.ownerToken,
            project,
            answers: run.answers,
            sourceWords: run.source.words,
          })
          .pipe(catchError((error) => (isTransientHttpError(error) ? of<LinkedinResult>({ status: 'pending' }) : throwError(() => error))))
      ),
      tap((result) => {
        if (owner !== this.user.user()?.sub) throw new Error('The effective user changed.');
        onProgress?.(result);
      }),
      filter(
        (result) =>
          result.status === 'failed' ||
          (result.status === 'ready' && !!result.envelope && !!result.persistence) ||
          (result.status === 'questions' &&
            !!result.questions?.length &&
            !!result.questionsId &&
            result.questionsId !== (this.answeredRounds.get(run) ?? run.answeredQuestionsId))
      ),
      take(1),
      timeout(MKTG_RUN_POLL.timeoutMs),
      tap((result) => {
        if (owner !== this.user.user()?.sub) throw new Error('The effective user changed.');
        if ((result.status === 'ready' || result.status === 'failed') && owner && isPlatformBrowser(this.platform)) {
          try {
            localStorage.removeItem(`${this.prefix(owner)}${project}:${run.documentId}`);
          } catch {
            /* Recovery storage may be disabled. */
          }
        }
      })
    );
  }
  private rememberQuestions(project: string, run: LinkedinGeneration, questionsId: string): void {
    const owner = this.user.user()?.sub;
    if (!owner || !isPlatformBrowser(this.platform)) return;
    try {
      const key = `${this.prefix(owner)}${project}:${run.documentId}`;
      const pending = JSON.parse(localStorage.getItem(key) ?? 'null') as LinkedinPendingRun | null;
      if (pending?.sessionId === run.sessionId && pending.projectUid === project)
        localStorage.setItem(key, this.serializePending({ ...pending, answeredQuestionsId: questionsId }));
    } catch {
      /* Disabled recovery storage does not prevent same-session answers. */
    }
  }

  /** Raw sources/setup stay in the live request; every persisted retry snapshot requires source re-entry. */
  private serializePending(pending: LinkedinPendingRun): string {
    const retry = pending.retryInputs;
    if (!retry) return JSON.stringify(pending);
    const answers = Object.fromEntries(
      Object.entries(retry.answers).filter(
        ([key, value]) => ['content_source', LINKEDIN_SHARE_LINK_ANSWER_KEY].includes(key) && value.length <= LINKEDIN_SHARE_LINK_MAX_CHARS
      )
    );
    return JSON.stringify({
      ...pending,
      retryInputs: { answers, requiresSource: !!retry.requiresSource || !!retry.answers['content_source'] },
    });
  }

  private setupKey(project: string, documentId: string): string {
    return `${this.user.user()?.sub ?? ''}:${project}:${documentId}`;
  }

  private create(intake: MktgAgentIntake, project: string, answers: Record<string, string>, setup?: LinkedinSetup): Observable<LinkedinGeneration> {
    const owner = this.user.user()?.sub;
    return this.http.post<LinkedinGeneration>(intake.endpoints.generate, { project, answers, ...(setup ? { setup } : {}) }).pipe(
      take(1),
      map((run) => ({ ...run, retryInputs: { answers: { ...answers }, ...(setup ? { setup: { ...setup } } : {}) } })),
      tap((run) => {
        if (!owner || owner !== this.user.user()?.sub || !MKTG_DOCUMENT_ID_REGEX.test(run.documentId))
          throw new Error('The run belongs to a different user or has no document destination.');
      })
    );
  }

  private prefix(owner: string): string {
    return `${MKTG_PENDING_DOCUMENT_STORAGE_PREFIX}:${owner}:`;
  }
}
