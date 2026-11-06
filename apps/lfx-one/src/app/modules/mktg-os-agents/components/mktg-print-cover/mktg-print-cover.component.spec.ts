// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_LANDSCAPE_CLASS, MKTG_PRINT_PAGE_COVER_EYEBROW_BOX, MKTG_PRINT_PAGE_COVER_LOGO_BOX } from '@lfx-one/shared/constants';
import { mktgPagePt, mktgPrintBrand, mktgPrintFooterLine, mktgPrintPageLook, mktgPrintShapeEl } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPrintCoverComponent } from './mktg-print-cover.component';

const brand = mktgPrintBrand(null);
const look = mktgPrintPageLook(brand);

describe('MktgPrintCoverComponent', () => {
  it('draws the deck cover: title and subtitle on the dark ground, the lines only when set, the lockup, and extra elements', async () => {
    const fixture = TestBed.createComponent(MktgPrintCoverComponent);
    fixture.componentRef.setInput('look', look);
    fixture.componentRef.setInput('title', 'Brand Kit');
    fixture.componentRef.setInput('subtitle', 'Logos, color, type and usage on one reference.');
    fixture.componentRef.setInput('eyebrow', 'Synthetic Project · A Linux Foundation project');
    fixture.componentRef.setInput('topRight', 'V1.0');
    fixture.componentRef.setInput('footerLeft', mktgPrintFooterLine('Synthetic Project'));
    fixture.componentRef.setInput('footerRight', 'synthetic.example · V1.0 · November 2026');
    fixture.componentRef.setInput('logo', brand.logoOnDark);
    fixture.componentRef.setInput('els', [mktgPrintShapeEl('RECTANGLE', { x: 38, y: 118, w: 36, h: 3 }, look.accent)]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS)).toBe(true);
    const page = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
    expect(page?.getAttribute('data-layout')).toBe('cover');
    expect(page?.classList.contains('lfx-print-page--dark')).toBe(true);
    expect(root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Brand Kit');
    expect(root.querySelector('[data-testid="mktg-print-page-subtitle"]')?.textContent?.trim()).toBe('Logos, color, type and usage on one reference.');
    const els = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
    expect(Array.from(els, (el) => el.textContent?.trim())).toEqual([
      'Synthetic Project · A Linux Foundation project',
      'V1.0',
      'Synthetic Project · a Linux Foundation project',
      'synthetic.example · V1.0 · November 2026',
      '',
      '',
    ]);
    expect(els[0].style.left).toBe(mktgPagePt(MKTG_PRINT_PAGE_COVER_EYEBROW_BOX.x));
    expect(els[0].querySelector('.pp-para--caps')).not.toBeNull();
    expect(els[1].querySelector('.pp-rich--end')).not.toBeNull();
    expect(els[4].querySelector('img')?.getAttribute('src')).toBe(brand.logoOnDark?.src);
    expect(els[4].style.top).toBe(mktgPagePt(MKTG_PRINT_PAGE_COVER_LOGO_BOX.y));
    expect(els[4].style.width).toBe(mktgPagePt(MKTG_PRINT_PAGE_COVER_LOGO_BOX.w));
    expect(els[5].style.backgroundColor).not.toBe('');

    // A document's own lockup frame (the kit's cover sets none: the deck's coverSlide carries no logo).
    fixture.componentRef.setInput('logoBox', { x: 40, y: 20, w: 120, h: 30 });
    await fixture.whenStable();
    const moved = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]')[4];
    expect(moved.style.top).toBe(mktgPagePt(20));
    expect(moved.style.width).toBe(mktgPagePt(120));

    fixture.componentRef.setInput('topRight', '');
    fixture.componentRef.setInput('footerRight', ' ');
    fixture.componentRef.setInput('logo', null);
    fixture.componentRef.setInput('els', []);
    await fixture.whenStable();
    expect(root.querySelectorAll('[data-testid="mktg-print-page-el"]')).toHaveLength(2);
  });
});
