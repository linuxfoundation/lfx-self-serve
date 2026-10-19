// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, isPlatformBrowser, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MessageComponent } from '@components/message/message.component';
import { MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
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
import { describeMktgRevision } from '@lfx-one/shared/utils';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { catchError, distinctUntilChanged, EMPTY, expand, map, of, switchMap, tap, timer } from 'rxjs';

// The Marketing OS Documents area (design of record: "Document store", Main
// board): living documents in run order with their revision state, the
// one-off runs grouped by agent, and the selected living document's Revisions
// table with View and Restore. Data is fetched in the browser only, after
// hydration, so SSR output stays stable — same pattern as the marketplace.
@Component({
  selector: 'lfx-mktg-documents',
  imports: [DatePipe, NgClass, RouterLink, MessageComponent],
  templateUrl: './mktg-documents.component.html',
})
export class MktgDocumentsComponent {
  // === Injections ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentStore = inject(MktgDocumentStoreService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContext = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly userService = inject(UserService);

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
  private readonly reloads = signal(0);
  // The project/effective-subject scope whose list is shown. Scope changes
  // clear old documents; a restore-triggered reload of the same scope keeps
  // them visible while the replacement list is read.
  private listedScope = '';

  private readonly selectedParam = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('type'))), { initialValue: null });

  // === Computed ===
  protected readonly projectName: Signal<string> = computed(() => this.projectContext.activeContext()?.name ?? '');
  protected readonly selectedType: Signal<MktgDocumentType> = this.initSelectedType();
  protected readonly livingNav: Signal<MktgDocumentNavItem[]> = this.initNav('living');
  protected readonly runNav: Signal<MktgDocumentNavItem[]> = this.initNav('run');
  protected readonly selectedGroup: Signal<MktgDocumentGroup | null> = computed(
    () => this.documents()?.groups.find((group) => group.type.agentKey === this.selectedType().agentKey) ?? null
  );
  protected readonly selectedLiving: Signal<MktgSelectedLivingDocument | null> = computed(() => {
    const type = this.selectedType();
    return type.kind === 'living' ? { type, document: this.selectedGroup()?.documents[0] ?? null } : null;
  });
  protected readonly revisionRows: Signal<MktgRevisionRow[]> = computed(() => {
    const detail = this.detail();
    return detail ? detail.revisions.map((revision) => ({ revision, how: describeMktgRevision(revision, detail.type) })) : [];
  });
  protected readonly latestRevision: Signal<MktgRevisionSummary | null> = computed(() => this.detail()?.revisions[0] ?? null);
  protected readonly runs = computed(() =>
    (this.documents()?.runs ?? []).map((run) => ({
      ...run,
      label: MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === run.agentKey)?.itemLabel ?? 'Document',
    }))
  );
  protected readonly selectedRuns = computed(() => this.runs().filter((run) => run.agentKey === this.selectedType().agentKey));

  // Requests, as observables of their inputs (toObservable needs the injection context).
  private readonly listRequest$ = toObservable(
    computed(() => ({ project: this.projectContext.activeContextUid(), userSub: this.userService.user()?.sub, reload: this.reloads() }))
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
      };
    })
  );

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.listRequest$
        .pipe(
          tap((request) => {
            this.errorText.set('');
            this.listFailed.set(false);
            const scope = JSON.stringify([request.project, request.userSub]);
            if (scope !== this.listedScope) {
              this.listedScope = scope;
              this.loading.set(true);
              this.documents.set(null);
              this.notice.set('');
            }
          }),
          switchMap((request) => {
            if (!request.project || !request.userSub) {
              return EMPTY;
            }
            return this.documentStore.listDocuments(request.project).pipe(
              expand((documents) =>
                documents.runs?.some((run) => run.state !== 'failed')
                  ? timer(MKTG_RUN_POLL.intervalMs).pipe(switchMap(() => this.documentStore.listDocuments(request.project, true)))
                  : EMPTY
              ),
              catchError((error: HttpErrorResponse) => {
                this.listFailed.set(true);
                this.errorText.set(
                  error.status === 403
                    ? 'You need write access to this project to see its Marketing OS documents.'
                    : 'The documents could not be loaded. Try again in a moment.'
                );
                return of(null);
              })
            );
          }),
          takeUntilDestroyed()
        )
        .subscribe((documents) => {
          this.documents.set(documents);
          this.loading.set(false);
        });

      this.detailRequest$
        .pipe(
          distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
          tap(() => this.detail.set(null)),
          switchMap((request) => {
            if (!request.project || !request.documentId) {
              return of(null);
            }
            this.detailLoading.set(true);
            return this.documentStore.getDocument(request.project, request.agentKey, request.documentId).pipe(catchError(() => of(null)));
          }),
          takeUntilDestroyed()
        )
        .subscribe((detail) => {
          this.detail.set(detail);
          this.detailLoading.set(false);
        });
    }
  }

  // === Protected methods ===
  protected onRestore(revision: MktgRevisionSummary): void {
    const detail = this.detail();
    const project = this.projectContext.activeContextUid();
    if (!detail || !project || this.restoringId()) {
      return;
    }

    this.restoringId.set(revision.id);
    this.notice.set('');
    this.errorText.set('');
    this.documentStore
      .restoreRevision(project, detail.type.agentKey, detail.documentId, revision.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (restored) => {
          this.restoringId.set(null);
          this.notice.set(`Revision ${revision.number} restored as revision ${restored.revision.number}, now the latest.`);
          this.reloads.update((count) => count + 1);
        },
        error: () => {
          this.restoringId.set(null);
          this.errorText.set(`Revision ${revision.number} could not be restored. Nothing was changed; try again.`);
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

  private initNav(kind: MktgDocumentType['kind']): Signal<MktgDocumentNavItem[]> {
    return computed(() => {
      const groups = this.documents()?.groups ?? [];
      // Until a list read succeeds (still loading, during SSR, or failed) nothing is
      // known about the counts: no badge rather than "Not generated yet" / "No runs yet".
      const countsUnknown = this.listFailed() || this.loading() || !this.documents();
      const selected = this.selectedType().agentKey;
      return MKTG_DOCUMENT_TYPES.filter((type) => type.kind === kind).map((type, index) => {
        const documents = groups.find((group) => group.type.agentKey === type.agentKey)?.documents ?? [];
        return {
          type,
          position: kind === 'living' ? index + 1 : null,
          ...(countsUnknown ? { badge: '', badgeClass: '' } : this.navBadge(type, documents.length, documents[0]?.revisionCount ?? 0)),
          selected: type.agentKey === selected,
        };
      });
    });
  }

  // === Private helpers ===
  private navBadge(type: MktgDocumentType, documentCount: number, revisionCount: number): Pick<MktgDocumentNavItem, 'badge' | 'badgeClass'> {
    const active = this.documents()?.runs?.find((run) => run.agentKey === type.agentKey && run.state !== 'failed');
    if (active) {
      return { badge: active.state === 'storing' ? 'Storing' : 'Writing', badgeClass: 'text-blue-600' };
    }
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
