// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitOverfullFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from '@lfx-one/shared/utils';
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

  it('keeps four attributes at full size and sets a grid of eight long ones smaller together, inside the frame', async () => {
    const { frame } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice');
    const fitOf = (grid: HTMLElement | null | undefined) => grid?.closest<HTMLElement>('.pp-r')?.style.getPropertyValue('--kp-fit');
    expect(fitOf(frame.querySelector<HTMLElement>('[data-testid="brand-kit-voice-attributes"]'))).toBe('1');
    expect(frame.querySelector('[data-testid="brand-kit-voice-attributes-more"]')).toBeNull();
    const line = 'Every claim names its number and its source, in the words the reader would use, and never a superlative the record cannot back.';
    const { frame: crowded } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice', (view) => ({
      ...view,
      voice: { ...view.voice, attributes: Array.from({ length: 8 }, (_, index) => ({ name: `Attribute ${index + 1}`, line })) },
    }));
    const grid = crowded.querySelector<HTMLElement>('[data-testid="brand-kit-voice-attributes"]');
    expect(grid?.querySelectorAll('.kp-attribute')).toHaveLength(8);
    const scale = Number(fitOf(grid));
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(0.72);
    expect(grid?.querySelector('.kp-attribute-line')?.textContent).toBe(line);
    expect(crowded.querySelector('[data-testid="brand-kit-voice-attributes-more"]')).toBeNull();
  });

  it('counts the attributes the room cannot hold in a "+N more" line instead of dropping them in silence', async () => {
    const line = 'Every claim names its number and its source, in the words the reader would use, and never a superlative the record cannot back.';
    const { frame } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice', (view) => ({
      ...view,
      voice: { ...view.voice, attributes: Array.from({ length: 20 }, (_, index) => ({ name: `Attribute ${index + 1}`, line: `${line} ${line}` })) },
    }));
    const grid = frame.querySelector<HTMLElement>('[data-testid="brand-kit-voice-attributes"]');
    const printed = grid?.querySelectorAll('.kp-attribute').length ?? 0;
    expect(printed).toBeGreaterThan(0);
    expect(printed).toBeLessThan(20);
    expect(printed % 2).toBe(0);
    expect(frame.querySelector('[data-testid="brand-kit-voice-attributes-more"]')?.textContent).toBe(`+${20 - printed} more on the Voice tab in LFX One`);
    // Names print whole; the lines are cut at a sentence (the first of the two).
    expect(grid?.querySelector('.kp-attribute-name')?.textContent).toBe('Attribute 1');
    expect(grid?.querySelector('.kp-attribute-line')?.textContent).toBe(line);
  });

  it('sets the overfull record’s umbrella and brand line smaller together above the attributes, the umbrella cut at a sentence at the smallest step', async () => {
    const { frame, view } = await mountBrandKitPage(MktgBrandKitPageVoiceComponent, 'voice', () => buildBrandKitBookView(brandKitOverfullFixture(), 4));
    const messages = frame.querySelector<HTMLElement>('[data-testid="brand-kit-voice-messages"]');
    expect(messages?.style.getPropertyValue('--kp-fit')).toBe('0.72');
    // At the brand line's 1.3 leading the pair no longer holds whole at 0.72: the umbrella (the longer paragraph) is
    // cut at its first sentence; the brand line stays as written.
    const umbrella = messages?.querySelector('.kp-voice-umbrella')?.textContent ?? '';
    expect(umbrella.length).toBeLessThan(view.voice.umbrella.length);
    expect(view.voice.umbrella.startsWith(umbrella)).toBe(true);
    expect(umbrella.endsWith('.')).toBe(true);
    expect(messages?.querySelector('.kp-voice-line')?.textContent).toBe(view.voice.line);
    // The intro (the source, then a 300-character note) keeps its whole sentences that fit three lines.
    expect((frame.querySelector('[data-testid="brand-kit-voice-intro"]')?.textContent ?? '').length).toBeLessThan(300);
  });
});
