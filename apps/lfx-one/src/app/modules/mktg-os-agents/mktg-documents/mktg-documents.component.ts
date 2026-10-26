// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, I18nPluralPipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_DOCUMENT_TYPES, MKTG_KIT_FAMILIES, MKTG_RUN_POLL, MKTG_DOCUMENT_PROGRESS_POLL } from '@lfx-one/shared/constants';
import {
  MktgDocumentDetailResponse,
  MktgDocumentGroup,
  MktgDocumentNavItem,
  MktgDocumentRunRow,
  MktgDocumentsResponse,
  MktgDocumentType,
  MktgRevisionRow,
  MktgRevisionSummary,
  MktgSelectedLivingDocument,
} from '@lfx-one/shared/interfaces';
import { describeMktgRevision, describeMktgRevisionAuthor, mktgKitRootCrumb } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { isTransientHttpError } from '@shared/utils/http-error.utils';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  map,
  merge,
  Observable,
  of,
  Subject,
  switchMap,
  takeUntil,
  tap,
  throwError,
  timer,
  withLatestFrom,
} from 'rxjs';
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
  imports: [
    DatePipe,
    I18nPluralPipe,
    NgClass,
    RouterLink,
    MessageComponent,
    MktgBreadcrumbComponent,
    MktgKitTabsComponent,
    MktgKitHeaderComponent,
    ButtonComponent,
  ],
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
  private readonly userService = inject(UserService);

  // === Signals ===
  protected readonly loading = signal(true);
  protected readonly errorText = signal('');
  protected readonly refreshWarning = signal('');
  // The documents list could not be read: nothing is known about what the
  // project has stored, so neither the empty states nor the nav badges may
  // assert an absence while this is set.
  protected readonly listFailed = signal(false);
  protected readonly documents = signal<MktgDocumentsResponse | null>(null);
  protected readonly detail = signal<MktgDocumentDetailResponse | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly restoringId = signal<string | null>(null);
  protected readonly notice = signal('');
  private listedType: string | null = null;
  private pendingSelectionScroll = false;
  private readonly reloads = signal(0);
  private listedScope = '';
  private detailedScope = '';
  private restoreEpoch = 0;

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
  /** "1 revision" / "N revisions", for the list rows and the history heading. */
  protected readonly revisionPlural = { '=1': '# revision', other: '# revisions' };
  /** The current revision as the header describes it: how it was made and by whom. */
  protected readonly latestRow: Signal<MktgRevisionRow | null> = computed(() => this.revisionRows().find((row) => row.revision.latest) ?? null);

  protected readonly runs: Signal<MktgDocumentRunRow[]> = this.initRuns();
  protected readonly selectedRuns = computed(() => this.runs().filter((run) => run.agentKey === this.selectedType().agentKey));

  // Type navigation follows main; identity/reload changes cancel scoped reads and timers.
  private readonly listRequest$ = toObservable(
    computed(() => ({
      project: this.projectContext.activeContextUid(),
      userSub: this.userService.user()?.sub,
      type: this.selectedParam(),
    }))
  );
  private readonly detailRequest$ = toObservable(
    computed(() => {
      const living = this.selectedLiving();
      return {
        project: this.projectContext.activeContextUid(),
        userSub: this.userService.user()?.sub,
        agentKey: living?.type.agentKey ?? '',
        documentId: living?.document?.documentId ?? '',
        latestRevisionId: living?.document?.latestRevisionId ?? '',
        revisionCount: living?.document?.revisionCount ?? 0,
        reload: this.reloads(),
      };
    })
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initLists()
        .pipe(takeUntilDestroyed())
        .subscribe((documents) => {
          this.documents.set(documents);
          this.loading.set(false);
          this.scrollToSelection();
        });

      this.detailRequest$
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap((request) => {
            const scope = JSON.stringify([request.project, request.userSub, request.agentKey, request.documentId]);
            if (scope !== this.detailedScope) {
              this.detailedScope = scope;
              this.detail.set(null);
              this.notice.set('');
              if (!this.listFailed()) this.errorText.set('');
            }
          }),
          switchMap((request) => {
            if (!request.project || !request.userSub || !request.documentId) {
              return of(null);
            }
            this.detailLoading.set(true);
            const known = this.detail();
            return this.documentStore.getDocument(request.project, request.agentKey, request.documentId).pipe(
              takeUntil(this.listRefresh),
              catchError((error: HttpErrorResponse) => {
                this.errorText.set(this.actionErrorText(error));
                if (known && isTransientHttpError(error)) {
                  this.refreshWarning.set('Could not refresh revisions. The last loaded revisions are kept; refresh to check again.');
                  return of(known);
                }
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
  protected onRefreshProgress(): void {
    this.errorText.set('');
    this.reloads.update((value) => value + 1);
    this.listRefresh.next();
  }

  protected onRestore(revision: MktgRevisionSummary): void {
    const detail = this.detail();
    const project = this.projectContext.activeContextUid();
    const userSub = this.userService.user()?.sub;
    if (!detail || detail.type.kind === 'run' || !project || !userSub || this.restoringId()) {
      return;
    }

    const epoch = ++this.restoreEpoch;
    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    // Do not cancel an accepted write when the component is destroyed.
    this.documentStore.restoreRevision(project, detail.type.agentKey, detail.documentId, revision.id).subscribe({
      next: (restored) => {
        if (
          epoch !== this.restoreEpoch ||
          this.destroyRef.destroyed ||
          this.projectContext.activeContextUid() !== project ||
          this.userService.user()?.sub !== userSub
        )
          return;
        this.restoringId.set(null);
        this.documents.update((documents) => this.withCurrentRevision(documents, detail, restored.revision));
        this.reloads.update((value) => value + 1);
        // Cancel and replace list reads synchronously so pre-write responses cannot undo this ACK.
        this.listRefresh.next();
        if (!this.sameDocument(project, detail.type.agentKey)) return;
        this.detail.set(restored);
        this.notice.set(`Revision ${revision.number} is now current. No revision was added.`);
      },
      error: (error: HttpErrorResponse) => {
        if (epoch !== this.restoreEpoch || this.userService.user()?.sub !== userSub) return;
        this.restoringId.set(null);
        if (this.sameDocument(project, detail.type.agentKey)) this.errorText.set(this.actionErrorText(error));
      },
    });
  }

  // === Private initializers ===
  private initRuns(): Signal<MktgDocumentRunRow[]> {
    return computed(() =>
      (this.documents()?.runs ?? []).map((run) => ({
        ...run,
        label: MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === run.agentKey)?.itemLabel ?? 'Document',
      }))
    );
  }

  private initLists(): Observable<MktgDocumentsResponse | null> {
    return merge(
      this.listRequest$,
      this.listRefresh.pipe(
        withLatestFrom(this.listRequest$),
        map(([, request]) => request)
      )
    ).pipe(
      tap((request) => {
        const scope = JSON.stringify([request.project, request.userSub]);
        this.pendingSelectionScroll = scope === this.listedScope && request.type !== this.listedType;
        const typeChanged = request.type !== this.listedType;
        this.listedType = request.type;
        if (typeChanged) this.loading.set(true);
        if (scope !== this.listedScope) {
          this.listedScope = scope;
          this.restoreEpoch++;
          this.restoringId.set(null);
          this.loading.set(true);
          this.documents.set(null);
          this.notice.set('');
          this.errorText.set('');
          this.refreshWarning.set('');
          this.listFailed.set(false);
        }
      }),
      switchMap((request) => {
        if (!request.project || !request.userSub) return EMPTY;
        const scope = JSON.stringify([request.project, request.userSub]);
        const currentScope = () => JSON.stringify([this.projectContext.activeContextUid(), this.userService.user()?.sub]);
        let known = this.documents();
        let unavailableSince: number | null = null;
        let activeSince: number | null = null;
        let failures = 0;
        const unavailable = () => {
          unavailableSince ??= Date.now();
          failures++;
        };
        const expired = () =>
          (unavailableSince !== null && Date.now() - unavailableSince >= MKTG_RUN_POLL.timeoutMs) ||
          (activeSince !== null && Date.now() - activeSince >= MKTG_RUN_POLL.timeoutMs);
        const pause = () => this.refreshWarning.set('Automatic progress checks paused. Refresh progress to try again; the last loaded documents are kept.');
        const read = (poll = false) =>
          (poll ? this.documentStore.listDocuments(request.project, true) : this.documentStore.listDocuments(request.project)).pipe(
            filter(() => scope === currentScope()),
            map((data) =>
              data.progressUnavailable
                ? {
                    ...data,
                    runs: [...new Map([...(known?.runs ?? []), ...(data.runs ?? [])].map((run) => [run.runId, run] as const)).values()],
                  }
                : data
            ),
            tap((data) => {
              if (this.listFailed()) this.errorText.set('');
              this.listFailed.set(false);
              known = data;
              if (data.runs?.some((run) => run.state === 'writing' || run.state === 'storing')) activeSince ??= Date.now();
              else if (!data.progressUnavailable) activeSince = null;
              if (data.progressUnavailable) unavailable();
              else {
                unavailableSince = null;
                failures = 0;
              }
              this.refreshWarning.set(data.progressUnavailable ? 'Run progress could not be fully refreshed. Retrying.' : '');
            }),
            catchError((error: unknown) => {
              if (scope !== currentScope()) return EMPTY;
              if (!known || !isTransientHttpError(error)) return throwError(() => error);
              unavailable();
              this.refreshWarning.set('Could not refresh. Showing the last loaded documents; retrying.');
              return of(known);
            })
          );
        return read().pipe(
          expand((data) => {
            if (expired()) {
              pause();
              return EMPTY;
            }
            const active = data.runs?.some((run) => run.state === 'writing' || run.state === 'storing');
            if (!active && unavailableSince === null) return EMPTY;
            let delay: number = MKTG_RUN_POLL.intervalMs;
            if (failures) delay = Math.min(MKTG_DOCUMENT_PROGRESS_POLL.maxBackoffMs, delay * 2 ** (failures - 1));
            if (unavailableSince !== null) delay = Math.min(delay, Math.max(0, MKTG_RUN_POLL.timeoutMs - (Date.now() - unavailableSince)));
            if (activeSince !== null) delay = Math.min(delay, Math.max(0, MKTG_RUN_POLL.timeoutMs - (Date.now() - activeSince)));
            return timer(delay).pipe(
              switchMap(() => {
                if (expired()) {
                  pause();
                  return EMPTY;
                }
                return read(true);
              })
            );
          }),
          takeUntil(this.listRefresh),
          catchError((error: HttpErrorResponse) => {
            this.refreshWarning.set('');
            this.listFailed.set(true);
            this.errorText.set(
              error.status === 403 || error.status === 401
                ? 'You need write access to this project to see its Marketing OS documents.'
                : 'The documents could not be loaded. Try again in a moment.'
            );
            return of(null);
          })
        );
      })
    );
  }

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
    const active = this.runs().find((run) => run.agentKey === type.agentKey && run.state !== 'failed');
    if (active) {
      if (active.state === 'questions') return { badge: type.agentKey === 'member-360' ? 'Paused' : 'Needs answers', badgeClass: 'text-blue-600' };
      return { badge: active.state === 'storing' ? 'Storing' : 'Writing', badgeClass: 'text-blue-600' };
    }
    if (documentCount === 0 && this.documents()?.progressUnavailable) return { badge: '', badgeClass: '' };
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
