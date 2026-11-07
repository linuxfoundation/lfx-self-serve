// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
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
    expect(elements?.querySelector('.kp-element--eyebrow .kp-element-message')?.textContent).toBe(view.voice.umbrella);
    expect(Array.from(elements?.querySelectorAll('.kp-element--buttons .kp-button') ?? [], (button) => button.textContent)).toEqual([
      'Primary button',
      'Secondary',
    ]);
    // The orange accent fails AA with white, so the call-out's text is the kit's dark and the caption says why.
    const callout = elements?.querySelector<HTMLElement>('.kp-element--callout');
    expect(callout?.style.color).toBe('rgb(77, 78, 78)');
    expect(callout?.querySelector('.kp-button--small')?.textContent).toBe('one.example.org');
    expect(frame.querySelector('[data-testid="brand-kit-imagery-callout-caption"]')?.textContent).toBe(
      'Call-out · the one accent moment; text in Charcoal (white on Orange fails AA, 2.8:1)'
    );
    const avoid = frame.querySelector('[data-testid="brand-kit-imagery-avoid"]');
    expect(rectOf(avoid)).toEqual({ left: '56px', top: '900px', width: '704px' });
    expect(Array.from(avoid?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(view.visual.imagery.avoid);
  });

  it('says the call-out’s text is white on an accent that passes AA, and leaves the avoid list out when the kit has none', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageVisualImageryComponent, 'visual-imagery', (view) => ({
      ...view,
      accent: '#1E3A8A',
      visual: { ...view.visual, imagery: { ...view.visual.imagery, avoid: [] } },
    }));
    expect(frame.querySelector('[data-testid="brand-kit-imagery-avoid"]')).toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-imagery-callout-caption"]')?.textContent).toBe('Call-out · the one accent moment; text in white');
  });
});
