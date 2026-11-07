// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
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
    // The same lockup size and bar on both tiles (the editor's ruling: the mock's smaller dark lockup read as a size change).
    expect(dark?.querySelector<HTMLElement>('img')?.style.height).toBe('64px');
    // The 96 px bar is the grammar class `kp-bar--partnership` on both tiles (no Tailwind utility inside a frame).
    expect(light?.querySelector('.kp-bar')?.classList.contains('kp-bar--partnership')).toBe(true);
    expect(dark?.querySelector('.kp-bar')?.classList.contains('kp-bar--partnership')).toBe(true);
    // The three-colour fixture lockup is never filtered: the dark tile draws it in full colour on the white plate.
    expect(dark?.querySelector<HTMLElement>('img')?.style.filter).toBe('');
    expect(dark?.querySelector<HTMLElement>('.pp-plate')?.style.padding).toBe('64px');
    expect(light?.querySelector('.kp-partner')?.textContent).toBe('Partner logo');
    expect(light?.parentElement?.querySelector('.pp-cap')?.textContent).toBe('On light grounds · Charcoal bar');
    expect(dark?.parentElement?.querySelector('.pp-cap')?.textContent).toBe('On dark grounds · white bar');
    const rules = Array.from(frame.querySelectorAll('[data-testid="brand-kit-partnership-rules"] li'), (li) => wordsOf(li));
    expect(rules).toEqual(view.logo.partnership.map((rule, index) => `0${index + 1} ${rule}`));
    expect(rectOf(frame.querySelector('[data-testid="brand-kit-partnership-rules"]'))).toEqual({ left: '56px', top: '806px', width: '704px' });
  });

  it('sets five 300-character rules smaller and cut at a sentence so the list ends above the footer, in the record’s order', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageLogoPartnershipComponent, 'logo-partnership', () =>
      buildBrandKitBookView(brandKitOverfullFixture(), 4)
    );
    const box = frame.querySelector<HTMLElement>('[data-testid="brand-kit-partnership-rules"]')?.closest<HTMLElement>('.kp-fit-list');
    expect(box?.style.getPropertyValue('--kp-fit')).toBe('0.72');
    const rules = Array.from(frame.querySelectorAll('[data-testid="brand-kit-partnership-rules"] li'), (li) => li.textContent ?? '');
    expect(rules).toHaveLength(5);
    expect(rules.every((rule) => rule.length < 300)).toBe(true);
    expect(frame.querySelector('[data-testid="brand-kit-partnership-rules-more"]')).toBeNull();
  });
});
