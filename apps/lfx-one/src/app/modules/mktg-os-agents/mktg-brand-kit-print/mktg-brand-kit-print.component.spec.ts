// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_BOOK_PAGES, BRAND_KIT_ICON_SAMPLES, MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { buildBrandKitBookView, mktgPrintBrand } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { MktgPrintService } from '@services/mktg-print.service';
import { describe, expect, it, vi } from 'vitest';
import { MktgBrandKitPrintComponent } from './mktg-brand-kit-print.component';

const CONTENT_TITLES = ['What’s inside', ...BRAND_KIT_BOOK_PAGES.filter((entry) => entry.id !== 'back-cover').map((entry) => entry.title)];

async function setup(inputs: Record<string, unknown> = {}) {
  const kit = brandKitTestRevision();
  const view = buildBrandKitBookView(kit, 3);
  const brand = mktgPrintBrand(kit);
  const print = { ensureFontStylesheet: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: MktgPrintService, useValue: print }] });
  const fixture = TestBed.createComponent(MktgBrandKitPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('brand', brand);
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  return { kit, view, brand, fixture, root, print };
}

function pageTitles(root: HTMLElement): (string | null)[] {
  return Array.from(root.querySelectorAll('[data-testid="kit-print-page"] [data-testid="mktg-print-page"]'), (page) => page.getAttribute('data-title'));
}

describe('MktgBrandKitPrintComponent', () => {
  it('prints the deck’s pages: the cover, the contents, the thirteen chapter pages in BRAND_KIT_BOOK_PAGES order and the back cover, every one a landscape page frame', async () => {
    const { root, view, print } = await setup();
    const wrapper = root.querySelector('[data-testid="mktg-brand-kit-print"]');
    expect(wrapper?.getAttribute('data-revision')).toBe('V3.0');
    expect(wrapper?.getAttribute('data-pages')).toBe('16');
    expect(root.querySelectorAll('[data-testid="kit-print-cover"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-testid="kit-print-back-cover"]')).toHaveLength(1);
    expect(pageTitles(root)).toEqual(CONTENT_TITLES);
    // Sixteen page frames, each a landscape page host (the cover and back-cover components carry the marker too, for the print frame).
    const frames = root.querySelectorAll('lfx-mktg-print-page');
    expect(frames).toHaveLength(16);
    expect(Array.from(frames).every((frame) => frame.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS))).toBe(true);
    expect(root.querySelectorAll('[data-testid="mktg-print-page"]')).toHaveLength(16);
    // Nothing of the portrait sheet: no tables, no running heads, no chapter headers.
    expect(root.querySelector('table, .kit-chapter, lfx-mktg-print-running-head, lfx-mktg-print-chapter-header')).toBeNull();
    // The kit's typeface is loaded through the service, as before.
    expect(print.ensureFontStylesheet).toHaveBeenCalledWith(view.fontUrl);
  });

  it('numbers the content pages from the cover (02 for the contents) and prints the footer line on each; no inner page shows the version', async () => {
    const { root } = await setup();
    const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="kit-print-page"]'));
    expect(pages.map((page) => page.getAttribute('data-page'))).toEqual(pages.map((_, index) => String(index + 2).padStart(2, '0')));
    for (const page of pages) {
      const footer = Array.from(page.querySelectorAll('[data-testid="mktg-print-page-footer"]'), (el) => el.textContent?.trim());
      expect(footer).toEqual(['Synthetic project · a Linux Foundation project', page.getAttribute('data-page')]);
      expect(page.textContent).not.toContain('V3.0');
    }
    const heads = Array.from(pages[1].querySelectorAll('[data-testid="mktg-print-page-head"]'), (el) => el.textContent?.trim());
    expect(heads).toEqual(['01 Logo', 'Synthetic project Brand Kit']);
    expect(pages[0].textContent).toContain('03   Logo system');
    // The contents list every book page, the back cover's row among them (kit-book.ts builds the rows over all of them).
    expect(pages[0].textContent).toContain('16   Back cover');
  });

  it('sets the cover as the deck does and the back cover with the brand line, the host and the notice, on the kit’s dark', async () => {
    const { root, view, brand } = await setup();
    const cover = root.querySelector<HTMLElement>('[data-testid="kit-print-cover"]');
    expect(cover?.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('cover');
    expect(cover?.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Brand Kit');
    expect(cover?.querySelector('[data-testid="mktg-print-page-subtitle"]')?.textContent?.trim()).toBe(
      'Open standards for one computing. Logos, color, type and usage on one reference, for members, partners and the press.'
    );
    expect(cover?.textContent).toContain('Synthetic project · A Linux Foundation project');
    expect(cover?.textContent).toContain('V3.0');
    expect(cover?.textContent).toContain('one.example.org · V3.0 · October 2026');
    expect(cover?.querySelector<HTMLElement>('[data-testid="mktg-print-page"]')?.style.getPropertyValue('--pp-dark')).toBe(brand.dark);
    // The deck's cover carries no logo (kit-book.ts coverSlide): none here either.
    expect(cover?.querySelector('img')).toBeNull();
    const back = root.querySelector<HTMLElement>('[data-testid="kit-print-back-cover"]');
    expect(back?.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-layout')).toBe('back');
    expect(back?.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe(view.voice.line);
    expect(back?.textContent).toContain(view.host);
    expect(back?.textContent).toContain(view.backCoverNotice);
  });

  it('fills the Iconography page’s slots with the shared icon samples in the kit’s colours: eight on the tiles, eight on the strip, the third highlighted', async () => {
    const { root, view } = await setup();
    const iconography = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="kit-print-page"]')).find((page) =>
      page.querySelector('[data-title="Iconography"]')
    );
    const icons = Array.from(iconography?.querySelectorAll<HTMLElement>('[data-testid="kit-print-icon"]') ?? []);
    expect(icons).toHaveLength(2 * BRAND_KIT_ICON_SAMPLES.length);
    expect(icons.map((icon) => icon.getAttribute('data-index'))).toEqual([...BRAND_KIT_ICON_SAMPLES.keys(), ...BRAND_KIT_ICON_SAMPLES.keys()].map(String));
    expect(icons.slice(0, 8).every((icon) => icon.style.color === cssColour(view.iconColours.tileInk))).toBe(true);
    expect(icons[8].style.color).toBe(cssColour('#FFFFFF'));
    expect(icons[10].style.color).toBe(cssColour(view.iconColours.highlight));
    // Each icon is the shared drawing: the first tile's icon has the Documents path.
    const svg = icons[0].querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
      BRAND_KIT_ICON_SAMPLES[0].shapes[0].kind === 'path' ? BRAND_KIT_ICON_SAMPLES[0].shapes[0].d : ''
    );
    expect(iconography?.textContent).toContain(BRAND_KIT_ICON_SAMPLES[0].label);
    expect(iconography?.textContent).toContain('Recommended set: Lucide');
  });

  it('inside a larger document, numbers from firstPage and drops its own back cover when told', async () => {
    const { root } = await setup({ firstPage: 5, backCover: false, number: '02' });
    expect(root.querySelectorAll('[data-testid="kit-print-back-cover"]')).toHaveLength(0);
    expect(root.querySelector('[data-testid="mktg-brand-kit-print"]')?.getAttribute('data-pages')).toBe('15');
    expect(root.querySelector('[data-testid="kit-print-page"]')?.getAttribute('data-page')).toBe('06');
    expect(root.querySelector('[data-testid="kit-print-page"]')?.textContent).toContain('07   Logo system');
    expect(root.querySelector('[data-testid="kit-print-page"]')?.textContent).not.toContain('Back cover');
    // The family's chapter number is accepted and not drawn: the deck's pages carry none.
    expect(root.textContent).not.toContain('02.');
  });
});

/** jsdom serialises a hex colour as `rgb(r, g, b)`. */
function cssColour(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
