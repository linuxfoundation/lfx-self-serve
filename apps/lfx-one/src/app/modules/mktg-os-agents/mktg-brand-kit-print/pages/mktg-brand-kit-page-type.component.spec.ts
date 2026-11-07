// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgPortraitLineFits } from '@lfx-one/shared/utils';
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
    // The synthetic brand line, measured in Montserrat (a wide face) at 500, does not fit the column at the mock's 48 px,
    // so it is set at the largest step that fits (38 px), whole; a line that fits stays at 48 (the shared spec).
    expect(h1?.style.fontSize).toBe('38px');
    expect(Array.from(specimen?.querySelectorAll('.kp-type-weight-name') ?? [], (name) => name.textContent)).toEqual(['Regular 400', 'Bold 700']);
    // The scale and the two lower blocks are one placed block in flow: the scale at least the room above the mock's
    // y 830 less the 16 px gap (830 − 16 − 436), the lower blocks right after it, so they sit at 830 while the scale is
    // short and follow the engine's own end when it is not — never a computed y.
    expect(rectOf(frame.querySelector('[data-testid="brand-kit-type-flow"]'))).toEqual({ left: '56px', top: '436px', width: '704px' });
    const scale = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-scale"]');
    expect(scale?.style.minHeight).toBe('378px');
    expect(scale?.style.top).toBe('');
    expect(scale?.nextElementSibling?.classList.contains('kp-type-lower')).toBe(true);
    const steps = Array.from(scale?.querySelectorAll<HTMLElement>('[data-step]') ?? []);
    expect(steps.map((step) => step.getAttribute('data-step'))).toEqual(['display', 'h2', 'h3', 'eyebrow', 'body', 'caption']);
    // The display step shows the project's name at its real size on its own line; a step whose sample would not fit its
    // line (the brand line at 32 px here) is set smaller, never cut; the spec column still names the step's real size.
    const display = steps[0].querySelector<HTMLElement>('.kp-scale-sample');
    expect(display?.style.fontSize).toBe('64px');
    expect(display?.style.lineHeight).toBe('72px');
    expect(display?.textContent?.trim()).toBe('Project One');
    expect(steps[0].querySelector('.kp-scale-meta')?.textContent).toContain('500 · 64/72');
    expect(steps[1].querySelector<HTMLElement>('.kp-scale-sample')?.style.fontSize).toBe('26.5px');
    expect(steps[1].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.voice.line);
    // The spec column names what is printed: the smaller size here, the step's own where the sample is at it.
    expect(steps[1].querySelector('.kp-scale-spec')?.textContent).toBe('500 · 26.5/40');
    expect(steps[2].querySelector('.kp-scale-spec')?.textContent).toBe('500 · 24/32');
    expect(steps[3].querySelector('.kp-scale-sample')?.classList.contains('kp-scale-sample--caps')).toBe(true);
    expect(steps[3].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.voice.line);
    expect(steps[4].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.voice.umbrella);
    expect(steps[4].querySelector('.kp-scale-spec')?.textContent).toBe('400 · 18/30');
    expect(steps[4].querySelector<HTMLElement>('.kp-scale-sample')?.style.fontSize).toBe('18px');
    expect(steps[5].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.footer);
    const source = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-source"]');
    expect(source?.parentElement).toBe(scale?.nextElementSibling);
    expect(source?.classList.contains('kp-type-lower-block')).toBe(true);
    expect(source?.style.top).toBe('');
    expect(wordsOf(source)).toContain('Montserrat · Google Fonts · weights 400, 700');
    expect(source?.textContent).toContain('Fallback: none');
    expect(source?.textContent).toContain('Named on one.example.org');
    expect(source?.textContent).not.toContain('https://');
    const rules = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-rules"]');
    expect(rules?.previousElementSibling).toBe(source);
    expect(rules?.classList.contains('kp-type-lower-block')).toBe(true);
    expect(Array.from(rules?.querySelectorAll('li') ?? [], (li) => li.textContent)).toEqual(view.type.rules);
  });

  it('shrinks the H1 sample until a long brand line fits the column in one line, never cut', async () => {
    const long = 'Open standards, open governance and open collaboration for every kind of computing everywhere';
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, line: long } }));
    const h1 = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-h1"]');
    const size = parseFloat(h1?.style.fontSize ?? '0');
    expect(size).toBeLessThan(48);
    // 94 characters in Montserrat at 500 fit the 704 px column at 13 px by the measured width; the text is whole.
    expect(size).toBe(13);
    expect(h1?.textContent).toBe(long);
    expect(mktgPortraitLineFits(long, 704, size, { weight: 500, family: 'Montserrat' })).toBe(true);
  });

  it('sets the body step at its real size and lets the paragraph wrap, the lower blocks following the scale in flow when three lines run past y 830', async () => {
    const umbrella =
      'The Synthetic Foundation is the neutral home at the Linux Foundation where the open protocols and tools for agents are governed in the open.';
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, umbrella } }));
    const body = frame.querySelector<HTMLElement>('[data-step="body"] .kp-scale-sample');
    expect(body?.style.fontSize).toBe('18px');
    expect(body?.style.lineHeight).toBe('30px');
    expect(body?.textContent?.trim()).toBe(umbrella);
    // Three lines at 18/30 take the caption row past the mock's y 830: the blocks are in flow after the scale (no inline y
    // on either), so they follow the engine's own end; the model agrees the stack still fits without shrinking the body
    // (the shared spec reads its numbers), which is why the body is still at 18/30 above.
    const scale = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-scale"]');
    const lower = scale?.nextElementSibling;
    expect(lower?.classList.contains('kp-type-lower')).toBe(true);
    expect(Array.from(lower?.children ?? [], (block) => block.getAttribute('data-testid'))).toEqual(['brand-kit-type-source', 'brand-kit-type-rules']);
    expect(Array.from(lower?.children ?? [], (block) => (block as HTMLElement).style.top)).toEqual(['', '']);
  });

  it('sets the body step smaller, never below 14 px, when even the moved blocks would cross the footer', async () => {
    const sentence = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    const umbrella = `${sentence} ${sentence}`;
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, umbrella } }));
    const body = frame.querySelector<HTMLElement>('[data-step="body"] .kp-scale-sample');
    const size = parseFloat(body?.style.fontSize ?? '0');
    expect(size).toBeLessThan(18);
    expect(size).toBeGreaterThanOrEqual(14);
    expect(body?.textContent?.trim()).toBe(umbrella);
    // The label agrees with the sample: the shrunk size and leading, not the step's nominal 18/30.
    expect(frame.querySelector('[data-step="body"] .kp-scale-spec')?.textContent).toBe(`400 · ${size}/${parseFloat(body?.style.lineHeight ?? '0')}`);
  });
});
