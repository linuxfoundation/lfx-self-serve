// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_REVERSED_FILTER } from '@lfx-one/shared/constants';
import { MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { buildBrandKitBookView, mktgPrintBrand } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { MktgPrintService } from '@services/mktg-print.service';
import { describe, expect, it, vi } from 'vitest';
import { MktgBrandKitPrintComponent } from './mktg-brand-kit-print.component';

async function setup() {
  const kit = brandKitTestRevision();
  const view = buildBrandKitBookView(kit, 3);
  const brand = mktgPrintBrand(kit);
  const print = { ensureFontStylesheet: vi.fn() };
  TestBed.configureTestingModule({ providers: [{ provide: MktgPrintService, useValue: print }] });
  const fixture = TestBed.createComponent(MktgBrandKitPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('brand', brand);
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  return { kit, view, brand, fixture, root, print };
}

// The synthetic kit has no symbol file or crop, so its plan has no symbol page: sixteen frames.
const FRAMES = [
  'cover',
  'contents',
  'logo-system',
  'logo-colorways',
  'logo-clear-space',
  'logo-partnership',
  'logo-watchouts',
  'color-palette',
  'color-contrast',
  'type',
  'visual-iconography',
  'visual-imagery',
  'usage',
  'voice',
  'sources',
  'back-cover',
];
const SECTIONS = [
  'Cover',
  'Contents',
  '01 Logo',
  '01 Logo',
  '01 Logo',
  '01 Logo',
  '01 Logo',
  '02 Color',
  '02 Color',
  '03 Type',
  '04 Visual',
  '04 Visual',
  '05 Usage',
  '06 Voice',
  '07 Sources',
  'Back cover',
];

/** A colour as jsdom normalises it on an element's inline style. */
function colour(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

describe('the portrait book', () => {
  it('prints the planned frames in the mock’s order on the portrait root, each named for QA, and nothing else', async () => {
    const { root, view, print } = await setup();
    const book = root.querySelector<HTMLElement>('[data-testid="mktg-brand-kit-print"]');
    expect(book?.classList.contains('lfx-mktg-portrait')).toBe(true);
    expect(book?.getAttribute('data-revision')).toBe('V3.0');
    const frames = Array.from(book?.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]') ?? []);
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES);
    expect(frames.map((frame) => frame.getAttribute('data-page'))).toEqual(FRAMES.map((_, index) => String(index + 1)));
    expect(frames.map((frame) => frame.getAttribute('data-section'))).toEqual(SECTIONS);
    // The band on each chapter's first page only; the running head's right text is the document's name; the footer is the project line.
    const bands = frames.map((frame) => frame.querySelector('[data-testid="mktg-portrait-page-band"]') !== null);
    expect(FRAMES.filter((_, index) => bands[index])).toEqual(['logo-system', 'color-palette', 'type', 'visual-iconography', 'usage', 'voice', 'sources']);
    frames.slice(1, -1).forEach((frame) => {
      expect(frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project brand kit');
      expect(frame.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic project · a Linux Foundation project');
      // The version is on the cover and the back cover only; nothing is bracketed.
      expect(frame.textContent).not.toContain('V3.0');
      expect(frame.textContent).not.toMatch(/\[[^\]]+\]/);
    });
    frames.forEach((frame) => expect(frame.style.getPropertyValue('--pp-dark')).toBe(view.dark));
    // No head or footer on the cover and the back cover; no flowing chapter, no legacy plate.
    expect(frames[0].querySelector('[data-testid="mktg-portrait-page-head"]')).toBeNull();
    expect(frames[15].querySelector('[data-testid="mktg-portrait-page-foot"]')).toBeNull();
    expect(root.querySelectorAll('.kit-chapter, .lfx-brand-kit-book, .lfx-brand-kit-page, canvas, iframe')).toHaveLength(0);
    expect(root.querySelector('[data-testid="mktg-print-running-head"]')).toBeNull();
    expect(print.ensureFontStylesheet).toHaveBeenCalledWith(view.fontUrl);
  });

  it('opens on the cover with the version and date on the strip and closes on the back cover with the brand line, the host and the notice', async () => {
    const { root, view } = await setup();
    const frames = root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
    const cover = frames[0];
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-title"]')?.textContent).toBe('Brand Kit');
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-lede"]')?.textContent).toContain(
      'Open standards for one computing. Logos, color, type and usage'
    );
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-strip"]')?.textContent).toContain('one.example.org · V3.0 · October 2026');
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-logo"]')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    const back = frames[15];
    expect(back.classList.contains('pp-page--dark')).toBe(true);
    expect(back.querySelector('[data-testid="mktg-portrait-back-cover-logo"]')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(back.querySelector('[data-testid="mktg-portrait-back-cover-line"]')?.textContent).toBe(view.voice.line);
    expect(back.querySelector('[data-testid="mktg-portrait-back-cover-url"]')?.textContent).toBe('one.example.org');
    expect(back.querySelector('[data-testid="mktg-portrait-back-cover-notice"]')?.textContent).toBe(view.backCoverNotice);
    // The contents page lists the plan's pages, the Sources page at 15 and the back cover at 16.
    expect(frames[1].querySelectorAll('.kp-contents-row')).toHaveLength(14);
    expect(frames[1].querySelector('[data-testid="brand-kit-contents-approval"]')).toBeNull();
  });

  it('inside the family takes the book: no cover, contents or back cover, pages numbered from the book, the family’s head and foot, no band', async () => {
    const { root, fixture } = await setup();
    const book: MktgPortraitBook = { inFamily: true, headRight: 'Synthetic project positioning & brand', footLeft: 'Synthetic family foot', firstPage: 17 };
    fixture.componentRef.setInput('book', book);
    fixture.componentRef.setInput('number', '2');
    await fixture.whenStable();
    const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES.slice(2, -1));
    expect(frames.map((frame) => frame.getAttribute('data-page'))).toEqual(Array.from({ length: 13 }, (_, index) => String(17 + index)));
    expect(frames[0].getAttribute('data-section')).toBe('Brand kit · Logo');
    expect(frames[5].getAttribute('data-section')).toBe('Brand kit · Color');
    expect(frames[12].getAttribute('data-section')).toBe('Brand kit · Sources');
    frames.forEach((frame) => {
      expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
      expect(frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project positioning & brand');
      expect(frame.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic family foot');
    });
    expect(frames[0].querySelector('[data-testid="mktg-portrait-page-number"]')?.textContent).toBe('17');
    expect(root.querySelector('[data-testid="mktg-portrait-cover-title"]')).toBeNull();
    expect(root.querySelector('.pp-page--dark')).toBeNull();
  });

  it('with the family’s document number and no book yet, prints inside the family: no cover, the family’s name in the head', async () => {
    const { root, fixture } = await setup();
    fixture.componentRef.setInput('number', '2');
    await fixture.whenStable();
    const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES.slice(2, -1));
    expect(frames[0].getAttribute('data-page')).toBe('1');
    expect(frames[0].querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project positioning & brand');
    expect(root.textContent).not.toContain('V3.0');
  });

  it('prints the approval on the contents page and in the Sources page’s accepted box from the approval it is given', async () => {
    const { root, fixture } = await setup();
    expect(root.querySelector('[data-testid="brand-kit-sources-accepted"]')).toBeNull();
    fixture.componentRef.setInput('approval', { approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026 by Synthetic Approver');
    expect(root.querySelector('[data-testid="brand-kit-sources-accepted"]')?.textContent).toContain(
      'Accepted when V3.0 was approved. Approved 6 Nov 2026 by Synthetic Approver.'
    );
  });

  it('omits the logo slots a kit lacks: no empty tile, no apology, the Logo chapter one page saying no files were uploaded', async () => {
    const { root, view, brand, fixture } = await setup();
    fixture.componentRef.setInput('view', {
      ...view,
      logos: { primary: null, stacked: null, symbol: null, reversed: null },
      symbol: null,
      colorways: view.colorways.map((row) => ({ ...row, logo: null })),
    });
    fixture.componentRef.setInput('brand', { ...brand, logoOnDark: null, logoOnLight: null });
    await fixture.whenStable();
    const frames = Array.from(root.querySelectorAll('[data-testid="lfx-mktg-portrait-page"]'));
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES.filter((id) => !id.startsWith('logo-') || id === 'logo-system'));
    expect(root.querySelector('[data-testid="brand-kit-logo-system-none"]')?.textContent).toBe('No logo files uploaded yet');
    expect(root.querySelector('[data-testid="brand-kit-logo-system-files"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-portrait-cover-logo"]')).toBeNull();
    expect(root.querySelector('[data-testid="mktg-portrait-back-cover-logo"]')).toBeNull();
    expect(root.querySelector('[data-testid="lfx-mktg-portrait-page"] img')).toBeNull();
    expect(root.textContent).not.toContain('SVG supplied');
    expect(root.textContent).not.toMatch(/\[[^\]]+\]/);
  });

  it('inks the social card on the accent by the shared rule: the kit’s dark and the full-colour lockup when white fails AA there, white and the reversed lockup when it passes', async () => {
    const { root, brand, fixture } = await setup();
    const social = () => root.querySelector<HTMLElement>('.kp-usage-frame--social');
    // The fixture's orange accent reads 2.8:1 against white, as its own contrast table would grade it.
    expect(social()?.style.background).toBe(colour(brand.accent));
    expect(social()?.style.color).toBe(colour(brand.dark));
    expect(social()?.querySelector('img')?.style.filter).toBe('');
    // A dark accent that passes AA against white: white ink and the reversed lockup.
    fixture.componentRef.setInput('brand', { ...brand, accent: '#1F4E79' });
    await fixture.whenStable();
    expect(social()?.style.background).toBe(colour('#1F4E79'));
    expect(social()?.style.color).toBe(colour('white'));
    expect(social()?.querySelector('img')?.style.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
  });
});
