// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_SAMPLES } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';
import { brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
import { MktgBrandKitPageVisualIconographyComponent } from './mktg-brand-kit-page-visual-iconography.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Iconography page', () => {
  it('opens the Visual chapter with the shared icon samples at the mock’s size, the strip caption, the rules, the set and the sizes', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageVisualIconographyComponent, 'visual-iconography');
    expect(frame.getAttribute('data-page')).toBe('11');
    expect(frame.getAttribute('data-section')).toBe('04 Visual');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    const samples = frame.querySelector('[data-testid="brand-kit-iconography-samples"]');
    expect(rectOf(samples)).toEqual({ left: '56px', top: '148px', width: '704px' });
    expect(samples?.querySelectorAll('[data-testid^="brand-kit-icon-tile-"]')).toHaveLength(BRAND_KIT_ICON_SAMPLES.length);
    expect(samples?.querySelector<HTMLElement>('[data-testid="brand-kit-icon-strip"]')?.style.backgroundColor).toBe('rgb(77, 78, 78)');
    expect(samples?.querySelector('[data-testid="brand-kit-icon-tile-verified"] svg')?.getAttribute('width')).toBe('36');
    expect(frame.querySelector('[data-testid="brand-kit-iconography-strip-caption"]')?.textContent?.trim()).toBe(
      'On dark grounds: white, one active state in Orange'
    );
    const rules = frame.querySelector('[data-testid="brand-kit-iconography-rules"]');
    expect(rectOf(rules)).toEqual({ left: '56px', top: '680px', width: '420px' });
    expect(Array.from(rules?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(view.visual.icons.rules);
    const set = frame.querySelector('[data-testid="brand-kit-iconography-set"]');
    expect(rectOf(set)).toEqual({ left: '500px', top: '680px', width: '260px' });
    expect(set?.textContent).toContain(view.visual.icons.recommended);
    expect(set?.querySelector('.kp-icon-labelled')?.textContent?.trim()).toBe('Verified');
    const sizes = frame.querySelector('[data-testid="brand-kit-iconography-sizes"]');
    expect(rectOf(sizes)).toEqual({ left: '56px', top: '870px', width: '704px' });
    expect(Array.from(sizes?.querySelectorAll('svg') ?? [], (svg) => svg.getAttribute('width'))).toEqual(['16', '24', '32', '48']);
    expect(Array.from(sizes?.querySelectorAll('.kp-icon-size-label') ?? [], (label) => label.textContent)).toEqual(['16 px', '24 px', '32 px', '48 px']);
  });

  it('keeps four 300-character rules above the Sizes block: smaller, cut at a sentence, the rules the room cannot hold counted in a line', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageVisualIconographyComponent, 'visual-iconography', () =>
      buildBrandKitBookView(brandKitOverfullFixture(), 4)
    );
    const rules = frame.querySelector<HTMLElement>('[data-testid="brand-kit-iconography-rules"]');
    expect(rules?.style.getPropertyValue('--kp-fit')).toBe('0.72');
    const items = rules?.querySelectorAll('li') ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(4);
    expect(rules?.querySelector('[data-testid="brand-kit-iconography-rules-more"]')?.textContent).toBe(`+${4 - items.length} more rules, in LFX One`);
  });
});
