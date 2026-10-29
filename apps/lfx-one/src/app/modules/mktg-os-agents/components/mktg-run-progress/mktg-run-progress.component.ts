// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import {
  MKTG_DOCUMENT_PROGRESS_POLL,
  MKTG_DOCUMENT_TYPES,
  MKTG_RUN_POLL,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_STARTED_RUN_STATE_ORDER,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentLocalProgress,
  MktgDocumentReadCycle,
  MktgRevisionResponse,
  MktgRunActivity,
} from '@lfx-one/shared/interfaces';
import { findMktgRunIntake, mktgKitAssetLabel, mktgSentenceCaseLabel } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { UserService } from '@services/user.service';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import { catchError, defer, distinctUntilChanged, EMPTY, expand, map, of, switchMap, tap, throwError, timer } from 'rxjs';
import { MktgRunActivityComponent } from '../../mktg-run-activity/mktg-run-activity.component';

/**
 * One public progress reader/presentation for the run and document pages.
 * Public landing = current revision; exact landing only with the private attempt.
 * Completed runs leave runs[] without a public receipt, so landed never claims
 * a particular revision. Creator activity is filtered by the BFF, not inferred here.
 * Legacy one-off receivers supply their existing snapshot with polling disabled.
 * The questions block / questions output is the extension point for a future
 * answer-from-any-device flow; today only a matching private browser can continue.
 */
@Component({
  selector: 'lfx-mktg-run-progress',
  imports: [DatePipe, ButtonComponent, MessageComponent, MktgRunActivityComponent],
  templateUrl: './mktg-run-progress.component.html',
})
export class MktgRunProgressComponent {
  private readonly store = inject(MktgDocumentStoreService);
  private readonly user = inject(UserService);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly project = input.required<string>();
  public readonly agentKey = input.required<string>();
  public readonly documentId = input.required<string>();
  public readonly runId = input('');
  public readonly polling = input(true);
  public readonly snapshot = input<MktgDocumentDetailResponse | null>(null);
  public readonly refreshKey = input('');
  public readonly loadRevision = input(false);
  public readonly revisionId = input('');
  public readonly expectedPending = input(false);
  public readonly viewSnapshot = input<MktgRevisionResponse | null>(null);
  public readonly localProgress = input<MktgDocumentLocalProgress>(null);
  public readonly failureText = input('');
  public readonly unconfirmed = input(false);
  public readonly submittingGeneration = input(false);
  public readonly retrying = input(false);
  public readonly errorText = input('');
  public readonly waitingForQuestions = input(false);
  /** A dedicated receiver may answer elsewhere rather than through this public card. */
  public readonly answersSupported = input<boolean | null>(null);
  public readonly runAgentId = input('');
  public readonly externalActivity = input<MktgRunActivity[] | undefined>();
  public readonly runPage = input(false);
  public readonly suppressCard = input(false);
  /** Keep the single public observer alive without rendering a living document's live presentation. */
  public readonly headless = input(false);

  public readonly observed = output<MktgDocumentReadCycle>();
  public readonly landed = output<void>();
  public readonly failed = output<void>();
  public readonly questions = output<void>();
  public readonly readError = output<HttpErrorResponse>();
  public readonly retry = output<void>();
  public readonly openIntake = output<void>();
  public readonly refresh = output<void>();

  private readonly loaded = signal<MktgDocumentDetailResponse | null>(null);
  private readonly loadedSubject = signal('');
  protected readonly warning = signal('');
  protected readonly readFailure = signal('');
  private readonly reload = signal(0);

  protected readonly detail = computed(() => {
    const detail = this.polling() ? this.loaded() : this.snapshot();
    if (!detail) return null;
    if (detail.project !== this.project() || detail.type.agentKey !== this.agentKey() || detail.documentId !== this.documentId()) return null;
    if (this.polling() && this.loadedSubject() && this.loadedSubject() !== this.user.user()?.sub) return null;
    return detail;
  });
  public readonly selectedRun = this.initSelectedRun();
  public readonly runState = this.initRunState();
  protected readonly visibleRunActivity = this.initVisibleActivity();
  protected readonly activityStartedAt = computed(() => Date.parse(this.selectedRun()?.startedAt ?? '') || 0);
  protected readonly pausedWithoutAnswers = computed(
    () => this.selectedRun()?.state === 'questions' && !(this.answersSupported() ?? !!findMktgRunIntake(this.agentKey(), true)?.endpoints.answers)
  );
  protected readonly runDocumentType = computed(() => MKTG_DOCUMENT_TYPES.find((type) => type.kind === 'run' && type.agentKey === this.agentKey()));
  protected readonly unconfirmedFailure = computed(() => this.unconfirmed() && !this.selectedRun());
  protected readonly failureAssetLabel = computed(() =>
    mktgSentenceCaseLabel(MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.agentKey())?.itemLabel ?? 'document')
  );
  protected readonly generatingLabel = computed(
    () => `Working on ${mktgKitAssetLabel(this.agentKey()) ?? MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.agentKey())?.label ?? 'the document'}`
  );
  protected readonly runFailure = computed(() => this.selectedRun()?.failureText || this.failureText());
  protected readonly runRecorded = computed(() => !this.submittingGeneration() && (!!this.runId() || !!this.selectedRun()));
  protected readonly liveState = this.initLiveState();

  public constructor() {
    const scope = computed(() => ({
      project: this.project(),
      agentKey: this.agentKey(),
      documentId: this.documentId(),
      runId: this.runPage() ? this.runId() : '',
      subject: this.user.user()?.sub ?? '',
      polling: this.polling(),
      loadRevision: this.loadRevision(),
      revisionId: this.revisionId(),
      refresh: this.refreshKey(),
      reload: this.reload(),
    }));
    let identityResolved = false;
    toObservable(scope)
      .pipe(
        distinctUntilChanged((a, b) => {
          // Keep the first public read in flight while identity initially resolves.
          // Every later identity change is a scope change and cancels the old reader.
          identityResolved ||= !!a.subject;
          const firstResolution = !identityResolved && !!b.subject;
          identityResolved ||= !!b.subject;
          return JSON.stringify(a) === JSON.stringify(b) || (firstResolution && JSON.stringify({ ...a, subject: b.subject }) === JSON.stringify(b));
        }),
        switchMap((request) => {
          this.loaded.set(null);
          this.loadedSubject.set('');
          this.warning.set('');
          this.readFailure.set('');
          if (!isPlatformBrowser(this.platformId) || !request.polling || !request.project || !request.agentKey || !request.documentId) return EMPTY;
          if (request.runId && !MKTG_STARTED_RUN_ID_REGEX.test(request.runId)) {
            this.readFailure.set('This run could not be found. Open Documents to choose a started run.');
            return EMPTY;
          }
          const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === request.agentKey);
          const prior = this.viewSnapshot();
          let known: MktgDocumentReadCycle | null =
            prior && prior.project === request.project && prior.type.agentKey === request.agentKey && prior.documentId === request.documentId
              ? { detail: prior, view: prior }
              : null;
          if (!known && this.expectedPending() && type)
            known = { detail: { project: request.project, type, documentId: request.documentId, revisions: [], approvedCurrent: null, runs: [] }, view: null };
          let unavailableSince: number | null = null;
          let unavailableCount = 0;
          let refreshedFailure = false;
          let terminal = '';
          const unavailable = () => {
            unavailableSince ??= Date.now();
            unavailableCount++;
            this.warning.set('Could not fully refresh. Showing the last loaded asset; retrying.');
          };
          const read = (poll: boolean) => {
            // Authentication may resolve after this reader started. Stamp each read,
            // not the long-lived polling scope, before exposing creator-only activity.
            const readerSubject = this.user.user()?.sub ?? '';
            // A document handoff updates its selector without replacing the accepted observer.
            const selectedRunId = this.runPage() ? '' : this.runId();
            const metadata$ = defer(() =>
              selectedRunId
                ? this.store.getDocument(request.project, request.agentKey, request.documentId, poll, undefined, false, selectedRunId)
                : this.store.getDocument(request.project, request.agentKey, request.documentId, poll)
            ).pipe(
              switchMap((detail) => {
                const selector = this.runId();
                const selected = selector ? detail.runs?.find((run) => run.runId === selector) : detail.runs?.[0];
                if (poll || this.localProgress() || selected?.state !== 'failed' || refreshedFailure) return of(detail);
                refreshedFailure = true;
                const refreshed$ = selectedRunId
                  ? this.store.getDocument(request.project, request.agentKey, request.documentId, false, selected.runId, false, selectedRunId)
                  : this.store.getDocument(request.project, request.agentKey, request.documentId, false, selected.runId);
                return refreshed$.pipe(
                  catchError((error: unknown) => (isTransientHttpError(error) ? of({ ...detail, progressUnavailable: true }) : throwError(() => error)))
                );
              }),
              catchError((error: HttpErrorResponse) => {
                if (error.status === 404 && this.expectedPending() && type)
                  return of<MktgDocumentDetailResponse>({
                    project: request.project,
                    type,
                    documentId: request.documentId,
                    revisions: [],
                    approvedCurrent: null,
                    runs: [],
                  });
                return throwError(() => error);
              })
            );
            const cycle$ =
              request.loadRevision && request.revisionId && !this.runId() && !this.expectedPending()
                ? this.store
                    .getRevision(request.project, request.agentKey, request.documentId, request.revisionId, poll)
                    .pipe(map((view): MktgDocumentReadCycle => ({ detail: view, view })))
                : metadata$.pipe(
                    switchMap((detail) => {
                      const revisionId =
                        request.revisionId || detail.current?.revisionId || detail.revisions.find((revision) => revision.latest)?.id || detail.revisions[0]?.id;
                      if (!request.loadRevision || !revisionId) return of<MktgDocumentReadCycle>({ detail, view: null });
                      return this.store
                        .getRevision(request.project, request.agentKey, request.documentId, revisionId, true)
                        .pipe(map((view): MktgDocumentReadCycle => ({ detail, view })));
                    })
                  );
            return cycle$.pipe(
              tap((cycle) => {
                known = cycle;
                if (cycle.detail.progressUnavailable || cycle.view?.progressUnavailable) unavailable();
                else {
                  unavailableSince = null;
                  unavailableCount = 0;
                  this.warning.set('');
                }
              }),
              catchError((error: unknown) => {
                if (!known || !isTransientHttpError(error)) return throwError(() => error);
                unavailable();
                return of<MktgDocumentReadCycle>({ detail: { ...known.detail, progressUnavailable: true }, view: this.viewSnapshot() ?? known.view });
              }),
              tap((cycle) => {
                if (request.project !== this.project() || request.agentKey !== this.agentKey() || request.documentId !== this.documentId()) return;
                if (this.runPage() && request.runId !== this.runId()) return;
                if (readerSubject && readerSubject !== this.user.user()?.sub) return;
                this.loaded.set(cycle.detail);
                this.loadedSubject.set(readerSubject);
                this.observed.emit(cycle);
                if (cycle.detail.progressUnavailable || cycle.view?.progressUnavailable) return;
                const outcome = this.selectedRun()?.state ?? (request.runId && cycle.detail.revisions.length ? 'landed' : '');
                if (outcome === terminal) return;
                terminal = outcome;
                if (outcome === 'failed') this.failed.emit();
                if (outcome === 'questions') this.questions.emit();
                if (outcome === 'landed') this.landed.emit();
              })
            );
          };
          return read(false).pipe(
            expand((cycle) => {
              const elapsed = unavailableSince === null ? 0 : Date.now() - unavailableSince;
              if (unavailableSince !== null && elapsed >= MKTG_RUN_POLL.timeoutMs) {
                this.warning.set('Automatic checks are paused. Showing the last loaded asset; refresh to check again.');
                return EMPTY;
              }
              const active = cycle.detail.runs?.some((run) => run.state === 'writing' || run.state === 'storing');
              const state = this.selectedRun()?.state;
              if (state === 'discarded' || state === 'superseded' || (state === 'questions' && unavailableSince === null)) return EMPTY;
              const local = this.localProgress();
              if (!active && local !== 'writing' && local !== 'storing' && unavailableSince === null) return EMPTY;
              let delay: number = MKTG_RUN_POLL.intervalMs;
              if (unavailableCount) delay = Math.min(delay * 2 ** Math.min(unavailableCount - 1, 3), MKTG_DOCUMENT_PROGRESS_POLL.maxBackoffMs);
              if (unavailableSince !== null) delay = Math.min(delay, MKTG_RUN_POLL.timeoutMs - elapsed);
              return timer(delay).pipe(switchMap(() => read(true)));
            }),
            catchError((error: HttpErrorResponse) => {
              this.loaded.set(null);
              this.readFailure.set(
                error.status === 401 || error.status === 403
                  ? 'You need write access to this project to see its Marketing OS documents.'
                  : 'This run could not be loaded. Try again in a moment.'
              );
              this.readError.emit(error);
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe();
  }

  public clear(): void {
    this.loaded.set(null);
    this.loadedSubject.set('');
  }

  protected onRefreshProgress(): void {
    if (this.submittingGeneration()) return;
    if (this.polling() && this.runPage()) this.reload.update((count) => count + 1);
    else this.refresh.emit();
  }

  private initSelectedRun() {
    return computed(() => {
      const runs = this.detail()?.runs ?? [];
      const selector = this.runId();
      if (selector) return MKTG_STARTED_RUN_ID_REGEX.test(selector) ? (runs.find((run) => run.runId === selector) ?? null) : null;
      return this.localProgress() ? null : (runs[0] ?? null);
    });
  }

  private initRunState() {
    return computed(() => {
      const states = [this.localProgress(), this.selectedRun()?.state].filter((state) => state != null);
      return states.sort((a, b) => MKTG_STARTED_RUN_STATE_ORDER[b] - MKTG_STARTED_RUN_STATE_ORDER[a])[0] ?? null;
    });
  }

  private initVisibleActivity() {
    return computed(() => {
      if (!this.polling()) return this.externalActivity();
      return this.loadedSubject() === this.user.user()?.sub ? this.selectedRun()?.activity : undefined;
    });
  }

  private initLiveState() {
    return computed(() => {
      if (this.runState() === 'failed')
        return this.unconfirmedFailure() ? 'The run could not be confirmed.' : `The ${this.failureAssetLabel()} wasn't finished`;
      if (this.pausedWithoutAnswers()) return 'The agent is waiting for input.';
      if (this.runState() === 'questions') return 'Waiting for your answers.';
      if (this.runState()) return this.runDocumentType() ? `Writing the ${this.runDocumentType()?.itemLabel}.` : 'Generating the asset.';
      return this.viewSnapshot() ? 'The asset is ready.' : '';
    });
  }
}
