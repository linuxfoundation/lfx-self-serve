// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_AGENT_INTAKES, MKTG_README_SKIP_NOTES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentRunProgress,
  MktgGenerateProgress,
  MktgRevisionResponse,
  MktgRevisionRow,
  MktgRevisionSummary,
} from '@lfx-one/shared/interfaces';
import { describeMktgRevision, findMktgDocumentType } from '@lfx-one/shared/utils';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { UserService } from '@services/user.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, concat, defer, distinctUntilChanged, EMPTY, expand, finalize, map, Observable, of, switchMap, timer } from 'rxjs';

// One revision of a Marketing OS document (design of record: "Document
// store", DocumentView board): the header says which revision of how many,
// the body is the revision's Markdown, and the Revisions panel opens or
// restores any other revision. `?revision=` picks the revision; without it
// the latest is shown. Fetched in the browser only, after hydration.
@Component({
  selector: 'lfx-mktg-document-view',
  imports: [DatePipe, NgClass, RouterLink, MarkdownRendererComponent, MessageComponent],
  templateUrl: './mktg-document-view.component.html',
})
export class MktgDocumentViewComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly runService = inject(MktgAgentRunService);
  private readonly dependencies = inject(MktgDependencyService);
  private readonly userService = inject(UserService);
  private retryTarget = '';
  private retryServerRunId = '';

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  protected readonly notice = signal('');
  protected readonly view = signal<MktgRevisionResponse | null>(null);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly generating = signal(false);
  protected readonly generationProgress = signal<MktgGenerateProgress['type'] | null>(null);
  protected readonly generationStartedAt = signal<string | null>(null);
  protected readonly retry = signal(0);
  protected readonly canResume = signal(false);
  protected readonly retryRun = signal(false);
  protected readonly serverRun = signal<MktgDocumentRunProgress | null>(null);

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((params) => ({ agentKey: params.get('agentKey') ?? '', documentId: params.get('documentId') ?? '' }))),
    { initialValue: { agentKey: '', documentId: '' } }
  );
  private readonly revisionParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('revision') ?? '')), { initialValue: '' });
  private readonly generationParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('generation') ?? '')), { initialValue: '' });

  // === Computed ===
  protected readonly intakeAgentId = computed(() => findMktgDocumentType(this.params().agentKey)?.catalogAgentId ?? null);
  protected readonly title: Signal<string> = this.initTitle();
  protected readonly nextRevisionNumber = computed(() => (this.view()?.revisions[0]?.number ?? 0) + 1);
  protected readonly storing = computed(() => this.generationProgress() === 'document' || this.generationProgress() === 'persisted');
  protected readonly revisionRows: Signal<MktgRevisionRow[]> = computed(() => {
    const view = this.view();
    return view ? view.revisions.map((revision) => ({ revision, how: describeMktgRevision(revision, view.type) })) : [];
  });
  protected readonly shortHash: Signal<string> = computed(() => {
    const sha = this.view()?.revision.contentSha256 ?? '';
    return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : '';
  });

  protected readonly readmeNote = computed(() => {
    const outcome = this.view()?.source?.readme;
    return outcome && !outcome.fetched && outcome.skipReason ? MKTG_README_SKIP_NOTES[outcome.skipReason] : '';
  });

  protected readonly derivativeChips = computed(() => {
    const current = this.view();
    const intake = MKTG_AGENT_INTAKES[current?.type.catalogAgentId ?? ''];
    return (intake?.derivativeChips ?? []).flatMap((chip) => {
      const value = current?.derivatives?.[chip.key];
      return value?.trim() ? [{ ...chip, value }] : [];
    });
  });

  private readonly request$ = toObservable(
    computed(() => ({
      project: this.projectContext.activeContextUid(),
      ...this.params(),
      revisionId: this.revisionParam(),
      generationId: this.generationParam(),
      userSub: this.userService.user()?.sub,
      retry: this.retry(),
    }))
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.request$
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          switchMap((request) => {
            const explicitRetry =
              this.retryTarget === JSON.stringify([request.project, request.agentKey, request.documentId, request.revisionId, request.userSub]);
            const serverRetryId = explicitRetry ? this.retryServerRunId : '';
            this.retryTarget = '';
            this.retryServerRunId = '';
            this.serverRun.set(null);
            this.loading.set(true);
            this.errorText.set('');
            this.view.set(null);
            this.canResume.set(false);
            if (!request.project || !request.agentKey || !request.documentId || !request.userSub) {
              return EMPTY;
            }
            return this.loadDocument(
              request.project,
              request.agentKey,
              request.documentId,
              request.revisionId,
              request.generationId,
              explicitRetry,
              serverRetryId
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((view) => {
          this.view.set(view);
          this.loading.set(false);
        });
    }
  }

  // === Protected methods ===
  protected onRestore(revision: MktgRevisionSummary): void {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    if (!view || !project || this.restoringId() || this.generating()) {
      return;
    }

    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    this.documentStore
      .restoreRevision(project, view.type.agentKey, view.documentId, revision.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (restored) => {
          this.restoringId.set(null);
          this.notice.set(`Revision ${revision.number} restored as revision ${restored.revision.number}, now the latest.`);
          this.router.navigate([], { relativeTo: this.route, queryParams: { revision: restored.revision.id }, queryParamsHandling: 'merge' });
        },
        error: () => {
          this.restoringId.set(null);
          this.errorText.set(`Revision ${revision.number} could not be restored. Nothing was changed; try again.`);
        },
      });
  }

  protected async onCopy(value: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      this.notice.set('Copied to the clipboard.');
    } catch {
      this.errorText.set('Unable to copy to the clipboard. Try again or download the document.');
    }
  }

  protected onDownload(): void {
    const current = this.view();
    if (!current || !isPlatformBrowser(this.platformId)) {
      return;
    }
    const url = URL.createObjectURL(new Blob([current.markdown], { type: 'text/markdown' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.title()} v${current.revision.number}.md`;
    anchor.click();
    timer(0)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => URL.revokeObjectURL(url))
      )
      .subscribe();
  }

  protected onRetry(): void {
    this.retryServerRunId = this.serverRun()?.state === 'failed' ? (this.serverRun()?.runId ?? '') : '';
    this.retryTarget = JSON.stringify([
      this.projectContext.activeContextUid(),
      this.params().agentKey,
      this.params().documentId,
      this.revisionParam(),
      this.userService.user()?.sub,
    ]);
    this.retry.update((value) => value + 1);
  }

  // === Private initializers ===
  private initTitle(): Signal<string> {
    return computed(() => {
      const type = this.view()?.type ?? findMktgDocumentType(this.params().agentKey);
      if (!type) {
        return '';
      }
      if (type.kind === 'living') {
        return `${this.projectContext.activeContext()?.name ?? ''} ${type.label}`.trim();
      }
      return type.itemLabel;
    });
  }

  // === Private helpers ===
  private loadDocument(
    project: string,
    agentKey: string,
    documentId: string,
    revisionId: string,
    generationId: string,
    explicitRetry: boolean,
    serverRetryId: string
  ): Observable<MktgRevisionResponse | null> {
    const type = findMktgDocumentType(agentKey);
    const agentId = type?.catalogAgentId ?? '';
    const intake = MKTG_AGENT_INTAKES[agentId];
    const prepared = generationId ? this.runService.takePreparedGeneration(generationId, project, agentId) : null;
    let generation$: Observable<MktgGenerateProgress> | null = null;
    if (intake && !revisionId && !serverRetryId) {
      generation$ = explicitRetry ? this.runService.retryGeneration(project, agentId, intake) : this.runService.resumeGeneration(project, agentId, intake);
    }
    if (prepared) {
      generation$ = this.runService.generate(prepared);
    }
    this.errorText.set('');
    const stored = this.runService.loadRun(project, agentId);
    this.retryRun.set(!revisionId && !!(stored?.pendingAttempt || stored?.failedAttempt));
    this.canResume.set(!revisionId && !!stored?.failedAttempt);
    const startedAt = prepared?.startedAt ?? stored?.pendingAttempt?.startedAt ?? stored?.failedAttempt?.startedAt ?? stored?.savedAt;
    this.generationStartedAt.set(startedAt && !Number.isNaN(Date.parse(startedAt)) ? startedAt : new Date().toISOString());
    this.generating.set(!!generation$);
    this.generationProgress.set(null);
    if (!generation$) {
      return this.loadServerDocument(project, agentKey, documentId, revisionId, serverRetryId);
    }

    let serverVisible = false;
    let observedRetryId = serverRetryId;
    const revision$ = revisionId
      ? this.documentStore.getRevision(project, agentKey, documentId, revisionId)
      : this.documentStore.getDocument(project, agentKey, documentId).pipe(
          switchMap((detail) => {
            serverVisible = detail.runs !== undefined;
            if (explicitRetry && !observedRetryId) {
              observedRetryId = detail.runs?.find((run) => run.state === 'failed')?.runId ?? '';
            }
            return detail.revisions[0] ? this.documentStore.getRevision(project, agentKey, documentId, detail.revisions[0].id) : of(null);
          })
        );
    let authorized = true;
    const initial$ = revision$.pipe(
      catchError((error: HttpErrorResponse) => {
        authorized = error.status !== 401 && error.status !== 403;
        this.canResume.set(authorized && error.status !== 404);
        if (error.status !== 404 || !generation$) {
          this.errorText.set(this.loadErrorText(error.status));
        }
        return of(null);
      })
    );
    let landed = false;
    // Defer the write until the existing-document read has checked access.
    const generation = generation$;
    const progress$ = of(null).pipe(switchMap(() => (authorized ? generation : EMPTY)));
    const updates$ = progress$.pipe(
      switchMap((progress) => {
        this.loading.set(false);
        if (progress.type === 'activity') {
          return EMPTY;
        }
        this.generationProgress.set(progress.type);
        if (progress.type === 'submitted') {
          return EMPTY;
        }
        if (progress.type === 'failed') {
          this.errorText.set(progress.failureText || 'The agent finished without producing a document. Return to the intake or retry the run.');
          return EMPTY;
        }
        if (progress.type === 'questions') {
          if (intake) {
            const request = prepared ?? { projectUid: project, agentId, intake, answers: this.runService.loadRun(project, agentId)?.answers ?? {} };
            const questions = this.runService.prepareGeneration({ ...request, pendingQuestions: progress.pending });
            landed = true;
            this.router.navigate(['../../..', agentId], {
              relativeTo: this.route,
              queryParams: { questions, generation: null, revision: null },
              queryParamsHandling: 'merge',
            });
          }
          return EMPTY;
        }
        this.dependencies.notifyDocumentsChanged(project);
        const location = progress.location;
        if (!location) {
          return EMPTY;
        }
        landed = true;
        // Canonicalize the URL before reading, so even a failed read retries
        // this run's exact revision rather than another writer's latest.
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { generation: null, revision: location.revisionId },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        return EMPTY;
      }),
      catchError((error: unknown) => {
        console.error('Marketing OS run failed', error);
        this.errorText.set('This run could not finish. Your answers are kept. Return to the intake or retry the run.');
        return EMPTY;
      }),
      finalize(() => {
        this.generating.set(false);
        const run = this.runService.loadRun(project, agentId);
        const retryable = !!(run?.pendingAttempt || run?.failedAttempt);
        this.retryRun.set(retryable);
        this.canResume.set(!landed && authorized && retryable);
        if (!landed && authorized && !this.errorText()) {
          this.errorText.set('The document has not been saved yet. Retry to resume saving; no new generation is started.');
        }
      })
    );
    // A recorded server run is authoritative over an old local capability.
    return concat(
      initial$,
      defer(() => (serverVisible && !prepared ? this.loadServerDocument(project, agentKey, documentId, revisionId, observedRetryId) : updates$))
    );
  }

  /** Server-visible progress works without a local session capability or localStorage record. */
  private loadServerDocument(
    project: string,
    agentKey: string,
    documentId: string,
    revisionId: string,
    retryId: string
  ): Observable<MktgRevisionResponse | null> {
    const revision = (detail: MktgDocumentDetailResponse, poll = false) => {
      const id = revisionId || detail.revisions[0]?.id;
      if (!id) {
        return of({ detail, view: null as MktgRevisionResponse | null });
      }
      return this.documentStore.getRevision(project, agentKey, documentId, id, poll).pipe(
        switchMap((view) =>
          !revisionId && view.revisions[0]?.id && view.revisions[0].id !== view.revision.id
            ? this.documentStore.getRevision(project, agentKey, documentId, view.revisions[0].id, poll)
            : of(view)
        ),
        map((view) => ({ detail: { ...detail, runs: view.runs ?? detail.runs }, view }))
      );
    };
    const read = (poll = false) =>
      revisionId
        ? this.documentStore
            .getRevision(project, agentKey, documentId, revisionId, poll)
            .pipe(map((view) => ({ detail: view as MktgDocumentDetailResponse, view })))
        : this.documentStore.getDocument(project, agentKey, documentId, poll).pipe(switchMap((detail) => revision(detail, poll)));
    const first$ = retryId ? this.documentStore.retryRun(project, agentKey, documentId, retryId).pipe(switchMap((detail) => revision(detail))) : read();
    return first$.pipe(
      expand((state) => (state.detail.runs?.some((run) => run.state !== 'failed') ? timer(MKTG_RUN_POLL.intervalMs).pipe(switchMap(() => read(true))) : EMPTY)),
      map(({ detail, view }) => {
        const run = detail.runs?.find((entry) => entry.state !== 'failed') ?? detail.runs?.[0] ?? null;
        this.serverRun.set(run);
        this.generating.set(!!run && run.state !== 'failed');
        if (run) {
          this.generationStartedAt.set(run.startedAt);
          this.generationProgress.set(run.state === 'storing' ? 'document' : 'submitted');
          this.canResume.set(run.state === 'failed');
          this.retryRun.set(run.state === 'failed');
          if (run.state === 'failed') {
            this.errorText.set(run.failureText || 'This run did not finish. Return to the intake or retry the run.');
          }
        } else {
          const agentId = findMktgDocumentType(agentKey)?.catalogAgentId ?? '';
          const legacyFailed = detail.runs === undefined && !revisionId && !!this.runService.loadRun(project, agentId)?.failedAttempt;
          this.canResume.set(legacyFailed);
          this.retryRun.set(legacyFailed);
        }
        return view;
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('Marketing OS document progress could not be loaded', error);
        this.serverRun.set(null);
        this.generating.set(false);
        this.loading.set(false);
        this.errorText.set(this.loadErrorText(error.status));
        this.canResume.set(error.status !== 401 && error.status !== 403 && error.status !== 404);
        this.retryRun.set(false);
        return of(null);
      })
    );
  }

  private loadErrorText(status: number): string {
    if (status === 403) {
      return 'You need write access to this project to see its Marketing OS documents.';
    }
    if (status === 404) {
      return this.revisionParam() ? 'This document has no such revision.' : 'This document has not been generated yet.';
    }
    return 'This revision could not be loaded. Try again in a moment.';
  }
}
