// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { environment } from '@environments/environment';
import { MyDonation, DonationStats, PaymentMethod, RecurringDonation, RecurringDonationsResponse } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_DONATION_STATS } from '@lfx-one/shared/constants';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { DonationsStatsBarComponent } from './components/donations-stats-bar/donations-stats-bar.component';
import { DonationHistoryTableComponent } from './components/donation-history-table/donation-history-table.component';
import { PaymentMethodsComponent } from './components/payment-methods/payment-methods.component';
import { RecurringDonationsListComponent } from './components/recurring-donations-list/recurring-donations-list.component';
import { Subject } from 'rxjs';
import { concatMap, map, scan, startWith } from 'rxjs/operators';

const EMPTY_RECURRING: RecurringDonation[] = [];
const EMPTY_HISTORY_STATE = { items: [] as MyDonation[], hasMore: false };

@Component({
  selector: 'lfx-my-donations',
  imports: [DonationsStatsBarComponent, RecurringDonationsListComponent, DonationHistoryTableComponent, PaymentMethodsComponent],
  templateUrl: './my-donations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyDonationsComponent {
  // ─── Private Injections ───────────────────────────────────────────────────
  private readonly crowdfundingService = inject(CrowdfundingService);

  // ─── Public Fields ────────────────────────────────────────────────────────
  protected readonly crowdfundingUrl = environment.urls.crowdfunding;

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  // TODO: derive from API response once cancelled-recurring concept is implemented
  protected readonly cancelledCount = signal(0);

  // ─── Pagination Driver ────────────────────────────────────────────────────
  private readonly loadMore$ = new Subject<void>();

  // ─── Complex Signals ──────────────────────────────────────────────────────
  protected readonly stats: Signal<DonationStats> = this.initStats();
  protected readonly recurringDonations: Signal<RecurringDonation[]> = this.initRecurringDonations();
  private readonly paymentMethod: Signal<PaymentMethod | null> = this.initPaymentMethod();
  protected readonly paymentMethods = computed(() => (this.paymentMethod() ? [this.paymentMethod()!] : []));
  private readonly donationHistoryState: Signal<{ items: MyDonation[]; hasMore: boolean }> = this.initDonationHistory();
  protected readonly donationHistory = computed(() => this.donationHistoryState().items);
  protected readonly donationHistoryHasMore = computed(() => this.donationHistoryState().hasMore);

  // ─── Protected Methods ────────────────────────────────────────────────────
  protected onLoadMoreDonations(): void {
    this.loadMore$.next();
  }

  protected onViewCancelled(): void {
    // TODO: navigate to cancelled donations view
  }

  protected onChangeAmount(donation: RecurringDonation): void {
    // TODO: open change amount dialog for donation
    void donation;
  }

  protected onPauseDonation(donation: RecurringDonation): void {
    // TODO: call pause API for donation
    void donation;
  }

  protected onResumeDonation(donation: RecurringDonation): void {
    // TODO: call resume API for donation
    void donation;
  }

  protected onCancelDonation(donation: RecurringDonation): void {
    // TODO: call cancel API for donation
    void donation;
  }

  protected onRemoveCard(card: PaymentMethod): void {
    // TODO: call remove card API
    void card;
  }

  // ─── Private Initializers ─────────────────────────────────────────────────
  private initPaymentMethod(): Signal<PaymentMethod | null> {
    return toSignal(this.crowdfundingService.getMyPaymentMethod(), { initialValue: null });
  }

  private initStats(): Signal<DonationStats> {
    return toSignal(this.crowdfundingService.getMyDonationStats(), { initialValue: EMPTY_DONATION_STATS });
  }

  private initRecurringDonations(): Signal<RecurringDonation[]> {
    return toSignal(this.crowdfundingService.getMyRecurringDonations().pipe(map((res: RecurringDonationsResponse) => res.data)), {
      initialValue: EMPTY_RECURRING,
    });
  }

  private initDonationHistory(): Signal<{ items: MyDonation[]; hasMore: boolean }> {
    return toSignal(
      this.loadMore$.pipe(
        startWith(undefined as void),
        scan((page) => page + 1, -1),
        concatMap((page) =>
          this.crowdfundingService.getMyDonations({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset: page * DEFAULT_CROWDFUNDING_PAGE_SIZE })
        ),
        scan(
          (acc, res) => ({
            items: [...acc.items, ...res.data],
            hasMore: acc.items.length + res.data.length < res.total,
          }),
          EMPTY_HISTORY_STATE
        )
      ),
      { initialValue: EMPTY_HISTORY_STATE }
    );
  }
}
