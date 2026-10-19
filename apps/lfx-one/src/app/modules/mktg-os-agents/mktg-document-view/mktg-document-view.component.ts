// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { MktgRevisionResponse, MktgRevisionRow, MktgRevisionSummary } from '@lfx-one/shared/interfaces';
import { describeMktgRevision } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, filter, map, of, switchMap, tap } from 'rxjs';

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

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  protected readonly notice = signal('');
  protected readonly view = signal<MktgRevisionResponse | null>(null);
  protected readonly restoringId = signal<string | null>(null);

  private readonly params = toSignal(
    this.route.paramMap.pipe(map((params) => ({ agentKey: params.get('agentKey') ?? '', documentId: params.get('documentId') ?? '' }))),
    { initialValue: { agentKey: '', documentId: '' } }
  );
  private readonly revisionParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('revision') ?? '')), { initialValue: '' });

  // === Computed ===
  protected readonly title: Signal<string> = this.initTitle();
  protected readonly revisionRows: Signal<MktgRevisionRow[]> = computed(() => {
    const view = this.view();
    return view ? view.revisions.map((revision) => ({ revision, how: describeMktgRevision(revision, view.type) })) : [];
  });
  protected readonly shortHash: Signal<string> = computed(() => {
    const sha = this.view()?.revision.contentSha256 ?? '';
    return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : '';
  });

  private readonly request$ = toObservable(
    computed(() => ({ project: this.projectContext.activeContextUid(), ...this.params(), revisionId: this.revisionParam() }))
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.request$
        .pipe(
          filter((request) => !!request.project && !!request.agentKey && !!request.documentId),
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap(() => {
            this.loading.set(true);
            this.errorText.set('');
          }),
          switchMap((request) => {
            // Without `?revision=`, open the latest: the document's newest revision.
            const revision$ = request.revisionId
              ? this.documentStore.getRevision(request.project, request.agentKey, request.documentId, request.revisionId)
              : this.documentStore
                  .getDocument(request.project, request.agentKey, request.documentId)
                  .pipe(switchMap((detail) => this.documentStore.getRevision(request.project, request.agentKey, request.documentId, detail.revisions[0].id)));
            return revision$.pipe(
              catchError((error: HttpErrorResponse) => {
                this.errorText.set(this.loadErrorText(error.status));
                return of(null);
              })
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
    if (!view || !project || this.restoringId()) {
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

  // === Private initializers ===
  private initTitle(): Signal<string> {
    return computed(() => {
      const view = this.view();
      if (!view) {
        return '';
      }
      if (view.type.kind === 'living') {
        return `${this.projectContext.activeContext()?.name ?? ''} ${view.type.label}`.trim();
      }
      return view.type.itemLabel;
    });
  }

  // === Private helpers ===
  private loadErrorText(status: number): string {
    if (status === 403) {
      return 'You need write access to this project to see its Marketing OS documents.';
    }
    if (status === 404) {
      return 'This document has no such revision.';
    }
    return 'This revision could not be loaded. Try again in a moment.';
  }
}
