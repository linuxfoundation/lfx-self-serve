// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import {
  BrandKitRevision,
  MktgBoilerplatesAsset,
  MktgFrameworkAsset,
  MktgRevisionResponse,
  MktgRevisionRow,
  MktgRevisionSummary,
  MktgSlidesExportTarget,
} from '@lfx-one/shared/interfaces';
import {
  boilerplatesAssetOfRevision,
  describeMktgRevision,
  describeMktgRevisionAuthor,
  foundationMessageAssetOfRevision,
  isMktgSlidesExportAgentKey,
  readBrandKitRevision,
} from '@lfx-one/shared/utils';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { BrandKitWebViewComponent } from '../brand-kit-web-view/brand-kit-web-view.component';
import { MktgBoilerplatesViewComponent } from '../mktg-boilerplates-view/mktg-boilerplates-view.component';
import { MktgFrameworkViewComponent } from '../mktg-framework-view/mktg-framework-view.component';

// One revision of a Marketing OS document (design of record: "Document
// store", DocumentView board): the header says which revision of how many,
// the body is the revision's Markdown — or, for a Messaging Framework
// revision (JSON content), the framework's own view, for a Boilerplates
// revision (JSON content) the Boilerplates view, and for a Brand Kit
// revision the kit's web view, rendered from the revision's sidecar — and the
// Revisions panel opens or restores any other revision. `?revision=` picks
// the revision; without it the latest is shown. Fetched in the browser only,
// after hydration.
@Component({
  selector: 'lfx-mktg-document-view',
  imports: [
    DatePipe,
    NgClass,
    RouterLink,
    BrandKitWebViewComponent,
    MarkdownRendererComponent,
    MessageComponent,
    MktgBoilerplatesViewComponent,
    MktgFrameworkViewComponent,
  ],
  templateUrl: './mktg-document-view.component.html',
})
export class MktgDocumentViewComponent {
  // === Injections ===
  private readonly dependencyService = inject(MktgDependencyService);
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
    return view
      ? view.revisions.map((revision) => ({
          revision,
          how: describeMktgRevision(revision, view.type),
          authorLabel: describeMktgRevisionAuthor(revision.author),
        }))
      : [];
  });
  protected readonly shortHash: Signal<string> = computed(() => {
    const sha = this.view()?.revision.contentSha256 ?? '';
    return sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : '';
  });
  /**
   * The revision as a framework asset, when it is one: a JSON revision of the
   * foundation-message document whose text parses as a framework. Null for
   * every Markdown revision — and for a JSON revision that does not parse,
   * which then shows as its raw text rather than nothing.
   */
  protected readonly asset: Signal<MktgFrameworkAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'foundation-message') {
      return null;
    }
    return foundationMessageAssetOfRevision(view.markdown, view.sidecar);
  });
  /**
   * The revision as the Boilerplates, when it is one: a JSON revision of the
   * boilerplates document whose text parses as the four lengths, with the
   * report and checks from its sidecar. Null otherwise — a JSON revision
   * that does not parse shows as its raw text.
   */
  protected readonly boilerplates: Signal<MktgBoilerplatesAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'boilerplates') {
      return null;
    }
    return boilerplatesAssetOfRevision(view.markdown, view.sidecar);
  });
  /** The Brand Kit of a brand-kit revision, read from its sidecar; null for every other document, and for a kit stored by the earlier agent as Markdown alone. */
  protected readonly brandKit: Signal<BrandKitRevision | null> = computed(() => {
    const view = this.view();
    return view?.type.agentKey === 'brand-kit' ? readBrandKitRevision(view.sidecar) : null;
  });
  /** A framework, the boilerplates or a kit takes the page's full width; a Markdown document keeps the reading column. */
  protected readonly fullWidth = computed(() => this.asset() !== null || this.boilerplates() !== null || this.brandKit() !== null);
  /** The project name the framework view titles itself with. */
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? '');
  /** A short word on the revision's standing, beside the asset's version. */
  protected readonly revisionNote = computed(() => (this.view()?.revision.latest ? 'latest' : ''));
  /** The project's stored Brand Kit, which a framework revision's print (Download PDF) is set in; null for the LF look. */
  protected readonly printKit: Signal<BrandKitRevision | null> = this.initPrintKit();
  /** The revision on screen as Export to Google Slides reads it: a framework or a kit revision of the active project; null otherwise. */
  protected readonly exportTarget: Signal<MktgSlidesExportTarget | null> = computed(() => {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    const agentKey = view?.type.agentKey;
    if (!view || !project || !isMktgSlidesExportAgentKey(agentKey) || (this.asset() === null && this.brandKit() === null)) {
      return null;
    }
    return { project, agentKey, documentId: view.documentId, revisionId: view.revision.id };
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
  /**
   * The project's Brand Kit, read only while a framework revision is on
   * screen (a kit or a Markdown document prints nothing of this) and only in
   * the browser. Any failed read is the LF look, not an error.
   */
  private initPrintKit(): Signal<BrandKitRevision | null> {
    const projectUid = computed(() => (isPlatformBrowser(this.platformId) && this.asset() !== null ? this.projectContext.activeContextUid() : ''));
    return toSignal(
      toObservable(projectUid).pipe(
        distinctUntilChanged(),
        // A project switch drops the previous project's kit at once: until the new
        // project's kit resolves, the print takes the LF look, never another project's brand.
        switchMap((uid) => (uid ? this.dependencyService.resolveBrandKit(uid).pipe(startWith(null)) : of(null)))
      ),
      { initialValue: null }
    );
  }

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
