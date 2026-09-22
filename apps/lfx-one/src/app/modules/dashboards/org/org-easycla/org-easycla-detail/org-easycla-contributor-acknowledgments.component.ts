// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  CLA_GROUP_SEARCH_DEBOUNCE_MS,
  ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS,
  ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
  ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY,
  ORG_CLA_ACKNOWLEDGMENTS_HEADING,
  ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS,
  ORG_CLA_INVALIDATE_ACTION_COPY,
  ORG_CLA_INVALIDATE_DIALOG_COPY,
  ORG_CLA_INVALIDATE_RECEIPT_COPY,
} from '@lfx-one/shared/constants';
import type {
  OrgClaAcknowledgmentRow,
  OrgClaContributorAcknowledgment,
  OrgClaContributorAcknowledgmentList,
  OrgClaGroup,
  OrgClaInvalidateAcknowledgmentRequest,
} from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';

import { OrgEasyclaInvalidateAcknowledgmentDialogComponent } from './org-easycla-invalidate-acknowledgment-dialog.component';

const LOADING_ROWS = [1, 2, 3, 4] as const;

/**
 * The Contributor Acknowledgments tab of the CLA Group detail page (#1986, #2806).
 *
 * Lists the employee acknowledgments (ECLA signatures) the producer holds under this CCLA. Per
 * the M3 prototype the identity is split into two columns: Name (DocuSign name) and the
 * LF Login / GitHub or GitLab ID, so a row with any identifier is visible even without an
 * LF Login. Both columns fall through to an em-dash rather than dropping the row.
 *
 * Two visible states only: Acknowledged and Invalidated. The prototype's third amber state is
 * deliberately out of scope and has no scaffolding.
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
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, ReactiveFormsModule, SkeletonModule, TagComponent],
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

  protected readonly heading = ORG_CLA_ACKNOWLEDGMENTS_HEADING;
  protected readonly emptyCopy = ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY;
  protected readonly columnHeaders = ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS;
  protected readonly stateLabels = ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS;
  protected readonly emDash = ORG_CLA_ACKNOWLEDGMENTS_EM_DASH;
  protected readonly actionCopy = ORG_CLA_INVALIDATE_ACTION_COPY;
  protected readonly loadingRows = LOADING_ROWS;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly page = signal<OrgClaContributorAcknowledgmentList | null>(null);
  private readonly errorMessage = signal<string | null>(null);
  private readonly loadingMore = signal(false);
  private readonly fetchGeneration = signal(0);
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

  /** Server-decided from the CCLA's manager roster. Never inferred client-side. */
  protected readonly canEdit = computed(() => this.loadedList()?.canEdit === true);

  protected readonly hasNextPage = computed(() => !!this.loadedList()?.nextKey);
  protected readonly totalCount = computed(() => this.loadedList()?.totalCount ?? 0);
  protected readonly resultCount = computed(() => this.loadedList()?.list.length ?? 0);
  protected readonly showEmptyState = computed(
    () => !this.loading() && !this.errorMessage() && (this.searchTerm() ?? '').trim().length === 0 && (this.loadedList()?.list.length ?? 0) === 0
  );
  protected readonly showErrorState = computed(() => !!this.errorMessage());
  protected readonly loadingMoreSignal = this.loadingMore.asReadonly();

  constructor() {
    // The dialog attaches to `document.body`, so it would outlive this panel if the CLA manager
    // switched tabs with it open.
    this.destroyRef.onDestroy(() => {
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
    if (!this.canEdit() || row.invalidated || !row.invalidatable || row.invalidatePending) return;

    // Close any dialog already open, so a fast click on a second row leaves one modal rather than
    // two competing for keyboard focus.
    this.invalidateDialog?.close();
    const dialogRef = this.dialogService.open(OrgEasyclaInvalidateAcknowledgmentDialogComponent, {
      header: ORG_CLA_INVALIDATE_DIALOG_COPY.header,
      modal: true,
      dismissableMask: true,
      closable: true,
      width: 'min(32rem, 100%)',
      data: { contributor: row.identity.display },
    });

    // `open` is typed nullable because it declines under SSR, where there is no document to attach
    // to. The control that calls this is browser-side, so there is nothing to subscribe to then.
    if (!dialogRef) return;
    this.invalidateDialog = dialogRef;
    dialogRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((request: OrgClaInvalidateAcknowledgmentRequest | null | undefined) => {
      if (this.invalidateDialog === dialogRef) this.invalidateDialog = null;
      if (!request) return;
      this.sendInvalidate(row, request);
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
  private sendInvalidate(row: OrgClaAcknowledgmentRow, request: OrgClaInvalidateAcknowledgmentRequest): void {
    const signatureId = row.ack.signatureId;
    this.trackPending(signatureId, true);
    this.claService
      .invalidateAcknowledgment(this.orgUid(), this.signatureId(), signatureId, request)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.trackPending(signatureId, false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.successSummary,
            detail: ORG_CLA_INVALIDATE_RECEIPT_COPY.successDetail(row.identity.display),
          });
          this.reloadTrigger.update((value) => value + 1);
        },
        error: (error: unknown) => {
          // The BFF's own sentence is preferred: it is the producer's account of why this write
          // was refused, and the generic fallback would throw that away.
          const detail =
            error instanceof HttpErrorResponse && typeof error.error?.message === 'string' && error.error.message.trim().length > 0
              ? error.error.message
              : ORG_CLA_INVALIDATE_RECEIPT_COPY.failureDetail;
          this.messageService.add({ severity: 'error', summary: ORG_CLA_INVALIDATE_RECEIPT_COPY.failureSummary, detail });
        },
      });
  }

  private trackPending(signatureId: string, pending: boolean): void {
    const next = new Set(this.pendingInvalidateIds());
    if (pending) next.add(signatureId);
    else next.delete(signatureId);
    this.pendingInvalidateIds.set(next);
  }

  private toRow(ack: OrgClaContributorAcknowledgment, pending: ReadonlySet<string>): OrgClaAcknowledgmentRow {
    const invalidated = this.isInvalidated(ack);
    const signatureId = ack.signatureId?.trim() ?? '';
    return {
      ack,
      name: ack.name?.trim() || ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
      identity: this.resolveIdentity(ack),
      cclaVersion: ack.cclaVersion?.trim() || ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
      signedOnLabel: ack.signedOn ? formatClaSignedOnInstant(ack.signedOn) : ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
      invalidated,
      invalidatedTooltip: invalidated ? this.formatInvalidatedTooltip(ack) : '',
      invalidatable: signatureId.length > 0,
      invalidatePending: signatureId.length > 0 && pending.has(signatureId),
    };
  }

  /**
   * Chooses the ID display for the LF Login / GitHub or GitLab ID column, in order:
   * LF Login → GitHub username → GitLab username → email → em-dash. GitHub / GitLab logins are
   * display only and never used as stable identifiers.
   */
  private resolveIdentity(ack: OrgClaContributorAcknowledgment): OrgClaAcknowledgmentRow['identity'] {
    if (ack.lfLogin) return { display: ack.lfLogin, href: null, ariaLabel: `LF Login ${ack.lfLogin}` };
    if (ack.githubUsername) {
      return {
        display: `@${ack.githubUsername}`,
        href: `https://github.com/${encodeURIComponent(ack.githubUsername)}`,
        ariaLabel: `GitHub username @${ack.githubUsername}, opens on github.com`,
      };
    }
    if (ack.gitlabUsername) {
      return {
        display: `@${ack.gitlabUsername}`,
        href: `https://gitlab.com/${encodeURIComponent(ack.gitlabUsername)}`,
        ariaLabel: `GitLab username @${ack.gitlabUsername}, opens on gitlab.com`,
      };
    }
    if (ack.email) return { display: ack.email, href: `mailto:${ack.email}`, ariaLabel: `Email ${ack.email}` };
    return { display: ORG_CLA_ACKNOWLEDGMENTS_EM_DASH, href: null, ariaLabel: 'No login recorded' };
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
    if (ack.invalidatedAt) parts.push(`Invalidated ${formatClaSignedOnInstant(ack.invalidatedAt)}`);
    if (ack.invalidatedBy) parts.push(`by ${ack.invalidatedBy}`);
    if (ack.invalidationReason) parts.push(`Reason: ${ack.invalidationReason}`);
    return parts.join(' · ');
  }
}
