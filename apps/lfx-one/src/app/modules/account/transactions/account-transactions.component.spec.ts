// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { Transaction } from '@lfx-one/shared/interfaces';
import { TransactionService } from '@services/transaction.service';
import { NEVER, Observable, of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AccountTransactionsComponent } from './account-transactions.component';

const transaction = (id: string, transactionType: Transaction['transactionType']): Transaction => ({
  id,
  orderId: `order-${id}`,
  createdDate: '2026-03-04T12:00:00Z',
  name: `Purchase ${id}`,
  transactionType,
  netRevenue: 1250.5,
  projectId: null,
  projectName: null,
});

/** State-only page: no template, so these tests cost no render. */
@Component({ selector: 'lfx-test-account-transactions', template: '' })
class StateTransactionsComponent extends AccountTransactionsComponent {}

describe('AccountTransactionsComponent', () => {
  function setup(transactions$: Observable<Transaction[]>) {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { embedded: true } } } },
        { provide: TransactionService, useValue: { getTransactions: () => transactions$ } },
      ],
    });
  }

  async function renderPage(transactions$: Observable<Transaction[]>) {
    setup(transactions$);
    const fixture = TestBed.createComponent(AccountTransactionsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null };
  }

  it('shows ten rows a page, with each type in words', async () => {
    const all = Array.from({ length: 12 }, (_, index) => transaction(`t${index}`, index === 0 ? null : 'events'));
    setup(of(all));
    const fixture = TestBed.createComponent(StateTransactionsComponent);
    await fixture.whenStable();
    const page = fixture.componentInstance;

    expect(page['tableRows']()).toHaveLength(10);
    expect(page['tableRows']()[0].row.typeLabel).toBeNull();
    expect(page['tableRows']()[1].row.typeLabel).toBe('Event Ticket');

    page['page'].set(1);
    expect(page['tableRows']().map((row) => row.id)).toEqual(['t10', 't11']);
  });

  it('filters by the tab picked and starts it on its first page', async () => {
    setup(of([...Array.from({ length: 11 }, (_, index) => transaction(`e${index}`, 'events')), transaction('tr', 'training')]));
    const fixture = TestBed.createComponent(StateTransactionsComponent);
    await fixture.whenStable();
    const page = fixture.componentInstance;
    page['page'].set(1);

    page['onTabChange']('training');

    expect(page['page']()).toBe(0);
    expect(page['tableRows']().map((row) => row.id)).toEqual(['tr']);
  });

  it('shows the name over its order ID, the type as a badge and the value as money', async () => {
    const { query } = await renderPage(of([transaction('t1', 'training')]));

    expect(query('account-transactions-name-t1')?.textContent).toContain('Purchase t1');
    expect(query('account-transactions-name-t1')?.textContent).toContain('Order ID: order-t1');
    expect(query('account-transactions-type-t1')?.textContent?.trim()).toBe('Training');
    expect(query('account-transactions-value-t1')?.textContent?.trim()).toBe('$1,250.50');
  });

  it('offers the types as tabs and, for a narrow card, as a select', async () => {
    const { query } = await renderPage(of([]));

    expect(query('account-transactions-tabs')?.textContent).toContain('Individual Support');
    expect(query('account-transactions-select')).not.toBeNull();
  });

  it('gives every tab the panel it controls, showing only the active one', async () => {
    const { host } = await renderPage(of([]));
    const tabs = Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));

    expect(tabs).toHaveLength(7);
    for (const tab of tabs) {
      const panel = host.querySelector<HTMLElement>(`#${tab.getAttribute('aria-controls')}`);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') !== 'true');
    }
  });

  it('says when a tab has no transactions, and that recent ones take time to appear', async () => {
    const { query } = await renderPage(of([]));

    expect(query('account-transactions-empty')?.textContent).toContain('No transactions found');
    expect(query('account-transactions-empty')?.textContent).toContain('up to 48 hours');
  });

  it('shows placeholders while the transactions load', async () => {
    const { query } = await renderPage(NEVER);

    expect(query('account-transactions-loading')).not.toBeNull();
    expect(query('account-transactions-table')).toBeNull();
  });
});
