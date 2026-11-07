// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageLogoSymbolComponent } from './mktg-brand-kit-page-logo-symbol.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

const SVG = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')}`;

describe('the Symbol & symbol in shape page', () => {
  it('draws the variants, the four shapes and the padding rule from a kit with a symbol; white on the orange fails AA, so the figure prints', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSymbolComponent, 'logo-symbol', (view) => ({
      ...view,
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG },
    }));
    expect(frame.getAttribute('data-page')).toBe('6');
    expect(frame.querySelector('[data-testid="brand-kit-symbol-intro"]')?.textContent).toBe('The symbol.');
    const variants = frame.querySelector('[data-testid="brand-kit-symbol-variants"]');
    expect(rectOf(variants)).toEqual({ left: '56px', top: '250px', width: '704px' });
    // The symbol comes from a three-colour kit, which no filter may derive from: the full-colour variant draws it, and
    // the reversed and one-colour tiles say "Not supplied" rather than draw a full-colour symbol under a false label.
    expect(Array.from(variants?.querySelectorAll('img') ?? [], (img) => img.style.filter)).toEqual(['']);
    expect(Array.from(variants?.querySelectorAll('[data-testid="brand-kit-symbol-variant-missing"]') ?? [], (tile) => tile.textContent)).toEqual([
      'Not supplied',
      'Not supplied',
    ]);
    expect(Array.from(variants?.querySelectorAll('.pp-cap') ?? [], (cap) => cap.textContent)).toEqual(['Full color', 'Reversed', 'One-color black']);
    const shapes = Array.from(frame.querySelectorAll('[data-testid="brand-kit-symbol-shapes"] > div'));
    expect(shapes).toHaveLength(4);
    expect(rectOf(shapes[0])).toEqual({ left: '56px', top: '470px', width: '704px' });
    expect(shapes[0].querySelector<HTMLElement>('.kp-shape')?.style.borderRadius).toBe('50%');
    expect(shapes[0].querySelector<HTMLElement>('.kp-shape')?.style.width).toBe('158px');
    expect(shapes[3].querySelector<HTMLElement>('.kp-shape')?.style.width).toBe('126px');
    expect(shapes[3].querySelector('.kp-shape-stage')?.classList.contains('kp-shape-stage--mist')).toBe(true);
    expect(frame.querySelector<HTMLElement>('[data-testid="brand-kit-symbol-padding"] img')?.style.height).toBe('100px');
    const ruleBlock = frame.querySelector<HTMLElement>('[data-testid="brand-kit-symbol-rule"]');
    // The 8 px under the label comes from a grammar class: a Tailwind margin utility is beaten by the frame's reset (rv3 F7).
    expect(ruleBlock?.classList.contains('pp-body-gap-tight')).toBe(true);
    expect(ruleBlock?.className).not.toMatch(/\bmt-\[/);
    const rule = ruleBlock?.textContent?.replace(/\s+/g, ' ').trim();
    expect(rule).toBe(
      'One X of padding from the symbol to the edge of the circle or rounded square, where X is the height of the symbol. Never put the symbol on the accent: accent colors are not logo colors, and white on Orange fails AA (2.8:1).'
    );
  });

  it('derives the reversed and one-colour variants by filter from a one-ink symbol, whatever the lockup is drawn in', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSymbolComponent, 'logo-symbol', (view) => ({
      ...view,
      derivable: { lockup: false, symbol: true },
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG },
    }));
    const variants = frame.querySelector('[data-testid="brand-kit-symbol-variants"]');
    expect(Array.from(variants?.querySelectorAll('img') ?? [], (img) => img.style.filter)).toEqual(['', 'brightness(0) invert(1)', 'brightness(0)']);
    expect(variants?.querySelector('[data-testid="brand-kit-symbol-variant-missing"]')).toBeNull();
  });

  it('says "Not supplied" on the two variant tiles for a multi-colour symbol even when the lockup is one ink', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSymbolComponent, 'logo-symbol', (view) => ({
      ...view,
      derivable: { lockup: true, symbol: false },
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG },
    }));
    const variants = frame.querySelector('[data-testid="brand-kit-symbol-variants"]');
    expect(Array.from(variants?.querySelectorAll('img') ?? [], (img) => img.style.filter)).toEqual(['']);
    expect(variants?.querySelectorAll('[data-testid="brand-kit-symbol-variant-missing"]')).toHaveLength(2);
  });

  it('keeps the rule without the AA figure when white reads on the accent', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSymbolComponent, 'logo-symbol', (view) => ({
      ...view,
      accent: '#1E3A8A',
      accentName: 'Navy',
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG },
    }));
    expect(frame.querySelector('[data-testid="brand-kit-symbol-rule"]')?.textContent).not.toContain('fails AA');
    expect(frame.querySelector('[data-testid="brand-kit-symbol-rule"]')?.textContent).toContain('accent colors are not logo colors.');
  });

  it('prints the AA figure for an accent white fails on by a hair (4.48:1), cut to 4.4, never rounded up to a pass', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoSymbolComponent, 'logo-symbol', (view) => ({
      ...view,
      accent: '#777777',
      accentName: 'Grey',
      symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG },
    }));
    expect(frame.querySelector('[data-testid="brand-kit-symbol-rule"]')?.textContent).toContain('white on Grey fails AA (4.4:1).');
  });
});
