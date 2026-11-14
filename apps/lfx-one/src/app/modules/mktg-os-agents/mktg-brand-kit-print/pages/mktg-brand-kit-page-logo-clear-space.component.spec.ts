// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageLogoClearSpaceComponent } from './mktg-brand-kit-page-logo-clear-space.component';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { mountBrandKitPage, rectOf, syntheticPlacedPlan, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Clear space & minimum size page', () => {
  it('shows the rule, the X box with four badges on the mist stage, the scaling row and the three minimum cards from the kit’s sizes', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoClearSpaceComponent, 'logo-clear-space');
    expect(frame.getAttribute('data-page')).toBe('5');
    expect(frame.querySelector('[data-testid="brand-kit-clear-space-intro"]')?.textContent).toBe('X on every side. Below that, the symbol.');
    const stage = frame.querySelector('[data-testid="brand-kit-clear-space-stage"]');
    expect(rectOf(stage)).toEqual({ left: '56px', top: '232px', width: '704px' });
    expect(stage?.querySelectorAll('.kp-x')).toHaveLength(4);
    expect(stage?.querySelector<HTMLElement>('img')?.style.height).toBe('60px');
    const scaling = frame.querySelector('[data-testid="brand-kit-clear-space-scaling"]');
    expect(rectOf(scaling)).toEqual({ left: '56px', top: '610px', width: '704px' });
    expect(Array.from(scaling?.querySelectorAll('img') ?? [], (img) => img.style.height)).toEqual(['48px', '40px', '32px']);
    expect(scaling?.textContent).not.toContain('Symbol 16 px');
    const cards = Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="brand-kit-clear-space-cards"] .kp-figure-card'), (card) => wordsOf(card));
    expect(cards).toEqual(['32 px Minimum height on screen', '10 mm Minimum height in print', '16 px Minimum symbol, below that nothing']);
    expect(rectOf(frame.querySelector('.kp-figure-card'))).toEqual({ left: '56px', top: '770px', width: '704px' });
  });

  it('is not planned for a kit without a horizontal lockup to stage: the plan drops the page rather than printing its cards alone', () => {
    // The page's stage, scaling row and minimum cards all draw the primary lockup; without one the plan leaves the page
    // out (as it does Partnership and Watchouts), so the component never mounts a stacked-only or logo-less kit.
    const kit = brandKitTestRevision();
    const view = buildBrandKitBookView(kit, 4);
    const stackedOnly = { ...view, logos: { primary: null, stacked: view.logos.primary, symbol: null, reversed: null }, symbol: null };
    expect(syntheticPlacedPlan(stackedOnly).map((page) => page.id)).not.toContain('logo-clear-space');
    expect(syntheticPlacedPlan(view).map((page) => page.id)).toContain('logo-clear-space');
  });
});
