// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Mention } from '@lfx-one/shared/interfaces';

import { MentionCardComponent } from './mention-card.component';

/**
 * Shallow DOM coverage for the mention card's trust boundaries: the `validExternalUrl` pipe gates every
 * external `[href]` (stretched card link, author profile, subreddit, decorative open-original affordance)
 * so a crafted `javascript:` URL can't bind through. The decorative open-original span is also pinned down
 * as non-interactive (`aria-hidden`, no anchor) so the stretched link remains the sole tab stop.
 */
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
