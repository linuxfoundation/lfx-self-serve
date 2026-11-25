// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, computed, Signal, signal } from '@angular/core';
import { ACCOUNT_TRANSACTIONS_COPY, TRANSACTION_TYPE_LABELS } from '@lfx-one/shared/constants';
import { AccountTransactionRow, UiTabItem, UiTableColumn } from '@lfx-one/shared/interfaces';
import { AccountCardComponent } from '@shared/components/account-card/account-card.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTableCellDirective } from '@shared/uikit/table/table-cell.directive';
import { UiTableComponent } from '@shared/uikit/table/table.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';

import { TransactionsDashboardComponent } from '../../transactions/transactions-dashboard/transactions-dashboard.component';

/**
 * Account & Settings › Transactions (#6078): one card with type tabs, which turn into a select on a narrow card, and a table of
 * ten rows a page. It keeps the transactions page's loading and tab filtering by extending it.
 */
@Component({
  selector: 'lfx-account-transactions',
  imports: [
    CurrencyPipe,
    DatePipe,
    AccountCardComponent,
    UiBadgeComponent,
    UiEmptyStateComponent,
    UiOptionComponent,
    UiPaginationComponent,
    UiSelectComponent,
    UiSkeletonComponent,
    UiTableComponent,
    UiTableCellDirective,
    UiTabsComponent,
  ],
  templateUrl: './account-transactions.component.html',
})
export class AccountTransactionsComponent extends TransactionsDashboardComponent {
  protected readonly copy = ACCOUNT_TRANSACTIONS_COPY;
  protected readonly tabs: UiTabItem[] = this.tabOptions.map((option) => ({ value: option.id, label: option.label }));
  protected readonly columns: UiTableColumn[] = [
    { key: 'name', header: 'Name' },
    { key: 'date', header: 'Date' },
    { key: 'type', header: 'Type' },
    { key: 'value', header: 'Transaction Value', align: 'end' },
  ];

  protected readonly page = signal(0);

  protected readonly loading: Signal<boolean> = computed(() => this.transactions() === undefined);
  /** The current page of the active tab, as the table's rows. */
  protected readonly tableRows: Signal<{ id: string; row: AccountTransactionRow }[]> = this.initTableRows();

  protected override onTabChange(tabId: string): void {
    super.onTabChange(tabId);
    this.page.set(0);
  }

  private initTableRows(): Signal<{ id: string; row: AccountTransactionRow }[]> {
    return computed(() => {
      const start = this.page() * this.copy.pageSize;
      return this.filteredTransactions()
        .slice(start, start + this.copy.pageSize)
        .map((transaction) => ({
          id: transaction.id,
          row: { transaction, typeLabel: transaction.transactionType ? (TRANSACTION_TYPE_LABELS[transaction.transactionType] ?? null) : null },
        }));
    });
  }
}
