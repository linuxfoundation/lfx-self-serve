// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { mktgPortraitLook, mktgPrintBrand } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPortraitBackCoverComponent } from './mktg-portrait-back-cover.component';

const BOOK: MktgPortraitBook = {
  inFamily: false,
  headRight: 'Synthetic project brand kit',
  footLeft: 'Synthetic project · a Linux Foundation project',
  firstPage: 1,
};

async function setup(logo = true) {
  const brand = mktgPrintBrand(null);
  const fixture = TestBed.createComponent(MktgPortraitBackCoverComponent);
  fixture.componentRef.setInput('look', mktgPortraitLook(brand));
  fixture.componentRef.setInput('book', BOOK);
  fixture.componentRef.setInput('page', 17);
  fixture.componentRef.setInput('logo', logo ? brand.logoOnDark : null);
  fixture.componentRef.setInput('line', 'Open standards for agents');
  fixture.componentRef.setInput('url', 'synthetic.example');
  fixture.componentRef.setInput('notice', 'Copyright © The Linux Foundation and its contributors.');
  await fixture.whenStable();
  const page = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!page) throw new Error('Missing synthetic back cover');
  return { fixture, page, brand };
}

describe('lfx-mktg-portrait-back-cover', () => {
  it('is a bare dark frame: the lockup centred at y 420, the brand line in the accent and the url at y 560, the notice at y 964', async () => {
    const { page, brand } = await setup();
    expect(page.classList.contains('pp-page--dark')).toBe(true);
    expect(page.getAttribute('data-page-id')).toBe('back-cover');
    expect(page.getAttribute('data-page')).toBe('17');
    expect(page.getAttribute('data-section')).toBe('Back cover');
    expect(page.querySelector('[data-testid="mktg-portrait-page-foot"]')).toBeNull();
    const logo = page.querySelector<HTMLImageElement>('[data-testid="mktg-portrait-back-cover-logo"]');
    expect(logo?.getAttribute('src')).toBe(brand.logoOnDark?.src);
    expect(logo?.parentElement?.classList.contains('pp-back-lockup')).toBe(true);
    expect(logo?.parentElement?.style.top).toBe('420px');
    expect(logo?.parentElement?.style.width).toBe('816px');
    const line = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-back-cover-line"]');
    expect(line?.textContent).toBe('Open standards for agents');
    expect(line?.classList.contains('pp-back-line')).toBe(true);
    expect(line?.parentElement?.style.top).toBe('560px');
    expect(page.querySelector('[data-testid="mktg-portrait-back-cover-url"]')?.textContent).toBe('synthetic.example');
    const notice = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-back-cover-notice"]');
    expect(notice?.textContent).toContain('Copyright ©');
    expect(notice?.parentElement?.style.left).toBe('72px');
    expect(notice?.parentElement?.style.top).toBe('964px');
  });

  it('draws nothing in the lockup’s place without a reversed logo', async () => {
    const { page } = await setup(false);
    expect(page.querySelector('img')).toBeNull();
    expect(page.querySelector('[data-testid="mktg-portrait-back-cover-line"]')).not.toBeNull();
  });
});
