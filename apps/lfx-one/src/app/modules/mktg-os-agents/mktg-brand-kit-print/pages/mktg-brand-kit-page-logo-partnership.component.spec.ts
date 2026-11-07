// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageLogoPartnershipComponent } from './mktg-brand-kit-page-logo-partnership.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Partnership lockup page', () => {
  it('shows the lockup beside the partner slot on light and on dark, and numbers the rules in two columns', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageLogoPartnershipComponent, 'logo-partnership');
    expect(frame.getAttribute('data-page')).toBe('6');
    const light = frame.querySelector('[data-testid="brand-kit-partnership-light"]');
    const dark = frame.querySelector('[data-testid="brand-kit-partnership-dark"]');
    expect(rectOf(light)).toEqual({ left: '56px', top: '148px', width: '704px' });
    expect(rectOf(dark)).toEqual({ left: '56px', top: '486px', width: '704px' });
    expect(light?.querySelector<HTMLElement>('img')?.style.height).toBe('64px');
    expect(dark?.querySelector<HTMLElement>('img')?.style.filter).toBe('brightness(0) invert(1)');
    expect(light?.querySelector('.kp-partner')?.textContent).toBe('Partner logo');
    expect(light?.parentElement?.querySelector('.pp-cap')?.textContent).toBe('On light grounds · Charcoal bar');
    expect(dark?.parentElement?.querySelector('.pp-cap')?.textContent).toBe('On dark grounds · white bar');
    const rules = Array.from(frame.querySelectorAll('[data-testid="brand-kit-partnership-rules"] li'), (li) => wordsOf(li));
    expect(rules).toEqual(view.logo.partnership.map((rule, index) => `0${index + 1} ${rule}`));
    expect(rectOf(frame.querySelector('[data-testid="brand-kit-partnership-rules"]'))).toEqual({ left: '56px', top: '806px', width: '704px' });
  });
});
