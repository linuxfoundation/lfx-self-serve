// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_PORTRAIT_FIT } from '@lfx-one/shared/constants';
import { MktgBrandKitPageTypeComponent } from './mktg-brand-kit-page-type.component';
import { mountBrandKitPage, rectOf, wordsOf } from './mktg-brand-kit-page.spec-helper';

describe('the Typography page', () => {
  it('opens the Type chapter with the specimen, the scale at real size with the kit’s own words, the source and the rules', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type');
    expect(frame.getAttribute('data-page')).toBe('10');
    expect(frame.getAttribute('data-section')).toBe('03 Type');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-type-intro"]')?.textContent).toBe(view.type.summary);
    const specimen = frame.querySelector('[data-testid="brand-kit-type-specimen"]');
    expect(rectOf(specimen)).toEqual({ left: '56px', top: '212px', width: '704px' });
    const h1 = specimen?.querySelector<HTMLElement>('[data-testid="brand-kit-type-h1"]');
    expect(h1?.textContent).toBe(view.voice.line);
    // The synthetic brand line (32 characters) does not fit the column at the mock's 48 px, so it is set at the largest
    // step that fits (40 px), whole.
    expect(h1?.style.fontSize).toBe('40px');
    expect(Array.from(specimen?.querySelectorAll('.kp-type-weight-name') ?? [], (name) => name.textContent)).toEqual(['Regular 400', 'Bold 700']);
    const scale = frame.querySelector('[data-testid="brand-kit-type-scale"]');
    expect(rectOf(scale)).toEqual({ left: '56px', top: '436px', width: '704px' });
    const steps = Array.from(scale?.querySelectorAll<HTMLElement>('[data-step]') ?? []);
    expect(steps.map((step) => step.getAttribute('data-step'))).toEqual(['display', 'h2', 'h3', 'eyebrow', 'body', 'caption']);
    const display = steps[0].querySelector<HTMLElement>('.kp-scale-sample');
    expect(display?.style.fontSize).toBe('64px');
    expect(display?.style.lineHeight).toBe('72px');
    expect(display?.textContent?.trim()).toBe(view.voice.line);
    expect(steps[3].querySelector('.kp-scale-sample')?.classList.contains('kp-scale-sample--caps')).toBe(true);
    expect(steps[3].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe('Plain');
    expect(steps[4].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.voice.umbrella);
    expect(steps[4].querySelector('.kp-scale-spec')?.textContent).toBe('400 · 18/30');
    expect(steps[5].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.footer);
    const source = frame.querySelector('[data-testid="brand-kit-type-source"]');
    expect(rectOf(source)).toEqual({ left: '56px', top: '830px', width: '340px' });
    expect(wordsOf(source)).toContain('Montserrat · Google Fonts · weights 400, 700');
    expect(source?.textContent).toContain('Fallback: none');
    expect(source?.textContent).toContain('Named on one.example.org');
    expect(source?.textContent).not.toContain('https://');
    const rules = frame.querySelector('[data-testid="brand-kit-type-rules"]');
    expect(rectOf(rules)).toEqual({ left: '420px', top: '830px', width: '340px' });
    expect(Array.from(rules?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(view.type.rules);
  });

  it('shrinks the H1 sample until a long brand line fits the column in one line, never below the grammar’s floor', async () => {
    const long = 'Open standards, open governance and open collaboration for every kind of computing everywhere';
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, line: long } }));
    const size = parseFloat(frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-h1"]')?.style.fontSize ?? '0');
    expect(size).toBeLessThan(48);
    // The floor is the grammar's minimum scale, rounded down to the half pixel the sample is set at.
    expect(size).toBeGreaterThanOrEqual(Math.floor(48 * MKTG_PORTRAIT_FIT.minScale * 2) / 2);
  });
});
