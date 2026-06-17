// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { ButtonComponent } from '@components/button/button.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { MyDonationsResponse, DonationStats, PaymentMethod, RecurringDonation, RecurringDonationsResponse, StatCardItem } from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_DONATION_STATS, EMPTY_MY_DONATIONS } from '@lfx-one/shared/constants';
import { formatCurrency } from '@lfx-one/shared/utils';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
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
  imports: [
    ButtonComponent,
    StatCardGridComponent,
    RecurringDonationsListComponent,
    DonationHistoryTableComponent,
    PaymentMethodsComponent,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  templateUrl: './my-donations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyDonationsComponent {
  // ─── Private Injections ───────────────────────────────────────────────────
  private readonly router = inject(Router);
  private readonly crowdfundingService = inject(CrowdfundingService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // ─── Public Fields ────────────────────────────────────────────────────────
  protected readonly crowdfundingUrl = `${environment.urls.crowdfunding}initiatives`;

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
  protected readonly statCards: Signal<StatCardItem[]> = this.initStatCards();
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

  protected onViewRecurringDetail(donation: RecurringDonation): void {
    void this.router.navigate(['/crowdfunding/donations/recurring', donation.id]);
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

  private initStatCards(): Signal<StatCardItem[]> {
    return computed<StatCardItem[]>(() => {
      const stats = this.stats();
      const recurringValue = `${formatCurrency(stats.activeRecurringAmount)}/mo · ${stats.activeRecurringCount} active`;

      return [
        {
          value: `${formatCurrency(stats.totalDonated)} · all time`,
          label: 'Total Donated',
          icon: 'fa-light fa-hand-holding-heart',
          iconContainerClass: 'bg-blue-100 text-blue-600',
        },
        {
          value: stats.initiativesSupported,
          label: 'Initiatives Supported',
          icon: 'fa-light fa-seedling',
          iconContainerClass: 'bg-emerald-100 text-emerald-600',
        },
        { value: recurringValue, label: 'Active Recurring', icon: 'fa-light fa-arrows-rotate', iconContainerClass: 'bg-violet-100 text-violet-600' },
      ];
    });
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
