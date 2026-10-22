// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_DOCUMENT_TYPES, MKTG_KIT_FAMILIES } from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentGroup,
  MktgDocumentNavItem,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgRevisionRow,
  MktgRevisionSummary,
  MktgSelectedLivingDocument,
} from '@lfx-one/shared/interfaces';
import { describeMktgRevision, describeMktgRevisionAuthor, mktgKitRootCrumb } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, distinctUntilChanged, filter, map, of, startWith, Subject, switchMap, tap } from 'rxjs';
import { MktgBreadcrumbComponent } from '../components/mktg-breadcrumb/mktg-breadcrumb.component';
import { MktgKitTabsComponent } from '../components/mktg-kit-tabs/mktg-kit-tabs.component';
import { MktgKitHeaderComponent } from '../components/mktg-kit-header/mktg-kit-header.component';

// The Marketing OS Documents area (design of record: "Document store", Main
// board): living documents in run order with their revision state, the
// one-off runs grouped by agent, and the selected living document's Revisions
// table with View and Restore. Data is fetched in the browser only, after
// hydration, so SSR output stays stable — same pattern as the marketplace.
@Component({
  selector: 'lfx-mktg-documents',
  // Layout queries use the padded inner page's content width, not this routed host.
  // The 800px switch leaves headroom for classic scrollbars.
  host: { class: '@container block w-full min-w-0', 'data-testid': 'mktg-documents-width' },
  imports: [DatePipe, NgClass, RouterLink, MessageComponent, MktgBreadcrumbComponent, MktgKitTabsComponent, MktgKitHeaderComponent],
  templateUrl: './mktg-documents.component.html',
})
export class MktgDocumentsComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly documentPanel = viewChild<ElementRef<HTMLElement>>('documentPanel');
  private readonly documentContainer = viewChild<ElementRef<HTMLElement>>('documentContainer');
  private readonly listRefresh = new Subject<void>();

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  // The documents list could not be read: nothing is known about what the
  // project has stored, so neither the empty states nor the nav badges may
  // assert an absence while this is set.
  protected readonly listFailed = signal(false);
  protected readonly documents = signal<MktgDocumentsResponse | null>(null);
  protected readonly detail = signal<MktgDocumentDetailResponse | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly notice = signal('');
  // The project whose list is shown. Switching projects clears the previous
  // project's documents and badges while the new project's list loads.
  private listedProject = '';
  private listedType: string | null = null;
  private pendingSelectionScroll = false;

  private readonly selectedParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('type'))), { initialValue: null });

  // === Computed ===
  protected readonly projectName: Signal<string> = computed(() => this.projectContext.activeContext()?.name ?? 'Project');
  protected readonly projectSlug = computed(() => this.projectContext.activeContext()?.slug ?? null);
  protected readonly crumbs = computed(() => [mktgKitRootCrumb(this.projectName(), ['..']), { label: 'Documents' }]);
  protected readonly selectedType: Signal<MktgDocumentType> = this.initSelectedType();
  protected readonly showAll = computed(() => !MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === this.selectedParam()));
  protected readonly allDocuments = computed(() =>
    (this.documents()?.groups ?? []).flatMap((group) => group.documents.map((document) => ({ type: group.type, document })))
  );
  /** All documents under their Kit family headings, in Kit order. */
  protected readonly allDocumentSections = computed(() => {
    const documents = this.allDocuments();
    return this.familyTypes()
      .map((family) => ({ name: family.name, items: family.types.flatMap((type) => documents.filter((item) => item.type.agentKey === type.agentKey)) }))
      .filter((family) => family.items.length > 0);
  });
  /** The nav, grouped and ordered as the Kit's families. */
  protected readonly familyNav: Signal<{ name: string; items: MktgDocumentNavItem[] }[]> = this.initFamilyNav();
  protected readonly selectedGroup: Signal<MktgDocumentGroup | null> = computed(
    () => this.documents()?.groups.find((group) => group.type.agentKey === this.selectedType().agentKey) ?? null
  );
  protected readonly selectedLiving: Signal<MktgSelectedLivingDocument | null> = computed(() => {
    const type = this.selectedType();
    return !this.showAll() && type.kind === 'living' ? { type, document: this.selectedGroup()?.documents[0] ?? null } : null;
  });
  protected readonly revisionRows: Signal<MktgRevisionRow[]> = computed(() => {
    const detail = this.detail();
    return detail
      ? detail.revisions.map((revision) => ({
          revision,
          how: describeMktgRevision(revision, detail.type),
          authorLabel: describeMktgRevisionAuthor(revision.author),
        }))
      : [];
  });
  protected readonly latestRevision: Signal<MktgRevisionSummary | null> = computed(() => this.detail()?.revisions.find((revision) => revision.latest) ?? null);

  // Requests, as observables of their inputs (toObservable needs the injection context).
  private readonly listRequest$ = toObservable(computed(() => ({ project: this.projectContext.activeContextUid(), type: this.selectedParam() })));
  private readonly detailRequest$ = toObservable(
    computed(() => {
      const living = this.selectedLiving();
      return {
        project: this.projectContext.activeContextUid(),
        agentKey: living?.type.agentKey ?? '',
        documentId: living?.document?.documentId ?? '',
      };
    })
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.listRequest$
        .pipe(
          filter((request) => !!request.project),
          tap((request) => {
            this.pendingSelectionScroll = request.project === this.listedProject && request.type !== this.listedType;
            this.listedType = request.type;
            this.loading.set(true);
            this.errorText.set('');
            this.listFailed.set(false);
            if (request.project !== this.listedProject) {
              this.listedProject = request.project;
              this.documents.set(null);
              this.notice.set('');
            }
          }),
          switchMap((request) =>
            this.listRefresh.pipe(
              startWith(undefined),
              switchMap(() =>
                this.documentStore.listDocuments(request.project).pipe(
                  catchError((error: HttpErrorResponse) => {
                    this.listFailed.set(true);
                    this.errorText.set(
                      error.status === 403
                        ? 'You need write access to this project to see its Marketing OS documents.'
                        : 'The documents could not be loaded. Try again in a moment.'
                    );
                    return of(null);
                  })
                )
              )
            )
          ),
          takeUntilDestroyed()
        )
        .subscribe((documents) => {
          this.documents.set(documents);
          this.loading.set(false);
          this.scrollToSelection();
        });

      this.detailRequest$
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap(() => {
            this.detail.set(null);
            this.notice.set('');
            if (!this.listFailed()) this.errorText.set('');
          }),
          switchMap((request) => {
            if (!request.project || !request.documentId) {
              return of(null);
            }
            this.detailLoading.set(true);
            return this.documentStore.getDocument(request.project, request.agentKey, request.documentId).pipe(
              catchError((error: HttpErrorResponse) => {
                this.errorText.set(this.actionErrorText(error));
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((detail) => {
          this.detail.set(detail);
          this.detailLoading.set(false);
          this.scrollToSelection();
        });
    }
  }

  // === Protected methods ===
  protected onRestore(revision: MktgRevisionSummary): void {
    const detail = this.detail();
    const project = this.projectContext.activeContextUid();
    if (!detail || detail.type.kind === 'run' || !project || this.restoringId()) {
      return;
    }

    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    // Do not cancel an accepted write when the component is destroyed.
    this.documentStore.restoreRevision(project, detail.type.agentKey, detail.documentId, revision.id).subscribe({
      next: (restored) => {
        this.restoringId.set(null);
        if (this.destroyRef.destroyed || this.projectContext.activeContextUid() !== project) return;
        // Replace a read started before this write committed; it must not undo the restored pointer.
        if (this.loading()) this.listRefresh.next();
        this.documents.update((documents) => this.withCurrentRevision(documents, detail, restored.revision));
        if (!this.sameDocument(project, detail.type.agentKey)) return;
        this.detail.set(restored);
        this.notice.set(`Revision ${revision.number} is now current. No revision was added.`);
      },
      error: (error: HttpErrorResponse) => {
        this.restoringId.set(null);
        if (this.sameDocument(project, detail.type.agentKey)) this.errorText.set(this.actionErrorText(error));
      },
    });
  }

  // === Private initializers ===
  /**
   * The type in `?type=`, when it names one; otherwise the first living
   * document the project has, or the first living type.
   */
  private initSelectedType(): Signal<MktgDocumentType> {
    return computed(() => {
      const requested = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === this.selectedParam());
      if (requested) {
        return requested;
      }
      const withDocument = this.documents()?.groups.find((group) => group.type.kind === 'living' && group.documents.length > 0);
      return withDocument?.type ?? MKTG_DOCUMENT_TYPES[0];
    });
  }

  /** Document types per Kit family in board order; types no family lists (e.g. legacy ICPs) close the list as Other documents. */
  private familyTypes(): { name: string; types: MktgDocumentType[] }[] {
    const placed = new Set<string>();
    const families = MKTG_KIT_FAMILIES.map((family) => {
      const types = family.assets.flatMap((asset) => MKTG_DOCUMENT_TYPES.filter((type) => type.agentKey === asset.agentKey && !placed.has(type.agentKey)));
      types.forEach((type) => placed.add(type.agentKey));
      return { name: family.name, types };
    });
    const others = MKTG_DOCUMENT_TYPES.filter((type) => !placed.has(type.agentKey));
    return [...families, { name: 'Other documents', types: others }].filter((family) => family.types.length > 0);
  }

  private initFamilyNav(): Signal<{ name: string; items: MktgDocumentNavItem[] }[]> {
    return computed(() => {
      const groups = this.documents()?.groups ?? [];
      // Until a list read succeeds (still loading, during SSR, or failed) nothing is
      // known about the counts: no badge rather than "Not generated yet" / "No runs yet".
      const countsUnknown = this.listFailed() || this.loading() || !this.documents();
      const selected = this.selectedType().agentKey;
      return this.familyTypes().map((family) => {
        // Number living documents only where a family has a run order to show.
        const living = family.types.filter((type) => type.kind === 'living');
        return {
          name: family.name,
          items: family.types.map((type) => {
            const documents = groups.find((group) => group.type.agentKey === type.agentKey)?.documents ?? [];
            return {
              type,
              position: type.kind === 'living' && living.length > 1 ? living.indexOf(type) + 1 : null,
              ...(countsUnknown
                ? { badge: '', badgeClass: '' }
                : this.navBadge(type, documents.length, documents[0]?.currentRevisionNumber ?? documents[0]?.revisionCount ?? 0)),
              selected: !this.showAll() && type.agentKey === selected,
            };
          }),
        };
      });
    });
  }

  // === Private helpers ===
  private withCurrentRevision(
    documents: MktgDocumentsResponse | null,
    detail: MktgDocumentDetailResponse,
    revision: MktgRevisionSummary
  ): MktgDocumentsResponse | null {
    if (!documents) return null;
    return {
      ...documents,
      groups: documents.groups.map((group) => {
        if (group.type.agentKey !== detail.type.agentKey) return group;
        return {
          ...group,
          documents: group.documents.map((document) => {
            if (document.documentId !== detail.documentId) return document;
            return { ...document, latestRevisionId: revision.id, currentRevisionNumber: revision.number };
          }),
        };
      }),
    };
  }

  private scrollToSelection(): void {
    if (!this.pendingSelectionScroll || this.loading() || this.detailLoading() || (this.selectedLiving()?.document && !this.detail())) return;
    this.pendingSelectionScroll = false;
    afterNextRender(
      () => {
        if (!isPlatformBrowser(this.platformId)) return;
        const container = this.documentContainer()?.nativeElement;
        if (!container) return;
        const style = window.getComputedStyle(container);
        const contentWidth = container.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
        // Match the page's @[800px] content-box query, including sidebar and gutter effects.
        if (contentWidth < 800) this.documentPanel()?.nativeElement.scrollIntoView({ block: 'start' });
      },
      { injector: this.injector }
    );
  }

  private sameDocument(project: string, agentKey: string): boolean {
    return !this.destroyRef.destroyed && this.projectContext.activeContextUid() === project && this.selectedType().agentKey === agentKey;
  }

  private actionErrorText(error: HttpErrorResponse): string {
    if (error.status === 403) return 'You need write access to this project to use its Marketing OS documents.';
    if (error.status === 404)
      return error.error?.code === 'MKTG_DOCUMENT_NOT_FOUND' ? 'This document could not be found.' : 'This document has no such revision.';
    if (error.status === 412) return 'The document changed. Reload before making a revision current.';
    return 'The document could not be updated or loaded. Reload to check its state, then try again.';
  }

  private navBadge(type: MktgDocumentType, documentCount: number, revisionCount: number): Pick<MktgDocumentNavItem, 'badge' | 'badgeClass'> {
    if (type.kind === 'run') {
      if (documentCount === 0) {
        return { badge: 'No runs yet', badgeClass: 'text-gray-500' };
      }
      return { badge: documentCount === 1 ? '1 run' : `${documentCount} runs`, badgeClass: 'text-gray-500' };
    }
    if (documentCount === 0) {
      return { badge: 'Not generated yet', badgeClass: 'text-gray-500' };
    }
    return { badge: `v${revisionCount} · current`, badgeClass: 'rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700' };
  }
}
