// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { mktgPortraitLook, mktgPrintBrand } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPortraitCoverComponent } from './mktg-portrait-cover.component';

const BOOK: MktgPortraitBook = {
  inFamily: false,
  headRight: 'Synthetic project brand kit',
  footLeft: 'Synthetic project · a Linux Foundation project',
  firstPage: 1,
};

async function setup(logo = true) {
  const brand = mktgPrintBrand(null);
  const fixture = TestBed.createComponent(MktgPortraitCoverComponent);
  fixture.componentRef.setInput('look', mktgPortraitLook(brand));
  fixture.componentRef.setInput('book', BOOK);
  fixture.componentRef.setInput('title', 'Brand Kit');
  fixture.componentRef.setInput('lede', 'Open standards. Logos, color, type and usage on one reference.');
  fixture.componentRef.setInput('logo', logo ? brand.logoOnDark : null);
  fixture.componentRef.setInput('stripLeft', 'Synthetic project · a Linux Foundation project');
  fixture.componentRef.setInput('stripRight', 'synthetic.example · V4.0 · November 2026');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const page = root.querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!page) throw new Error('Missing synthetic cover');
  return { fixture, root, page, brand };
}

describe('lfx-mktg-portrait-cover', () => {
  it('is page 1, a bare dark frame on the grid ground, with the lockup at (72, 300), the title and lede at y 560 and the strip at y 984', async () => {
    const { page, brand } = await setup();
    expect(page.classList.contains('pp-page')).toBe(true);
    expect(page.classList.contains('pp-page--dark')).toBe(true);
    expect(page.getAttribute('data-page-id')).toBe('cover');
    expect(page.getAttribute('data-page')).toBe('1');
    expect(page.getAttribute('data-section')).toBe('Cover');
    expect(page.querySelector('[data-testid="mktg-portrait-page-head"]')).toBeNull();
    expect(page.querySelector('[data-testid="mktg-portrait-page-foot"]')).toBeNull();
    const ground = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-cover-ground"]');
    expect(ground?.classList.contains('pp-grid-ground')).toBe(true);
    expect(ground?.style.width).toBe('816px');
    expect(ground?.style.height).toBe('1056px');
    const logo = page.querySelector<HTMLImageElement>('[data-testid="mktg-portrait-cover-logo"]');
    expect(logo?.getAttribute('src')).toBe(brand.logoOnDark?.src);
    expect(logo?.getAttribute('alt')).toBe(brand.logoOnDark?.alt);
    expect(logo?.parentElement?.style.left).toBe('72px');
    expect(logo?.parentElement?.style.top).toBe('300px');
    const title = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-cover-title"]');
    expect(title?.textContent).toBe('Brand Kit');
    expect(title?.parentElement?.style.top).toBe('560px');
    expect(title?.parentElement?.style.width).toBe('672px');
    expect(page.querySelector('[data-testid="mktg-portrait-cover-lede"]')?.textContent).toBe('Open standards. Logos, color, type and usage on one reference.');
    const strip = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-cover-strip"]');
    expect(strip?.textContent).toContain('Synthetic project · a Linux Foundation project');
    expect(strip?.textContent).toContain('synthetic.example · V4.0 · November 2026');
    expect(strip?.parentElement?.style.top).toBe('984px');
  });

  it('draws nothing in the lockup’s place without a reversed logo', async () => {
    const { page } = await setup(false);
    expect(page.querySelector('[data-testid="mktg-portrait-cover-logo"]')).toBeNull();
    expect(page.querySelector('img')).toBeNull();
    expect(page.textContent).not.toContain('[');
  });
});
