// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignBiddingControlView, CampaignBiddingDraft } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignBiddingControlComponent } from './campaign-bidding-control.component';

describe('CampaignBiddingControlComponent', () => {
  let fixture: ComponentFixture<CampaignBiddingControlComponent>;
  let emitted: CampaignBiddingDraft[];

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  async function render(view: CampaignBiddingControlView): Promise<void> {
    fixture.componentRef.setInput('view', view);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignBiddingControlComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignBiddingControlComponent);
    emitted = [];
    fixture.componentInstance.biddingChange.subscribe((d) => emitted.push(d));
  });

  it('defaults to Automatic, with no bid input and nothing emitted', async () => {
    await render({ platform: 'meta-ads', value: { strategy: 'automatic', bidAmount: null }, error: null });

    expect(fixture.componentInstance.form.getRawValue()).toEqual({ strategy: 'automatic', bidAmount: null });
    expect(query('implementation-bidding-meta-ads-automatic')?.textContent).toContain('Automatic (recommended)');
    expect(query('implementation-bidding-meta-ads-amount')).toBeNull();
    expect(emitted).toEqual([]);
  });

  it('groups the two options under a Bidding legend, one radio name per platform', async () => {
    await render({ platform: 'reddit-ads', value: { strategy: 'automatic', bidAmount: null }, error: null });

    const fieldset = query('implementation-bidding-reddit-ads') as HTMLFieldSetElement;
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(fieldset.querySelector('legend')?.textContent?.trim()).toBe('Bidding');
    const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]')) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.name))).toEqual(new Set(['campaign-bidding-reddit-ads-strategy']));
  });

  it('emits the choice and the typed bid as the operator edits them', async () => {
    await render({ platform: 'linkedin-ads', value: { strategy: 'automatic', bidAmount: null }, error: null });

    fixture.componentInstance.form.controls.strategy.setValue('manual');
    expect(emitted.at(-1)).toEqual({ strategy: 'manual', bidAmount: null });

    await render({ platform: 'linkedin-ads', value: { strategy: 'manual', bidAmount: null }, error: null });
    const input = query('implementation-bidding-linkedin-ads-amount')?.querySelector('input') as HTMLInputElement;
    input.value = '2.5';
    input.dispatchEvent(new Event('input'));

    expect(emitted.at(-1)).toEqual({ strategy: 'manual', bidAmount: 2.5 });
  });

  it('restores a manual choice without echoing it back as an edit', async () => {
    await render({ platform: 'microsoft-ads', value: { strategy: 'manual', bidAmount: 1.25 }, error: null });

    expect(fixture.componentInstance.form.getRawValue()).toEqual({ strategy: 'manual', bidAmount: 1.25 });
    expect((query('implementation-bidding-microsoft-ads-amount')?.querySelector('input') as HTMLInputElement).value).toBe('1.25');
    expect(emitted).toEqual([]);
  });

  it('shows the currency and limits, and wires the error to the bid input', async () => {
    await render({ platform: 'meta-ads', value: { strategy: 'manual', bidAmount: 9 }, error: 'Meta needs a daily budget of at least 5× the bid (45).' });

    expect(query('implementation-bidding-meta-ads-currency')?.textContent).toContain("ad account's currency");
    expect(query('implementation-bidding-meta-ads-limit')?.textContent).toContain('Traffic or Leads');
    expect(query('implementation-bidding-meta-ads-error')?.textContent).toContain('5× the bid');
    const input = query('implementation-bidding-meta-ads-amount')?.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('campaign-bidding-meta-ads-currency campaign-bidding-meta-ads-limit campaign-bidding-meta-ads-error');
    const label = fixture.nativeElement.querySelector('label[for="campaign-bidding-meta-ads-amount"]') as HTMLLabelElement;
    expect(label.textContent).toContain('ad account currency');
  });

  /**
   * The live region must exist BEFORE the error does and only change its text: a region inserted
   * with its text already present is not reliably announced. Same element across all three renders.
   */
  it('keeps one persistent live region and updates its text as the error appears and clears', async () => {
    await render({ platform: 'meta-ads', value: { strategy: 'automatic', bidAmount: null }, error: null });
    const region = query('implementation-bidding-meta-ads-live');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent?.trim()).toBe('');
    expect(query('implementation-bidding-meta-ads-error')).toBeNull();

    await render({
      platform: 'meta-ads',
      value: { strategy: 'manual', bidAmount: null },
      error: 'Enter a max CPC bid for manual bidding, or choose Automatic.',
    });

    expect(query('implementation-bidding-meta-ads-live')).toBe(region);
    expect(region?.textContent?.trim()).toBe('Enter a max CPC bid for manual bidding, or choose Automatic.');
    // The visible error is not itself a live region; it stays the input's description.
    expect(query('implementation-bidding-meta-ads-error')?.hasAttribute('aria-live')).toBe(false);

    await render({ platform: 'meta-ads', value: { strategy: 'manual', bidAmount: 1 }, error: null });

    expect(query('implementation-bidding-meta-ads-live')).toBe(region);
    expect(region?.textContent?.trim()).toBe('');
  });

  it('labels a LinkedIn bid as USD and leaves the input valid without an error', async () => {
    await render({ platform: 'linkedin-ads', value: { strategy: 'manual', bidAmount: 2.5 }, error: null });

    const label = fixture.nativeElement.querySelector('label[for="campaign-bidding-linkedin-ads-amount"]') as HTMLLabelElement;
    expect(label.textContent).toContain('USD');
    const input = query('implementation-bidding-linkedin-ads-amount')?.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(query('implementation-bidding-linkedin-ads-error')).toBeNull();
  });
});
