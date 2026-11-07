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

async function setup(logo: boolean | 'plate' = true) {
  const brand = mktgPrintBrand(null);
  const logoOnDark = logo === 'plate' && brand.logoOnDark ? { ...brand.logoOnDark, plate: true } : brand.logoOnDark;
  const fixture = TestBed.createComponent(MktgPortraitBackCoverComponent);
  fixture.componentRef.setInput('look', mktgPortraitLook(brand));
  fixture.componentRef.setInput('book', BOOK);
  fixture.componentRef.setInput('page', 17);
  fixture.componentRef.setInput('logo', logo ? logoOnDark : null);
  fixture.componentRef.setInput('line', 'Open standards for agents');
  fixture.componentRef.setInput('url', 'synthetic.example');
  fixture.componentRef.setInput('version', 'V4.0 · November 2026');
  fixture.componentRef.setInput('notice', 'Copyright © The Linux Foundation and its contributors.');
  await fixture.whenStable();
  const page = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!page) throw new Error('Missing synthetic back cover');
  // A block host (MKTG_PORTRAIT_BLOCK_HOST): Chrome 156 breaks a sheet at the anonymous-block boundary an inline host puts around a frame.
  expect(getComputedStyle(fixture.nativeElement as HTMLElement).display).toBe('block');
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
    // The img sits in the plate span (bare here) inside the centred block.
    const lockup = logo?.closest<HTMLElement>('.pp-back-lockup');
    expect(lockup).not.toBeNull();
    expect(lockup?.style.top).toBe('420px');
    expect(lockup?.style.width).toBe('816px');
    const line = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-back-cover-line"]');
    expect(line?.textContent).toBe('Open standards for agents');
    expect(line?.classList.contains('pp-back-line')).toBe(true);
    expect(line?.parentElement?.style.top).toBe('560px');
    // Inside the frame's margins: a long line wraps within the 704 px, never 8 px from the edges.
    expect(line?.parentElement?.style.left).toBe('56px');
    expect(line?.parentElement?.style.width).toBe('704px');
    expect(page.querySelector('[data-testid="mktg-portrait-back-cover-url"]')?.textContent).toBe('synthetic.example');
    expect(page.querySelector('[data-testid="mktg-portrait-back-cover-version"]')?.textContent).toBe('V4.0 · November 2026');
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

  it('sets a full-colour lockup the kit cannot reverse on the white plate, padded by half its 72 px height (36 px); none for a reversed logo', async () => {
    const plain = await setup(true);
    expect(plain.page.querySelector('[data-testid="mktg-portrait-plate"]')).toBeNull();
    const plated = await setup('plate');
    const plate = plated.page.querySelector<HTMLElement>('[data-testid="mktg-portrait-plate"]');
    expect(plate?.classList.contains('pp-plate')).toBe(true);
    expect(plate?.style.padding).toBe('36px');
    // The plated block starts a padding higher (384): the lockup stays at y 420 and the plate (72 + 2 × 36) ends at 528,
    // 32 px above the brand line's block at 560; the bare layout keeps the block at 420.
    const lockupBlock = plate?.closest<HTMLElement>('.pp-back-lockup');
    expect(lockupBlock?.style.top).toBe('384px');
    expect(384 + 72 + 2 * 36).toBeLessThanOrEqual(560 - 24);
    expect(plain.page.querySelector<HTMLElement>('.pp-back-lockup')?.style.top).toBe('420px');
    expect(plate?.querySelector('[data-testid="mktg-portrait-back-cover-logo"]')).not.toBeNull();
  });
});
