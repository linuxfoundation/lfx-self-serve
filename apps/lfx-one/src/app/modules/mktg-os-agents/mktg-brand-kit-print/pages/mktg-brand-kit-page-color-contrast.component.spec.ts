// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageColorContrastComponent } from './mktg-brand-kit-page-color-contrast.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Color contrast page', () => {
  it('grades every pairing of the palette in the matrix from the hex values and repeats the kit’s own pairs under it', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageColorContrastComponent, 'color-contrast');
    expect(frame.getAttribute('data-page')).toBe('9');
    expect(frame.getAttribute('data-section')).toBe('02 Color');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-contrast-intro"]')?.textContent).toContain(view.color.contrast.rule);
    const matrix = frame.querySelector<HTMLTableElement>('[data-testid="brand-kit-contrast-matrix"]');
    expect(rectOf(matrix)).toEqual({ left: '56px', top: '220px', width: '704px' });
    // The matrix block keeps the mock's room above the pairs (390 px), so a four-colour matrix leaves them at y 610.
    // The matrix block keeps the room above the pairs' 24 px gap, so "The kit's pairs" sits at the mock's y 610.
    expect(matrix?.parentElement?.style.minHeight).toBe('366px');
    expect(Array.from(matrix?.querySelectorAll('thead th') ?? [], (th) => th.textContent)).toEqual(['', 'on Charcoal', 'on White', 'on Orange', 'on Mid gray']);
    const rows = Array.from(matrix?.querySelectorAll('tbody tr') ?? []);
    expect(rows).toHaveLength(4);
    expect(rows[0].querySelector('th')?.textContent).toBe('Charcoal text');
    // The same colour on itself is a blank cell; the others carry the computed ratio and its WCAG grade.
    expect(rows[0].querySelectorAll('.kp-matrix-same')).toHaveLength(1);
    const cells = Array.from(rows[0].querySelectorAll<HTMLElement>('.kp-matrix-cell'));
    expect(cells.map((cell) => cell.getAttribute('data-ratio'))).toEqual(['8.3', '2.9', '1.8']);
    expect(cells.map((cell) => cell.querySelector('.kp-pill')?.textContent)).toEqual(['AAA', 'Fails', 'Fails']);
    expect(cells[0].querySelector<HTMLElement>('.kp-matrix-aa')?.style.color).toBe('rgb(77, 78, 78)');
    const pairs = frame.querySelector<HTMLElement>('[data-testid="brand-kit-contrast-pairs"]');
    // The pairs follow the matrix block in flow inside the one placed block (no inline y): at 610 under four colours.
    expect(rectOf(pairs)).toEqual({ left: '56px', top: '220px', width: '704px' });
    expect(pairs?.style.top).toBe('');
    expect(pairs?.previousElementSibling).toBe(matrix?.parentElement);
    expect(frame.querySelector('[data-testid="brand-kit-contrast-pairs-more"]')).toBeNull();
    // The kit's own pairs print the kit's own ratio label and recorded grade, as the web view does.
    expect(wordsOf(pairs?.querySelector('.kp-pair') ?? null)).toBe('Aa Charcoal on White 8.3:1 AAA');
    expect(frame.textContent).not.toMatch(/\[[^\]]+\]/);
  });

  it('grades a six-colour palette in a six-row matrix, the pairs following it in flow, the pairs the footer cannot hold counted in a line', async () => {
    const extra = [
      {
        name: 'Teal',
        hex: '#0F766E',
        rgb: [15, 118, 110] as [number, number, number],
        role: 'Links',
        found_in: { kind: 'site_css' as const, source: 'https://one.example.org' },
      },
      {
        name: 'Sand',
        hex: '#F5E6D3',
        rgb: [245, 230, 211] as [number, number, number],
        role: 'Tint',
        found_in: { kind: 'brand_page' as const, source: 'https://one.example.org/brand' },
      },
    ];
    const { frame } = await mountBrandKitPage(MktgBrandKitPageColorContrastComponent, 'color-contrast', (view) => ({
      ...view,
      color: { ...view.color, palette: [...view.color.palette, ...extra] },
      contrast: Array.from({ length: 8 }, () => ({ ...view.contrast[0] })),
    }));
    const matrix = frame.querySelector<HTMLTableElement>('[data-testid="brand-kit-contrast-matrix"]');
    expect(matrix?.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(matrix?.querySelectorAll('.kp-matrix-cell')).toHaveLength(30);
    // The matrix (18 + 6 × 86 = 534 px by the model) runs past the mock's pairs line; the pairs follow it in flow and
    // the room left to y 990 (990 − 754 − 20 = 216) holds three of the eight pairs with the line.
    const pairs = frame.querySelector('[data-testid="brand-kit-contrast-pairs"]');
    expect(pairs?.querySelectorAll('.kp-pair')).toHaveLength(3);
    expect(frame.querySelector('[data-testid="brand-kit-contrast-pairs-more"]')?.textContent).toBe('+5 more pairs, in LFX One');
  });

  it('leaves the pairs out when the kit recorded none', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageColorContrastComponent, 'color-contrast', (view) => ({ ...view, contrast: [] }));
    expect(frame.querySelector('[data-testid="brand-kit-contrast-pairs"]')).toBeNull();
    expect(frame.querySelectorAll('.kp-matrix-cell')).toHaveLength(12);
  });
});
