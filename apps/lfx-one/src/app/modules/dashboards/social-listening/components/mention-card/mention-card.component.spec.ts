// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Mention } from '@lfx-one/shared/interfaces';

import { MentionCardComponent } from './mention-card.component';

/** Mention card trust boundaries: validExternalUrl gates every [href]; the open-original span is non-interactive so the stretched link is the sole tab stop. */
describe('MentionCardComponent', () => {
  function baseMention(overrides: Partial<Mention> = {}): Mention {
    return {
      id: 'm1',
      platform: 'reddit',
      keyword: 'kubernetes',
      timestamp: '2026-08-01T00:00:00Z',
      authorName: 'Jane Doe',
      authorProfileLink: 'https://reddit.com/u/jane',
      title: 'A mention',
      content: 'body text',
      analysis: '',
      sentiment: 'neutral',
      relevance: 'low',
      tags: ['ai'],
      originalUrl: 'https://reddit.com/r/kubernetes/comments/m1',
      imageUrl: '',
      subreddit: 'kubernetes',
      language: 'en',
      raw: {} as Mention['raw'],
      ...overrides,
    };
  }

  let fixture: ComponentFixture<MentionCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MentionCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(MentionCardComponent);
  });

  function setMention(mention: Mention): void {
    fixture.componentRef.setInput('mention', mention);
    fixture.componentRef.setInput('timeTick', 0);
  }

  function querySelector(selector: string): Element | null {
    return fixture.nativeElement.querySelector(selector);
  }

  it('renders the stretched card link with a sanitized http(s) href', async () => {
    setMention(baseMention());
    await fixture.whenStable();

    const cardLink = querySelector('.card-link') as HTMLAnchorElement;
    expect(cardLink).not.toBeNull();
    expect(cardLink.getAttribute('href')).toBe('https://reddit.com/r/kubernetes/comments/m1');
    expect(cardLink.getAttribute('target')).toBe('_blank');
    expect(cardLink.getAttribute('rel')).toBe('noopener noreferrer');
    expect(cardLink.getAttribute('aria-label')).toBe('Open mention');
  });

  it('drops the stretched card link when originalUrl is a javascript: scheme', async () => {
    setMention(baseMention({ originalUrl: 'javascript:alert(1)' }));
    await fixture.whenStable();

    expect(querySelector('.card-link')).toBeNull();
  });

  it('renders the author profile link only when it passes URL validation', async () => {
    setMention(baseMention({ authorProfileLink: 'https://reddit.com/u/jane' }));
    await fixture.whenStable();

    const authorLink = querySelector('a.card-interactive.font-medium') as HTMLAnchorElement;
    expect(authorLink).not.toBeNull();
    expect(authorLink.getAttribute('href')).toBe('https://reddit.com/u/jane');
  });

  it('falls back to a plain author name span when the profile link is invalid', async () => {
    setMention(baseMention({ authorProfileLink: 'javascript:alert(1)' }));
    await fixture.whenStable();

    expect(querySelector('a.card-interactive.font-medium')).toBeNull();
    expect(querySelector('span.font-medium.text-gray-900')).not.toBeNull();
  });

  it('renders the decorative open-original affordance as a non-interactive span when originalUrl is valid', async () => {
    setMention(baseMention());
    await fixture.whenStable();

    const affordance = querySelector('[data-testid="mention-card-open-original"]');
    expect(affordance).not.toBeNull();
    expect(affordance?.tagName).toBe('SPAN');
    expect(affordance?.getAttribute('aria-hidden')).toBe('true');
    expect(affordance?.querySelector('a')).toBeNull();
  });

  it('hides the open-original affordance when originalUrl fails validation', async () => {
    setMention(baseMention({ originalUrl: 'javascript:alert(1)' }));
    await fixture.whenStable();

    expect(querySelector('[data-testid="mention-card-open-original"]')).toBeNull();
  });

  it('renders the mention image only when its URL passes validation', async () => {
    setMention(baseMention({ imageUrl: 'https://cdn.example.com/a.png' }));
    await fixture.whenStable();

    const image = querySelector('[data-testid="mention-card-image"]') as HTMLImageElement;
    expect(image?.getAttribute('src')).toBe('https://cdn.example.com/a.png');

    setMention(baseMention({ imageUrl: 'javascript:alert(1)' }));
    await fixture.whenStable();

    expect(querySelector('[data-testid="mention-card-image"]')).toBeNull();
  });

  it('drops the image once it fails to load', async () => {
    setMention(baseMention({ imageUrl: 'https://cdn.example.com/a.png' }));
    await fixture.whenStable();

    querySelector('[data-testid="mention-card-image"]')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();

    expect(querySelector('[data-testid="mention-card-image"]')).toBeNull();
  });

  it('caps the forward-email body by encoded length, not raw length', async () => {
    for (const content of ['漢'.repeat(600), '😀'.repeat(600)]) {
      setMention(baseMention({ content }));
      await fixture.whenStable();

      const href = (querySelector('[data-testid="mention-card-forward-email"]') as HTMLAnchorElement).getAttribute('href') ?? '';
      const body = href.split('&body=')[1] ?? '';
      expect(body.length).toBeLessThanOrEqual(MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS);
      // The original-post link is the point of the email, so it must survive the trim.
      expect(decodeURIComponent(body)).toContain('https://reddit.com/r/kubernetes/comments/m1');
    }
  });

  it('does not throw when the raw-char slice boundary splits a surrogate pair', async () => {
    // 'a😀' is 3 UTF-16 units (1 + 2); repeating 300× gives 900 units, so slice(0, 500) ends mid-surrogate.
    setMention(baseMention({ content: 'a😀'.repeat(300) }));
    await fixture.whenStable();

    const href = (querySelector('[data-testid="mention-card-forward-email"]') as HTMLAnchorElement).getAttribute('href') ?? '';
    expect(href).not.toBe('');
    const body = href.split('&body=')[1] ?? '';
    expect(body.length).toBeLessThanOrEqual(MENTION_FORWARD_EMAIL_BODY_MAX_ENCODED_CHARS);
  });

  it('exposes the stretched link as the sole keyboard tab stop to the original URL', async () => {
    setMention(baseMention());
    await fixture.whenStable();

    const cardLink = querySelector('.card-link') as HTMLAnchorElement;
    expect(cardLink?.getAttribute('tabindex')).toBe('0');

    // The decorative open-original affordance must not be a focusable anchor.
    const affordance = querySelector('[data-testid="mention-card-open-original"]');
    expect(affordance?.tagName).toBe('SPAN');
    expect(affordance?.hasAttribute('tabindex')).toBe(false);
  });
});
