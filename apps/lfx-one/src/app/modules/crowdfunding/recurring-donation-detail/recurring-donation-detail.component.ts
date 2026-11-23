// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal, Signal, WritableSignal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { concatMap, filter, finalize, map, scan, startWith, switchMap, take, tap } from 'rxjs/operators';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

import { CrowdfundingTransaction, RecurringDonation } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE } from '@lfx-one/shared/constants';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { ButtonComponent } from '@components/button/button.component';
import { RecurringDonationInitiativeHeaderComponent } from './components/recurring-donation-initiative-header/recurring-donation-initiative-header.component';
import { RecurringDonationSubscriptionSummaryComponent } from './components/recurring-donation-subscription-summary/recurring-donation-subscription-summary.component';
import { RecurringDonationChargeHistoryComponent } from './components/recurring-donation-charge-history/recurring-donation-charge-history.component';

@Component({
  selector: 'lfx-recurring-donation-detail',
  imports: [
    RouterLink,
    ConfirmDialogModule,
    ButtonComponent,
    RecurringDonationInitiativeHeaderComponent,
    RecurringDonationSubscriptionSummaryComponent,
    RecurringDonationChargeHistoryComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './recurring-donation-detail.component.html',
  styleUrl: './recurring-donation-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringDonationDetailComponent {
  // ─── Private Injections ───────────────────────────────────────────────────
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // ─── Pagination Driver ────────────────────────────────────────────────────
  private readonly loadMore$ = new Subject<void>();

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  protected readonly isLoading = signal(true);
  protected readonly anonymitySaving = signal(false);

  // ─── Private Fields ───────────────────────────────────────────────────────
  private readonly emptyChargeHistoryState = { items: [] as CrowdfundingTransaction[], hasMore: false };

  // ─── Complex Signals ──────────────────────────────────────────────────────
  private readonly fetchedDonation: Signal<RecurringDonation | undefined> = this.initDonation();
  // Writable so a saved name-visibility change shows without refetching; resets whenever a new donation loads.
  protected readonly donation: WritableSignal<RecurringDonation | undefined> = linkedSignal(() => this.fetchedDonation());
  private readonly chargeHistoryState: Signal<{ items: CrowdfundingTransaction[]; hasMore: boolean }> = this.initChargeHistory();
  protected readonly chargeHistory = computed(() => this.chargeHistoryState().items);
  protected readonly chargeHistoryHasMore = computed(() => this.chargeHistoryState().hasMore);

  // ─── Protected Methods ────────────────────────────────────────────────────
  protected onCancelDonation(): void {
    const donation = this.donation();
    if (!donation) return;

    this.confirmationService.confirm({
      header: 'Cancel Recurring Donation',
      message: `Are you sure you want to cancel your recurring donation to ${donation.name}? This cannot be undone.`,
      acceptLabel: 'Cancel Donation',
      rejectLabel: 'Keep',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.crowdfundingService.cancelSubscription(donation.id).subscribe({
          next: () => void this.router.navigate(['/crowdfunding/donations']),
          error: () =>
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to cancel donation. Please try again.',
            }),
        });
      },
    });
  }

  /** Hides or shows the donor's name on every charge of this subscription (lfx-crowdfunding#466). */
  protected onToggleAnonymity(): void {
    const donation = this.donation();
    if (!donation || this.anonymitySaving()) return;

    this.anonymitySaving.set(true);
    this.crowdfundingService
      .updateSubscriptionAnonymity(donation.id, !donation.anonymous)
      .pipe(
        take(1),
        finalize(() => this.anonymitySaving.set(false))
      )
      .subscribe({
        next: (result) => {
          this.donation.update((current) => (current && current.id === donation.id ? { ...current, anonymous: result.anonymous } : current));
          this.messageService.add({
            severity: 'success',
            summary: 'Saved',
            detail: result.anonymous
              ? 'Your name is now hidden on every charge of this recurring donation. It shows as Anonymous.'
              : 'Your name is now shown on every charge of this recurring donation.',
          });
        },
        error: () =>
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update who can see your name on this donation. Please try again.',
          }),
      });
  }

  protected onLoadMore(): void {
    this.loadMore$.next();
  }

  // ─── Private Initializers ─────────────────────────────────────────────────
  private initDonation(): Signal<RecurringDonation | undefined> {
    return toSignal(
      this.route.paramMap.pipe(
        map((params) => params.get('id') ?? ''),
        switchMap((id) =>
          this.crowdfundingService.getRecurringDonationById(id).pipe(
            map((d) => d ?? undefined),
            tap(() => this.isLoading.set(false))
          )
        )
      ),
      { initialValue: undefined }
    );
  }

  private initChargeHistory(): Signal<{ items: CrowdfundingTransaction[]; hasMore: boolean }> {
    return toSignal(
      // Keyed on the fetched donation: a name-visibility toggle must not reset the loaded pages.
      toObservable(this.fetchedDonation).pipe(
        filter((d): d is RecurringDonation => d !== undefined),
        map((d) => d.initiativeSlug),
        switchMap((slug) =>
          this.loadMore$.pipe(
            startWith(undefined as void),
            scan((page) => page + 1, -1),
            concatMap((page) =>
              this.crowdfundingService.getMyInitiativeTransactions(slug, {
                type: 'donations',
                subscriptionOnly: true,
                size: DEFAULT_CROWDFUNDING_PAGE_SIZE,
                from: page * DEFAULT_CROWDFUNDING_PAGE_SIZE,
              })
            ),
            scan(
              (acc, res) => ({
                items: [...acc.items, ...res.data],
                hasMore: acc.items.length + res.data.length < res.totalCount,
              }),
              this.emptyChargeHistoryState
            )
          )
        )
      ),
      { initialValue: this.emptyChargeHistoryState }
    );
  }
}
