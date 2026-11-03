// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { addShareToTally, newsletterIssuePath, shareButtonAriaLabel, visibleShareCount } from './newsletter.utils';

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
