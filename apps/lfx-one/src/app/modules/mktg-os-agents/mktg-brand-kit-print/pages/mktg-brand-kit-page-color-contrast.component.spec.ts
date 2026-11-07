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
    const pairs = frame.querySelector('[data-testid="brand-kit-contrast-pairs"]');
    expect(rectOf(pairs)).toEqual({ left: '56px', top: '610px', width: '704px' });
    // The kit's own pairs print the kit's own ratio label and recorded grade, as the web view does.
    expect(wordsOf(pairs?.querySelector('.kp-pair') ?? null)).toBe('Aa Charcoal on White 8.3:1 AAA');
    expect(frame.textContent).not.toMatch(/\[[^\]]+\]/);
  });

  it('leaves the pairs out when the kit recorded none', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageColorContrastComponent, 'color-contrast', (view) => ({ ...view, contrast: [] }));
    expect(frame.querySelector('[data-testid="brand-kit-contrast-pairs"]')).toBeNull();
    expect(frame.querySelectorAll('.kp-matrix-cell')).toHaveLength(12);
  });
});
