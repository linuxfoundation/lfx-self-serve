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
  const ending = root.querySelector('[data-testid="kit-print-ending-rules"]');
  expect(ending?.tagName).toBe('TR');
  expect(ending?.classList.contains('kit-block')).toBe(true);
  expect(ending?.textContent).toContain('Partnership lockups');
  expect(ending?.textContent).toContain('Watch-outs');
  kit.chapters.color.palette.forEach((entry) => expect(root.querySelector('[data-testid="kit-print-palette"]')?.textContent).toContain(entry.hex));
  expect(root.querySelector('[data-testid="kit-print-contrast"]')?.textContent).toContain('8.3:1');
  const contrast = root.querySelector('[data-testid="kit-print-contrast"]');
  if (!contrast) throw new Error('Missing synthetic contrast table');
  expect(getComputedStyle(contrast).breakInside).toBe('avoid');
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
    const padding = styles.paddingTop;
    const px = padding.endsWith('mm') ? (Number.parseFloat(padding) * 96) / 25.4 : Number.parseFloat(padding);
    expect(px).toBeCloseTo((mm * 96) / 25.4, 3);
    const logo = inner.querySelector('img');
    if (!logo) throw new Error('Missing synthetic usage logo');
    expect(getComputedStyle(logo).objectFit).toBe('contain');
    expect(getComputedStyle(logo).maxWidth).toBe('100%');
  });
});

it('keeps usage prose when a supplied kit has no examples', async () => {
  const { root, view, fixture } = await setup();
  fixture.componentRef.setInput('view', { ...view, usageTiles: [], usage: { ...view.usage, examples: [] } });
  await fixture.whenStable();
  expect(root.querySelector('[data-testid="kit-print-visual"]')?.textContent).toContain(view.usage.summary);
  expect(root.querySelector('[data-testid="kit-print-usage-pair"]')).toBeNull();
});
