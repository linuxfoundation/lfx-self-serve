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
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  return { kit, view, brand, fixture, root, print };
}

it('prints five native portrait chapters with branded heads, real SVG logo assets and no landscape plates', async () => {
  const { root, view, print } = await setup();
  expect(Array.from(root.querySelectorAll('h2')).map((heading) => heading.textContent?.trim())).toEqual([
    '02.1 Logo system',
    '02.2 Colour',
    '02.3 Typography',
    '02.4 Visual',
    '02.5 Voice in brief',
  ]);
  expect(root.querySelectorAll('.kit-chapter')).toHaveLength(5);
  const heads = root.querySelectorAll('[data-testid="mktg-print-running-head"]');
  expect(heads).toHaveLength(5);
  heads.forEach((head) => expect(head.textContent).toContain('02 Brand kit · Project One'));
  expect(root.textContent).not.toContain('V3.0');
  expect(root.querySelector('[data-testid="mktg-brand-kit-print"]')?.getAttribute('data-revision')).toBe('V3.0');
  expect(root.querySelectorAll('.kit-chapter > thead [data-testid="mktg-print-running-head"]')).toHaveLength(5);
  expect(root.querySelectorAll('lfx-mktg-print-chapter-header')).toHaveLength(5);
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

it('renders two-up aspect-ratio usage frames with ground, logo and current brand line', async () => {
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
  expect(root.querySelector('.kit-chapter > thead')?.textContent).toContain('Updated synthetic project');
  expect(root.querySelector('.kit-usage-frame')?.textContent).toContain('Updated approved line');
});
