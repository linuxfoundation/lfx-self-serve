// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { buildBrandKitBookView, mktgPrintBrand } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { MktgPrintService } from '@services/mktg-print.service';
import { expect, it, vi } from 'vitest';
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

it('prints five native portrait chapters with branded heads, real SVG logo assets and no landscape plates', async () => {
  const { root, view, print } = await setup();
  expect(Array.from(root.querySelectorAll('h2')).map((heading) => heading.textContent?.trim())).toEqual([
    '1 Logo system',
    '2 Colour',
    '3 Typography',
    '4 Visual',
    '5 Voice in brief',
  ]);
  expect(root.querySelectorAll('.kit-chapter')).toHaveLength(5);
  const heads = root.querySelectorAll('[data-testid="mktg-print-running-head"]');
  expect(heads).toHaveLength(5);
  heads.forEach((head) => {
    expect(head.textContent).toContain('Synthetic project Brand kit');
    expect(head.textContent).not.toContain('Project One');
    expect(head.textContent).not.toContain('02');
  });
  expect(root.textContent).not.toContain('V3.0');
  expect(root.querySelector('[data-testid="mktg-brand-kit-print"]')?.getAttribute('data-revision')).toBe('V3.0');
  expect(root.querySelectorAll('.kit-chapter > thead [data-testid="mktg-print-running-head"]')).toHaveLength(5);
  expect(root.querySelectorAll('lfx-mktg-print-chapter-header')).toHaveLength(5);
  root.querySelectorAll<HTMLElement>('lfx-mktg-print-chapter-header').forEach((header) => {
    expect(header.style.getPropertyValue('--mfp-chapter-accent')).toBe(view.accent);
  });
  expect(root.querySelector('[data-testid="kit-print-lockups"] img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  expect(root.querySelectorAll('.lfx-brand-kit-book, .lfx-brand-kit-page, canvas, iframe')).toHaveLength(0);
  expect(print.ensureFontStylesheet).toHaveBeenCalledWith(view.fontUrl);
});

it('renders all chapter data as text and keeps source type metrics beside portrait-sized specimens', async () => {
  const { root, kit, brand } = await setup();
  expect(root.textContent).toContain('Screen: 32 px · Print: 10 mm · Symbol: 16 px');
  for (const text of [kit.chapters.logo.clear_space, kit.chapters.logo.symbol, ...kit.chapters.logo.partnership, ...kit.chapters.logo.watchouts]) {
    expect(root.querySelector('[data-testid="kit-print-logo"]')?.textContent).toContain(text);
  }
  expect(root.querySelectorAll('[data-testid="kit-print-colorways"] tbody tr')).toHaveLength(kit.chapters.logo.colorways.length);
  expect(root.querySelectorAll('[data-testid="kit-print-colorways"] tbody img')).toHaveLength(kit.chapters.logo.colorways.length);
  expect(root.querySelector('[data-testid="kit-print-partnership"]')?.textContent).toContain('Partnership lockups');
  expect(root.querySelector('[data-testid="kit-print-watchouts"]')?.textContent).toContain('Watch-outs');
  kit.chapters.color.palette.forEach((entry) => expect(root.querySelector('[data-testid="kit-print-palette"]')?.textContent).toContain(entry.hex));
  expect(root.querySelector('[data-testid="kit-print-contrast"]')?.textContent).toContain('8.3:1');
  const specimens = root.querySelectorAll<HTMLElement>('.kit-specimen');
  expect(specimens).toHaveLength(kit.chapters.type.scale.length);
  expect(specimens[0].style.fontSize).toBe('32pt');
  expect(root.querySelector('[data-testid="kit-print-type"]')?.textContent).toContain('500 · 64/72 px');
  expect(root.querySelector<HTMLElement>('[data-testid="mktg-brand-kit-print"]')?.style.getPropertyValue('--mfp-font')).toBe(brand.fontStack);
  expect(root.querySelector('[data-testid="kit-print-visual"]')?.textContent).toContain(kit.chapters.visual.icons.recommended);
  expect(root.querySelectorAll('[data-testid="kit-print-usage"]')).toHaveLength(kit.chapters.usage.examples.length);
  expect(root.querySelector('[data-testid="kit-print-voice"]')?.textContent).toContain(kit.chapters.voice.umbrella);
  kit.chapters.voice.attributes.forEach((attribute) => expect(root.textContent).toContain(attribute.line));
});

it('compacts the logo chapter for Letter while keeping each tail block whole', async () => {
  const { root } = await setup();
  const partnership = root.querySelector<HTMLElement>('[data-testid="kit-print-partnership"]');
  const watchouts = root.querySelector<HTMLElement>('[data-testid="kit-print-watchouts"]');
  if (!partnership || !watchouts) throw new Error('Missing synthetic logo tail blocks');
  expect(partnership.tagName).toBe('TR');
  expect(watchouts.tagName).toBe('TR');
  expect(partnership.nextElementSibling).toBe(watchouts);
  for (const block of [partnership, watchouts]) {
    expect(getComputedStyle(block).breakInside).toBe('avoid');
    const list = block.querySelector('ul');
    if (!list) throw new Error('Missing synthetic tail list');
    expect(getComputedStyle(list).columnCount).toBe(block === watchouts ? '3' : '2');
  }
  const lockup = root.querySelector<HTMLElement>('[data-testid="kit-print-lockups"] .kit-logo');
  const colourway = root.querySelector<HTMLElement>('.kit-colourway img');
  const cell = root.querySelector<HTMLElement>('[data-testid="kit-print-logo"] > tbody > tr > td');
  if (!lockup || !colourway || !cell) throw new Error('Missing synthetic compact logo structure');
  for (const [image, mm] of [
    [lockup, 16],
    [colourway, 6],
  ] as const) {
    const value = getComputedStyle(image).maxHeight;
    const px = value.endsWith('mm') ? (Number.parseFloat(value) * 96) / 25.4 : Number.parseFloat(value);
    expect(px).toBeCloseTo((mm * 96) / 25.4, 3);
  }
  expect(Number.parseFloat(getComputedStyle(cell).paddingBottom)).toBeLessThan(10);
  expect(root.querySelector('.kit-rule-grid')).toBeNull();
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
  expect(root.querySelector('[data-testid="kit-print-lockups"]')).toBeNull();
  expect(root.querySelector('[data-testid="kit-print-colorways"]')).toBeNull();
  expect(root.querySelector('.kit-colourway')).toBeNull();
  expect(root.textContent).not.toContain('SVG supplied');
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
