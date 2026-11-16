// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { MktgPublicRunAnswersResponse, MktgRunAnswersRequest, MktgRunAnsweredNotice, MktgDocumentRunProgress } from '@lfx-one/shared/interfaces';
import { mktgRunAnsweredBy } from '@lfx-one/shared/utils';
import { catchError, Observable, ReplaySubject, share, take, throwError } from 'rxjs';
import { UserService } from './user.service';

/** Writer-authorized continuation without a private session or owner token. Never retries a POST. */
@Injectable({ providedIn: 'root' })
export class MktgRunAnswersService {
  private readonly http = inject(HttpClient);
  private readonly user = inject(UserService);
  private readonly notices = signal<Record<string, MktgRunAnsweredNotice>>({});
  private readonly epochs = new Map<string, number>();
  private readonly runs = new Map<string, string>();

  public notice(project: string, agentKey: string, documentId: string): MktgRunAnsweredNotice | null {
    const key = this.key(project, agentKey, documentId);
    return key ? (this.notices()[key] ?? null) : null;
  }

  public remember(project: string, agentKey: string, documentId: string, notice: MktgRunAnsweredNotice): void {
    const key = this.key(project, agentKey, documentId);
    if (!key || (this.runs.has(key) && this.runs.get(key) !== notice.runId)) return;
    this.runs.set(key, notice.runId);
    this.notices.update((current) => ({ ...current, [key]: notice }));
  }

  /** Only a newly accepted/server-confirmed run invalidates an older response, not an unsuccessful Start intent. */
  public observeRun(project: string, agentKey: string, documentId: string, runId: string): void {
    const key = this.key(project, agentKey, documentId);
    if (!key || !runId) return;
    const prior = this.runs.get(key);
    if (prior && prior !== runId) this.clear(project, agentKey, documentId);
    this.runs.set(key, runId);
  }

  public clear(project: string, agentKey: string, documentId: string): void {
    const key = this.key(project, agentKey, documentId);
    if (!key) return;
    this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
    this.notices.update((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  public answer(
    runId: string,
    request: MktgRunAnswersRequest,
    target?: Pick<MktgDocumentRunProgress, 'agentKey' | 'documentId'>
  ): Observable<MktgPublicRunAnswersResponse> {
    const subject = this.user.user()?.sub;
    if (target) this.observeRun(request.project, target.agentKey, target.documentId, runId);
    const key = target ? this.key(request.project, target.agentKey, target.documentId) : '';
    const epoch = this.epochs.get(key) ?? 0;
    return this.http.post<MktgPublicRunAnswersResponse>(`/api/mktg-agents/runs/${encodeURIComponent(runId)}/answers`, request).pipe(
      take(1),
      catchError((error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 409 &&
          target &&
          subject === this.user.user()?.sub &&
          (this.epochs.get(key) ?? 0) === epoch
        ) {
          const name = mktgRunAnsweredBy(error.error, runId, request.questionsId);
          if (name)
            this.remember(request.project, target.agentKey, target.documentId, {
              runId,
              questionsId: request.questionsId,
              message: `${name} already answered these — the agent is writing.`,
            });
        }
        return throwError(() => error);
      }),
      // The response must outlive a fast metadata landing; cache its terminal result, never repeat this POST.
      share({ connector: () => new ReplaySubject<MktgPublicRunAnswersResponse>(1), resetOnError: false, resetOnComplete: false, resetOnRefCountZero: false })
    );
  }

  private key(project: string, agentKey: string, documentId: string): string {
    const subject = this.user.user()?.sub;
    return subject && project && agentKey && documentId ? JSON.stringify([subject, project, agentKey, documentId]) : '';
  }
}
