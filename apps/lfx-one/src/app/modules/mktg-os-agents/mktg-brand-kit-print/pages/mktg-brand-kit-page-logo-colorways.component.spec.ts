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
    // A colorway whose name already says its ground is not followed by it again ("Full color · on white on white").
    expect(intro).toBe(
      'Full color · on white. Reversed · on Charcoal (white) on dark. One-color black · print only for white. Accent colors are never logo colors.'
    );
    const tiles = Array.from(frame.querySelectorAll('[data-testid="brand-kit-colorways-tiles"] > div'));
    expect(tiles).toHaveLength(4);
    expect(rectOf(tiles[0])).toEqual({ left: '56px', top: '236px', width: '704px' });
    // The captions say the ground once: the record's names already carry it.
    expect(tiles.map((tile) => tile.querySelector('.pp-cap')?.textContent)).toEqual([
      'Full color · on white',
      'Reversed · on Charcoal',
      'Full color · on light tint',
      'One-color black · print only',
    ]);
    expect(tiles[1].querySelector('.pp-tile')?.classList.contains('pp-tile--dark')).toBe(true);
    // The fixture's lockup is three colours: the reversed and one-colour tiles cannot be derived by filter (it would
    // flatten the mark), so they print the plain "Not supplied" line and no image; the two full-colour tiles draw it.
    expect(tiles[1].querySelector('img')).toBeNull();
    expect(tiles[1].querySelector('[data-testid="brand-kit-colorway-missing"]')?.textContent).toBe('Not supplied');
    expect(tiles[3].querySelector('[data-testid="brand-kit-colorway-missing"]')?.textContent).toBe('Not supplied');
    expect(tiles[0].querySelector<HTMLElement>('img')?.style.filter).toBe('');
    expect(tiles[2].querySelector<HTMLElement>('img')?.style.filter).toBe('');
    expect(tiles[2].querySelector<HTMLElement>('.pp-tile')?.style.background).not.toBe('');
    expect(frame.querySelectorAll('[data-testid="brand-kit-colorways-rules"] li')).toHaveLength(view.logo.colorways.length);
    expect(frame.querySelector('[data-testid="brand-kit-colorways-rules"] li')?.textContent?.trim()).toBe('Full color · on white.');
    expect(frame.querySelectorAll('[data-testid="brand-kit-colorways-rules"] li')[1]?.textContent?.trim()).toBe('Reversed · on Charcoal — white on dark.');
  });

  it('adds the ground to a caption and a clause whose name does not say it', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoColorwaysComponent, 'logo-colorways', (view) => ({
      ...view,
      colorways: view.colorways.map((tile, index) => ({ ...tile, name: ['Full color', 'Reversed', 'On the tint', 'One-color black'][index] })),
      logo: {
        ...view.logo,
        colorways: view.logo.colorways.map((rule, index) => ({ ...rule, name: ['Full color', 'Reversed', 'On the tint', 'One-color black'][index] })),
      },
    }));
    const tiles = Array.from(frame.querySelectorAll('[data-testid="brand-kit-colorways-tiles"] > div'));
    expect(tiles.map((tile) => tile.querySelector('.pp-cap')?.textContent)).toEqual([
      'Full color · on white',
      'Reversed · on Charcoal',
      'On the tint',
      'One-color black · print only',
    ]);
    const intro = frame.querySelector('[data-testid="brand-kit-colorways-intro"]')?.textContent?.replace(/\s+/g, ' ').trim();
    expect(intro?.startsWith('Full color on white. Reversed (white) on dark. One-color black for white.')).toBe(true);
    expect(frame.querySelector('[data-testid="brand-kit-colorways-rules"] li')?.textContent?.trim()).toBe('Full color — full color on white.');
  });

  it('keeps each caption with its own colorway when a tile without artwork is left out', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoColorwaysComponent, 'logo-colorways', (view) => ({
      ...view,
      colorways: view.colorways.map((tile, index) => (index === 1 ? { ...tile, logo: null, missing: '' } : tile)),
    }));
    const tiles = Array.from(frame.querySelectorAll('[data-testid="brand-kit-colorways-tiles"] > div'));
    // A tile with neither artwork nor a "Not supplied" line is left out; the one-colour tile (not derivable from the
    // three-colour fixture lockup) stays with its line.
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.querySelector('.pp-cap')?.textContent)).toEqual([
      'Full color · on white',
      'Full color · on light tint',
      'One-color black · print only',
    ]);
  });
});
