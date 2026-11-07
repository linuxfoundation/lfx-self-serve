// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_PRINT_REVERSED_FILTER } from '@lfx-one/shared/constants';
import { MktgBrandKitPageLogoSystemComponent } from './mktg-brand-kit-page-logo-system.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Logo system page', () => {
  it('opens the Logo chapter with the band, the intro, the lockup hero, the tiles the kit has files for, and the files table without names', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageLogoSystemComponent, 'logo-system');
    expect(frame.getAttribute('data-page')).toBe('3');
    expect(frame.getAttribute('data-section')).toBe('01 Logo');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-intro"]')?.textContent).toBe('The logo system.');
    const hero = frame.querySelector('[data-testid="brand-kit-logo-system-hero"]');
    expect(rectOf(hero)).toEqual({ left: '56px', top: '232px', width: '704px' });
    expect(hero?.querySelector('img')?.getAttribute('src')).toBe(view.logos.primary?.src);
    expect(hero?.querySelector<HTMLElement>('img')?.style.height).toBe('84px');
    // The synthetic kit has a primary file only: no symbol tile (no symbol, no crop), the derived reversed tile, no stacked tile.
    const tiles = frame.querySelector('[data-testid="brand-kit-logo-system-tiles"]');
    expect(tiles?.querySelectorAll('.pp-tile')).toHaveLength(1);
    expect(tiles?.querySelector<HTMLElement>('.pp-tile--dark img')?.style.filter).toBe('brightness(0) invert(1)');
    expect(tiles?.textContent).toContain('Reversed · derived from the horizontal file');
    const rows = Array.from(frame.querySelectorAll('[data-testid="brand-kit-logo-system-files"] tbody tr'), (row) => wordsOf(row));
    expect(rows).toEqual([
      'Horizontal lockup SVG Full color Supplied',
      'Reversed (white) — White Not supplied: this book derives it from the horizontal file',
      'Symbol — Full color Not supplied',
      'Stacked lockup — Full color Not supplied',
    ]);
    expect(frame.textContent).not.toContain('logo.svg');
  });

  it('draws the symbol tiles and names a supplied file when the kit has them', async () => {
    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')}`;
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSystemComponent, 'logo-system', (view) => ({
      ...view,
      logos: { ...view.logos, symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: svg }, reversed: { ref: 'reversed.svg', name: 'reversed.svg', src: svg } },
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: svg },
    }));
    const tiles = frame.querySelector('[data-testid="brand-kit-logo-system-tiles"]');
    expect(tiles?.querySelectorAll('.pp-tile')).toHaveLength(3);
    expect(tiles?.textContent).toContain('Symbol · supplied file');
    expect(tiles?.textContent).toContain('Reversed · supplied file');
    expect(tiles?.textContent).toContain('Symbol on light tint · same file');
    expect(tiles?.querySelector<HTMLElement>('.pp-tile--dark img')?.style.filter).toBe('');
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-files"]')?.textContent).not.toContain('symbol.svg');
  });

  it('captions the tiles by what they draw: PNG reversed and symbol uploads beside an SVG lockup are listed, not drawn', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSystemComponent, 'logo-system', (view) => ({
      ...view,
      logos: {
        ...view.logos,
        symbol: { ref: 'project-one-symbol.png', name: 'project-one-symbol.png', src: null },
        reversed: { ref: 'project-one-reversed.png', name: 'project-one-reversed.png', src: null },
      },
      symbol: { ref: 'project-one-symbol.png', name: 'project-one-symbol.png', src: null },
    }));
    const tiles = frame.querySelector('[data-testid="brand-kit-logo-system-tiles"]');
    // The symbol PNG has no artwork to draw and nothing to crop: no symbol tile. The reversed tile whitens the lockup.
    expect(tiles?.querySelectorAll('.pp-tile')).toHaveLength(1);
    expect(tiles?.textContent).not.toContain('Symbol ·');
    expect(tiles?.textContent).toContain('Reversed · derived from the horizontal file');
    expect(tiles?.textContent).not.toContain('supplied file');
    expect(tiles?.querySelector<HTMLElement>('.pp-tile--dark img')?.style.filter).toBe(MKTG_PRINT_REVERSED_FILTER);
    // The files table lists the uploads as supplied, in their format, without a file name.
    const rows = Array.from(frame.querySelectorAll('[data-testid="brand-kit-logo-system-files"] tbody tr'), (row) => wordsOf(row));
    expect(rows).toContain('Reversed (white) PNG White Supplied');
    expect(rows).toContain('Symbol PNG Full color Supplied');
    expect(frame.textContent).not.toContain('project-one-');
  });

  it('prints one line for a kit with no logo files, under the intro, and no tile or table', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSystemComponent, 'logo-system', (view) => ({
      ...view,
      logos: { primary: null, stacked: null, symbol: null, reversed: null },
      symbol: null,
    }));
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-hero"]')).toBeNull();
    expect(frame.querySelectorAll('.pp-tile')).toHaveLength(0);
    expect(frame.querySelector('img')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-files"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-none"]')?.textContent).toBe('No logo files uploaded yet');
    expect(rectOf(frame.querySelector('[data-testid="brand-kit-logo-system-none"]'))).toEqual({ left: '56px', top: '232px', width: '704px' });
  });

  it('lists a PNG-only kit’s supplied files and says the book draws SVG only, never "no logo files uploaded yet"', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSystemComponent, 'logo-system', (view) => ({
      ...view,
      logos: {
        primary: { ref: 'project-one-lockup.png', name: 'project-one-lockup.png', src: null },
        stacked: null,
        symbol: { ref: 'project-one-symbol.png', name: 'project-one-symbol.png', src: null },
        reversed: null,
      },
      symbol: null,
    }));
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-hero"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-tiles"]')).toBeNull();
    expect(frame.querySelector('img')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-logo-system-none"]')).toBeNull();
    const line = frame.querySelector('[data-testid="brand-kit-logo-system-undrawable"]');
    expect(line?.textContent).toBe(
      'This book draws inline SVG artwork only. The supplied horizontal lockup (PNG) and symbol (PNG) are listed below and not drawn here.'
    );
    expect(rectOf(line)).toEqual({ left: '56px', top: '232px', width: '704px' });
    expect(frame.textContent).not.toContain('.png');
    const table = frame.querySelector('[data-testid="brand-kit-logo-system-files"]');
    expect(rectOf(table)).toEqual({ left: '56px', top: '300px', width: '704px' });
    const rows = Array.from(table?.querySelectorAll('tbody tr') ?? [], (row) => Array.from(row.querySelectorAll('td'), (td) => td.textContent));
    expect(rows.map((row) => [row[1], row[3]])).toEqual([
      ['PNG', 'Supplied'],
      ['—', 'Not supplied: this book derives it from the horizontal file'],
      ['PNG', 'Supplied'],
      ['—', 'Not supplied'],
    ]);
  });
});
