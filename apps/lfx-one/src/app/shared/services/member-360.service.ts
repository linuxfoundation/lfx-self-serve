// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import {
  MEMBER_360_API,
  MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS,
  MEMBER_360_RUN_CEILING_MS,
  MEMBER_360_TRACKER_FILENAME_HEADER,
  MKTG_RUN_POLL,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  Member360GenerateRequest,
  Member360PendingRun,
  Member360Result,
  Member360Session,
  Member360Tracker,
  MktgRunActivity,
} from '@lfx-one/shared/interfaces';
import {
  catchError,
  defer,
  EMPTY,
  exhaustMap,
  filter,
  mergeMap,
  mergeWith,
  Observable,
  of,
  take,
  takeWhile,
  tap,
  throwError,
  timeout,
  TimeoutError,
  timer,
} from 'rxjs';

import { UserService } from './user.service';
import { isTransientHttpError } from '@shared/utils/http-error.utils';

/** Pending capabilities are scoped to user + project + document, expire, and never enter URLs. */
@Injectable({ providedIn: 'root' })
export class Member360Service {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly users = inject(UserService);
  private readonly pending = new Map<string, Member360PendingRun>();

  public generate(body: Member360GenerateRequest): Observable<Member360Session> {
    const user = this.users.user()?.sub ?? '';
    return this.http.post<Member360Session>(`${MEMBER_360_API}/generate`, body).pipe(
      take(1),
      tap((session) => {
        const key = this.key(user, body.project, session.documentId);
        const value = { user, project: body.project, session, startedAt: Date.now() };
        this.pending.set(key, value);
        if (isPlatformBrowser(this.platformId)) {
          try {
            sessionStorage.setItem(key, JSON.stringify(value));
          } catch {
            /* Memory still supports navigation when storage is disabled. */
          }
        }
      })
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

  public isPending(project: string, documentId: string): boolean {
    return !!this.readPending(project, documentId);
  }

  public pendingStartedAt(project: string, documentId: string): number | null {
    return this.readPending(project, documentId)?.startedAt ?? null;
  }

  public waitForStored(project: string, documentId: string, onActivity?: (activity: MktgRunActivity[]) => void): Observable<Member360Result> {
    const pending = this.readPending(project, documentId);
    if (!pending) return throwError(() => new Error('No pending run for this user and project'));
    const deadline = pending.startedAt + MEMBER_360_RUN_CEILING_MS;
    return defer(() => {
      // At or near the ceiling, check once instead of timing out before the first poll.
      const expired = Date.now() >= deadline - MKTG_RUN_POLL.initialDelayMs;
      let waitingSince: number | null = null;
      return (expired ? timer(0) : timer(MKTG_RUN_POLL.initialDelayMs, MKTG_RUN_POLL.intervalMs)).pipe(
        exhaustMap(() => {
          if (waitingSince !== null && Date.now() - waitingSince < MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS) return EMPTY;
          const poll = this.http
            .post<Member360Result>(`${MEMBER_360_API}/result`, { project, sessionId: pending.session.sessionId, ownerToken: pending.session.ownerToken })
            .pipe(
              catchError((error) => {
                if (!isTransientHttpError(error)) return throwError(() => error);
                console.warn('Member 360 result poll temporarily unavailable; retrying.');
                return of<Member360Result>({ status: 'pending' });
              })
            );
          return expired ? poll.pipe(timeout({ first: MKTG_RUN_POLL.timeoutMs })) : poll;
        }),
        // Report progress without releasing the document's persistence gate. A transient
        // poll failure has no activity, so it must not erase the last successful feed.
        tap((result) => {
          waitingSince = result.status === 'needs_input' ? Date.now() : null;
          if (result.activity) onActivity?.(result.activity);
        }),
        mergeMap((result) =>
          expired && !(result.status === 'failed' || (result.status === 'ready' && result.stored === true)) ? throwError(() => new TimeoutError()) : of(result)
        ),
        filter((result) => result.status === 'failed' || result.status === 'needs_input' || (result.status === 'ready' && result.stored === true)),
        // Absolute ceiling from startedAt; needs_input does not extend it.
        mergeWith(expired ? EMPTY : timer(new Date(deadline)).pipe(mergeMap(() => throwError(() => new TimeoutError())))),
        // Include the terminal result before completing; needs_input keeps the poll open.
        takeWhile((result) => !(result.status === 'failed' || (result.status === 'ready' && result.stored === true)), true),
        tap({
          next: (result) => {
            if (result.status === 'ready' || result.status === 'failed') this.forget(project, documentId);
          },
          // A timed-out poll may resume from the document. Permanent errors cannot.
          error: (error: unknown) => {
            if (!(error instanceof TimeoutError)) this.forget(project, documentId);
          },
        })
      );
    });
  }

  private readPending(project: string, documentId: string): Member360PendingRun | null {
    const user = this.users.user()?.sub ?? '';
    const key = this.key(user, project, documentId);
    let value = this.pending.get(key);
    if (!value && isPlatformBrowser(this.platformId)) {
      try {
        value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Member360PendingRun | undefined;
      } catch {
        return null;
      }
    }
    if (
      !value ||
      value.user !== user ||
      value.project !== project ||
      value.session?.documentId !== documentId ||
      typeof value.session.sessionId !== 'string' ||
      typeof value.session.ownerToken !== 'string' ||
      typeof value.startedAt !== 'number' ||
      Date.now() - value.startedAt > MKTG_RUN_STORAGE_TTL_MS
    ) {
      this.forget(project, documentId);
      return null;
    }
    return value;
  }

  private forget(project: string, documentId: string): void {
    const key = this.key(this.users.user()?.sub ?? '', project, documentId);
    this.pending.delete(key);
    if (isPlatformBrowser(this.platformId)) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Best effort when browser storage is unavailable. */
      }
    }
  }

  private key(user: string, project: string, documentId: string): string {
    return `lfx-member-360-pending:${JSON.stringify([user, project, documentId])}`;
  }
}
