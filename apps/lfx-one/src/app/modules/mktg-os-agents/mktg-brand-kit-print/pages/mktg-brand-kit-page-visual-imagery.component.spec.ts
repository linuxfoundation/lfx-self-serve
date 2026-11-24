// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
import { MktgBrandKitPageVisualImageryComponent } from './mktg-brand-kit-page-visual-imagery.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Imagery & graphic elements page', () => {
  it('shows the default ground, the three element cards with the call-out inked by the shared rule, and the kit’s avoid list', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageVisualImageryComponent, 'visual-imagery');
    expect(frame.getAttribute('data-page')).toBe('12');
    expect(frame.getAttribute('data-section')).toBe('04 Visual');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-imagery-intro"]')?.textContent).toBe(view.visual.imagery.rule);
    const ground = frame.querySelector('[data-testid="brand-kit-imagery-ground"]');
    expect(rectOf(ground)).toEqual({ left: '56px', top: '220px', width: '704px' });
    expect(ground?.querySelector('.kp-ground')?.classList.contains('pp-grid-ground')).toBe(true);
    expect(ground?.textContent).toContain('Default ground: a quiet grid on Charcoal');
    const elements = frame.querySelector('[data-testid="brand-kit-imagery-elements"]');
    expect(rectOf(elements)).toEqual({ left: '56px', top: '600px', width: '704px' });
    expect(elements?.querySelectorAll('.kp-element')).toHaveLength(3);
    const message = elements?.querySelector<HTMLElement>('[data-testid="brand-kit-imagery-message"]');
    expect(message?.textContent).toBe(view.voice.umbrella);
    expect(message?.style.fontSize).toBe('19px');
    expect(elements?.querySelector('.kp-element-captions span')?.textContent).toBe('Umbrella message card');
    expect(Array.from(elements?.querySelectorAll('.kp-element--buttons .kp-button') ?? [], (button) => button.textContent)).toEqual([
      'Primary button',
      'Secondary',
    ]);
    // Nothing in the kit reads on its orange (white 2.8:1, Charcoal 2.9:1), so no text goes on the accent: the call-out
    // is a white card in the kit's dark under an accent rule, and the caption says why in the matrix's ratios.
    const callout = elements?.querySelector<HTMLElement>('.kp-element--callout');
    expect(callout?.style.color).toBe('rgb(77, 78, 78)');
    expect(callout?.style.background).toBe('rgb(255, 255, 255)');
    expect(callout?.classList.contains('kp-element--callout-rule')).toBe(true);
    expect(callout?.querySelector('.kp-button--small')?.textContent).toBe('one.example.org');
    expect(frame.querySelector('[data-testid="brand-kit-imagery-callout-caption"]')?.textContent).toBe(
      'Call-out · the accent as a top rule; no palette color reaches AA on Orange (Charcoal 2.9:1 at best), so the card keeps a white ground under an accent rule'
    );
    const avoid = frame.querySelector('[data-testid="brand-kit-imagery-avoid"]');
    expect(rectOf(avoid)).toEqual({ left: '56px', top: '900px', width: '704px' });
    expect(Array.from(avoid?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(view.visual.imagery.avoid);
  });

  it('sets the call-out’s text in white on an accent white reads on, with the matrix’s ratio, and leaves the avoid list out when the kit has none', async () => {
    const { frame, fixture, look } = await mountBrandKitPage(MktgBrandKitPageVisualImageryComponent, 'visual-imagery', (view) => ({
      ...view,
      accent: '#1E3A8A',
      visual: { ...view.visual, imagery: { ...view.visual.imagery, avoid: [] } },
    }));
    // The look follows the brand; the moment follows the view's own contrast: white reads 10.3:1 on this navy.
    fixture.componentRef.setInput('look', { ...look, accent: '#1E3A8A' });
    await fixture.whenStable();
    expect(frame.querySelector('[data-testid="brand-kit-imagery-avoid"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-imagery-callout-caption"]')?.textContent).toBe(
      'Call-out · the one accent moment; text in White (10.3:1 on Orange)'
    );
    const callout = frame.querySelector<HTMLElement>('[data-element="callout"]');
    expect(callout?.classList.contains('kp-element--callout-rule')).toBe(false);
  });

  it('cuts a 300-character imagery rule to the intro’s three lines and counts the avoid items its 90 px cannot hold', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageVisualImageryComponent, 'visual-imagery', () =>
      buildBrandKitBookView(brandKitOverfullFixture(), 4)
    );
    const intro = frame.querySelector('[data-testid="brand-kit-imagery-intro"]')?.textContent ?? '';
    expect(intro.length).toBeLessThan(view.visual.imagery.rule.length);
    expect(view.visual.imagery.rule.startsWith(intro)).toBe(true);
    const avoid = frame.querySelector<HTMLElement>('[data-testid="brand-kit-imagery-avoid"]');
    expect(avoid?.style.getPropertyValue('--kp-fit')).toBe('0.72');
    const items = avoid?.querySelectorAll('li') ?? [];
    expect(items.length).toBeGreaterThan(0);
    // The Avoid list counts items to avoid, singular at one.
    expect(items).toHaveLength(2);
    expect(avoid?.querySelector('[data-testid="brand-kit-imagery-avoid-more"]')?.textContent).toBe('+1 more item to avoid, in LFX One');
  });
});
