// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildShareKitTrackedUrl, composeShareKitPost, countShareKitPostLength, formatShareKitDateRange, formatShareKitDay } from './share-kit.utils';

describe('buildShareKitTrackedUrl', () => {
  it('adds the share kit tracking parameters and keeps existing ones', () => {
    const url = buildShareKitTrackedUrl('https://events.example.org/register/?ref=home', { medium: 'x', campaign: 'example-summit-2027', content: 'invite' });
    const params = new URL(url).searchParams;
    expect(params.get('ref')).toBe('home');
    expect(params.get('utm_source')).toBe('lfx-share-kit');
    expect(params.get('utm_medium')).toBe('x');
    expect(params.get('utm_campaign')).toBe('example-summit-2027');
    expect(params.get('utm_content')).toBe('invite');
  });
});

describe('countShareKitPostLength', () => {
  const link = 'https://events.example.org/register/?utm_source=lfx-share-kit&utm_medium=x&utm_campaign=example&utm_content=invite';

  it('counts the full link on LinkedIn', () => {
    expect(countShareKitPostLength('Hello', link, 'linkedin')).toBe(5 + 2 + link.length);
  });

  it('counts links as 23 characters on X and 40 on Bluesky', () => {
    expect(countShareKitPostLength('Hello', link, 'x')).toBe(5 + 2 + 23);
    expect(countShareKitPostLength('Hello', link, 'bluesky')).toBe(5 + 2 + 40);
  });

  it('matches the composed post text', () => {
    expect(composeShareKitPost(' Hello ', 'https://e.example.org/')).toBe('Hello\n\nhttps://e.example.org/');
  });
});

describe('formatShareKitDateRange', () => {
  it.each([
    ['2027-04-28', '2027-04-28', 'April 28, 2027'],
    ['2027-04-28', '2027-04-29', 'April 28 and 29, 2027'],
    ['2027-04-28', '2027-04-30', 'April 28–30, 2027'],
    ['2027-04-30', '2027-05-02', 'April 30 – May 2, 2027'],
    ['2027-12-31', '2028-01-02', 'December 31, 2027 – January 2, 2028'],
  ])('formats %s to %s as "%s"', (start, end, expected) => {
    expect(formatShareKitDateRange(start, end)).toBe(expected);
  });

  it('formats a single day with or without the year', () => {
    expect(formatShareKitDay('2027-02-28')).toBe('February 28');
    expect(formatShareKitDay('2027-01-18', true)).toBe('January 18, 2027');
  });
});
