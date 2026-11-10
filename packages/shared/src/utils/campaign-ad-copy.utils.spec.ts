// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { fitAdCopyToWidth } from './campaign-ad-copy.utils';
import { googleAdsTextWeight } from './campaign-google-search-ads.utils';

const googleWidth = (char: string): number => googleAdsTextWeight(char);

describe('fitAdCopyToWidth', () => {
  it('returns a line that already fits unchanged, at exactly the width too', () => {
    expect(fitAdCopyToWidth('Join us in Barcelona.', 90)).toBe('Join us in Barcelona.');
    expect(fitAdCopyToWidth('a'.repeat(30), 30)).toBe('a'.repeat(30));
  });

  // Shaped like two of the lines #5378 found hard-cut at 90 ("...Rollouts &", "...innovation. Barcelon").
  it.each([
    ['Two days of GitOps talks and labs with the people who build it. Learn Argo CD, Rollouts & Events', 'Learn Argo CD, Rollouts'],
    ['Meet the Argo community and hear what is next for continuous software delivery innovation. Barcelona 2027', 'delivery innovation.'],
  ])('cuts %j on a word boundary, never mid-word', (line, ending) => {
    const fitted = fitAdCopyToWidth(line, 90);
    expect(fitted.length).toBeLessThanOrEqual(90);
    expect(fitted.endsWith(ending)).toBe(true);
    expect(line.startsWith(fitted)).toBe(true);
  });

  it('cuts at the width when the next character is a space, keeping the whole last word', () => {
    expect(fitAdCopyToWidth('Register for ArgoCon today', 21)).toBe('Register for ArgoCon');
  });

  it('backs off to the previous word when the width falls inside a word', () => {
    expect(fitAdCopyToWidth('Register for ArgoCon today', 18)).toBe('Register');
  });

  it.each([
    ['Workflows, Rollouts & Events', 21, 'Workflows, Rollouts'],
    ['Talks, labs, and the hallway track', 16, 'Talks, labs'],
    ['Learn from the maintainers', 15, 'Learn'],
    ['Day one - keynotes', 10, 'Day one'],
    ['Cloud native: the summit', 14, 'Cloud native'],
  ])('drops the dangling joiner from %j at %i', (line, width, expected) => {
    expect(fitAdCopyToWidth(line, width)).toBe(expected);
  });

  it('keeps a sentence-ending full stop', () => {
    expect(fitAdCopyToWidth('Register today. Seats are limited', 20)).toBe('Register today.');
  });

  it('cuts one unbroken word between characters, since it has no other boundary', () => {
    expect(fitAdCopyToWidth('Supercalifragilistic', 10)).toBe('Supercalif');
  });

  it('measures with the width it is given: CJK counts double on Google', () => {
    // 46 ideographs are 46 characters but 92 wide; Google's limit of 90 holds 45.
    const fitted = fitAdCopyToWidth('会'.repeat(46), 90, googleWidth);
    expect(fitted).toBe('会'.repeat(45));
    expect(googleAdsTextWeight(fitted)).toBe(90);
    // The default count passes the same line through, as `slice` did.
    expect(fitAdCopyToWidth('会'.repeat(46), 90)).toBe('会'.repeat(46));
  });

  it('cuts Japanese text between characters rather than backing off to the last space', () => {
    const line = 'KubeCon Japan で会いましょう登録受付中です';
    const fitted = fitAdCopyToWidth(line, 24, googleWidth);
    expect(fitted).toBe('KubeCon Japan で会いまし');
    expect(googleAdsTextWeight(fitted)).toBeLessThanOrEqual(24);
  });

  it('returns an empty line when nothing survives the cut', () => {
    expect(fitAdCopyToWidth('and the rest', 4)).toBe('');
  });
});
