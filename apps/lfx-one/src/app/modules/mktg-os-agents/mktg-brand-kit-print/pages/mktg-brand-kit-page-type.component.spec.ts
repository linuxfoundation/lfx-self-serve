// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitMinimalFixture, brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
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
    // The specimen is always at the mock's 48 px; the synthetic brand line, measured in Montserrat (a wide face) at 500,
    // does not fit the column whole, so it is shortened to the words that do, with an ellipsis (the editor: shorten,
    // never shrink; never a bare cut).
    expect(h1?.style.fontSize).toBe('48px');
    expect(h1?.textContent).toBe('Open standards for one…');
    expect(Array.from(specimen?.querySelectorAll('.kp-type-weight-name') ?? [], (name) => name.textContent)).toEqual(['Regular 400', 'Bold 700']);
    expect(specimen?.querySelector('.kp-type-weights-note')?.textContent).toBe('2 weights available; the rules below cap what one page uses.');
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
    // The display step shows the project's name at its real size on its own line; every step prints at the kit's own
    // size and leading, and a step whose sample would not fit its line (the brand line at 32 px here) is shortened to the
    // words that do, never shrunk or cut; the spec column names the kit's real size always.
    const display = steps[0].querySelector<HTMLElement>('.kp-scale-sample');
    expect(display?.style.fontSize).toBe('64px');
    expect(display?.style.lineHeight).toBe('72px');
    expect(display?.textContent?.trim()).toBe('Project One');
    expect(steps[0].querySelector('.kp-scale-meta')?.textContent).toContain('500 · 64/72');
    expect(steps[1].querySelector<HTMLElement>('.kp-scale-sample')?.style.fontSize).toBe('32px');
    expect(steps[1].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe('Open standards for one…');
    expect(steps[1].querySelector('.kp-scale-spec')?.textContent).toBe('500 · 32/40');
    expect(steps[2].querySelector('.kp-scale-sample')?.textContent?.trim()).toBe(view.voice.line);
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

  it('counts one weight in the singular', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', () => buildBrandKitBookView(brandKitMinimalFixture(), 4));
    expect(frame.querySelector('.kp-type-weights-note')?.textContent).toBe('1 weight available; the rules below cap what one page uses.');
  });

  it('shortens a long brand line to the words that fit the column at 48 px, in one line, never shrunk or clipped', async () => {
    const long = 'Open standards, open governance and open collaboration for every kind of computing everywhere';
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, line: long } }));
    const h1 = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-h1"]');
    expect(h1?.style.fontSize).toBe('48px');
    // 94 characters in Montserrat at 500: the first three words fit the 704 px column at 48 by the measured width.
    expect(h1?.textContent).toBe('Open standards, open…');
    expect(mktgPortraitLineFits('Open standards, open…', 704, 48, { weight: 500, family: 'Montserrat', tracking: -0.015 })).toBe(true);
    expect(mktgPortraitLineFits('Open standards, open governance', 704, 48, { weight: 500, family: 'Montserrat', tracking: -0.015 })).toBe(false);
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

  it('keeps the body step at 18/30 and shortens a long umbrella to three lines, cut at a word with an ellipsis, never shrunk', async () => {
    const sentence = 'Where organizations fund the open computing standards every member builds on, together and in the open, every year.';
    const umbrella = `${sentence} ${sentence}`;
    const { frame } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', (view) => ({ ...view, voice: { ...view.voice, umbrella } }));
    const body = frame.querySelector<HTMLElement>('[data-step="body"] .kp-scale-sample');
    expect(body?.style.fontSize).toBe('18px');
    expect(body?.style.lineHeight).toBe('30px');
    const text = body?.textContent?.trim() ?? '';
    expect(text.length).toBeLessThan(umbrella.length);
    expect(text.endsWith('…')).toBe(true);
    expect(umbrella.startsWith(text.slice(0, -1))).toBe(true);
    // The label names the kit's real size, which is what is printed.
    expect(frame.querySelector('[data-step="body"] .kp-scale-spec')?.textContent).toBe('400 · 18/30');
  });

  it('cuts a 300-character summary to three lines and sets three 300-character rules smaller and cut at a sentence in the lower block', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageTypeComponent, 'type', () => buildBrandKitBookView(brandKitOverfullFixture(), 4));
    const intro = frame.querySelector('[data-testid="brand-kit-type-intro"]')?.textContent ?? '';
    expect(intro.length).toBeLessThan(view.type.summary.length);
    const rules = frame.querySelector<HTMLElement>('[data-testid="brand-kit-type-rules"]');
    expect(rules?.style.getPropertyValue('--kp-fit')).toBe('0.72');
    expect(rules?.classList.contains('kp-fit-list')).toBe(true);
    const items = Array.from(rules?.querySelectorAll('li') ?? [], (li) => li.textContent ?? '');
    expect(items).toHaveLength(3);
    expect(items.every((rule) => rule.length < 300)).toBe(true);
  });
});
