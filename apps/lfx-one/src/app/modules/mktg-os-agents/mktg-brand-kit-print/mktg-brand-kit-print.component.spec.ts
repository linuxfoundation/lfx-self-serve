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

const FRAMES_B1 = [
  'cover',
  'contents',
  'logo-system',
  'logo-colorways',
  'logo-clear-space',
  'logo-symbol',
  'logo-partnership',
  'logo-watchouts',
  'color-palette',
];

describe('the portrait book', () => {
  it('prints the planned frames in the mock’s order on the portrait root, each named for QA, then the chapters still flowing', async () => {
    const { root, view, print } = await setup();
    const book = root.querySelector<HTMLElement>('[data-testid="mktg-brand-kit-print"]');
    expect(book?.classList.contains('lfx-mktg-portrait')).toBe(true);
    expect(book?.getAttribute('data-revision')).toBe('V3.0');
    const frames = Array.from(book?.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]') ?? []);
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES_B1);
    expect(frames.map((frame) => frame.getAttribute('data-page'))).toEqual(FRAMES_B1.map((_, index) => String(index + 1)));
    expect(frames.map((frame) => frame.getAttribute('data-section'))).toEqual([
      'Cover',
      'Contents',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '02 Color',
    ]);
    // The band on each chapter's first page; the running head's right text is the document's name only; the footer is the project line.
    expect(frames.map((frame) => frame.querySelector('[data-testid="mktg-portrait-page-band"]') !== null)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
    frames.slice(1).forEach((frame) => {
      expect(frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project brand kit');
      expect(frame.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic project · a Linux Foundation project');
      expect(frame.textContent).not.toContain('V3.0');
    });
    frames.forEach((frame) => expect(frame.style.getPropertyValue('--pp-dark')).toBe(view.dark));
    // The cover: the version and date on the strip, the brand line in the lede, the reversed lockup.
    const cover = frames[0];
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-title"]')?.textContent).toBe('Brand Kit');
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-lede"]')?.textContent).toContain(
      'Open standards for one computing. Logos, color, type and usage'
    );
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-strip"]')?.textContent).toContain('one.example.org · V3.0 · October 2026');
    expect(cover.querySelector('[data-testid="mktg-portrait-cover-logo"]')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    // The contents page lists the plan's pages, the Sources page at 15 and the back cover at 16.
    expect(frames[1].querySelectorAll('.kp-contents-row')).toHaveLength(14);
    expect(frames[1].querySelector('[data-testid="brand-kit-contents-approval"]')).toBeNull();
    // The chapters not yet on the grammar still flow after the frames, with their running heads.
    const chapters = root.querySelector('[data-testid="mktg-brand-kit-print-chapters"]');
    expect(Array.from(chapters?.querySelectorAll('h2') ?? []).map((heading) => heading.textContent?.trim())).toEqual([
      '2 Colour contrast',
      '3 Typography',
      '4 Visual',
      '5 Voice in brief',
    ]);
    expect(chapters?.querySelectorAll('.kit-chapter > tfoot')).toHaveLength(0);
    expect(root.querySelectorAll('.lfx-brand-kit-book, .lfx-brand-kit-page, canvas, iframe')).toHaveLength(0);
    expect(print.ensureFontStylesheet).toHaveBeenCalledWith(view.fontUrl);
  });

  it('inside the family takes the book: no cover, contents or back cover, pages numbered from the book, the family’s head and foot, no band', async () => {
    const { root, fixture } = await setup();
    const book: MktgPortraitBook = { inFamily: true, headRight: 'Synthetic project positioning & brand', footLeft: 'Synthetic family foot', firstPage: 17 };
    fixture.componentRef.setInput('book', book);
    fixture.componentRef.setInput('number', '2');
    await fixture.whenStable();
    const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES_B1.slice(2));
    expect(frames.map((frame) => frame.getAttribute('data-page'))).toEqual(['17', '18', '19', '20', '21', '22']);
    expect(frames[0].getAttribute('data-section')).toBe('Brand kit · Logo');
    expect(frames[5].getAttribute('data-section')).toBe('Brand kit · Color');
    frames.forEach((frame) => {
      expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
      expect(frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project positioning & brand');
      expect(frame.querySelector('[data-testid="mktg-portrait-page-foot"]')?.textContent).toContain('Synthetic family foot');
    });
    expect(frames[0].querySelector('[data-testid="mktg-portrait-page-number"]')?.textContent).toBe('17');
    expect(root.querySelector('[data-testid="mktg-portrait-cover-title"]')).toBeNull();
    // The flowing remainder keeps the family's document prefix.
    expect(root.querySelector('[data-testid="mktg-brand-kit-print-chapters"] h2')?.textContent?.trim()).toBe('2.2 Colour contrast');
  });

  it('with the family’s document number and no book yet, prints inside the family: no cover, the family’s name in the head', async () => {
    const { root, fixture } = await setup();
    fixture.componentRef.setInput('number', '2');
    await fixture.whenStable();
    const frames = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
    expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(FRAMES_B1.slice(2));
    expect(frames[0].getAttribute('data-page')).toBe('1');
    expect(frames[0].querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent).toBe('Synthetic project positioning & brand');
    expect(root.textContent).not.toContain('V3.0');
  });

  it('prints the approval line on the contents page from the approval it is given', async () => {
    const { root, fixture } = await setup();
    fixture.componentRef.setInput('approval', { approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } });
    await fixture.whenStable();
    expect(root.querySelector('[data-testid="brand-kit-contents-approval"]')?.textContent).toBe('Approved 6 Nov 2026 by Synthetic Approver');
  });
});

it('renders the flowing chapters’ data as text and keeps source type metrics beside portrait-sized specimens', async () => {
  const { root, kit, brand } = await setup();
  expect(root.querySelector('[data-testid="kit-print-contrast"]')?.textContent).toContain('8.3:1');
  const specimens = root.querySelectorAll<HTMLElement>('.kit-specimen');
  expect(specimens).toHaveLength(kit.chapters.type.scale.length);
  expect(specimens[0].style.fontSize).toBe('32pt');
  expect(root.querySelector('[data-testid="kit-print-type"]')?.textContent).toContain('500 · 64/72 px');
  expect(root.querySelector<HTMLElement>('[data-testid="mktg-brand-kit-print-chapters"]')?.style.getPropertyValue('--mfp-font')).toBe(brand.fontStack);
  expect(root.querySelector('[data-testid="kit-print-visual"]')?.textContent).toContain(kit.chapters.visual.icons.recommended);
  // The board's print layout for Iconography, on the Visual chapter's first page by itself: the block ends its page
  // (break-after, never break-before, which would leave a page holding only the title); under the title, the rules
  // across the sheet, then the sample icons (the print variant, the kit's colours) across the full content width.
  const iconBlock = root.querySelector<HTMLElement>('[data-testid="kit-print-visual"] [data-testid="kit-print-icon-block"]');
  if (!iconBlock) throw new Error('Missing synthetic icon block');
  expect(iconBlock.tagName).toBe('TR');
  expect(iconBlock.classList.contains('kit-block')).toBe(true);
  expect(getComputedStyle(iconBlock).breakAfter).toBe('page');
  expect(getComputedStyle(iconBlock).breakBefore).not.toBe('page');
  expect(getComputedStyle(iconBlock).breakInside).toBe('avoid');
  const rulesBlock = iconBlock.querySelector<HTMLElement>('[data-testid="kit-print-icon-rules"]');
  const samplesBlock = iconBlock.querySelector<HTMLElement>('[data-testid="kit-print-icon-samples"]');
  if (!rulesBlock || !samplesBlock) throw new Error('Missing synthetic icon rules or samples block');
  expect(rulesBlock.previousElementSibling?.tagName).toBe('H3');
  expect(rulesBlock.nextElementSibling).toBe(samplesBlock);
  expect(iconBlock.querySelector('.kit-icon-row')).toBeNull();
  for (const block of [rulesBlock, samplesBlock]) {
    expect(getComputedStyle(block).display).toBe('block');
    // Full content width: the e2e spec measures it in the browser; here the scss sets it.
    expect(getComputedStyle(block).width).not.toBe('auto');
  }
  expect(Array.from(rulesBlock.querySelectorAll('li'), (li) => li.textContent)).toEqual(kit.chapters.visual.icons.rules);
  const samples = samplesBlock.querySelector<HTMLElement>('.kit-icon-samples');
  if (!samples) throw new Error('Missing synthetic icon samples');
  expect(samples.getAttribute('data-testid')).toBe('brand-kit-icon-samples');
  expect(samples.classList.contains('block')).toBe(true);
  expect(getComputedStyle(samples).display).toBe('block');
  expect(getComputedStyle(samples).breakInside).toBe('avoid');
  expect(samples.querySelectorAll('[data-testid^="brand-kit-icon-tile-"]')).toHaveLength(8);
  // The board's sizes in table boxes: a 2 × 4 table of 110 px tiles (32 px icons, 11 px labels), a 110 px strip of eight cells (30 px icons).
  // These boxes are Tailwind utilities, which the unit environment does not load (only the component's scss), so they are
  // asserted by class; the e2e spec measures them in the browser.
  const tiles = samples.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tiles"]');
  expect(tiles?.classList.contains('table')).toBe(true);
  expect(tiles?.querySelectorAll(':scope > .table-row')).toHaveLength(2);
  expect(tiles?.querySelectorAll(':scope > .table-row > .table-cell')).toHaveLength(8);
  const tile = samples.querySelector<HTMLElement>('[data-testid="brand-kit-icon-tile-documents"]');
  expect(tile?.classList.contains('table')).toBe(true);
  expect(tile?.classList.contains('h-[110px]')).toBe(true);
  expect(tile?.querySelector('svg')?.getAttribute('width')).toBe('32');
  expect(tile?.querySelector('span')?.classList.contains('text-[11px]')).toBe(true);
  const strip = samples.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]');
  expect(strip?.classList.contains('table')).toBe(true);
  expect(strip?.classList.contains('h-[110px]')).toBe(true);
  expect(strip?.classList.contains('px-[30px]')).toBe(true);
  expect(strip?.querySelectorAll(':scope > .table-row > .table-cell')).toHaveLength(8);
  expect(strip?.querySelector('svg')?.getAttribute('width')).toBe('30');
  expect(samples.querySelector<HTMLElement>('[data-highlight="true"]')?.getAttribute('data-testid')).toBe('brand-kit-icon-strip-global');
  // No grid or flex box in the samples: inside the paginated table they fragment their contents away from their boxes.
  expect(samples.querySelectorAll('.grid, .flex, .inline-flex, .flex-wrap')).toHaveLength(0);
  const probe = document.createElement('span');
  probe.style.color = kit.kit.dark;
  expect(samples.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]')?.style.backgroundColor).toBe(probe.style.color);
  expect(root.querySelectorAll('[data-testid="kit-print-usage"]')).toHaveLength(kit.chapters.usage.examples.length);
  expect(root.querySelector('[data-testid="kit-print-voice"]')?.textContent).toContain(kit.chapters.voice.umbrella);
  kit.chapters.voice.attributes.forEach((attribute) => expect(root.textContent).toContain(attribute.line));
});

it('keeps up to twelve contrast rows whole and longer fragments in groups of at least three', async () => {
  const { root, view, fixture } = await setup();
  const row = view.contrast[0];
  if (!row) throw new Error('Missing synthetic contrast row');
  fixture.componentRef.setInput('view', {
    ...view,
    contrast: Array.from({ length: 11 }, (_, index) => ({ ...row, foreground: `Synthetic foreground ${index}` })),
  });
  await fixture.whenStable();
  const table = root.querySelector<HTMLElement>('[data-testid="kit-print-contrast"]');
  const block = root.querySelector<HTMLElement>('.kit-contrast-block');
  const intro = root.querySelector<HTMLElement>('.kit-contrast-intro');
  const header = table?.querySelector('thead');
  if (!table || !block || !intro || !header) throw new Error('Missing synthetic contrast pagination structure');
  expect(block.closest('[data-testid="kit-print-colour"]')).not.toBeNull();
  expect(getComputedStyle(block).breakInside).toBe('avoid');
  expect(getComputedStyle(table).breakInside).toBe('avoid');
  expect(getComputedStyle(block).breakBefore).toBe('auto');
  expect(getComputedStyle(intro).breakAfter).toBe('avoid');
  expect(getComputedStyle(header).display).toBe('table-header-group');
  expect(getComputedStyle(header).breakAfter).toBe('avoid');
  expect(table.querySelectorAll(':scope > tbody > tr')).toHaveLength(11);
  table.querySelectorAll(':scope > tbody > tr').forEach((row) => expect(getComputedStyle(row).breakInside).toBe('avoid'));
  for (const count of [10, 12, 13, 14, 15, 16, 17]) {
    fixture.componentRef.setInput('view', {
      ...view,
      contrast: Array.from({ length: count }, (_, index) => ({ ...row, foreground: `Synthetic foreground ${index}` })),
    });
    await fixture.whenStable();
    expect(getComputedStyle(block).breakInside).toBe(count <= 12 ? 'avoid' : 'auto');
    expect(getComputedStyle(table).breakInside).toBe(count <= 12 ? 'avoid' : 'auto');
    expect(table.querySelectorAll(':scope > tbody > tr')).toHaveLength(count);
    for (const group of table.querySelectorAll(':scope > tbody')) {
      expect(getComputedStyle(group).breakInside).toBe('avoid');
      expect(group.children.length).toBeGreaterThanOrEqual(3);
      if (count > 12) expect(group.children.length).toBeLessThanOrEqual(5);
    }
  }
});

it('prints materially repeated typography descriptions once while preserving a distinct font note', async () => {
  const { root, view, fixture } = await setup();
  const summary = 'Instrument Sans is the typeface example.org sets on headings, body and buttons (self-hosted via next/font).';
  const descriptionParagraphs = () =>
    Array.from(root.querySelectorAll('[data-testid="kit-print-type"] p')).map((p) => p.textContent?.replace(/\s+/g, ' ').trim());
  for (const note of [
    summary,
    ' INSTRUMENT SANS is the typeface example.org sets on headings,\nbody and buttons — self hosted via next font! ',
    `${summary} The site uses the supplied font files.`,
    summary.slice(0, -1),
    summary.replace('via next/font', 'using bundled files'),
    'Instrument Sans is the typeface example.org sets on headings, body and buttons (self-hosted via next/font); sourced from the site CSS.',
  ]) {
    fixture.componentRef.setInput('view', { ...view, type: { ...view.type, summary, note } });
    await fixture.whenStable();
    expect(descriptionParagraphs().filter((text) => text?.startsWith('Instrument Sans') || text?.startsWith('INSTRUMENT SANS'))).toEqual([summary]);
  }
  // Containment must work in either direction, without treating an empty intro as a match.
  fixture.componentRef.setInput('view', { ...view, type: { ...view.type, summary: `${summary} Extra source detail.`, note: summary } });
  await fixture.whenStable();
  expect(descriptionParagraphs()).not.toContain(summary);
  const distinct = 'Instrument Sans: use the supplied fallback stack for documents without embedded fonts.';
  for (const intro of [summary, '']) {
    fixture.componentRef.setInput('view', { ...view, type: { ...view.type, summary: intro, note: distinct } });
    await fixture.whenStable();
    expect(descriptionParagraphs()).toContain(distinct);
  }
});

it('replaces stylesheet asset URLs with a human host source and retains supplied human source labels', async () => {
  const { root, view, fixture } = await setup();
  fixture.componentRef.setInput('view', { ...view, type: { ...view.type, source: 'https://style.example.org/_next/static/chunks/font-abcd.css?v=1' } });
  await fixture.whenStable();
  const type = root.querySelector('[data-testid="kit-print-type"]');
  expect(type?.textContent).toContain('Source: style.example.org site CSS');
  expect(type?.textContent).not.toContain('https://');
  expect(type?.textContent).not.toContain('_next');
  fixture.componentRef.setInput('view', { ...view, type: { ...view.type, source: 'Project design team' } });
  await fixture.whenStable();
  expect(type?.textContent).toContain('Source: Project design team');
});

it('labels umbrella message and brand line and separates the small framework-source note', async () => {
  const { root, view } = await setup();
  const voice = root.querySelector('[data-testid="kit-print-voice"]');
  const eyebrows = voice?.querySelectorAll<HTMLElement>('.kit-eyebrow');
  expect(Array.from(eyebrows ?? []).map((p) => p.textContent)).toEqual(['Umbrella message', 'Brand line']);
  eyebrows?.forEach((p) => expect(getComputedStyle(p).textTransform).toBe('uppercase'));
  expect(voice?.querySelector('h3')?.textContent).toBe(view.voice.umbrella);
  expect(voice?.querySelector('.kit-eyebrow:nth-of-type(2)')?.nextElementSibling?.textContent).toBe(view.voice.line);
  expect(voice?.querySelector('.kit-voice-source')?.textContent).toBe('From the messaging framework');
  expect(voice?.textContent).toContain(view.voice.note);
});

it('omits missing logo slots and colourway samples without empty boxes or apology text', async () => {
  const { root, view, brand, fixture } = await setup();
  fixture.componentRef.setInput('view', {
    ...view,
    logos: { primary: null, stacked: null, symbol: null, reversed: null },
    symbol: null,
    colorways: view.colorways.map((row) => ({ ...row, logo: null })),
  });
  fixture.componentRef.setInput('brand', { ...brand, logoOnDark: null, logoOnLight: null });
  await fixture.whenStable();
  // A kit without logo files keeps the Logo chapter's first page only: cover, contents, Logo system, palette.
  const frames = Array.from(root.querySelectorAll('[data-testid="lfx-mktg-portrait-page"]'));
  expect(frames.map((frame) => frame.getAttribute('data-page-id'))).toEqual(['cover', 'contents', 'logo-system', 'color-palette']);
  expect(root.querySelector('[data-testid="brand-kit-logo-system-none"]')?.textContent).toBe('No logo files uploaded yet');
  expect(root.querySelector('[data-testid="brand-kit-logo-system-files"]')).toBeNull();
  expect(root.querySelector('[data-testid="lfx-mktg-portrait-page"] img')).toBeNull();
  expect(root.querySelector('[data-testid="brand-kit-logo-system-hero"]')).toBeNull();
  expect(root.querySelectorAll('[data-testid="brand-kit-colorways-tiles"] > div')).toHaveLength(0);
  expect(root.querySelector('[data-testid="mktg-portrait-cover-logo"]')).toBeNull();
  expect(root.textContent).not.toContain('SVG supplied');
  expect(root.textContent).not.toContain('[');
});

it('renders two-up usage samples with ground, logo and the current server-supplied brand line', async () => {
  const { root, view, brand, fixture } = await setup();
  expect(root.querySelectorAll('.kit-usage-grid')).toHaveLength(2);
  const frames = root.querySelectorAll<HTMLElement>('.kit-usage-frame');
  expect(frames).toHaveLength(4);
  frames.forEach((frame) => {
    expect(frame.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(frame.textContent).toContain(view.voice.line);
  });
  const expected = document.createElement('span');
  expected.style.backgroundColor = brand.dark;
  expect(frames[0].style.backgroundColor).toBe(expected.style.backgroundColor);
  expect(frames[2].getAttribute('data-layout')).toBe('report');
  expect(frames[2].style.backgroundColor).toBe('white');
  fixture.componentRef.setInput('view', { ...view, projectName: 'Updated synthetic project', voice: { ...view.voice, line: 'Updated approved line' } });
  await fixture.whenStable();
  expect(root.querySelector('.kit-chapter > thead')?.textContent).toContain('Synthetic project Brand kit');
  expect(root.querySelector('.kit-chapter > thead')?.textContent).not.toContain('Updated synthetic project');
  expect(root.querySelector('.kit-usage-frame')?.textContent).toContain('Updated approved line');
  fixture.componentRef.setInput('projectName', 'Updated project context');
  await fixture.whenStable();
  expect(root.querySelector('.kit-chapter > thead')?.textContent).toContain('Updated project context Brand kit');
});

it('inks a sample on the accent as the deck does: the kit’s dark and the full-colour lockup when white fails AA there, white and the reversed lockup when it passes', async () => {
  const { root, kit, view, brand, fixture } = await setup();
  const examples = kit.chapters.usage.examples.map((example, index) => (index === 1 ? { ...example, ground: 'accent' } : example));
  fixture.componentRef.setInput('view', { ...view, usage: { ...view.usage, examples } });
  await fixture.whenStable();
  const social = root.querySelectorAll<HTMLElement>('.kit-usage-frame')[1];
  const colour = (value: string): string => {
    const probe = document.createElement('span');
    probe.style.color = value;
    return probe.style.color;
  };
  // The fixture's orange accent reads 2.7:1 against white, as its own contrast table would grade it.
  expect(social.getAttribute('data-layout')).toBe('social');
  expect(social.style.backgroundColor).toBe(colour(brand.accent));
  expect(social.style.color).toBe(colour(brand.dark));
  expect(social.style.color).not.toBe(colour('white'));
  // The fixture supplies no reversed artwork, so the reversed lockup is the primary one filtered white; the full-colour one is unfiltered.
  expect(brand.logoOnDark?.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
  expect(social.querySelector('img')?.style.filter).toBe('');
  // A dark accent that passes AA against white: white ink and the reversed lockup.
  fixture.componentRef.setInput('brand', { ...brand, accent: '#1F4E79' });
  await fixture.whenStable();
  expect(social.style.backgroundColor).toBe(colour('#1F4E79'));
  expect(social.style.color).toBe(colour('white'));
  expect(social.querySelector('img')?.style.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
  // The samples on the dark and on white are inked as before.
  const frames = root.querySelectorAll<HTMLElement>('.kit-usage-frame');
  expect(frames[0].style.color).toBe(colour('white'));
  expect(frames[2].style.color).toBe(colour(brand.ink));
});

it('keeps captioned pairs indivisible with explicit frame heights and the intro inside the first pair', async () => {
  const { root } = await setup();
  const pairs = root.querySelectorAll<HTMLElement>('[data-testid="kit-print-usage-pair"]');
  expect(pairs).toHaveLength(2);
  expect(pairs[0].querySelector('.kit-usage-intro')?.textContent).toContain('Graphic elements and usage');
  expect(pairs[1].querySelector('.kit-usage-intro')).toBeNull();
  pairs.forEach((pair) => {
    expect(pair.closest('tr')?.classList.contains('kit-usage-pair-row')).toBe(true);
    expect(getComputedStyle(pair).breakInside).toBe('avoid');
    expect(getComputedStyle(pair).breakBefore).toBe('auto');
    expect(pair.querySelectorAll('figcaption')).toHaveLength(2);
    pair.querySelectorAll<HTMLElement>('.kit-usage-frame').forEach((frame) => {
      const styles = getComputedStyle(frame);
      const millimetres = frame.getAttribute('data-layout') === 'report' ? 44 : 36;
      const expectedPixels = (millimetres * 96) / 25.4;
      // Computed CSS resolves physical units to px; normalize either valid form.
      for (const value of [styles.height, styles.minHeight, styles.maxHeight]) {
        expect(value).toMatch(/(?:mm|px)$/);
        const pixels = value.endsWith('mm') ? (Number.parseFloat(value) * 96) / 25.4 : Number.parseFloat(value);
        expect(pixels).toBeCloseTo(expectedPixels, 3);
      }
      expect(styles.aspectRatio).not.toContain('/');
    });
  });
});

it('contains logos and brand lines inside padded frame boxes without clipping at the edge', async () => {
  const { root } = await setup();
  root.querySelectorAll<HTMLElement>('.kit-usage-frame').forEach((frame) => {
    const inner = frame.querySelector<HTMLElement>('.kit-usage-inner');
    if (!inner) throw new Error('Missing synthetic padded usage box');
    expect(inner.querySelector('img')).not.toBeNull();
    expect(inner.querySelector('p')).not.toBeNull();
    const styles = getComputedStyle(inner);
    const mm = frame.getAttribute('data-layout') === 'report' ? 3 : 2.5;
    expect(getComputedStyle(frame).position).toBe('relative');
    expect(getComputedStyle(frame).overflow).toBe('hidden');
    expect(getComputedStyle(frame).breakInside).toBe('avoid');
    expect(styles.position).toBe('absolute');
    const inset = styles.inset;
    const px = inset.endsWith('mm') ? (Number.parseFloat(inset) * 96) / 25.4 : Number.parseFloat(inset);
    expect(px).toBeCloseTo((mm * 96) / 25.4, 3);
    const logo = inner.querySelector('img');
    if (!logo) throw new Error('Missing synthetic usage logo');
    expect(getComputedStyle(logo).objectFit).toBe('contain');
    expect(getComputedStyle(logo).maxWidth).toBe('100%');
    inner.querySelectorAll('img, p').forEach((child) => {
      expect(getComputedStyle(child).position).toBe('absolute');
      expect(child.closest('.kit-usage-frame')).toBe(frame);
    });
  });
});

it('keeps usage prose when a supplied kit has no examples', async () => {
  const { root, view, fixture } = await setup();
  fixture.componentRef.setInput('view', { ...view, usageTiles: [], usage: { ...view.usage, examples: [] } });
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="kit-print-visual"]')?.textContent).toContain(view.usage.summary);
  expect(root.querySelector('[data-testid="kit-print-usage-pair"]')).toBeNull();
});
