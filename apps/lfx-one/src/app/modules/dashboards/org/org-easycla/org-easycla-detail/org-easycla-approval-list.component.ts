// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ORG_CLA_APPROVAL_HEADING, ORG_CLA_APPROVAL_RECEIPT } from '@lfx-one/shared/constants';
import type { OrgClaApprovalEntry, OrgClaApprovalList, OrgClaApprovalListUpdate, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { formatClaSignedOnInstant, orgClaApprovalCriteriaLabel, orgClaApprovalEntryMatches } from '@lfx-one/shared/utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, finalize, of, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensClaService } from '@services/org-lens-cla.service';

import { OrgEasyclaApprovalEntriesDialogComponent } from './org-easycla-approval-entries-dialog.component';

/** One table row: the entry itself, plus the two labels resolved from it. */
interface ApprovalRow {
  entry: OrgClaApprovalEntry;
  criteriaLabel: string;
  addedOnLabel: string;
}

/** Fixed skeleton rows, held as a constant so the loop does not allocate on every pass. */
const LOADING_ROWS = [1, 2, 3];

/**
 * The Approval List tab of the CLA Group detail page (#1985).
 *
 * The list is the set of *rules* granting coverage under this CCLA — a domain, an address, a
 * GitHub org, a username — not the contributors covered by them. The heading it renders under
 * says "Contributors", because that is what the console being replaced calls it; the count and
 * the copy here are careful not to repeat the confusion.
 *
 * Every removal invalidates the acknowledgements that matched the removed rule, synchronously and
 * without reporting how many. That is why both destructive paths — delete, and the removal half
 * of an edit — state the consequence before the change rather than after it.
 */
@Component({
  selector: 'lfx-org-easycla-approval-list',
  imports: [ButtonComponent, ConfirmDialogModule, EmptyStateComponent, InputTextComponent, ReactiveFormsModule, SkeletonModule],
  providers: [DialogService],
  templateUrl: './org-easycla-approval-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaApprovalListComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly claService = inject(OrgLensClaService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly claGroup = input.required<OrgClaGroup>();

  /**
   * The list's size after a write.
   *
   * The tab badge is drawn from the CLA Group row's `approvalCriteriaCount`, which came from the
   * list fetch and does not move when this tab writes. Without this the badge would keep
   * reporting the count from page load while the table below it showed a different number.
   */
  public readonly countChanged = output<number>();

  protected readonly heading = ORG_CLA_APPROVAL_HEADING;
  protected readonly loadingRows = LOADING_ROWS;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly searchTerm = toSignal(this.filterForm.controls.search.valueChanges, { initialValue: '' });

  protected readonly saving = signal(false);
  protected readonly fetchError = signal(false);
  private readonly loadingState = signal(true);

  /** Replaces the fetched list after a write, so the table reflects the change without a refetch. */
  private readonly localList = signal<OrgClaApprovalList | null>(null);

  /**
   * Gated on `signed`, not on `status === 'signed'`.
   *
   * The design locks the tab on the status, but status is a single slot where sanctions outrank
   * signing — so a sanctioned organization that *has* signed would be shown "Sign this CLA
   * first", which is untrue, and would hide an approval list it holds. `signed` is the field that
   * answers whether the agreement exists; the sanctions message is the sanctioned banner's job.
   */
  protected readonly locked = computed(() => this.claGroup().signed !== true);

  private readonly fetched = this.initFetched();

  protected readonly list = computed(() => this.localList() ?? this.fetched());

  protected readonly loading = computed(() => !this.locked() && this.loadingState() && !this.fetchError());

  protected readonly canEdit = computed(() => this.list()?.canEdit === true);

  protected readonly entries = computed(() => this.list()?.entries ?? []);

  /**
   * The rows as the table renders them, with the criteria label and the date already resolved.
   *
   * Resolved here rather than by calling a method from the template: a template method runs on
   * every change-detection pass, per row, and `saving()` alone flips twice per write.
   */
  protected readonly visibleRows = computed<ApprovalRow[]>(() =>
    this.entries()
      .filter((entry) => orgClaApprovalEntryMatches(entry, this.searchTerm()))
      .map((entry) => ({
        entry,
        criteriaLabel: orgClaApprovalCriteriaLabel(entry.kind),
        // The producer reads this from the approvals table and falls back to the signature's
        // modified date, so it can be absent — and an absent date renders as unknown, not as today.
        addedOnLabel: entry.addedOn ? formatClaSignedOnInstant(entry.addedOn) : '—',
      }))
  );

  /**
   * Two empty states, not one.
   *
   * The design shows a single "No matching approval list entries" for both an empty list and a
   * search that matched nothing — which tells a CLA manager who has never added a rule to try a
   * different search term. Same call as the CLA Group list, which ships its two separately.
   */
  protected readonly showEmptyList = computed(() => !this.loading() && !this.fetchError() && this.entries().length === 0);

  protected readonly showSearchMiss = computed(() => !this.loading() && !this.fetchError() && this.entries().length > 0 && this.visibleRows().length === 0);

  protected openAdd(): void {
    this.openDialog({ mode: 'add', existing: this.entries() }, 'Add approval list entries', 'added');
  }

  protected openEdit(entry: OrgClaApprovalEntry): void {
    this.openDialog({ mode: 'edit', entry, existing: this.entries() }, 'Edit approval list entry', 'edited');
  }

  /**
   * Confirms a delete before it is sent.
   *
   * The copy names invalidation rather than the softer "will no longer be recognized" the design
   * uses, because invalidation is what the producer does: it flips the matching acknowledgements
   * to unapproved and emails the contributors. A CLA manager is entitled to know that before the
   * click, not from the receipt.
   */
  protected confirmDelete(entry: OrgClaApprovalEntry): void {
    this.confirmationService.confirm({
      header: 'Remove this approval list entry?',
      message:
        `Contributors covered by ${orgClaApprovalCriteriaLabel(entry.kind).toLowerCase()} "${entry.value}" will no longer be covered by this CLA, ` +
        `and any acknowledgements they hold for it will be invalidated. They will need to acknowledge it again if you add the entry back.`,
      acceptLabel: 'Remove entry',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => this.applyUpdate({ add: [], remove: [{ kind: entry.kind, value: entry.value }] }, 'removed'),
    });
  }

  private openDialog(
    data: { mode: 'add' | 'edit'; entry?: OrgClaApprovalEntry; existing: OrgClaApprovalEntry[] },
    header: string,
    receipt: 'added' | 'edited'
  ): void {
    const dialog = this.dialogService.open(OrgEasyclaApprovalEntriesDialogComponent, {
      header,
      modal: true,
      width: '36rem',
      data,
    });

    // `open` is typed as nullable — it declines to open under SSR, where there is no document to
    // attach the dialog to. Nothing to subscribe to in that case.
    if (!dialog) return;

    dialog.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((update: OrgClaApprovalListUpdate | undefined) => {
      // Cancel, and an edit that changed nothing, both close with nothing to send.
      if (!update) return;
      this.applyUpdate(update, receipt);
    });
  }

  private applyUpdate(update: OrgClaApprovalListUpdate, receipt: 'added' | 'edited' | 'removed'): void {
    const orgUid = this.accountContext.selectedAccount()?.uid;
    const signatureId = this.claGroup().id;
    if (!orgUid || this.saving() || !this.canEdit()) return;

    this.saving.set(true);
    this.claService
      .updateApprovalList(orgUid, signatureId, update)
      // `finalize` rather than clearing in each handler: cancellation runs neither, and would
      // otherwise leave the controls disabled for the rest of the page's life.
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (list) => {
          this.localList.set(list);
          this.countChanged.emit(list.entries.length);
          this.messageService.add({
            severity: 'success',
            summary: ORG_CLA_APPROVAL_RECEIPT[receipt].summary,
            detail: ORG_CLA_APPROVAL_RECEIPT[receipt].detail(update.add.length),
          });
        },
        error: (error: HttpErrorResponse) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Could not update the approval list',
            detail: this.errorDetail(error),
          });
        },
      });
  }

  /**
   * Turns a failed write into a sentence a CLA manager can act on.
   *
   * 403 is the one worth naming specifically, and it is not an edge case: the producer requires
   * the caller to be named on this agreement's own CLA-manager list and explicitly refuses an
   * organization-level admin scope in its place. So an org admin who can read this page gets a
   * 403 on every write here, and "something went wrong" would leave them retrying.
   *
   * A 400 is echoed, because on this path it is the producer's own validation sentence about a
   * value — the useful half of the answer. Anything else stays generic rather than surfacing
   * upstream prose that may name internals.
   */
  private errorDetail(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return 'Only a CLA manager named on this CLA can change its approval list.';
    }

    const message = typeof error.error?.message === 'string' ? error.error.message.trim() : '';
    if (error.status === 400 && message) return message;

    return 'Please try again.';
  }

  private initFetched() {
    // Keyed on the organization and the agreement together: unlike the list, this endpoint is
    // per-signature, so both have to re-drive it.
    const context$ = toObservable(
      computed(() => {
        const orgUid = this.accountContext.selectedAccount()?.uid;
        // Not fetched for an unsigned agreement — it has no approval list, and the tab shows the
        // locked state instead. Saves a request whose answer is already known to be empty.
        return orgUid && !this.locked() ? { orgUid, signatureId: this.claGroup().id } : null;
      })
    ).pipe(distinctUntilChanged((a, b) => a?.orgUid === b?.orgUid && a?.signatureId === b?.signatureId));

    return toSignal(
      context$.pipe(
        filter((context): context is { orgUid: string; signatureId: string } => !!context),
        tap(() => {
          this.loadingState.set(true);
          this.fetchError.set(false);
          // Dropped so a stale list cannot outlive the agreement it belongs to: `localList` wins
          // over the fetch, and keeping one across a signature change would show one agreement's
          // rules under another's name.
          this.localList.set(null);
        }),
        switchMap(({ orgUid, signatureId }) =>
          this.claService.getApprovalList(orgUid, signatureId).pipe(
            tap(() => this.loadingState.set(false)),
            catchError((error: HttpErrorResponse) => {
              console.error('Failed to load the CLA approval list:', error.status, error.message);
              this.fetchError.set(true);
              this.loadingState.set(false);
              return of(null);
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      ),
      { initialValue: null }
    );
  }
}
