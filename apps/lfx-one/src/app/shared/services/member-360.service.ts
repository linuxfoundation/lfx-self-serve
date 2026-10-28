// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MEMBER_360_API, MEMBER_360_TRACKER_FILENAME_HEADER, MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants';
import {
  Member360GenerateRequest,
  Member360Session,
  Member360Tracker,
  Member360Result,
  MktgPendingGeneration,
  MktgRunAnswer,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, take, tap, throwError } from 'rxjs';
import { MktgRunAttemptService } from './mktg-run-attempt.service';

/** Dedicated intake/workbook transport. The shared Documents reader owns durable run progress. */
@Injectable({ providedIn: 'root' })
export class Member360Service {
  private readonly http = inject(HttpClient);
  private readonly attempts = inject(MktgRunAttemptService);

  public generate(body: Member360GenerateRequest): Observable<Member360Session> {
    const subject = this.attempts.subject();
    return this.http.post<Member360Session>(`${MEMBER_360_API}/generate`, body).pipe(
      take(1),
      tap((session) => {
        if (!session.runId || !session.documentId || subject !== this.attempts.subject()) return;
        this.attempts.save(
          {
            request: { projectUid: body.project, agentId: 'member-360', intake: MKTG_AGENT_INTAKES['member-360'], documentId: session.documentId, answers: {} },
            state: 'writing',
            updatedAt: new Date().toISOString(),
            attempt: { runId: session.runId, documentId: session.documentId, priorVersion: 0, session: { ...session, agentId: 'member-360' } },
          },
          subject
        );
      })
    );
  }

  public questions(pending: MktgPendingGeneration): Observable<Member360Result> {
    return this.http
      .post<Member360Result>(`${MEMBER_360_API}/result`, {
        sessionId: pending.attempt?.session.sessionId,
        ownerToken: pending.attempt?.session.ownerToken,
        project: pending.request.projectUid,
      })
      .pipe(take(1));
  }

  public answer(pending: MktgPendingGeneration, questionsId: string, answers: MktgRunAnswer[]): Observable<unknown> {
    const subject = this.attempts.subject();
    const session = pending.attempt?.session;
    return this.http
      .post(`${MEMBER_360_API}/answers`, {
        project: pending.request.projectUid,
        sessionId: session?.sessionId,
        ownerToken: session?.ownerToken,
        questionsId,
        answers: answers.map(({ key, ...answer }) => ({ ...answer, id: key })),
      })
      .pipe(
        take(1),
        tap(() => this.attempts.save({ ...pending, state: 'writing', pendingQuestions: undefined, answeredQuestionsId: questionsId }, subject))
      );
  }

  public download(project: string, documentId: string): Observable<Blob> {
    return this.http.get(`${MEMBER_360_API}/documents/${encodeURIComponent(documentId)}/workbook`, { params: { project }, responseType: 'blob' }).pipe(
      catchError((error) => {
        console.error('Member 360 workbook download failed', error);
        return throwError(() => error);
      })
    );
  }

  public parseTracker(project: string, file: File): Observable<Member360Tracker> {
    return this.http
      .post<Member360Tracker>(`${MEMBER_360_API}/tracker`, file, {
        params: { project },
        headers: { 'Content-Type': 'application/octet-stream', [MEMBER_360_TRACKER_FILENAME_HEADER]: encodeURIComponent(file.name) },
      })
      .pipe(take(1));
  }
}
