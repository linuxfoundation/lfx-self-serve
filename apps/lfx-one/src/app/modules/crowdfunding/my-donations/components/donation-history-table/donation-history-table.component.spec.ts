// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MyDonation } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { DonationHistoryTableComponent } from './donation-history-table.component';

function row(overrides: Partial<MyDonation> = {}): MyDonation {
  return {
    id: 'synthetic-row-1',
    donorType: 'member',
    amountCents: 1000,
    date: Date.UTC(2026, 9, 1),
    initiativeName: 'Synthetic Fund',
    recurring: false,
    anonymous: false,
    ...overrides,
  };
}

describe('DonationHistoryTableComponent donor anonymity (lfx-crowdfunding#466)', () => {
  let fixture: ComponentFixture<DonationHistoryTableComponent>;
  const root = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DonationHistoryTableComponent] }).compileComponents();
    fixture = TestBed.createComponent(DonationHistoryTableComponent);
    fixture.componentRef.setInput('exploreUrl', 'https://crowdfunding.example/initiatives');
  });

  it('tags anonymous rows and offers the name menu only on rows CF can match', async () => {
    fixture.componentRef.setInput('items', [
      row({ id: 'r1', anonymous: true, donationId: 'synthetic-donation-1' }),
      row({ id: 'r2', recurring: true, subscriptionId: 'synthetic-subscription-1' }),
      row({ id: 'r3' }),
    ]);
    await fixture.whenStable();

    const r1 = root().querySelector('[data-testid="donation-row-r1"]');
    const r2 = root().querySelector('[data-testid="donation-row-r2"]');
    const r3 = root().querySelector('[data-testid="donation-row-r3"]');
    expect(r1?.querySelector('[data-testid="donation-anonymous-tag"]')).not.toBeNull();
    expect(r2?.querySelector('[data-testid="donation-anonymous-tag"]')).toBeNull();

    expect(r1?.querySelector('[data-testid="donation-row-menu-r1"]')).not.toBeNull();
    expect(r2?.querySelector('[data-testid="donation-row-menu-r2"]')).not.toBeNull();
    // An old or offline row without a CF id can't be toggled.
    expect(r3?.querySelector('[data-testid="donation-row-menu-r3"]')).toBeNull();
  });

  it('labels the menu action for the row and emits the row when chosen', async () => {
    const hidden = row({ id: 'r1', anonymous: true, donationId: 'synthetic-donation-1' });
    const shown = row({ id: 'r2', subscriptionId: 'synthetic-subscription-1' });
    fixture.componentRef.setInput('items', [hidden, shown]);
    await fixture.whenStable();

    const emitted: MyDonation[] = [];
    fixture.componentInstance.toggleAnonymity.subscribe((d) => emitted.push(d));
    const component = fixture.componentInstance as unknown as {
      onRowMenuToggle(event: Event, item: MyDonation): void;
      rowMenuItems(): { label?: string; command?: () => void }[];
    };

    component.onRowMenuToggle(new MouseEvent('click'), hidden);
    expect(component.rowMenuItems()[0].label).toBe('Show my name');
    component.rowMenuItems()[0].command?.();

    component.onRowMenuToggle(new MouseEvent('click'), shown);
    expect(component.rowMenuItems()[0].label).toBe('Hide my name');
    component.rowMenuItems()[0].command?.();

    expect(emitted).toEqual([hidden, shown]);
  });
});
