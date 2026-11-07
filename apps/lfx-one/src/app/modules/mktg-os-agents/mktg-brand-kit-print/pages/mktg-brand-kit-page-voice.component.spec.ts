// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MktgBrandKitPageVoiceComponent } from './mktg-brand-kit-page-voice.component';
import { mountBrandKitPage, rectOf } from './mktg-brand-kit-page.spec-helper';

describe('the Voice in brief page', () => {
  it('opens the Voice chapter with the source as the intro, the umbrella message and brand line, and the attributes in two columns', async () => {
    const { frame, view, fixture, look } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice');
    expect(frame.getAttribute('data-page')).toBe('14');
    expect(frame.getAttribute('data-section')).toBe('06 Voice');
    expect(frame.querySelector('[data-testid="mktg-portrait-page-band"]')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-voice-intro"]')?.textContent).toBe('From the messaging framework. As they are.');
    const messages = frame.querySelector('[data-testid="brand-kit-voice-messages"]');
    expect(rectOf(messages)).toEqual({ left: '56px', top: '212px', width: '704px' });
    expect(messages?.querySelector('.kp-voice-umbrella')?.textContent).toBe(view.voice.umbrella);
    expect(messages?.querySelector('.kp-voice-line')?.textContent).toBe(view.voice.line);
    const attributes = frame.querySelector('[data-testid="brand-kit-voice-attributes"]');
    expect(rectOf(attributes)).toEqual({ left: '56px', top: '540px', width: '704px' });
    const names = Array.from(attributes?.querySelectorAll('.kp-attribute-name') ?? [], (name) => name.textContent);
    expect(names).toEqual(['Plain', 'Specific', 'Neutral', 'Welcoming']);
    expect(attributes?.querySelector('.kp-attribute-line')?.textContent).toBe('One sentence.');
    // The first rule is the spark, the rest the accent (the synthetic kit names no spark, so the look falls back to the
    // accent; a kit with one shows it on the first attribute).
    fixture.componentRef.setInput('look', { ...look, spark: '#1D4ED8' });
    await fixture.whenStable();
    const rules = Array.from(attributes?.querySelectorAll<HTMLElement>('.kp-attribute') ?? [], (attribute) => attribute.style.borderTopColor);
    expect(rules[0]).toBe('rgb(29, 78, 216)');
    expect(rules[0]).not.toBe(rules[1]);
    expect(new Set(rules.slice(1)).size).toBe(1);
    expect(frame.textContent).not.toContain('Say');
  });

  it('drops the intro, a message and the attributes the kit lacks, never printing an empty label', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice', (view) => ({
      ...view,
      voice: { ...view.voice, source: '', note: '', umbrella: '', attributes: [] },
    }));
    expect(frame.querySelector('[data-testid="brand-kit-voice-intro"]')).toBeNull();
    expect(frame.querySelector('.kp-voice-umbrella')).toBeNull();
    expect(frame.querySelector('.kp-voice-line')).not.toBeNull();
    expect(frame.querySelector('[data-testid="brand-kit-voice-attributes"]')).toBeNull();
    expect(frame.textContent).not.toContain('Umbrella message');
  });
});
