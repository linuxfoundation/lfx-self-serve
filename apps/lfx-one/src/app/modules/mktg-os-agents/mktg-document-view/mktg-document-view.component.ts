// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_DOCUMENT_REVISION_PREVIEW_COUNT } from '@lfx-one/shared/constants';
import {
  BrandKitRevision,
  MktgBoilerplatesAsset,
  MktgFaqAsset,
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
  faqAssetOfRevision,
  foundationMessageAssetOfRevision,
  isMktgSlidesExportAgentKey,
  readBrandKitRevision,
} from '@lfx-one/shared/utils';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, distinctUntilChanged, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { BrandKitWebViewComponent } from '../brand-kit-web-view/brand-kit-web-view.component';
import { MktgBoilerplatesViewComponent } from '../mktg-boilerplates-view/mktg-boilerplates-view.component';
import { MktgFaqViewComponent } from '../mktg-faq-view/mktg-faq-view.component';
import { MktgFrameworkViewComponent } from '../mktg-framework-view/mktg-framework-view.component';

// One revision of a Marketing OS document (design of record: "Document
// store", DocumentView board): the header says which revision of how many,
// the body is the revision's Markdown — or, for a Messaging Framework
// revision (JSON content), the framework's own view, for a Boilerplates
// revision (JSON content) the Boilerplates view, for an FAQ revision the FAQ
// view, and for a Brand Kit revision the kit's web view, rendered from the
// revision's sidecar — and the
// Revisions panel opens or makes another revision current. `?revision=` picks
// the revision; without it current is shown. Fetched in the browser only,
// after hydration.
@Component({
  selector: 'lfx-mktg-document-view',
  // Excluding layout gutters: 800px leaves classic-scrollbar headroom.
  host: { class: '@container block w-full min-w-0', 'data-testid': 'mktg-document-view-width' },
  imports: [
    DatePipe,
    NgClass,
    RouterLink,
    BrandKitWebViewComponent,
    MarkdownRendererComponent,
    MessageComponent,
    MktgBoilerplatesViewComponent,
    MktgFaqViewComponent,
    MktgFrameworkViewComponent,
    TooltipModule,
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

  // Explicit parent target works for both project and foundation route hosts.
  protected readonly documentsRoute = this.route.parent;

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  protected readonly notice = signal('');
  protected readonly view = signal<MktgRevisionResponse | null>(null);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly showAllRevisions = signal(false);

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
  protected readonly currentSelectorLabel = computed(() => describeMktgRevisionAuthor(this.view()?.current?.changedBy));
  protected readonly savingStatus = computed(() => {
    const revision = this.view()?.revisions.find((entry) => entry.id === this.restoringId());
    return revision ? `Saving revision ${revision.number}…` : '';
  });
  protected readonly viewedAuthorLabel: Signal<string> = this.initViewedAuthorLabel();
  protected readonly currentRevision: Signal<MktgRevisionSummary | null> = this.initCurrentRevision();
  protected readonly visibleRevisionRows: Signal<MktgRevisionRow[]> = this.initVisibleRevisionRows();
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
  /** The FAQ of a JSON revision of the FAQ document, when its text parses as one; null for everything else. */
  protected readonly faq: Signal<MktgFaqAsset | null> = computed(() => {
    const view = this.view();
    if (!view || view.revision.format !== 'json' || view.type.agentKey !== 'faq') {
      return null;
    }
    return faqAssetOfRevision(view.markdown, view.sidecar);
  });
  /** The Brand Kit of a brand-kit revision, read from its sidecar; null for every other document, and for a kit stored by the earlier agent as Markdown alone. */
  protected readonly brandKit: Signal<BrandKitRevision | null> = computed(() => {
    const view = this.view();
    return view?.type.agentKey === 'brand-kit' ? readBrandKitRevision(view.sidecar) : null;
  });
  /** A framework, the boilerplates, an FAQ or a kit takes the page's full width; a Markdown document keeps the reading column. */
  protected readonly fullWidth = computed(() => this.asset() !== null || this.boilerplates() !== null || this.faq() !== null || this.brandKit() !== null);
  /** The project name the framework view titles itself with. */
  protected readonly projectName = computed(() => this.projectContext.activeContext()?.name ?? '');
  /** A short word on the revision's standing, beside the asset's version. */
  protected readonly revisionNote = computed(() => (this.view()?.revision.latest ? 'current' : ''));
  /** The project's stored Brand Kit, which a framework revision's print (Download PDF) is set in; null for the LF look. */
  protected readonly printKit: Signal<BrandKitRevision | null> = this.initPrintKit();
  /** The revision on screen as Export to Google Slides reads it: a framework or a kit revision of the active project; null otherwise. */
  protected readonly exportTarget: Signal<MktgSlidesExportTarget | null> = computed(() => {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    const agentKey = view?.type.agentKey;
    if (
      !view ||
      !project ||
      view.approvedCurrent?.revisionId !== view.revision.id ||
      !isMktgSlidesExportAgentKey(agentKey) ||
      (this.asset() === null && this.brandKit() === null)
    ) {
      return null;
    }
    return { project, agentKey, documentId: view.documentId, revisionId: view.revision.id };
  });

  private readonly request$ = toObservable(
    computed(() => ({ project: this.projectContext.activeContextUid(), ...this.params(), revisionId: this.revisionParam() }))
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      let shownDocument = '';
      this.request$
        .pipe(
          filter((request) => !!request.project && !!request.agentKey && !!request.documentId),
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap((request) => {
            const documentKey = JSON.stringify([request.project, request.agentKey, request.documentId]);
            if (documentKey !== shownDocument) {
              this.showAllRevisions.set(false);
              shownDocument = documentKey;
            }
            this.loading.set(true);
            this.errorText.set('');
            this.notice.set('');
          }),
          switchMap((request) => {
            // Without `?revision=`, open current, which may not be newest.
            const revision$ = request.revisionId
              ? this.documentStore.getRevision(request.project, request.agentKey, request.documentId, request.revisionId)
              : this.documentStore
                  .getDocument(request.project, request.agentKey, request.documentId)
                  .pipe(
                    switchMap((detail) =>
                      this.documentStore.getRevision(
                        request.project,
                        request.agentKey,
                        request.documentId,
                        detail.current?.revisionId ?? (detail.revisions.find((revision) => revision.latest) ?? detail.revisions[0]).id
                      )
                    )
                  );
            return revision$.pipe(
              catchError((error: HttpErrorResponse) => {
                this.errorText.set(this.loadErrorText(error.status, error.error?.code));
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
  protected onToggleAllRevisions(): void {
    this.showAllRevisions.update((expanded) => !expanded);
  }

  protected onRestore(revision: MktgRevisionSummary): void {
    const view = this.view();
    const project = this.projectContext.activeContextUid();
    if (!view || view.type.kind === 'run' || !project || this.restoringId()) {
      return;
    }

    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    const selection = this.revisionParam();
    // This one-shot write outlives the page. Only its presentation is scoped to
    // the initiating project/revision, so navigation cannot cancel the save.
    this.documentStore.restoreRevision(project, view.type.agentKey, view.documentId, revision.id).subscribe({
      next: (restored) => {
        this.restoringId.set(null);
        if (!this.sameView(project, view, selection)) return;
        this.view.set({
          ...view,
          revisions: restored.revisions,
          current: restored.current ?? null,
          revision: { ...view.revision, latest: view.revision.id === restored.revision.id },
        });
        this.notice.set(`Revision ${revision.number} is now current. No revision was added.`);
      },
      error: (error: HttpErrorResponse) => {
        this.restoringId.set(null);
        if (!this.sameView(project, view, selection)) return;
        this.errorText.set(this.writeErrorText(error));
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

  private initViewedAuthorLabel(): Signal<string> {
    return computed(() => describeMktgRevisionAuthor(this.view()?.revision.author));
  }

  private initCurrentRevision(): Signal<MktgRevisionSummary | null> {
    return computed(() => this.view()?.revisions.find((revision) => revision.latest) ?? null);
  }

  private initVisibleRevisionRows(): Signal<MktgRevisionRow[]> {
    return computed(() => {
      const rows = this.revisionRows();
      if (this.showAllRevisions()) return rows;
      const openId = this.view()?.revision.id;
      return rows.filter((row, index) => index < MKTG_DOCUMENT_REVISION_PREVIEW_COUNT || row.revision.latest || row.revision.id === openId);
    });
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
  private sameView(project: string, view: MktgRevisionResponse, selection: string): boolean {
    return (
      !this.destroyRef.destroyed &&
      this.projectContext.activeContextUid() === project &&
      this.params().agentKey === view.type.agentKey &&
      this.params().documentId === view.documentId &&
      this.revisionParam() === selection
    );
  }

  private writeErrorText(error: HttpErrorResponse): string {
    if (error.status === 403 || error.status === 404) return this.loadErrorText(error.status, error.error?.code);
    if (error.status === 412) return 'The document changed. Reload before making a revision current.';
    return 'The revision could not be made current. Reload to check its state, then try again.';
  }

  private loadErrorText(status: number, code?: string): string {
    if (status === 403) {
      return 'You need write access to this project to see its Marketing OS documents.';
    }
    if (status === 404) {
      return code === 'MKTG_DOCUMENT_NOT_FOUND' ? 'This document could not be found.' : 'This document has no such revision.';
    }
    return 'This revision could not be loaded. Try again in a moment.';
  }
}
