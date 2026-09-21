// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS,
  ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY,
  ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
  ORG_CLA_ACKNOWLEDGMENTS_HEADING,
  ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS,
  ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_COPY,
  ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_RECEIPT,
} from '@lfx-one/shared/constants';
import type {
  OrgClaContributorAcknowledgment,
  OrgClaContributorAcknowledgmentList,
  OrgClaGroup,
  OrgClaInvalidateAcknowledgmentInput,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, finalize, of, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { formatClaSignedOnInstant } from '@lfx-one/shared/utils';

import { OrgEasyclaInvalidateAcknowledgmentDialogComponent } from './org-easycla-invalidate-acknowledgment-dialog.component';

/** One rendered acknowledgment row, with the identity display resolved from the fallback chain. */
interface AcknowledgmentRow {
  ack: OrgClaContributorAcknowledgment;
  identity: {
    display: string;
    href: string | null;
    ariaLabel: string;
  };
  cclaVersion: string;
  signedOnLabel: string;
  invalidated: boolean;
  invalidatedTooltip: string;
}

const LOADING_ROWS = [1, 2, 3, 4] as const;

/**
 * The Contributor Acknowledgments tab of the CLA Group detail page (#1986).
 *
 * Lists the employee acknowledgments (ECLA signatures) the producer holds under this CCLA. The
 * identity column falls back through LF Login → GitHub username → GitLab username → email →
 * DocuSign name → em-dash, so a row is never dropped for a missing LF Login (FR-001/002). The
 * CCLA version column reads the row's `signature_version` verbatim (FR-003).
 *
 * Two visible states only: Acknowledged and Invalidated. The prototype's third amber state is
 * deliberately out of scope and has no scaffolding.
 *
 * A per-row Invalidate control opens a confirmation dialog; on accept the tab refetches the
 * current page rather than optimistically removing the row, because the producer stamps
 * `invalidatedAt` / `invalidatedBy` on the signature — a refetch is what renders the row in the
 * Invalidated state.
 */
@Component({
  selector: 'lfx-org-easycla-contributor-acknowledgments',
  imports: [ButtonComponent, EmptyStateComponent, InputTextComponent, ReactiveFormsModule, SkeletonModule, TagComponent],
  providers: [DialogService],
  templateUrl: './org-easycla-contributor-acknowledgments.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaContributorAcknowledgmentsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  private invalidateDialog: DynamicDialogRef | null = null;

  public readonly claGroup = input.required<OrgClaGroup>();

  protected readonly heading = ORG_CLA_ACKNOWLEDGMENTS_HEADING;
  protected readonly emptyCopy = ORG_CLA_ACKNOWLEDGMENTS_EMPTY_COPY;
  protected readonly columnHeaders = ORG_CLA_ACKNOWLEDGMENTS_COLUMN_HEADERS;
  protected readonly stateLabels = ORG_CLA_ACKNOWLEDGMENT_STATE_LABELS;
  protected readonly loadingRows = LOADING_ROWS;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly page = signal<OrgClaContributorAcknowledgmentList | null>(null);
  private readonly errorMessage = signal<string | null>(null);
  private readonly pendingInvalidateIds = signal<Set<string>>(new Set());
  private readonly loadingMore = signal(false);
  private readonly reloadTrigger = signal(0);

  private readonly signatureId = computed(() => this.claGroup().id);
  private readonly orgUid = computed(() => {
    // The organization on the account context: `requireOrgLensAccess` server-side proves the
    // caller may act on it, and the URL path segment mirrors it.
    const org = this.accountContext.selectedAccount();
    return org?.uid ?? '';
  });

  /**
   * One fetch cycle per (org, signatureId, reloadTrigger) triple.
   *
   * `distinctUntilChanged` on the tuple key drops a second reload trigger while the first request
   * is still in flight — matching the sibling approval-list pattern. `takeUntilDestroyed` is fine
   * here because the read is idempotent: cancelling on tab-switch loses only a page display, not
   * a producer-side write.
   */
  private readonly listSignal = toSignal(
    toObservable(computed(() => `${this.orgUid()}|${this.signatureId()}|${this.reloadTrigger()}`)).pipe(
      distinctUntilChanged(),
      switchMap((key) => {
        this.errorMessage.set(null);
        const [orgUid, signatureId] = key.split('|');
        if (!orgUid || !signatureId) return of(null as OrgClaContributorAcknowledgmentList | null);
        this.loading.set(true);
        return this.claService.getContributorAcknowledgments(orgUid, signatureId, {}).pipe(
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

  protected readonly loading = signal(true);
  protected readonly loadedList = computed(() => this.listSignal() ?? this.page());

  private readonly searchTerm = toSignal(this.filterForm.controls.search.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef)), {
    initialValue: '',
  });

  protected readonly rows = computed<AcknowledgmentRow[]>(() => {
    const list = this.loadedList();
    if (!list) return [];
    const search = (this.searchTerm() ?? '').trim().toLowerCase();
    const rendered = list.list.map((ack) => this.toRow(ack));
    if (!search) return rendered;
    return rendered.filter((row) => this.rowMatchesSearch(row, search));
  });

  protected readonly canEdit = computed(() => this.loadedList()?.canEdit === true);
  protected readonly hasNextPage = computed(() => !!this.loadedList()?.nextKey);
  protected readonly totalCount = computed(() => this.loadedList()?.totalCount ?? 0);
  protected readonly resultCount = computed(() => this.loadedList()?.list.length ?? 0);
  protected readonly showEmptyState = computed(() => !this.loading() && !this.errorMessage() && (this.loadedList()?.list.length ?? 0) === 0);
  protected readonly showErrorState = computed(() => !!this.errorMessage());
  protected readonly loadingMoreSignal = this.loadingMore.asReadonly();

  constructor() {
    // Dispose the invalidate dialog on destroy; the dialog is attached to `document.body` and
    // would otherwise outlive the panel if the tab is switched while the dialog is open.
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
    this.claService
      .getContributorAcknowledgments(this.orgUid(), this.signatureId(), { nextKey: list.nextKey })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loadingMore.set(false))
      )
      .subscribe({
        next: (next) => {
          const merged: OrgClaContributorAcknowledgmentList = {
            ...next,
            signatureId: list.signatureId,
            list: [...list.list, ...next.list],
            canEdit: list.canEdit || next.canEdit,
            resultCount: list.list.length + next.list.length,
            totalCount: next.totalCount ?? list.totalCount,
            nextKey: next.nextKey,
          };
          this.page.set(merged);
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Load more failed',
            detail: "We couldn't fetch the next page of acknowledgments. Try again in a moment.",
          });
        },
      });
  }

  /**
   * Whether an invalidate is in flight for the row's per-ack signature id.
   *
   * Used to disable the Invalidate control after activation, so a fast double-click cannot send a
   * second request against the same acknowledgment.
   */
  protected isInvalidatePending(signatureId: string): boolean {
    return this.pendingInvalidateIds().has(signatureId);
  }

  /**
   * Opens the invalidate confirmation. On accept, calls the producer and refetches the page.
   *
   * `refetch` after success rather than optimistic remove — the producer stamps `invalidatedAt`
   * and `invalidatedBy` on the signature, and refetching is what shows the row in the Invalidated
   * state with those stamps. Mid-flight the row's Invalidate control is hidden.
   */
  protected onInvalidate(row: AcknowledgmentRow): void {
    if (!this.canEdit() || row.invalidated) return;
    if (this.isInvalidatePending(row.ack.signatureId)) return;

    // Close any previous dialog before opening a new one, so a fast double-click on two different
    // rows leaves only the second dialog open — the first would otherwise capture keyboard focus.
    this.invalidateDialog?.close();
    const dialogRef = this.dialogService.open(OrgEasyclaInvalidateAcknowledgmentDialogComponent, {
      header: ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_COPY.title,
      modal: true,
      dismissableMask: true,
      closable: true,
      width: 'min(32rem, 100%)',
      data: {
        contributor: row.identity.display,
        claGroup: this.claGroup().claGroupName,
      },
    });

    // `open` is typed as nullable — it declines to open under SSR, where there is no document to
    // attach the dialog to. The row's Invalidate control is browser-side, so this only happens
    // during hydration; there is nothing to subscribe to in that case.
    if (!dialogRef) return;
    this.invalidateDialog = dialogRef;
    dialogRef.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((input: OrgClaInvalidateAcknowledgmentInput | null) => {
      if (this.invalidateDialog === dialogRef) this.invalidateDialog = null;
      if (!input) return;
      this.sendInvalidate(row, input);
    });
  }

  private sendInvalidate(row: AcknowledgmentRow, input: OrgClaInvalidateAcknowledgmentInput): void {
    this.trackPending(row.ack.signatureId, true);
    this.claService
      .invalidateAcknowledgment(this.orgUid(), this.signatureId(), row.ack.signatureId, input)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.trackPending(row.ack.signatureId, false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_RECEIPT.summary,
            detail: ORG_CLA_INVALIDATE_ACKNOWLEDGMENT_RECEIPT.detail(row.identity.display),
          });
          // Bump the reload trigger; the toSignal above refetches on distinctUntilChanged.
          this.reloadTrigger.update((n) => n + 1);
        },
        error: (error: unknown) => {
          const message =
            error instanceof HttpErrorResponse && typeof error.error?.message === 'string' && error.error.message.trim().length > 0
              ? error.error.message
              : "We couldn't invalidate this acknowledgment. Try again in a moment.";
          this.messageService.add({
            severity: 'error',
            summary: 'Invalidate failed',
            detail: message,
          });
        },
      });
  }

  private trackPending(signatureId: string, pending: boolean): void {
    const set = new Set(this.pendingInvalidateIds());
    if (pending) set.add(signatureId);
    else set.delete(signatureId);
    this.pendingInvalidateIds.set(set);
  }

  private toRow(ack: OrgClaContributorAcknowledgment): AcknowledgmentRow {
    const identity = this.resolveIdentity(ack);
    const invalidated = this.isInvalidated(ack);
    return {
      ack,
      identity,
      cclaVersion: this.formatVersion(ack.cclaVersion),
      signedOnLabel: ack.signedOn ? formatClaSignedOnInstant(ack.signedOn) : ORG_CLA_ACKNOWLEDGMENTS_EM_DASH,
      invalidated,
      invalidatedTooltip: invalidated ? this.formatInvalidatedTooltip(ack) : '',
    };
  }

  /**
   * Chooses the identity display, in order: LF Login → GitHub username → GitLab username →
   * email → DocuSign name → em-dash. GitHub/GitLab logins are display only and never used as a
   * stable identifier.
   */
  private resolveIdentity(ack: OrgClaContributorAcknowledgment): AcknowledgmentRow['identity'] {
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
    if (ack.name) return { display: ack.name, href: null, ariaLabel: ack.name };
    return { display: ORG_CLA_ACKNOWLEDGMENTS_EM_DASH, href: null, ariaLabel: 'Unknown contributor' };
  }

  /**
   * A row is Invalidated when the producer explicitly says so, or when any of the invalidation
   * stamps are populated. Legacy rows can carry the stamps with `approved: true`, and the stamps
   * are authoritative for the visible state.
   */
  private isInvalidated(ack: OrgClaContributorAcknowledgment): boolean {
    return ack.approved === false || !!ack.invalidatedAt || !!ack.invalidatedBy || !!ack.invalidationReason;
  }

  private formatVersion(raw: string): string {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) return ORG_CLA_ACKNOWLEDGMENTS_EM_DASH;
    return trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed : `v${trimmed}`;
  }

  private formatInvalidatedTooltip(ack: OrgClaContributorAcknowledgment): string {
    const parts: string[] = [];
    if (ack.invalidatedAt) parts.push(`Invalidated ${formatClaSignedOnInstant(ack.invalidatedAt)}`);
    if (ack.invalidatedBy) parts.push(`by ${ack.invalidatedBy}`);
    if (ack.invalidationReason) parts.push(`Reason: ${ack.invalidationReason}`);
    return parts.join(' · ');
  }

  private rowMatchesSearch(row: AcknowledgmentRow, search: string): boolean {
    const haystack = [row.identity.display, row.ack.lfLogin, row.ack.githubUsername, row.ack.gitlabUsername, row.ack.email, row.ack.name, row.cclaVersion]
      .filter((value): value is string => !!value)
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  }
}
