// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EnrollmentMembership, IndividualEnrollment } from '@lfx-one/shared/interfaces';
import { EnrollmentService } from '@services/enrollment.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountIndividualEnrollmentComponent } from './account-individual-enrollment.component';

const MEMBERSHIP: EnrollmentMembership = {
  status: 'Active',
  autoRenew: true,
  purchaseDate: '2025-01-12',
  endDate: '2099-01-12',
  price: 99,
  id: 'm-1',
  extPaymentType: 'stripe',
};
const ITEM = {
  projectName: 'The Linux Foundation',
  productName: 'Individual Supporter',
  price: 99,
  projectLogo: '',
  benefits: ['A t-shirt', 'Discounts'],
  productId: 'p-1',
  enrollButton: 'Enroll',
  ctaPath: '/individual',
  membership: MEMBERSHIP,
} as unknown as IndividualEnrollment;

/** State-only page: no template, so these tests cost no render. Providers are not inherited, so the page's own is repeated. */
@Component({ selector: 'lfx-test-account-enrollment', template: '', providers: [ConfirmationService] })
class StateEnrollmentComponent extends AccountIndividualEnrollmentComponent {}

describe('AccountIndividualEnrollmentComponent', () => {
  function setup(items: IndividualEnrollment[]) {
    const closed = of(true);
    const open = vi.fn(() => ({ closed }));
    const updateAutoRenew = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: EnrollmentService, useValue: { getEnrollments: () => of({ kind: 'loaded', items }), updateAutoRenew } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: UiModalService, useValue: { open } },
      ],
    });
    return { open, updateAutoRenew };
  }

  async function state(items: IndividualEnrollment[]) {
    const mocks = setup(items);
    const fixture = TestBed.createComponent(StateEnrollmentComponent);
    await fixture.whenStable();
    return { page: fixture.componentInstance, ...mocks };
  }

  it('shows an active card payment with its figures and the auto-renew switch', async () => {
    const { page } = await state([ITEM]);
    const [card] = page['cards']();

    expect(card.subtitle).toBe('The Linux Foundation');
    expect(card.action).toBe('auto-renew');
    expect(card.figures.map((figure) => [figure.label, figure.value])).toEqual([
      ['Price', '$99/year'],
      ['Purchased', 'Jan 12, 2025'],
      ['Renews', 'Jan 12, 2099'],
      ['Auto-renew', 'Enabled'],
    ]);
  });

  it('offers renewal when expiring and repurchase when expired, with the matching date', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { page } = await state([
      { ...ITEM, productId: 'soon', membership: { ...MEMBERSHIP, autoRenew: false, endDate: soon } },
      { ...ITEM, productId: 'gone', membership: { ...MEMBERSHIP, status: 'Expired', endDate: '2025-01-12' } },
    ]);
    const [expiring, expired] = page['cards']();

    expect(expiring.item.displayStatus).toBe('Expiring Soon');
    expect(expiring.action).toBe('renew');
    expect(expiring.figures.map((figure) => figure.label)).toContain('Expires');
    expect(expired.action).toBe('repurchase');
    expect(expired.figures.map((figure) => figure.label)).toEqual(['Price', 'Purchased', 'Expired on']);
  });

  it('has no auto-renew switch for a payment that is not by card', async () => {
    const { page } = await state([{ ...ITEM, membership: { ...MEMBERSHIP, extPaymentType: 'invoice' } }]);
    const [card] = page['cards']();

    expect(card.action).toBeNull();
    expect(card.figures.map((figure) => figure.label)).not.toContain('Auto-renew');
  });

  it('offers enrollment at its price when not enrolled', async () => {
    const { page } = await state([{ ...ITEM, membership: null }]);
    const [card] = page['cards']();

    expect(card.subtitle).toBe('$99/year · Renews every year');
    expect(card.enrollLabel).toBe('Enroll now ($99/year)');
    expect(card.figures).toEqual([]);
  });

  it('asks before changing auto-renew, then changes it', async () => {
    const { open, updateAutoRenew } = setup([ITEM]);
    const fixture = TestBed.createComponent(AccountIndividualEnrollmentComponent);
    await fixture.whenStable();
    const page = fixture.componentInstance;
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="account-enrollment-toggle-auto-renew"] button')?.click();

    expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: 'alertdialog' }));
    expect(page['pendingAutoRenew']()).toEqual({ enable: false, endDate: '2099-01-12' });
    expect(updateAutoRenew).toHaveBeenCalledWith('m-1', false);
  });

  it('renders the card with its status, figures, benefits and action', async () => {
    setup([ITEM]);
    const fixture = TestBed.createComponent(AccountIndividualEnrollmentComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const query = (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

    expect(query('account-enrollment-card-title')?.textContent?.trim()).toBe('Individual Supporter');
    expect(query('account-enrollment-status')?.textContent?.trim()).toBe('Active');
    expect(host.querySelectorAll('[data-testid="account-enrollment-figure"]').length).toBe(4);
    expect(query('account-enrollment-benefits')?.textContent).toContain('A t-shirt');
    expect(query('account-enrollment-toggle-auto-renew')?.textContent?.trim()).toBe('Disable auto-renew');
  });

  it('says so when there are no products', async () => {
    setup([]);
    const fixture = TestBed.createComponent(AccountIndividualEnrollmentComponent);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="account-enrollment-empty"]')).not.toBeNull();
  });
});
