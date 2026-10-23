// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  MKTG_DOCUMENTS_API_PATH,
  MKTG_DOCUMENT_TYPES,
  MKTG_AGENT_INTAKES,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_RUN_STORAGE_TTL_MS,
} from '@lfx-one/shared/constants';
import type {
  MktgDocumentCommentScope,
  MktgPendingRedraftIntent,
  MktgRedraftStartResponse,
  MktgRedraftProgress,
  MktgReviseDocumentRequest,
  MktgRunAttempt,
  MktgReleaseRedraftResponse,
  MktgRedraftRecoveryResponse,
} from '@lfx-one/shared/interfaces';
import { mktgDocumentLocationOfReceipt } from '@lfx-one/shared/utils';
import { catchError, concat, concatMap, defer, EMPTY, filter, finalize, map, Observable, of, take, takeUntil, tap, throwError } from 'rxjs';
import { MktgRunAttemptService } from './mktg-run-attempt.service';
import { MktgAgentRunService } from './mktg-agent-run.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { ProjectContextService } from './project-context.service';

/** ID-only intent + existing accepted-run observer; never generates intake answers or falls back to Generate. */
@Injectable({ providedIn: 'root' })
export class MktgDocumentRedraftClientService {
  private readonly http = inject(HttpClient);
  private readonly attempts = inject(MktgRunAttemptService);
  private readonly runs = inject(MktgAgentRunService);
  private readonly comments = inject(MktgDocumentCommentsService);
  private readonly project = inject(ProjectContextService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly identity = computed(() => JSON.stringify([this.attempts.subject(), this.project.activeContextUid()]));
  private readonly identity$ = toObservable(this.identity);
  private readonly active = new Set<string>();

  public hasIntent(scope: MktgDocumentCommentScope): boolean {
    return !!this.attempts.loadRedraft(scope);
  }

  public hasAcceptedAttempt(scope: MktgDocumentCommentScope): boolean {
    return !!this.attempts.loadRedraft(scope)?.attempt;
  }
  public canRelease(scope: MktgDocumentCommentScope): boolean {
    const intent = this.attempts.loadRedraft(scope);
    return !!intent && !intent.attempt && intent.releaseAllowed === true;
  }

  /** Explicit action only. An uncertain nonce always reuses its EXACT frozen IDs, not today's newly added comments. */
  public send(scope: MktgDocumentCommentScope, priorVersion: number): Observable<MktgRedraftProgress> {
    return defer(() => {
      if (!isPlatformBrowser(this.platformId)) return EMPTY;
      const owner = this.identity();
      this.assertOwner(owner, scope);
      let intent = this.attempts.loadRedraft(scope);
      if (!intent) {
        if (!this.comments.loaded() || this.comments.loading() || this.comments.saving())
          throw new Error('Load the selected revision comments before sending.');
        const selected = this.comments.selectedScope();
        if (
          !selected ||
          selected.projectUid !== scope.projectUid ||
          selected.agentKey !== scope.agentKey ||
          selected.documentId !== scope.documentId ||
          selected.revisionId !== scope.revisionId
        )
          throw new Error('The asset revision changed.');
        const ids = this.comments
          .threads()
          .filter((row) => row.status === 'open' && row.revisionId === scope.revisionId)
          .map((row) => row.id);
        if (!ids.length || ids.length > MKTG_DOCUMENT_COMMENT_LIMITS[scope.agentKey] || !Number.isSafeInteger(priorVersion) || priorVersion < 1)
          throw new Error('Choose a supported number of open comments on a stored asset.');
        intent = { scope: { ...scope }, priorVersion, commentIds: ids, clientRequestId: window.crypto.randomUUID(), updatedAt: new Date().toISOString() };
        this.attempts.saveRedraft(intent); // BEFORE POST; transport failure never creates a new nonce automatically.
      }
      const key = `${owner}:${intent.clientRequestId}`;
      if (this.active.has(key)) return EMPTY;
      this.active.add(key);
      const frozen = intent;
      return this.reconcile(frozen, owner).pipe(
        concatMap((current) =>
          current
            ? this.accept(current, owner)
            : of<MktgRedraftProgress>({ type: 'failed', message: 'The earlier send finished. Comments were refreshed; send remaining feedback explicitly.' })
        ),
        takeUntil(this.identity$.pipe(filter((value) => value !== owner))),
        finalize(() => this.active.delete(key))
      );
    });
  }
  /** Explicit creator release only; success frees local nonce for a later explicit NEW send, never sends itself. */
  public release(scope: MktgDocumentCommentScope): Observable<void> {
    return defer(() => {
      if (!isPlatformBrowser(this.platformId)) return EMPTY;
      const owner = this.identity();
      this.assertOwner(owner, scope);
      const intent = this.attempts.loadRedraft(scope);
      if (!intent) return EMPTY;
      if (intent.attempt) throw new Error('The agent is still working on this redraft. Retry checks the same run.');
      const path = `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(scope.agentKey)}/${encodeURIComponent(scope.documentId)}/revise/${encodeURIComponent(intent.clientRequestId)}/release`;
      return this.http.post<MktgReleaseRedraftResponse>(path, { project: scope.projectUid }).pipe(
        take(1),
        takeUntil(this.identity$.pipe(filter((value) => value !== owner))),
        tap((ack) => {
          this.assertOwner(owner, scope);
          if (!ack || !(('success' in ack && ack.success === true) || ('state' in ack && ack.state === 'unknown')))
            throw new Error('The release could not be confirmed. The original send is retained.');
          this.attempts.clearRedraft(scope);
          this.comments.refresh();
        }),
        map(() => undefined)
      );
    });
  }

  /** Navigation/refresh restores no POST. A known accepted attempt may resume only result/receipt reads. */
  public resume(scope: MktgDocumentCommentScope): Observable<MktgRedraftProgress> {
    return defer(() => {
      if (!isPlatformBrowser(this.platformId)) return EMPTY;
      const owner = this.identity();
      this.assertOwner(owner, scope);
      const intent = this.attempts.loadRedraft(scope);
      if (!intent) return EMPTY;
      return this.reconcile(intent, owner).pipe(
        concatMap((current) => (current?.attempt ? this.observe(current, current.attempt, owner) : EMPTY)),
        takeUntil(this.identity$.pipe(filter((value) => value !== owner)))
      );
    });
  }
  /** TTL expires capabilities, never an unresolved ID-only nonce without authoritative terminal state. */
  private reconcile(intent: MktgPendingRedraftIntent, owner: string): Observable<MktgPendingRedraftIntent | null> {
    const age = Date.now() - Date.parse(intent.updatedAt);
    if (Number.isFinite(age) && age >= 0 && age <= MKTG_RUN_STORAGE_TTL_MS) return of(intent);
    const scope = intent.scope;
    const path = `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(scope.agentKey)}/${encodeURIComponent(scope.documentId)}/revise/${encodeURIComponent(intent.clientRequestId)}/state`;
    return this.http.get<MktgRedraftRecoveryResponse>(path, { params: { project: scope.projectUid, revision: scope.revisionId }, transferCache: false }).pipe(
      take(1),
      map((response) => {
        this.assertOwner(owner, scope);
        if (!response || typeof response.terminal !== 'boolean') throw new Error('The earlier send could not be reconciled. Its recovery ID is retained.');
        if (response.terminal) {
          this.attempts.clearRedraft(scope);
          this.comments.refresh();
          return null;
        }
        const retained = { ...intent, updatedAt: new Date().toISOString() };
        this.attempts.saveRedraft(retained);
        return retained;
      })
    );
  }
  private accept(intent: MktgPendingRedraftIntent, owner: string): Observable<MktgRedraftProgress> {
    if (intent.attempt) return this.observe(intent, intent.attempt, owner);
    const scope = intent.scope;
    const body: MktgReviseDocumentRequest = {
      project: scope.projectUid,
      revisionId: scope.revisionId,
      commentIds: [...intent.commentIds],
      clientRequestId: intent.clientRequestId,
    };
    const path = `${MKTG_DOCUMENTS_API_PATH}/${encodeURIComponent(scope.agentKey)}/${encodeURIComponent(scope.documentId)}/revise`;
    return this.http.post<MktgRedraftStartResponse>(path, body).pipe(
      take(1),
      catchError((error: unknown) => {
        if (owner === this.identity() && error instanceof HttpErrorResponse) {
          const code = error.error?.code;
          const rejected =
            (error.status === 400 && code === 'VALIDATION_ERROR') ||
            (error.status === 404 && code === 'NOT_FOUND') ||
            (error.status === 409 && (code === 'MKTG_REDRAFT_COMMENTS_BUSY' || code === 'MKTG_REDRAFT_REQUEST_FAILED'));
          // Only these PRIMARY BFF answers prove non-acceptance. Unknown 4xx/5xx and transport failures retain creator recovery.
          if (rejected) {
            this.attempts.clearRedraft(scope);
            this.comments.refresh();
          } else this.attempts.saveRedraft({ ...intent, releaseAllowed: true });
        }
        return throwError(() => error);
      }),
      concatMap((ack) => {
        this.assertOwner(owner, scope);
        if (
          !ack ||
          typeof ack.runId !== 'string' ||
          !MKTG_STARTED_RUN_ID_REGEX.test(ack.runId) ||
          typeof ack.sessionId !== 'string' ||
          !ack.sessionId ||
          typeof ack.ownerToken !== 'string' ||
          !ack.ownerToken ||
          !Number.isSafeInteger(ack.priorVersion) ||
          ack.priorVersion < 1 ||
          ack.priorVersion >= Number.MAX_SAFE_INTEGER
        )
          throw new Error('The start could not be confirmed. Retry the same send.');
        const agentId = MKTG_DOCUMENT_TYPES.find((row) => row.agentKey === scope.agentKey)?.catalogAgentId;
        if (!agentId) throw new Error('This asset has no registered agent.');
        const attempt: MktgRunAttempt = {
          runId: ack.runId,
          session: { agentId, sessionId: ack.sessionId, ownerToken: ack.ownerToken },
          priorVersion: ack.priorVersion,
        };
        const accepted = { ...intent, priorVersion: ack.priorVersion, releaseAllowed: false, attempt };
        this.attempts.saveRedraft(accepted);
        this.comments.refresh();
        return concat(of<MktgRedraftProgress>({ type: 'submitted', attempt }), this.observe(accepted, attempt, owner));
      })
    );
  }
  private observe(intent: MktgPendingRedraftIntent, attempt: MktgRunAttempt, owner: string): Observable<MktgRedraftProgress> {
    const scope = intent.scope;
    const type = MKTG_DOCUMENT_TYPES.find((row) => row.agentKey === scope.agentKey);
    const intake = type?.catalogAgentId ? MKTG_AGENT_INTAKES[type.catalogAgentId] : null;
    if (!intake) return throwError(() => new Error('This asset has no registered result observer.'));
    return this.runs.observeAccepted(intake, attempt, scope.projectUid).pipe(
      concatMap(({ result, terminal }) => {
        this.assertOwner(owner, scope);
        const activity$ = result.activity ? of<MktgRedraftProgress>({ type: 'activity', activity: result.activity }) : EMPTY;
        if (!terminal) return activity$;
        if (result.status === 'failed' || result.status === 'refused' || result.status === 'questions') {
          this.attempts.clearRedraft(scope);
          this.comments.refresh();
          return concat(
            activity$,
            of<MktgRedraftProgress>({
              type: 'failed',
              message:
                result.status === 'questions'
                  ? 'The agent asked questions on a comments-only redraft. The comments are reopened; send again explicitly.'
                  : (result.failureText ?? result.reply ?? 'The agent did not return a redraft.'),
            })
          );
        }
        const location = result.persistence?.project === scope.projectUid ? mktgDocumentLocationOfReceipt(result.persistence) : undefined;
        if (!location) return concat(activity$, of<MktgRedraftProgress>({ type: 'storing' }));
        if (
          location.agentKey !== scope.agentKey ||
          location.documentId !== scope.documentId ||
          location.revisionId === scope.revisionId ||
          result.version !== attempt.priorVersion + 1
        )
          throw new Error('The stored result does not match the selected redraft.');
        this.attempts.clearRedraft(scope);
        return concat(activity$, of<MktgRedraftProgress>({ type: 'ready', location }));
      })
    );
  }
  private assertOwner(owner: string, scope: MktgDocumentCommentScope): void {
    if (!this.attempts.subject() || owner !== this.identity() || scope.projectUid !== this.project.activeContextUid())
      throw new Error('The effective viewer or project changed.');
  }
}
