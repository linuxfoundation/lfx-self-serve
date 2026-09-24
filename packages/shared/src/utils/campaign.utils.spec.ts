// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MAX_SPONSORS, MAX_SPONSOR_NAME_LENGTH } from '../constants/campaign.constants';
import { normalizeSponsors } from './campaign.utils';

/**
 * Sponsor entries arrive from a SCRAPED page: attacker-influenced names and logo urls that reach
 * a sent email. Coverage was indirect only, through the controller and component specs, so the
 * bounds and the per-entry sanitizing had nothing asserting them directly.
 */
describe('normalizeSponsors', () => {
  const logo = (n: number): string => `https://cdn.example.com/${n}.png`;

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not an array'],
    ['an object', { name: 'x' }],
  ])('returns [] for %s rather than throwing', (_label, input) => {
    expect(normalizeSponsors(input)).toEqual([]);
  });

  it('drops an entry whose name is not a string', () => {
    // The type guard, not cosmetics: `sponsor.name.trim()` below would throw on a non-string.
    expect(
      normalizeSponsors([
        { name: 42, logoUrl: logo(1) },
        { name: 'Acme', logoUrl: logo(2) },
      ])
    ).toEqual([{ name: 'Acme', logoUrl: logo(2) }]);
  });

  it('drops an entry with no usable logo url', () => {
    // `canonicalHttpUrl` returns '' for a private host, a bad scheme or a non-default port, and
    // an entry with no logo has nothing to render.
    const sponsors = normalizeSponsors([
      { name: 'Private', logoUrl: 'https://10.0.0.1/logo.png' },
      { name: 'Javascript', logoUrl: 'javascript:alert(1)' },
      { name: 'OddPort', logoUrl: 'https://cdn.example.com:8443/logo.png' },
      { name: 'Good', logoUrl: logo(1) },
    ]);

    expect(sponsors).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });

  it('sanitizes the name, because it reaches a recipient as display text', () => {
    // A BIDI override renders a name as something other than what it contains.
    const [sponsor] = normalizeSponsors([{ name: 'Acme‮kcatta', logoUrl: logo(1) }]);

    expect(sponsor?.name).not.toContain('‮');
  });

  it('drops an entry whose name sanitizes to nothing', () => {
    // Invisible-only names render blank while reading as non-empty.
    expect(normalizeSponsors([{ name: '​​', logoUrl: logo(1) }])).toEqual([]);
  });

  it('truncates a long name by CODE POINT, not by UTF-16 unit', () => {
    // `.slice()` on the string would cut an astral character in half and leave a lone surrogate.
    const [sponsor] = normalizeSponsors([{ name: '😀'.repeat(MAX_SPONSOR_NAME_LENGTH + 10), logoUrl: logo(1) }]);

    expect([...(sponsor?.name ?? '')]).toHaveLength(MAX_SPONSOR_NAME_LENGTH);
  });

  it('caps the result at MAX_SPONSORS', () => {
    const many = Array.from({ length: MAX_SPONSORS + 5 }, (_, i) => ({ name: `S${i}`, logoUrl: logo(i) }));

    expect(normalizeSponsors(many)).toHaveLength(MAX_SPONSORS);
  });

  it('bounds the work BEFORE parsing, so a huge list cannot cost a url parse per entry', () => {
    // The pre-slice is why `preSliceFactor` exists: the scrape path passes a wider factor because
    // its input is unbounded, but neither path parses the whole list.
    const huge = Array.from({ length: 5000 }, (_, i) => ({ name: `S${i}`, logoUrl: logo(i) }));

    expect(normalizeSponsors(huge)).toHaveLength(MAX_SPONSORS);
  });

  it('lets preSliceFactor keep entries the default would have cut before parsing', () => {
    // The first MAX_SPONSORS entries are all unusable; the good ones sit past that window. With
    // the default factor they are pre-sliced away and the result is empty.
    const unusable = Array.from({ length: MAX_SPONSORS }, (_, i) => ({ name: `Bad${i}`, logoUrl: 'javascript:alert(1)' }));
    const list = [...unusable, { name: 'Good', logoUrl: logo(1) }];

    expect(normalizeSponsors(list)).toEqual([]);
    expect(normalizeSponsors(list, 2)).toEqual([{ name: 'Good', logoUrl: logo(1) }]);
  });
});
