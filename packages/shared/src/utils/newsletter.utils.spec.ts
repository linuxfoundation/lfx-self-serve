// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { addShareToTally, newsletterIssuePath } from './newsletter.utils';

describe('newsletterIssuePath', () => {
  it('builds the relative permalink path from a project slug and newsletter id', () => {
    expect(newsletterIssuePath('cncf', 'abc123')).toBe('/newsletters/cncf/abc123');
  });

  it('does not encode or otherwise transform its inputs', () => {
    expect(newsletterIssuePath('kubernetes', 'issue-42')).toBe('/newsletters/kubernetes/issue-42');
  });
});

describe('addShareToTally', () => {
  const base = { newsletterId: 'n1', count: 4, channels: [] };

  it('counts the first share to a channel', () => {
    expect(addShareToTally(base, 'linkedin')).toEqual({ newsletterId: 'n1', count: 5, channels: ['linkedin'] });
  });

  it('counts each channel once, like the server', () => {
    const once = addShareToTally(base, 'linkedin');
    expect(addShareToTally(once, 'linkedin')).toBe(once);
    expect(addShareToTally(once, 'copy_link').count).toBe(6);
  });

  it('keeps an unknown count unknown but remembers the channel', () => {
    expect(addShareToTally({ ...base, count: null }, 'x')).toEqual({ newsletterId: 'n1', count: null, channels: ['x'] });
  });
});
