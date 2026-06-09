// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { environment } from '@environments/environment';
import { MyDonationsResponse, DonationStats, PaymentMethod, RecurringDonation, RecurringDonationsResponse } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_DONATION_STATS, EMPTY_MY_DONATIONS } from '@lfx-one/shared/constants';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { DonationsStatsBarComponent } from './components/donations-stats-bar/donations-stats-bar.component';
import { DonationHistoryTableComponent } from './components/donation-history-table/donation-history-table.component';
import { PaymentMethodsComponent } from './components/payment-methods/payment-methods.component';
import { RecurringDonationsListComponent } from './components/recurring-donations-list/recurring-donations-list.component';
import { BehaviorSubject } from 'rxjs';
import { map, scan, switchMap } from 'rxjs/operators';

const EMPTY_RECURRING: RecurringDonation[] = [];

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

  // ─── Pagination Drivers ───────────────────────────────────────────────────
  private readonly recurringRefresh$ = new BehaviorSubject<void>(undefined);
  private readonly donationHistoryOffset = signal(0);

  // ─── Complex Signals ──────────────────────────────────────────────────────
  protected readonly stats: Signal<DonationStats> = this.initStats();
  protected readonly recurringDonations: Signal<RecurringDonation[]> = this.initRecurringDonations();
  private readonly paymentMethod: Signal<PaymentMethod | null> = this.initPaymentMethod();
  protected readonly paymentMethods = computed(() => (this.paymentMethod() ? [this.paymentMethod()!] : []));
  private readonly donationHistoryState: Signal<MyDonationsResponse> = this.initDonationHistory();
  protected readonly donationHistory = computed(() => this.donationHistoryState().data);
  protected readonly donationHistoryHasMore = computed(() => this.donationHistoryState().data.length < this.donationHistoryState().total);

  // ─── Protected Methods ────────────────────────────────────────────────────
  protected onLoadMoreDonations(): void {
    this.donationHistoryOffset.update((curr) => curr + DEFAULT_CROWDFUNDING_PAGE_SIZE);
  }

  protected onViewCancelled(): void {
    // TODO: navigate to cancelled donations view
  }

  protected onCancelDonation(donation: RecurringDonation): void {
    this.crowdfundingService.cancelSubscription(donation.id).subscribe({
      next: () => this.recurringRefresh$.next(),
      error: (err) => console.error('[MyDonationsComponent] cancelSubscription failed', err),
    });
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
    return toSignal(
      this.recurringRefresh$.pipe(
        switchMap(() => this.crowdfundingService.getMyRecurringDonations()),
        map((res: RecurringDonationsResponse) => res.data)
      ),
      { initialValue: EMPTY_RECURRING }
    );
  }

  private initDonationHistory(): Signal<MyDonationsResponse> {
    return toSignal(
      toObservable(this.donationHistoryOffset).pipe(
        switchMap((offset) => this.crowdfundingService.getMyDonations({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset })),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_MY_DONATIONS)
      ),
      { initialValue: EMPTY_MY_DONATIONS }
    );
  }
}
