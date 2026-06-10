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
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { BehaviorSubject } from 'rxjs';
import { map, scan, switchMap, tap } from 'rxjs/operators';

const EMPTY_RECURRING: RecurringDonation[] = [];

@Component({
  selector: 'lfx-my-donations',
  imports: [DonationsStatsBarComponent, RecurringDonationsListComponent, DonationHistoryTableComponent, PaymentMethodsComponent, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './my-donations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyDonationsComponent {
  // ─── Private Injections ───────────────────────────────────────────────────
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // ─── Public Fields ────────────────────────────────────────────────────────
  protected readonly crowdfundingUrl = environment.urls.crowdfunding;

  // ─── Simple WritableSignals ───────────────────────────────────────────────
  // TODO: derive from API response once cancelled-recurring concept is implemented
  protected readonly cancelledCount = signal(0);
  protected readonly loadingMore = signal(false);

  // ─── Pagination Drivers ───────────────────────────────────────────────────
  private readonly recurringRefresh$ = new BehaviorSubject<void>(undefined);
  private readonly paymentMethodRefresh$ = new BehaviorSubject<void>(undefined);
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
    if (this.loadingMore()) return;
    this.loadingMore.set(true);
    this.donationHistoryOffset.update((curr) => curr + DEFAULT_CROWDFUNDING_PAGE_SIZE);
  }

  protected onViewCancelled(): void {
    // TODO: navigate to cancelled donations view
  }

  protected onCancelDonation(donation: RecurringDonation): void {
    this.confirmationService.confirm({
      header: 'Cancel Recurring Donation',
      message: `Are you sure you want to cancel your recurring donation to ${donation.name}? This cannot be undone.`,
      acceptLabel: 'Cancel Donation',
      rejectLabel: 'Keep',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.crowdfundingService.cancelSubscription(donation.id).subscribe({
          next: () => this.recurringRefresh$.next(),
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

  protected onRemoveCard(card: PaymentMethod): void {
    this.confirmationService.confirm({
      header: 'Remove Payment Method',
      message: `Are you sure you want to remove your ${card.brand} card ending in ${card.lastFour}? This cannot be undone.`,
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.crowdfundingService.deletePaymentMethod().subscribe({
          next: () => this.paymentMethodRefresh$.next(),
          error: () =>
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to remove payment method. Please try again.',
            }),
        });
      },
    });
  }

  protected onCardAdded(): void {
    this.paymentMethodRefresh$.next();
  }

  // ─── Private Initializers ─────────────────────────────────────────────────
  private initPaymentMethod(): Signal<PaymentMethod | null> {
    return toSignal(this.paymentMethodRefresh$.pipe(switchMap(() => this.crowdfundingService.getMyPaymentMethod())), { initialValue: null });
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
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_MY_DONATIONS),
        tap(() => this.loadingMore.set(false))
      ),
      { initialValue: EMPTY_MY_DONATIONS }
    );
  }
}
