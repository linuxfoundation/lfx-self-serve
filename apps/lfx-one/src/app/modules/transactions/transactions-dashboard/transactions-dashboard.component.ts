// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  TRANSACTION_TYPE_BUNDLE,
  TRANSACTION_TYPE_CERTIFICATION,
  TRANSACTION_TYPE_EVENT,
  TRANSACTION_TYPE_INDIVIDUAL_SUPPORT,
  TRANSACTION_TYPE_SUBSCRIPTION,
  TRANSACTION_TYPE_TRAINING,
} from '@lfx-one/shared/constants';
import { FilterPillOption, Transaction } from '@lfx-one/shared/interfaces';

import { CardComponent } from '@components/card/card.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { TransactionTypeStylePipe } from '@pipes/transaction-type-style.pipe';
import { TransactionService } from '@services/transaction.service';

const PAGE_SUBTITLE = 'View your Linux Foundation purchase history. Recent purchases may take up to 48 hours to appear.';

const TAB_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All Transactions' },
  { id: 'event-tickets', label: 'Event Tickets' },
  { id: 'training', label: 'Training' },
  { id: 'certifications', label: 'Certifications' },
  { id: 'bundle', label: 'Bundles' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'individual-support', label: 'Individual Support' },
];

const TAB_TYPE_MAP: Record<string, string> = {
  'event-tickets': TRANSACTION_TYPE_EVENT,
  training: TRANSACTION_TYPE_TRAINING,
  certifications: TRANSACTION_TYPE_CERTIFICATION,
  subscriptions: TRANSACTION_TYPE_SUBSCRIPTION,
  'individual-support': TRANSACTION_TYPE_INDIVIDUAL_SUPPORT,
  bundle: TRANSACTION_TYPE_BUNDLE,
};

@Component({
  selector: 'lfx-transactions-dashboard',
  imports: [CardComponent, FilterPillsComponent, TableComponent, TagComponent, CurrencyPipe, DatePipe, TransactionTypeStylePipe],
  templateUrl: './transactions-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsDashboardComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly transactionService = inject(TransactionService);

  // ─── Configuration ─────────────────────────────────────────────────────────
  protected readonly subtitle = PAGE_SUBTITLE;
  protected readonly tabOptions = TAB_OPTIONS;

  // ─── Writable Signals ──────────────────────────────────────────────────────
  protected readonly activeTab = signal<string>('all');
  protected readonly tableFirst = signal<number>(0);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  protected readonly transactions: Signal<Transaction[] | undefined> = this.initTransactions();
  protected readonly filteredTransactions: Signal<Transaction[]> = this.initFilteredTransactions();

  // ─── Protected Methods ─────────────────────────────────────────────────────
  protected onTabChange(tabId: string): void {
    this.activeTab.set(tabId);
    this.tableFirst.set(0);
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initTransactions(): Signal<Transaction[] | undefined> {
    return toSignal(this.transactionService.getTransactions());
  }

  private initFilteredTransactions(): Signal<Transaction[]> {
    return computed(() => {
      const all = this.transactions();
      if (!all) return [];

      const tab = this.activeTab();
      if (tab === 'all') return all;

      const keyword = TAB_TYPE_MAP[tab];
      if (!keyword) return all;

      return all.filter((t) => t.transactionType === keyword);
    });
  }
}
