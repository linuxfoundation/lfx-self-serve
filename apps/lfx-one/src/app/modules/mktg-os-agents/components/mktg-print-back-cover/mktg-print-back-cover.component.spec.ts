// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { mktgPrintBrand, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPrintBackCoverComponent } from './mktg-print-back-cover.component';

const look = mktgPrintPageLook(mktgPrintBrand(null));

describe('MktgPrintBackCoverComponent', () => {
  it('draws the closing slide: the brand line in capitals centred on the dark ground, the host and the notice only when set', async () => {
    const fixture = TestBed.createComponent(MktgPrintBackCoverComponent);
    fixture.componentRef.setInput('look', look);
    fixture.componentRef.setInput('title', 'Open tooling for everyone');
    fixture.componentRef.setInput('host', 'synthetic.example');
    fixture.componentRef.setInput(
      'notice',
      'Copyright © The Linux Foundation and its contributors. Synthetic Project and its logo are trademarks of the Linux Foundation.'
    );
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS)).toBe(true);
    const page = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
    expect(page?.getAttribute('data-layout')).toBe('back');
    expect(page?.classList.contains('lfx-print-page--dark')).toBe(true);
    const title = root.querySelector<HTMLElement>('[data-testid="mktg-print-page-title"]');
    expect(title?.textContent?.trim()).toBe('Open tooling for everyone');
    expect(title?.querySelector('.pp-para--caps')).not.toBeNull();
    expect(title?.querySelector('.pp-rich--center')).not.toBeNull();
    const els = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
    expect(els).toHaveLength(2);
    expect(els[0].textContent?.trim()).toBe('synthetic.example');
    expect(els[1].textContent).toContain('trademarks of the Linux Foundation');
    expect(root.querySelector('[data-testid="mktg-print-page-head"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-print-page-footer"]')).toBeNull();

    fixture.componentRef.setInput('host', '');
    fixture.componentRef.setInput('notice', '');
    await fixture.whenStable();
    expect(root.querySelectorAll('[data-testid="mktg-print-page-el"]')).toHaveLength(0);
  });
});
