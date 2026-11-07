// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_RECOLOR_FILTER } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageLogoWatchoutsComponent } from './mktg-brand-kit-page-logo-watchouts.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Watchouts page', () => {
  it('draws the six distortions under a red cross with the kit’s lines, and the safe default with the minimum size', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageLogoWatchoutsComponent, 'logo-watchouts');
    expect(frame.getAttribute('data-page')).toBe('7');
    expect(frame.querySelector('[data-testid="brand-kit-watchouts-intro"]')?.textContent).toContain('reversed on Charcoal, with X of clear space.');
    const tiles = Array.from(frame.querySelectorAll('[data-testid="brand-kit-watchouts-tiles"] > div'));
    expect(tiles).toHaveLength(6);
    expect(rectOf(tiles[0])).toEqual({ left: '56px', top: '220px', width: '704px' });
    expect(tiles.map((tile) => tile.querySelector('.kp-watchout-label')?.textContent)).toEqual(view.logo.watchouts);
    expect(tiles.every((tile) => tile.querySelector('.kp-no')?.textContent === '✕')).toBe(true);
    expect(tiles[0].querySelector<HTMLElement>('span')?.style.transform).toBe('scaleX(1.45)');
    // The recoloured mark is a lilac whatever the mark's own colour, so a dark lockup looks wrong too (not black).
    expect(tiles[1].querySelector<HTMLElement>('span')?.style.filter).toBe(BRAND_KIT_RECOLOR_FILTER);
    expect(tiles[3].querySelector<HTMLElement>('span')?.style.filter).toBe('drop-shadow(4px 5px 3px rgba(0, 0, 0, 0.45))');
    expect(tiles[4].querySelector<HTMLElement>('span')?.style.transform).toBe('');
    expect(tiles[5].querySelector('.kp-retyped')?.textContent).toBe('Project One');
    expect(tiles[5].querySelector('img')).toBeNull();
    const fallback = frame.querySelector('[data-testid="brand-kit-watchouts-default"]');
    expect(rectOf(fallback)).toEqual({ left: '56px', top: '760px', width: '704px' });
    expect(fallback?.textContent).toContain('never smaller than 32 px tall.');
  });
});
