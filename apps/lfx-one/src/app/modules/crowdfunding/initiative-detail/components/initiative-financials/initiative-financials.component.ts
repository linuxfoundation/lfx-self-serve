// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { CROWDFUNDING_DONOR_AVATAR_PALETTE, DEFAULT_CROWDFUNDING_PAGE_SIZE, EMPTY_TRANSACTION_STATE } from '@lfx-one/shared/constants';
import { formatCurrency } from '@lfx-one/shared/utils';
import { CrowdfundingTransaction, CrowdfundingTransactionList, InitiativeDetail } from '@lfx-one/shared/interfaces';
import { concat, concatMap, finalize, of, scan, Subject, switchMap } from 'rxjs';
import { CrowdfundingService } from '@app/shared/services/crowdfunding.service';

@Component({
  selector: 'lfx-initiative-financials',
  imports: [AvatarComponent],
  templateUrl: './initiative-financials.component.html',
  styleUrl: './initiative-financials.component.scss',
})
export class InitiativeFinancialsComponent {
  // Dependencies
  private readonly crowdfundingService = inject(CrowdfundingService);

  // Inputs
  public readonly initiative = input.required<InitiativeDetail>();

  // State
  private readonly nextDonationsPage$ = new Subject<void>();
  private readonly nextExpensesPage$ = new Subject<void>();

  protected readonly donationsLoading = signal(false);
  protected readonly expensesLoading = signal(false);

  // Derived state (financial summary)
  protected readonly formattedTotalReceived = computed(() => formatCurrency((this.initiative().financialSummary?.totalReceivedCents ?? 0) / 100));
  protected readonly formattedTotalExpenses = computed(() => formatCurrency((this.initiative().financialSummary?.totalExpensesCents ?? 0) / 100));
  protected readonly formattedBalance = computed(() => formatCurrency((this.initiative().financialSummary?.balanceCents ?? 0) / 100));

  // Derived state (donations — paginated via transactions endpoint)
  protected readonly donationsState = this.initDonationsState();
  protected readonly donationsWithMeta = this.initDonationsWithMeta();
  protected readonly hasMoreDonations = computed(() => this.donationsState().items.length < this.donationsState().totalCount);

  // Derived state (expenses — paginated via transactions endpoint)
  protected readonly expensesState = this.initExpensesState();
  protected readonly expensesWithMeta = this.initExpensesWithMeta();
  protected readonly hasMoreExpenses = computed(() => this.expensesState().items.length < this.expensesState().totalCount);

  protected loadMoreDonations(): void {
    this.donationsLoading.set(true);
    this.nextDonationsPage$.next();
  }

  protected loadMoreExpenses(): void {
    this.expensesLoading.set(true);
    this.nextExpensesPage$.next();
  }

  private initDonationsState(): Signal<{ items: CrowdfundingTransaction[]; totalCount: number }> {
    return toSignal(
      toObservable(this.initiative).pipe(
        switchMap((initiative) =>
          concat(of(0), this.nextDonationsPage$.pipe(scan((offset) => offset + DEFAULT_CROWDFUNDING_PAGE_SIZE, 0))).pipe(
            concatMap((from) =>
              this.crowdfundingService
                .getInitiativeTransactions(initiative.slug, {
                  type: 'donations',
                  size: DEFAULT_CROWDFUNDING_PAGE_SIZE,
                  from,
                })
                .pipe(finalize(() => this.donationsLoading.set(false)))
            ),
            scan(
              (acc, result: CrowdfundingTransactionList, index) => ({
                items: index === 0 ? result.data : [...acc.items, ...result.data],
                totalCount: result.totalCount,
              }),
              EMPTY_TRANSACTION_STATE
            )
          )
        )
      ),
      { initialValue: EMPTY_TRANSACTION_STATE }
    );
  }

  private initDonationsWithMeta(): Signal<(CrowdfundingTransaction & { formattedAmount: string; avatarClass: string })[]> {
    return computed(() =>
      this.donationsState().items.map((t) => ({
        ...t,
        formattedAmount: formatCurrency(t.amountCents / 100),
        avatarClass: this.donorAvatarClass(t.donorName ?? ''),
      }))
    );
  }

  private initExpensesState(): Signal<{ items: CrowdfundingTransaction[]; totalCount: number }> {
    return toSignal(
      toObservable(this.initiative).pipe(
        switchMap((initiative) =>
          concat(of(0), this.nextExpensesPage$.pipe(scan((offset) => offset + DEFAULT_CROWDFUNDING_PAGE_SIZE, 0))).pipe(
            concatMap((from) =>
              this.crowdfundingService
                .getInitiativeTransactions(initiative.slug, {
                  type: 'expenses',
                  size: DEFAULT_CROWDFUNDING_PAGE_SIZE,
                  from,
                })
                .pipe(finalize(() => this.expensesLoading.set(false)))
            ),
            scan(
              (acc, result: CrowdfundingTransactionList, index) => ({
                items: index === 0 ? result.data : [...acc.items, ...result.data],
                totalCount: result.totalCount,
              }),
              EMPTY_TRANSACTION_STATE
            )
          )
        )
      ),
      { initialValue: EMPTY_TRANSACTION_STATE }
    );
  }

  private initExpensesWithMeta(): Signal<(CrowdfundingTransaction & { formattedAmount: string })[]> {
    return computed(() =>
      this.expensesState().items.map((t) => ({
        ...t,
        formattedAmount: formatCurrency(t.amountCents / 100),
      }))
    );
  }

  private donorAvatarClass(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
    }
    return CROWDFUNDING_DONOR_AVATAR_PALETTE[Math.abs(hash) % CROWDFUNDING_DONOR_AVATAR_PALETTE.length];
  }

}
