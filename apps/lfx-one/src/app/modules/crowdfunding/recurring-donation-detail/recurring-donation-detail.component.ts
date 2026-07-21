// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { concatMap, filter, map, scan, startWith, switchMap, tap } from 'rxjs/operators';
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

  // ─── Private Fields ───────────────────────────────────────────────────────
  private readonly emptyChargeHistoryState = { items: [] as CrowdfundingTransaction[], hasMore: false };

  // ─── Complex Signals ──────────────────────────────────────────────────────
  protected readonly donation: Signal<RecurringDonation | undefined> = this.initDonation();
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
      toObservable(this.donation).pipe(
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
