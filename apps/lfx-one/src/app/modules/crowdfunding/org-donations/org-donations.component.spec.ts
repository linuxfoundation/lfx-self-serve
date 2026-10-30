// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY_ORG_DONATIONS } from '@lfx-one/shared/constants';
import { OrgDonation } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { CrowdfundingService } from '@services/crowdfunding.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgDonationsComponent } from './org-donations.component';

const ORG_UID = '001000000000000AAA';

function donation(): OrgDonation {
  return {
    id: 'synthetic-donation-1',
    recurring: true,
    initiativeName: 'Synthetic Fund',
    donorName: 'Synthetic Donor',
    donorEmail: 'donor@example.com',
    amountCents: 2500,
    date: Date.UTC(2026, 9, 1),
  };
}

describe('OrgDonationsComponent (#415)', () => {
  let fixture: ComponentFixture<OrgDonationsComponent>;
  let rows: OrgDonation[];
  let service: { getOrgDonations: ReturnType<typeof vi.fn> };
  const accountContext = {
    selectedAccount: signal<{ accountId: string; accountName: string; uid: string | null }>({ accountId: '', accountName: '', uid: null }),
  };

  const root = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    rows = [];
    accountContext.selectedAccount.set({ accountId: '', accountName: '', uid: null });
    service = { getOrgDonations: vi.fn(() => of({ ...EMPTY_ORG_DONATIONS, data: rows, total: rows.length })) };
    await TestBed.configureTestingModule({
      imports: [OrgDonationsComponent],
      providers: [
        { provide: CrowdfundingService, useValue: service },
        { provide: AccountContextService, useValue: accountContext },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OrgDonationsComponent);
  });

  it('lists the selected organization once it resolves, ignoring display-only re-sets', async () => {
    rows = [donation()];
    await fixture.whenStable();
    expect(service.getOrgDonations).not.toHaveBeenCalled();

    accountContext.selectedAccount.set({ accountId: '', accountName: 'Synthetic Org', uid: ORG_UID });
    await fixture.whenStable();
    expect(service.getOrgDonations).toHaveBeenCalledWith(expect.objectContaining({ orgUid: ORG_UID, offset: 0 }));
    const row = root().querySelector<HTMLElement>('[data-testid="org-donation-row-synthetic-donation-1"]');
    expect(row?.textContent).toContain('Synthetic Fund');
    expect(row?.textContent).toContain('Recurring');
    expect(row?.textContent).toContain('Synthetic Donor');
    expect(row?.textContent).toContain('donor@example.com');
    expect(row?.textContent).toContain('$25.00');

    accountContext.selectedAccount.set({ accountId: 'x', accountName: 'Synthetic Org Inc', uid: ORG_UID });
    await fixture.whenStable();
    expect(service.getOrgDonations).toHaveBeenCalledTimes(1);
  });

  it('notes that only matched donations appear when the list is empty', async () => {
    accountContext.selectedAccount.set({ accountId: '', accountName: 'Synthetic Org', uid: ORG_UID });
    await fixture.whenStable();
    expect(root().querySelector('[data-testid="org-donations-empty"]')?.textContent).toContain('Only donations matched to Synthetic Org');
  });

  it('shows an access-denied state on a 403 and a retryable state on a 5xx', async () => {
    service.getOrgDonations.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    accountContext.selectedAccount.set({ accountId: '', accountName: 'Synthetic Org', uid: ORG_UID });
    await fixture.whenStable();
    expect(root().querySelector('[data-testid="org-donations-error-forbidden"]')).not.toBeNull();

    service.getOrgDonations.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })));
    accountContext.selectedAccount.set({ accountId: '', accountName: 'Other Org', uid: '001000000000000BBB' });
    await fixture.whenStable();
    const unavailable = root().querySelector<HTMLElement>('[data-testid="org-donations-error-unavailable"]');
    expect(unavailable).not.toBeNull();
    expect(root().querySelector('[data-testid="org-donations-error-forbidden"]')).toBeNull();

    rows = [donation()];
    unavailable!.querySelector<HTMLButtonElement>('button')!.click();
    await fixture.whenStable();
    expect(root().querySelector('[data-testid="org-donations-error-unavailable"]')).toBeNull();
    expect(root().querySelector('[data-testid="org-donation-row-synthetic-donation-1"]')).not.toBeNull();
  });
});
