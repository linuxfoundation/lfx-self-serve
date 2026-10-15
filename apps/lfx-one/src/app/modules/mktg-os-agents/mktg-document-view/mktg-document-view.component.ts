// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_AGENT_INTAKES, MKTG_README_SKIP_NOTES } from '@lfx-one/shared/constants';
import { MktgGenerateProgress, MktgRevisionResponse, MktgRevisionRow, MktgRevisionSummary } from '@lfx-one/shared/interfaces';
import { describeMktgRevision, findMktgDocumentType } from '@lfx-one/shared/utils';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { UserService } from '@services/user.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, concat, distinctUntilChanged, EMPTY, finalize, map, Observable, of, switchMap, timer } from 'rxjs';

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

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  protected readonly notice = signal('');
  protected readonly view = signal<MktgRevisionResponse | null>(null);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly generating = signal(false);
  protected readonly generationStage = signal('Submitting your intake…');
  protected readonly retry = signal(0);
  protected readonly canResume = signal(false);
  protected readonly retryRun = signal(false);

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((params) => ({ agentKey: params.get('agentKey') ?? '', documentId: params.get('documentId') ?? '' }))),
    { initialValue: { agentKey: '', documentId: '' } }
  );
  private readonly revisionParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('revision') ?? '')), { initialValue: '' });
  private readonly generationParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('generation') ?? '')), { initialValue: '' });

  // === Computed ===
  protected readonly intakeAgentId = computed(() => findMktgDocumentType(this.params().agentKey)?.catalogAgentId ?? null);
  protected readonly title: Signal<string> = this.initTitle();
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
            this.retryTarget = '';
            this.loading.set(true);
            this.errorText.set('');
            this.view.set(null);
            this.canResume.set(false);
            if (!request.project || !request.agentKey || !request.documentId || !request.userSub) {
              return EMPTY;
            }
            return this.loadDocument(request.project, request.agentKey, request.documentId, request.revisionId, request.generationId, explicitRetry);
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
      const view = this.view();
      if (!view) {
        return findMktgDocumentType(this.params().agentKey)?.itemLabel ?? '';
      }
      if (view.type.kind === 'living') {
        return `${this.projectContext.activeContext()?.name ?? ''} ${view.type.label}`.trim();
      }
      return view.type.itemLabel;
    });
  }

  // === Private helpers ===
  private loadDocument(
    project: string,
    agentKey: string,
    documentId: string,
    revisionId: string,
    generationId: string,
    explicitRetry: boolean
  ): Observable<MktgRevisionResponse | null> {
    const type = findMktgDocumentType(agentKey);
    const agentId = type?.catalogAgentId ?? '';
    const intake = MKTG_AGENT_INTAKES[agentId];
    const prepared = generationId ? this.runService.takePreparedGeneration(generationId, project, agentId) : null;
    let generation$: Observable<MktgGenerateProgress> | null = null;
    if (intake && !revisionId) {
      generation$ = explicitRetry ? this.runService.retryGeneration(project, agentId, intake) : this.runService.resumeGeneration(project, agentId, intake);
    }
    if (prepared) {
      generation$ = this.runService.generate(prepared);
    }
    this.errorText.set('');
    const stored = this.runService.loadRun(project, agentId);
    this.retryRun.set(!revisionId && !!(stored?.pendingAttempt || stored?.failedAttempt));
    this.canResume.set(!revisionId && !!stored?.failedAttempt);
    this.generating.set(!!generation$);
    this.generationStage.set('Submitting your intake…');

    const revision$ = revisionId
      ? this.documentStore.getRevision(project, agentKey, documentId, revisionId)
      : this.documentStore
          .getDocument(project, agentKey, documentId)
          .pipe(
            switchMap((detail) => (detail.revisions[0] ? this.documentStore.getRevision(project, agentKey, documentId, detail.revisions[0].id) : of(null)))
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
    if (!generation$) {
      return initial$;
    }
    let landed = false;
    // Defer the write until the existing-document read has checked access.
    const generation = generation$;
    const progress$ = of(null).pipe(switchMap(() => (authorized ? generation : EMPTY)));
    return concat(
      initial$,
      progress$.pipe(
        switchMap((progress) => {
          this.loading.set(false);
          this.generationStage.set(progress.type === 'submitted' ? 'Agent drafting the document…' : 'Saving the document…');
          if (progress.type === 'submitted') {
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
      )
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
