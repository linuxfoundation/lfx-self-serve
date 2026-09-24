// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  CLA_GROUP_SEARCH_DEBOUNCE_MS,
  ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS,
  ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
  ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY,
  ORG_CLA_ACKNOWLEDGMENTS_HEADING,
  ORG_CLA_ACKNOWLEDGMENTS_SUBTITLE,
  ORG_CLA_ACKNOWLEDGMENT_NOT_AUTHORIZED_COPY,
  ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS,
  ORG_CLA_INVALIDATE_ACTION_COPY,
  ORG_CLA_INVALIDATE_RECEIPT_COPY,
} from '@lfx-one/shared/constants';
import type {
  OrgClaAcknowledgmentRow,
  OrgClaApprovalEntry,
  OrgClaApprovalEntryInput,
  OrgClaContributorAcknowledgment,
  OrgClaContributorAcknowledgmentList,
  OrgClaGroup,
  OrgClaInvalidateAcknowledgmentDialogResult,
  OrgClaInvalidateAcknowledgmentRequest,
} from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant, orgClaPairProjectSfid } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  expand,
  finalize,
  of,
  reduce,
  skip,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { serverAuthoredMessage } from '@shared/utils/http-error.utils';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';

import { OrgEasyclaInvalidateAcknowledgmentDialogComponent } from './org-easycla-invalidate-acknowledgment-dialog.component';

/**
 * The Contributor Acknowledgments tab of the CLA Group detail page (#1986, #2806).
 *
 * Lists the employee acknowledgments (ECLA signatures) the producer holds under this CCLA. Per
 * the M3 prototype the identity is split into two columns: Name and the LF Login / GitHub or
 * GitLab ID, so a row with any identifier is visible even without an LF Login. Both columns fall
 * through to an em-dash rather than dropping the row.
 *
 * Three states, as the prototype shows them: Authorized, Not Authorized (the acknowledgment's
 * approval-list criteria were removed), and Invalidated (a CLA manager or admin revoked it). A Not
 * Authorized row keeps its Invalidate control, which the prototype offers to remove it for good.
 *
 * Search is server-side: the input feeds a debounced observable whose term is forwarded to the
 * BFF as `search`. A new term resets pagination (the producer's `nextKey` is scoped to a term)
 * so filtering never silently misses matches on pages the browser has not fetched yet. Load-more
 * uses `nextKey` to append the next page to the current view.
 *
 * A per-row Invalidate control opens a confirmation and, on confirm, refetches rather than
 * removing the row — the producer stamps the invalidation on the signature, and the refetch is
 * what renders the row in its Invalidated state with those stamps.
 */
@Component({
  selector: 'lfx-org-easycla-contributor-acknowledgments',
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, PersonAvatarComponent, ReactiveFormsModule, SkeletonModule, TagComponent],
  templateUrl: './org-easycla-contributor-acknowledgments.component.html',
  // Scoped to this panel so the dialog it opens is torn down with the tab rather than outliving it.
  providers: [DialogService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaContributorAcknowledgmentsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  /** The open confirmation, held so it can be closed if the tab is torn down under it. */
  private invalidateDialog: DynamicDialogRef | null = null;

  public readonly claGroup = input.required<OrgClaGroup>();

  /**
   * The agreement's acknowledgment total, each time an unsearched list loads.
   *
   * The detail page's tab badge counts from its own read on page load; this keeps it matching the
   * table once the tab has loaded. A searched load is not emitted: its total is the matches.
   */
  public readonly countChanged = output<{ signatureId: string; count: number }>();

  /** The Not Authorized row's "Add the user to the Approval list" link. The page switches tabs. */
  public readonly approvalListRequested = output<void>();

  /** The approval list's new entry count, after an invalidate also removed the contributor's entries. */
  public readonly approvalListChanged = output<{ signatureId: string; count: number }>();

  protected readonly heading = ORG_CLA_ACKNOWLEDGMENTS_HEADING;
  protected readonly subtitle = ORG_CLA_ACKNOWLEDGMENTS_SUBTITLE;
  protected readonly emptyCopy = ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY;
  protected readonly columnHeaders = ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS;
  protected readonly stateLabels = ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS;
  protected readonly notAuthorizedCopy = ORG_CLA_ACKNOWLEDGMENT_NOT_AUTHORIZED_COPY;
  protected readonly emDash = ORG_CLA_ACKNOWLEDGMENTS_EM_DASH;
  protected readonly actionCopy = ORG_CLA_INVALIDATE_ACTION_COPY;
  protected readonly loadingRows = [1, 2, 3, 4] as const;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly page = signal<OrgClaContributorAcknowledgmentList | null>(null);
  private readonly errorMessage = signal<string | null>(null);
  private readonly loadingMore = signal(false);
  private readonly fetchGeneration = signal(0);
  private pagesLoaded = 1;
  private readonly pendingInvalidateIds = signal<ReadonlySet<string>>(new Set());
  // Bumped after a successful invalidate to re-run the fetch cycle. A counter rather than a
  // boolean so two invalidates in a row each produce a distinct tuple for `distinctUntilChanged`.
  private readonly reloadTrigger = signal(0);
  // The last-emitted search term, cached as a signal so `loadMore` can read it synchronously
  // alongside the fetch subscription.
  private readonly searchTerm = signal<string>('');
  protected readonly loading = signal(true);

  private readonly signatureId = computed(() => this.claGroup().id);
  private readonly orgUid = computed(() => this.accountContext.selectedAccount()?.uid ?? '');

  /**
   * One fetch cycle per (org, signatureId, search) tuple.
   *
   * The pipeline is observable end-to-end. An earlier version used
   * `toSignal(toObservable(computed(...)))` and was fragile under Angular's effect scheduler
   * — the signal update would land but the resulting `toObservable` emission needed a manual
   * tick to fire, making a working search hard to pin down in a test. Keeping the tuple in one
   * `combineLatest` avoids that hop entirely.
   *
   * A change in `search` resets pagination: the producer's `nextKey` cursor is scoped to a
   * term, so re-using it under a new term would page through unrelated rows. `page` is reset to
   * `null` alongside so the previous term's rows are not shown while the fresh request is in
   * flight.
   *
   * `distinctUntilChanged` on the tuple key drops a duplicate refresh while the first is still
   * in flight — matching the sibling approval-list pattern.
   */
  private readonly orgUid$ = toObservable(this.orgUid);
  private readonly signatureId$ = toObservable(this.signatureId);
  private readonly reload$ = toObservable(this.reloadTrigger);
  // `startWith` is placed AFTER `debounceTime` so the initial empty term fires synchronously —
  // otherwise the first fetch would wait a debounce window. Only user-driven `valueChanges` are
  // debounced.
  private readonly search$ = this.filterForm.controls.search.valueChanges.pipe(
    debounceTime(CLA_GROUP_SEARCH_DEBOUNCE_MS),
    startWith(this.filterForm.controls.search.value),
    distinctUntilChanged(),
    tap((value) => this.searchTerm.set(value)),
    takeUntilDestroyed(this.destroyRef)
  );

  private readonly listSignal = toSignal(
    combineLatest([this.orgUid$, this.signatureId$, this.search$, this.reload$]).pipe(
      distinctUntilChanged(([a1, b1, c1, d1], [a2, b2, c2, d2]) => a1 === a2 && b1 === b2 && c1 === c2 && d1 === d2),
      switchMap(([orgUid, signatureId, search]) => {
        this.fetchGeneration.update((generation) => generation + 1);
        this.pagesLoaded = 1;
        // Load more is a separate request from this pipeline. A tuple change must drop its
        // in-flight flag here: waiting for that request's finalize leaves the new page's
        // Load more disabled, and a request that never returns leaves it disabled for good.
        this.loadingMore.set(false);
        this.errorMessage.set(null);
        // Reset pagination each fetch cycle — Load-more merges into `page`, and this reset is
        // what makes a new search term start from the first page rather than the previous one.
        this.page.set(null);
        if (!orgUid || !signatureId) return of(null as OrgClaContributorAcknowledgmentList | null);
        this.loading.set(true);
        return this.claService.getContributorAcknowledgments(orgUid, signatureId, { search: search.trim() }).pipe(
          tap((list) => {
            this.page.set(list);
            this.errorMessage.set(null);
            if (!search.trim()) this.countChanged.emit({ signatureId, count: list.totalCount });
          }),
          catchError((error: unknown) => {
            const message =
              error instanceof HttpErrorResponse && typeof error.error?.message === 'string' && error.error.message.trim().length > 0
                ? error.error.message
                : "We couldn't load the contributor acknowledgments for this agreement.";
            this.page.set(null);
            this.errorMessage.set(message);
            return of(null as OrgClaContributorAcknowledgmentList | null);
          }),
          finalize(() => this.loading.set(false))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ),
    { initialValue: null as OrgClaContributorAcknowledgmentList | null }
  );

  // Load-more mutates `page`, so it takes precedence over `listSignal` (which holds only the
  // first page for the current fetch cycle). Reversing this order was a real bug: a second page
  // fetched by Load-more never rendered because the initial `listSignal` shadowed the merged
  // `page` value.
  protected readonly loadedList = computed(() => this.page() ?? this.listSignal());

  protected readonly rows = computed<OrgClaAcknowledgmentRow[]>(() => {
    const list = this.loadedList();
    if (!list) return [];
    const pending = this.pendingInvalidateIds();
    return list.list.map((ack) => this.toRow(ack, pending));
  });

  // ACS decides both affordances, per the self permission check the gateway also enforces (#1980).
  // Each starts null (checking) and fails closed, so the control stays hidden until ACS says yes.
  // Invalidate is gated on `ecla-invalidate`; the dialog's also-remove option on
  // `approval-list-update`, so a manager who can invalidate but not edit the list still invalidates.
  private readonly invalidateGrant = signal<boolean | null>(null);
  private readonly removeFromListGrant = signal<boolean | null>(null);
  protected readonly canInvalidate = computed(() => this.invalidateGrant() === true);

  protected readonly hasNextPage = computed(() => !!this.loadedList()?.nextKey);
  protected readonly showEmptyState = computed(
    () => !this.loading() && !this.errorMessage() && (this.searchTerm() ?? '').trim().length === 0 && (this.loadedList()?.list.length ?? 0) === 0
  );
  protected readonly showErrorState = computed(() => !!this.errorMessage());
  protected readonly loadingMoreSignal = this.loadingMore.asReadonly();

  /** Set once the panel is torn down, so a write that outlives the tab does not touch its signals. */
  private destroyed = false;

  constructor() {
    // The parent reuses this panel when the agreement changes, so a dialog opened against one
    // CCLA must not stay up for the next one.
    combineLatest([this.orgUid$, this.signatureId$])
      .pipe(
        distinctUntilChanged(([prevOrg, prevSignature], [nextOrg, nextSignature]) => prevOrg === nextOrg && prevSignature === nextSignature),
        skip(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.invalidateDialog?.close();
        this.invalidateDialog = null;
      });

    toObservable(
      computed(() => {
        const orgUid = this.orgUid();
        const projectSfid = orgClaPairProjectSfid(this.claGroup());
        return orgUid && projectSfid ? `${orgUid}::${projectSfid}` : '';
      })
    )
      .pipe(
        distinctUntilChanged(),
        tap(() => {
          this.invalidateGrant.set(null);
          this.removeFromListGrant.set(null);
        }),
        switchMap((pair) => {
          if (!pair) return of<[boolean, boolean]>([false, false]);
          const [orgUid, projectSfid] = pair.split('::');
          return combineLatest([
            this.claService.checkPermission(orgUid, 'ecla-invalidate', projectSfid),
            this.claService.checkPermission(orgUid, 'approval-list-update', projectSfid),
          ]);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(([canInvalidate, canRemove]) => {
        this.invalidateGrant.set(canInvalidate);
        this.removeFromListGrant.set(canRemove);
      });

    // The dialog attaches to `document.body`, so it would outlive this panel if the CLA manager
    // switched tabs with it open. The invalidate request itself is not tied to this teardown.
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidateDialog?.close();
      this.invalidateDialog = null;
    });
  }

  /** Fetch the next page from the producer and append its rows to the current list. */
  protected loadMore(): void {
    const list = this.loadedList();
    if (!list?.nextKey || this.loadingMore()) return;
    this.loadingMore.set(true);
    const search = (this.searchTerm() ?? '').trim();
    const generation = this.fetchGeneration();
    this.claService
      .getContributorAcknowledgments(this.orgUid(), this.signatureId(), { search, nextKey: list.nextKey })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          // A newer fetch already cleared this flag and may have started its own Load more.
          // Clearing again here would re-enable that newer request's button while it is still in flight.
          if (this.fetchGeneration() === generation) this.loadingMore.set(false);
        })
      )
      .subscribe({
        next: (next) => {
          if (this.fetchGeneration() !== generation) return;
          this.pagesLoaded += 1;
          const merged: OrgClaContributorAcknowledgmentList = {
            ...next,
            signatureId: list.signatureId,
            list: [...list.list, ...next.list],
            canEdit: next.canEdit,
            resultCount: list.list.length + next.list.length,
            totalCount: next.totalCount ?? list.totalCount,
            nextKey: next.nextKey,
          };
          this.page.set(merged);
        },
        error: () => {
          if (this.fetchGeneration() !== generation) return;
          this.messageService.add({
            severity: 'error',
            summary: 'Load more failed',
            detail: "We couldn't fetch the next page of acknowledgments. Try again in a moment.",
          });
        },
      });
  }

  /**
   * Opens the confirmation for one row. Nothing is sent until it closes with a request.
   *
   * The dialog is the consent moment, so dismissing it — Cancel, the mask, Escape — closes with
   * `null` and no request is made. That is the whole reason the API call lives here and not in
   * the dialog: a dismissed dialog cannot leave a write half-done.
   */
  protected onInvalidate(row: OrgClaAcknowledgmentRow): void {
    if (!this.canInvalidate() || row.invalidated || !row.invalidatable || row.invalidatePending) return;

    // Close any dialog already open, so a fast click on a second row leaves one modal rather than
    // two competing for keyboard focus.
    this.invalidateDialog?.close();
    const orgUid = this.orgUid();
    const claSignatureId = this.signatureId();
    const matchingEntries = signal<OrgClaApprovalEntry[] | null | undefined>(undefined);
    const canRemoveEntries = signal(this.removeFromListGrant() === true);
    const dialogRef = this.dialogService.open(OrgEasyclaInvalidateAcknowledgmentDialogComponent, {
      showHeader: false,
      modal: true,
      dismissableMask: true,
      closable: true,
      width: 'min(32rem, 100%)',
      data: { contributor: this.contributorLabel(row), matchingEntries: matchingEntries.asReadonly(), canRemoveEntries: canRemoveEntries.asReadonly() },
    });

    // `open` is typed nullable because it declines under SSR, where there is no document to attach
    // to. The control that calls this is browser-side, so there is nothing to subscribe to then.
    if (!dialogRef) return;
    nameDynamicDialog(this.dialogService, dialogRef, OrgEasyclaInvalidateAcknowledgmentDialogComponent.headingId);
    this.invalidateDialog = dialogRef;
    this.claService
      .getApprovalList(orgUid, claSignatureId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          matchingEntries.set(this.entriesAddedFor(row.ack, list.entries));
        },
        error: (error: unknown) => {
          console.warn(
            'Failed to load the approval list for the invalidate dialog:',
            (error as HttpErrorResponse)?.status,
            (error as HttpErrorResponse)?.message
          );
          matchingEntries.set(null);
        },
      });
    // take(1): the dialog can emit close more than once while it is still closing, and a second
    // emission would send the write again. The HTTP call itself does not use take(1), so closing
    // the tab does not cancel a write that has already started.
    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: OrgClaInvalidateAcknowledgmentDialogResult | null | undefined) => {
      if (this.invalidateDialog === dialogRef) this.invalidateDialog = null;
      if (!result || this.destroyed) return;
      const { removeApprovalEntries, ...request } = result;
      // The pair captured when the dialog opened. A confirm that races an agreement change
      // must not write the previous row against the agreement now on screen.
      if (orgUid !== this.orgUid() || claSignatureId !== this.signatureId()) return;
      this.sendInvalidate(row, request, orgUid, claSignatureId, removeApprovalEntries ?? []);
    });
  }

  /** Entries added for this contributor alone. Domain and org entries cover others too, so they never match. */
  private entriesAddedFor(ack: OrgClaContributorAcknowledgment, entries: OrgClaApprovalEntry[]): OrgClaApprovalEntry[] {
    const same = (entry: OrgClaApprovalEntry, identity: string | undefined): boolean =>
      !!identity && entry.value.trim().toLowerCase() === identity.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (entry.kind === 'email' && same(entry, ack.email)) ||
        (entry.kind === 'github-username' && same(entry, ack.githubUsername)) ||
        (entry.kind === 'gitlab-username' && same(entry, ack.gitlabUsername))
    );
  }

  private removeApprovalEntries(orgUid: string, claSignatureId: string, entries: OrgClaApprovalEntryInput[]): void {
    this.claService.updateApprovalList(orgUid, claSignatureId, { add: [], remove: entries }).subscribe({
      next: (list) => {
        if (!this.destroyed && claSignatureId === this.signatureId())
          this.approvalListChanged.emit({ signatureId: claSignatureId, count: list.entries.length });
      },
      error: (error: unknown) => {
        console.warn(
          'Failed to remove approval-list entries after an invalidate:',
          (error as HttpErrorResponse)?.status,
          (error as HttpErrorResponse)?.message
        );
        this.messageService.add({
          severity: 'warn',
          summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.removalFailedSummary,
          detail: ORG_CLA_INVALIDATE_RECEIPT_COPY.removalFailedDetail,
        });
      },
    });
  }

  /**
   * Sends the write, then refetches — it does not remove the row.
   *
   * The producer stamps `invalidatedAt` and `invalidatedBy` on the signature and reports neither
   * in its response, and the row's job afterwards is to show the Invalidated state *with* those
   * stamps. An optimistic removal would show the contributor as gone, which is a different and
   * wrong claim: the acknowledgment stays on the record, invalidated.
   */
  private sendInvalidate(
    row: OrgClaAcknowledgmentRow,
    request: OrgClaInvalidateAcknowledgmentRequest,
    orgUid: string,
    claSignatureId: string,
    removeApprovalEntries: OrgClaApprovalEntryInput[] = []
  ): void {
    const signatureId = row.ack.signatureId;
    this.trackPending(signatureId, true);
    this.claService
      .invalidateAcknowledgment(orgUid, claSignatureId, signatureId, request)
      .pipe(
        finalize(() => {
          if (!this.destroyed) this.trackPending(signatureId, false);
        })
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.successSummary,
            detail: ORG_CLA_INVALIDATE_RECEIPT_COPY.successDetail(this.contributorLabel(row)),
          });
          if (removeApprovalEntries.length > 0) this.removeApprovalEntries(orgUid, claSignatureId, removeApprovalEntries);
          if (this.destroyed) return;
          if (orgUid !== this.orgUid() || claSignatureId !== this.signatureId()) return;
          if (this.pagesLoaded > 1) {
            const generation = this.fetchGeneration() + 1;
            this.fetchGeneration.set(generation);
            this.loadingMore.set(true);
            const search = (this.searchTerm() ?? '').trim();
            this.markInvalidatedInPlace(signatureId);
            this.refreshLoadedSpan(orgUid, claSignatureId, search, this.pagesLoaded, generation);
            return;
          }
          this.reloadTrigger.update((value) => value + 1);
        },
        error: (error: unknown) => {
          this.messageService.add({
            severity: 'error',
            summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.failureSummary,
            detail: this.invalidateFailureDetail(error),
          });
        },
      });
  }

  private markInvalidatedInPlace(signatureId: string): void {
    const list = this.page() ?? this.listSignal();
    if (!list) return;
    this.page.set({
      ...list,
      list: list.list.map((ack) =>
        ack.signatureId === signatureId
          ? {
              ...ack,
              approved: false,
              removedFromApprovalList: false,
              removedCriteria: undefined,
              // Drop any approval-list-removal stamps a Not Authorized row carried, so they are not
              // shown as this invalidation's date/reason. The producer's refresh supplies the real ones.
              invalidatedAt: undefined,
              invalidatedBy: undefined,
              invalidationReason: undefined,
            }
          : ack
      ),
    });
  }

  private refreshLoadedSpan(orgUid: string, claSignatureId: string, search: string, pages: number, generation: number): void {
    let remaining = pages;
    this.claService
      .getContributorAcknowledgments(orgUid, claSignatureId, { search })
      .pipe(
        expand((list) => {
          remaining -= 1;
          if (remaining <= 0 || !list.nextKey || this.destroyed || this.fetchGeneration() !== generation) return EMPTY;
          return this.claService.getContributorAcknowledgments(orgUid, claSignatureId, { search, nextKey: list.nextKey });
        }),
        reduce((acc, list) => this.mergeAcknowledgmentPage(acc, list), null as OrgClaContributorAcknowledgmentList | null),
        catchError(() => {
          if (!this.destroyed && this.fetchGeneration() === generation && orgUid === this.orgUid() && claSignatureId === this.signatureId()) {
            this.messageService.add({
              severity: 'warn',
              summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.successSummary,
              detail: 'The acknowledgment was invalidated, but the list could not be refreshed.',
            });
          }
          return of(null);
        }),
        finalize(() => {
          if (!this.destroyed && this.fetchGeneration() === generation) this.loadingMore.set(false);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((merged) => {
        if (!merged || this.destroyed || this.fetchGeneration() !== generation) return;
        if (orgUid !== this.orgUid() || claSignatureId !== this.signatureId()) return;
        this.pagesLoaded = pages;
        this.page.set(merged);
      });
  }

  private mergeAcknowledgmentPage(
    acc: OrgClaContributorAcknowledgmentList | null,
    list: OrgClaContributorAcknowledgmentList
  ): OrgClaContributorAcknowledgmentList {
    if (!acc) return list;
    return {
      ...list,
      signatureId: acc.signatureId,
      list: [...acc.list, ...list.list],
      resultCount: acc.list.length + list.list.length,
      totalCount: list.totalCount,
      canEdit: list.canEdit,
      nextKey: list.nextKey,
    };
  }

  /**
   * Impersonation is named on its own. Every other refusal goes through `serverAuthoredMessage`,
   * which keeps a sentence the BFF wrote and drops status-derived 5xx copy such as
   * "Internal server error".
   */
  private invalidateFailureDetail(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 403 && error.error?.code === 'IMPERSONATION_READ_ONLY') {
      return 'This change is not available while impersonating a user.';
    }
    return serverAuthoredMessage(error, ORG_CLA_INVALIDATE_RECEIPT_COPY.failureDetail);
  }

  /**
   * Who the confirmation, the toast, and the button name.
   *
   * Identity first, because that is the column the manager matched the row on. A row that has
   * only a name would otherwise be "—" in all three places.
   */
  private contributorLabel(row: OrgClaAcknowledgmentRow): string {
    return this.labelFor(row.identity.lfLogin ?? row.identity.display, row.name);
  }

  private labelFor(identity: string, name: string): string {
    const identityLabel = identity.trim();
    const nameLabel = name.trim();
    if (identityLabel && identityLabel !== ORG_CLA_ACKNOWLEDGMENTS_EM_DASH) return identityLabel;
    if (nameLabel && nameLabel !== ORG_CLA_ACKNOWLEDGMENTS_EM_DASH) return nameLabel;
    return 'this contributor';
  }

  private trackPending(signatureId: string, pending: boolean): void {
    const next = new Set(this.pendingInvalidateIds());
    if (pending) next.add(signatureId);
    else next.delete(signatureId);
    this.pendingInvalidateIds.set(next);
  }

  private toRow(ack: OrgClaContributorAcknowledgment, pending: ReadonlySet<string>): OrgClaAcknowledgmentRow {
    const notAuthorized = ack.removedFromApprovalList === true;
    const invalidated = !notAuthorized && this.isInvalidated(ack);
    const signatureId = ack.signatureId?.trim() ?? '';
    const identity = this.resolveIdentity(ack);
    const name = ack.name?.trim() || ORG_CLA_ACKNOWLEDGMENTS_EM_DASH;
    return {
      ack,
      name,
      avatarIdentity: ack.email ?? ack.lfLogin ?? ack.githubUsername ?? ack.gitlabUsername ?? null,
      identity,
      signedOnLabel: ack.signedOn ? formatClaSignedOnInstant(ack.signedOn) : ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
      notAuthorized,
      notAuthorizedTooltip: notAuthorized ? ORG_CLA_ACKNOWLEDGMENT_NOT_AUTHORIZED_COPY.tooltip(ack.removedCriteria) : '',
      invalidated,
      invalidatedOnLabel: invalidated ? this.toInvalidatedOnLabel(ack) : '',
      invalidatedTooltip: invalidated ? this.formatInvalidatedTooltip(ack) : '',
      invalidatable: signatureId.length > 0,
      invalidatePending: signatureId.length > 0 && pending.has(signatureId),
      invalidateAriaLabel: ORG_CLA_INVALIDATE_ACTION_COPY.ariaLabel(this.labelFor(identity.lfLogin ?? identity.display, name)),
    };
  }

  /**
   * Chooses the ID display for the LF Login / GitHub or GitLab ID column: `LF Login/GitHub` when
   * both are present, else LF Login → GitHub username → GitLab username → email → em-dash.
   * GitHub / GitLab logins are display only and never used as stable identifiers.
   */
  private resolveIdentity(ack: OrgClaContributorAcknowledgment): OrgClaAcknowledgmentRow['identity'] {
    if (ack.lfLogin && !ack.githubUsername) return { lfLogin: null, display: ack.lfLogin, href: null, ariaLabel: `LF Login ${ack.lfLogin}` };
    if (ack.githubUsername) {
      return {
        lfLogin: ack.lfLogin ?? null,
        display: `@${ack.githubUsername}`,
        href: `https://github.com/${encodeURIComponent(ack.githubUsername)}`,
        ariaLabel: `GitHub username @${ack.githubUsername}, opens on github.com`,
      };
    }
    if (ack.gitlabUsername) {
      return {
        lfLogin: null,
        display: `@${ack.gitlabUsername}`,
        href: `https://gitlab.com/${encodeURIComponent(ack.gitlabUsername)}`,
        ariaLabel: `GitLab username @${ack.gitlabUsername}, opens on gitlab.com`,
      };
    }
    if (ack.email) return { lfLogin: null, display: ack.email, href: `mailto:${ack.email}`, ariaLabel: `Email ${ack.email}` };
    return { lfLogin: null, display: ORG_CLA_ACKNOWLEDGMENTS_EM_DASH, href: null, ariaLabel: 'No login recorded' };
  }

  /**
   * A row is Invalidated when the producer explicitly says so, or when any of the invalidation
   * stamps are populated. Legacy rows can carry the stamps with `approved: true`, and the stamps
   * are authoritative for the visible state.
   */
  private isInvalidated(ack: OrgClaContributorAcknowledgment): boolean {
    return ack.approved === false || !!ack.invalidatedAt || !!ack.invalidatedBy || !!ack.invalidationReason;
  }

  private formatInvalidatedTooltip(ack: OrgClaContributorAcknowledgment): string {
    const parts: string[] = [];
    if (ack.invalidatedBy) parts.push(`Invalidated by ${ack.invalidatedBy}`);
    if (ack.invalidationReason) parts.push(`Reason: ${ack.invalidationReason}`);
    return parts.join(' · ');
  }

  /** The invalidation date, or '' when absent or unparseable, so the template never renders "on —". */
  private toInvalidatedOnLabel(ack: OrgClaContributorAcknowledgment): string {
    if (!ack.invalidatedAt) return '';
    const label = formatClaSignedOnInstant(ack.invalidatedAt);
    return label === '—' ? '' : label;
  }
}
