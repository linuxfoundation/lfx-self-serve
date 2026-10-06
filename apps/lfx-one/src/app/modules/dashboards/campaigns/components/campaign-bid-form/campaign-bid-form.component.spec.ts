// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CAMPAIGN_BID_OUTCOME_UNCONFIRMED, CAMPAIGN_BID_STRATEGY_NOTE } from '@lfx-one/shared/constants';
import { CampaignBidChange } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignBidFormComponent } from './campaign-bid-form.component';

describe('CampaignBidFormComponent', () => {
  let fixture: ComponentFixture<CampaignBidFormComponent>;
  let submitted: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignBidFormComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignBidFormComponent);
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    submitted = vi.fn();
    fixture.componentInstance.submitBid.subscribe((change: CampaignBidChange) => submitted(change));
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null => el().querySelector(`[data-testid="${testId}"]`);

  function typeBid(value: string): void {
    const input = el().querySelector('#campaign-bid-amount-c-1') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    q('optimization-campaign-bid-form-c-1')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('emits the bid exactly as typed', () => {
    fixture.detectChanges();
    typeBid('1.255');
    submit();

    expect(submitted).toHaveBeenCalledWith({ bid: 1.255 });
  });

  it.each(['0', '-0.5'])('refuses %s and says why', (bid) => {
    fixture.detectChanges();
    typeBid(bid);
    submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(q('optimization-campaign-bid-amount-error-c-1')!.textContent).toContain('greater than zero');
  });

  it('refuses an empty bid', () => {
    fixture.detectChanges();
    submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(q('optimization-campaign-bid-amount-error-c-1')!.textContent).toContain('as a number');
  });

  // The strategy limitation is stated BEFORE a save, and described to assistive tech with the field.
  it('states that it applies to manual per-click bidding only, and labels the field without a currency symbol', () => {
    fixture.detectChanges();

    expect(q('optimization-campaign-bid-strategy-note-c-1')!.textContent).toContain(CAMPAIGN_BID_STRATEGY_NOTE);
    const label = el().querySelector('label[for="campaign-bid-amount-c-1"]')!.textContent!;
    expect(label).toContain('ad account currency');
    expect(el().textContent).not.toContain('$');
    expect(el().querySelector('#campaign-bid-amount-c-1')!.getAttribute('aria-describedby')).toBe('campaign-bid-amount-hint-c-1 campaign-bid-strategy-c-1');
  });

  it('prefills a confirmed bid without submitting it', () => {
    fixture.componentRef.setInput('initialBid', 2.5);
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.bid.value).toBe(2.5);
    expect(submitted).not.toHaveBeenCalled();
  });

  it('renders an unconfirmed outcome as "may have applied", apart from a failure', () => {
    fixture.componentRef.setInput('outcome', { state: 'unconfirmed', message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED });
    fixture.detectChanges();

    const unconfirmed = q('optimization-campaign-bid-unconfirmed-c-1')!;
    expect(unconfirmed.textContent).toContain('may have applied');
    expect(unconfirmed.textContent).toContain(CAMPAIGN_BID_OUTCOME_UNCONFIRMED);
    expect(q('optimization-campaign-bid-error-c-1')).toBeNull();
    expect(el().querySelector('#campaign-bid-amount-c-1')!.getAttribute('aria-describedby')).toContain('campaign-bid-outcome-c-1');
  });

  it("renders upstream's 409 verbatim as a failure", () => {
    const message = "this campaign's bid cannot be set here: its bidding setup is not a manual per-click bid";
    fixture.componentRef.setInput('outcome', { state: 'failed', message });
    fixture.detectChanges();

    expect(q('optimization-campaign-bid-error-c-1')!.textContent!.trim()).toBe(message);
    expect(q('optimization-campaign-bid-unconfirmed-c-1')).toBeNull();
  });

  it('blocks submitting, and says why, while the row is blocked', () => {
    fixture.componentRef.setInput('blockedReason', 'Another change to this campaign is still in progress.');
    fixture.detectChanges();
    typeBid('1');
    submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(q('optimization-campaign-bid-blocked-c-1')!.textContent).toContain('still in progress');
    expect((el().querySelector('[data-testid="optimization-campaign-bid-submit-c-1"] button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits cancel', () => {
    const cancelled = vi.fn();
    fixture.componentInstance.cancelEdit.subscribe(() => cancelled());
    fixture.detectChanges();
    (el().querySelector('[data-testid="optimization-campaign-bid-cancel-c-1"] button') as HTMLButtonElement).click();

    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
