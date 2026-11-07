// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageLogoColorwaysComponent } from './mktg-brand-kit-page-logo-colorways.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Colorways page', () => {
  it('names the colorways in the intro, draws the four tiles on the live grounds with the mock’s captions, and lists the rules', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageLogoColorwaysComponent, 'logo-colorways');
    expect(frame.getAttribute('data-page')).toBe('4');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
    const intro = frame.querySelector('[data-testid="brand-kit-colorways-intro"]')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(intro).toBe(
      'Full color · on white on white. Reversed · on Charcoal (white) on dark. One-color black · print only for white. Accent colors are never logo colors.'
    );
    const tiles = Array.from(frame.querySelectorAll('[data-testid="brand-kit-colorways-tiles"] > div'));
    expect(tiles).toHaveLength(4);
    expect(rectOf(tiles[0])).toEqual({ left: '56px', top: '236px', width: '704px' });
    expect(tiles.map((tile) => tile.querySelector('.pp-cap')?.textContent)).toEqual([
      'Full color · on white · on white',
      'Reversed · on Charcoal · on Charcoal',
      'Full color · on light tint',
      'One-color black · print only · print only',
    ]);
    expect(tiles[1].querySelector('.pp-tile')?.classList.contains('pp-tile--dark')).toBe(true);
    expect(tiles[1].querySelector<HTMLElement>('img')?.style.filter).toBe('brightness(0) invert(1)');
    expect(tiles[3].querySelector<HTMLElement>('img')?.style.filter).toBe('brightness(0)');
    expect(tiles[2].querySelector<HTMLElement>('.pp-tile')?.style.background).not.toBe('');
    expect(frame.querySelectorAll('[data-testid="brand-kit-colorways-rules"] li')).toHaveLength(view.logo.colorways.length);
    expect(frame.querySelector('[data-testid="brand-kit-colorways-rules"] li')?.textContent?.trim()).toBe('Full color · on white — full color on white.');
  });
});
