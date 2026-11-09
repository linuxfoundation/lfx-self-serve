// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  addShareToTally,
  combinedViewCount,
  isNewsletterBlocksEnabled,
  newsletterIssuePath,
  shareButtonAriaLabel,
  visibleShareCount,
  withNewsletterPreviewDate,
} from './newsletter.utils';

describe('newsletterIssuePath', () => {
  it('builds the relative permalink path from a project slug and newsletter id', () => {
    expect(newsletterIssuePath('cncf', 'abc123')).toBe('/newsletters/cncf/abc123');
  });

  it('does not encode or otherwise transform its inputs', () => {
    expect(newsletterIssuePath('kubernetes', 'issue-42')).toBe('/newsletters/kubernetes/issue-42');
  });
});

describe('addShareToTally', () => {
  const base = { count: 4, channels: [] };

  it('counts the first share to a channel', () => {
    expect(addShareToTally(base, 'linkedin')).toEqual({ count: 5, channels: ['linkedin'] });
  });

  it('counts each channel once, like the server', () => {
    const once = addShareToTally(base, 'linkedin');
    expect(addShareToTally(once, 'linkedin')).toBe(once);
    expect(addShareToTally(once, 'copy_link').count).toBe(6);
  });

  it('keeps an unknown count unknown but remembers the channel', () => {
    expect(addShareToTally({ ...base, count: null }, 'x')).toEqual({ count: null, channels: ['x'] });
  });
});

describe('visibleShareCount', () => {
  it('hides unknown and zero counts', () => {
    expect(visibleShareCount(null)).toBeNull();
    expect(visibleShareCount(undefined)).toBeNull();
    expect(visibleShareCount(0)).toBeNull();
    expect(visibleShareCount(4)).toBe(4);
  });
});

describe('shareButtonAriaLabel', () => {
  it('names the button with the grouped count', () => {
    expect(shareButtonAriaLabel(null)).toBe('Share');
    expect(shareButtonAriaLabel(1)).toBe('Share, shared 1 time');
    expect(shareButtonAriaLabel(12500)).toBe('Share, shared 12,500 times');
  });
});

describe('combinedViewCount', () => {
  it('sums email opens and unique page views', () => {
    expect(combinedViewCount(12, 5)).toBe(17);
  });

  it('shows the known half when the other is unknown', () => {
    expect(combinedViewCount(12, undefined)).toBe(12);
    expect(combinedViewCount(null, 5)).toBe(5);
  });

  it('keeps a known zero', () => {
    expect(combinedViewCount(0, 0)).toBe(0);
  });

  it('is null only when both halves are unknown', () => {
    expect(combinedViewCount(undefined, null)).toBeNull();
  });
});

describe('withNewsletterPreviewDate', () => {
  // 02:00 UTC on 10 Nov is still 9 Nov in Los Angeles, where the service renders the date.
  const now = new Date('2026-11-10T02:00:00Z');

  it('fills in every send-date token in the service format and timezone', () => {
    expect(withNewsletterPreviewDate('<p>%%SEND_DATE%%</p><p>%%SEND_DATE%%</p>', now)).toBe('<p>November 9, 2026</p><p>November 9, 2026</p>');
  });

  it('leaves HTML with no token alone', () => {
    expect(withNewsletterPreviewDate('<p>October 2, 2026</p>', now)).toBe('<p>October 2, 2026</p>');
  });
});

describe('isNewsletterBlocksEnabled', () => {
  const pilot = { hasLayout: false, flagEnabled: true, contextIsOwner: true, projectSlug: 'agentic-ai-foundation' };

  it('allows new authoring with the flag on a pilot project the context owns', () => {
    expect(isNewsletterBlocksEnabled(pilot)).toBe(true);
  });

  it.each([
    ['the flag is off', { ...pilot, flagEnabled: false }],
    ['the project is not a pilot', { ...pilot, projectSlug: 'cncf' }],
    ['the context is not the owning project', { ...pilot, contextIsOwner: false }],
    ['there is no project', { ...pilot, projectSlug: undefined }],
  ])('blocks new authoring when %s', (_label, options) => {
    expect(isNewsletterBlocksEnabled(options)).toBe(false);
  });

  it('keeps a draft with a layout in the composer even with the flag off', () => {
    expect(isNewsletterBlocksEnabled({ hasLayout: true, flagEnabled: false, contextIsOwner: false })).toBe(true);
  });
});
