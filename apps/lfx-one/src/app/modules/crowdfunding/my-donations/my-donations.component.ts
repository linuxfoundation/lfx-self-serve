// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { environment } from '@environments/environment';
import { ButtonComponent } from '@components/button/button.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  DonationAnonymityTargetKind,
  DonationStats,
  MyDonation,
  MyDonationsResponse,
  PaymentMethod,
  RecurringDonation,
  RecurringDonationsResponse,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_DONATION_STATS, EMPTY_MY_DONATIONS, EMPTY_RECURRING_DONATION_LIST } from '@lfx-one/shared/constants';
import { formatCurrency } from '@lfx-one/shared/utils';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';
import { DonationHistoryTableComponent } from './components/donation-history-table/donation-history-table.component';
import { PaymentMethodsComponent } from './components/payment-methods/payment-methods.component';
import { RecurringDonationsListComponent } from './components/recurring-donations-list/recurring-donations-list.component';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { BehaviorSubject } from 'rxjs';
import { finalize, map, scan, switchMap, tap } from 'rxjs/operators';
import { PageHeaderComponent } from '@components/page-header/page-header.component';

@Component({
  selector: 'lfx-my-donations',
  imports: [
    ButtonComponent,
    StatCardGridComponent,
    RouteLoadingComponent,
    RecurringDonationsListComponent,
    DonationHistoryTableComponent,
    PaymentMethodsComponent,
    ConfirmDialogModule,
    PageHeaderComponent,
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
  protected readonly isLoading = signal(true);
  protected readonly loadingMore = signal(false);
  // Name-visibility settings saved this session, keyed `donation:<id>` / `subscription:<id>` (lfx-crowdfunding#466).
  // Applied over the fetched rows so one subscription change updates all its charges and survives Load more.
  private readonly anonymityOverrides = signal<Record<string, boolean>>({});
  private readonly anonymityPending = signal<ReadonlySet<string>>(new Set());

  // ─── Pagination Drivers ───────────────────────────────────────────────────
  private readonly recurringRefresh$ = new BehaviorSubject<void>(undefined);
  private readonly paymentMethodRefresh$ = new BehaviorSubject<void>(undefined);
  private readonly donationHistoryOffset = signal(0);

  // ─── Complex Signals ──────────────────────────────────────────────────────
  protected readonly stats: Signal<DonationStats> = this.initStats();
  protected readonly statCards: Signal<StatCardItem[]> = this.initStatCards();
  private readonly fetchedRecurringDonations: Signal<RecurringDonation[]> = this.initAllRecurringDonations();
  protected readonly recurringDonations: Signal<RecurringDonation[]> = this.initRecurringDonations();
  private readonly paymentMethod: Signal<PaymentMethod | null> = this.initPaymentMethod();
  protected readonly paymentMethods = computed(() => (this.paymentMethod() ? [this.paymentMethod()!] : []));
  private readonly donationHistoryState: Signal<MyDonationsResponse> = this.initDonationHistory();
  protected readonly donationHistory: Signal<MyDonation[]> = this.initDonationHistoryRows();
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

  /** Hides or shows the donor's name on a donation history row; a recurring row changes its whole subscription. */
  protected onToggleDonationAnonymity(donation: MyDonation): void {
    if (donation.subscriptionId) {
      this.updateAnonymity('subscription', donation.subscriptionId, !donation.anonymous);
    } else if (donation.donationId) {
      this.updateAnonymity('donation', donation.donationId, !donation.anonymous);
    }
  }

  protected onToggleRecurringAnonymity(donation: RecurringDonation): void {
    this.updateAnonymity('subscription', donation.id, !donation.anonymous);
  }

  // ─── Private Initializers ─────────────────────────────────────────────────
  private initRecurringDonations(): Signal<RecurringDonation[]> {
    return computed(() => {
      const overrides = this.anonymityOverrides();
      return this.fetchedRecurringDonations().map((d) => {
        const anonymous = overrides[`subscription:${d.id}`];
        return anonymous === undefined ? d : { ...d, anonymous };
      });
    });
  }

  private initDonationHistoryRows(): Signal<MyDonation[]> {
    return computed(() => {
      const overrides = this.anonymityOverrides();
      return this.donationHistoryState().data.map((d) => {
        const key = this.anonymityKeyFor(d);
        const anonymous = key ? overrides[key] : undefined;
        return anonymous === undefined ? d : { ...d, anonymous };
      });
    });
  }

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

  private initAllRecurringDonations(): Signal<RecurringDonation[]> {
    return toSignal(
      this.recurringRefresh$.pipe(
        switchMap(() => this.crowdfundingService.getMyRecurringDonations()),
        map((res: RecurringDonationsResponse) => res.data)
      ),
      { initialValue: EMPTY_RECURRING_DONATION_LIST }
    );
  }

  private initDonationHistory(): Signal<MyDonationsResponse> {
    return toSignal(
      toObservable(this.donationHistoryOffset).pipe(
        switchMap((offset) =>
          this.crowdfundingService.getMyDonations({ pageSize: DEFAULT_CROWDFUNDING_PAGE_SIZE, offset }).pipe(finalize(() => this.loadingMore.set(false)))
        ),
        scan((acc, curr) => (curr.offset === 0 ? curr : { ...curr, data: [...acc.data, ...curr.data] }), EMPTY_MY_DONATIONS),
        tap(() => this.isLoading.set(false))
      ),
      { initialValue: EMPTY_MY_DONATIONS }
    );
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────
  private anonymityKeyFor(donation: MyDonation): string | null {
    if (donation.subscriptionId) return `subscription:${donation.subscriptionId}`;
    if (donation.donationId) return `donation:${donation.donationId}`;
    return null;
  }

  private updateAnonymity(kind: DonationAnonymityTargetKind, id: string, anonymous: boolean): void {
    const key = `${kind}:${id}`;
    if (this.anonymityPending().has(key)) return;
    this.anonymityPending.update((pending) => new Set(pending).add(key));

    const request =
      kind === 'subscription'
        ? this.crowdfundingService.updateSubscriptionAnonymity(id, anonymous)
        : this.crowdfundingService.updateDonationAnonymity(id, anonymous);

    request
      .pipe(
        finalize(() =>
          this.anonymityPending.update((pending) => {
            const next = new Set(pending);
            next.delete(key);
            return next;
          })
        )
      )
      .subscribe({
        next: (result) => {
          this.anonymityOverrides.update((overrides) => ({ ...overrides, [key]: result.anonymous }));
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: this.anonymitySavedMessage(kind, result.anonymous) });
        },
        error: () =>
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update who can see your name on this donation. Please try again.',
          }),
      });
  }

  private anonymitySavedMessage(kind: DonationAnonymityTargetKind, anonymous: boolean): string {
    const target = kind === 'subscription' ? 'every charge of this recurring donation' : 'this donation';
    if (anonymous) return `Your name is now hidden on ${target}. It shows as Anonymous.`;
    return `Your name is now shown on ${target}.`;
  }
}
