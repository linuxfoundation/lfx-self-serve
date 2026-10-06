// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import { CampaignBudgetChange } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignBudgetFormComponent } from './campaign-budget-form.component';

describe('CampaignBudgetFormComponent', () => {
  let fixture: ComponentFixture<CampaignBudgetFormComponent>;
  let submitted: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CampaignBudgetFormComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(CampaignBudgetFormComponent);
    fixture.componentRef.setInput('campaignId', 'c-1');
    fixture.componentRef.setInput('campaignName', 'KubeCon EU');
    submitted = vi.fn();
    fixture.componentInstance.submitBudget.subscribe((change: CampaignBudgetChange) => submitted(change));
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null => el().querySelector(`[data-testid="${testId}"]`);

  function typeAmount(value: string): void {
    const input = el().querySelector('#campaign-budget-amount-c-1') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submit(): void {
    q('optimization-campaign-budget-form-c-1')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('emits the amount exactly as typed with the chosen pacing', () => {
    fixture.detectChanges();
    typeAmount('99.995');
    (el().querySelector('#campaign-budget-type-c-1-lifetime') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(submitted).toHaveBeenCalledWith({ budget: 99.995, budgetType: 'lifetime' });
  });

  // Prefilled from a budget this session confirmed, and NEVER submitted on the operator's behalf.
  it('prefills a known amount without submitting it', () => {
    fixture.componentRef.setInput('initialBudget', 2500);
    fixture.componentRef.setInput('knownBudgetType', 'daily');
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.budget.value).toBe(2500);
    expect(fixture.componentInstance.form.controls.budgetType.value).toBe('daily');
    expect(submitted).not.toHaveBeenCalled();
  });

  it('leaves the amount empty when no budget is known', () => {
    fixture.detectChanges();

    expect(fixture.componentInstance.form.controls.budget.value).toBeNull();
  });

  it('labels every control and groups the pacing choice under a legend', () => {
    fixture.detectChanges();

    expect(el().querySelector('label[for="campaign-budget-amount-c-1"]')).not.toBeNull();
    expect(el().querySelector('fieldset legend')!.textContent).toContain('Budget pacing');
    expect(el().querySelector('label[for="campaign-budget-type-c-1-daily"]')!.textContent).toContain('Daily');
    expect(el().querySelector('label[for="campaign-budget-type-c-1-lifetime"]')!.textContent).toContain('Lifetime');
    expect(el().querySelector('#campaign-budget-amount-c-1')!.getAttribute('aria-describedby')).toBe('campaign-budget-amount-hint-c-1');
  });

  it.each(['0', '-1'])('refuses %s and says why', (amount) => {
    fixture.detectChanges();
    typeAmount(amount);
    fixture.componentInstance.form.controls.budgetType.setValue('daily');
    submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(q('optimization-campaign-budget-amount-error-c-1')!.textContent).toContain('greater than zero');
  });

  it('pre-selects a known pacing and leaves an unknown one unselected', () => {
    fixture.componentRef.setInput('knownBudgetType', 'lifetime');
    fixture.detectChanges();
    expect(fixture.componentInstance.form.controls.budgetType.value).toBe('lifetime');

    const fresh = TestBed.createComponent(CampaignBudgetFormComponent);
    fresh.componentRef.setInput('campaignId', 'c-2');
    fresh.componentRef.setInput('campaignName', 'Other');
    fresh.detectChanges();
    expect(fresh.componentInstance.form.controls.budgetType.value).toBeNull();
  });

  it('renders an unconfirmed outcome apart from a failure', () => {
    fixture.componentRef.setInput('outcome', { state: 'unconfirmed', message: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED });
    fixture.detectChanges();

    expect(q('optimization-campaign-budget-unconfirmed-c-1')!.textContent).toContain('may already be applied');
    expect(q('optimization-campaign-budget-error-c-1')).toBeNull();
    expect(el().querySelector('#campaign-budget-amount-c-1')!.getAttribute('aria-describedby')).toContain('campaign-budget-outcome-c-1');

    fixture.componentRef.setInput('outcome', { state: 'failed', message: 'budget is below the platform minimum' });
    fixture.detectChanges();
    expect(q('optimization-campaign-budget-unconfirmed-c-1')).toBeNull();
    expect(q('optimization-campaign-budget-error-c-1')!.textContent!.trim()).toBe('budget is below the platform minimum');
  });

  it('blocks submitting, and says why, while the row is blocked', () => {
    fixture.componentRef.setInput('blockedReason', 'A pause or resume of this campaign is still in progress.');
    fixture.detectChanges();
    typeAmount('10');
    fixture.componentInstance.form.controls.budgetType.setValue('daily');
    submit();

    expect(submitted).not.toHaveBeenCalled();
    expect(q('optimization-campaign-budget-blocked-c-1')!.textContent).toContain('still in progress');
    expect((el().querySelector('[data-testid="optimization-campaign-budget-submit-c-1"] button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('emits cancel', () => {
    const cancelled = vi.fn();
    fixture.componentInstance.cancelEdit.subscribe(() => cancelled());
    fixture.detectChanges();
    (el().querySelector('[data-testid="optimization-campaign-budget-cancel-c-1"] button') as HTMLButtonElement).click();

    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
