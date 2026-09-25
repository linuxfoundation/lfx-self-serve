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
    const [sponsor] = normalizeSponsors([{ name: 'Acme\u202Ekcatta', logoUrl: logo(1) }]);

    expect(sponsor?.name).not.toContain('\u202E');
  });

  it('drops an entry whose name sanitizes to nothing', () => {
    // Invisible-only names render blank while reading as non-empty.
    expect(normalizeSponsors([{ name: '\u200B\u200B', logoUrl: logo(1) }])).toEqual([]);
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

  it('parses only the pre-sliced window, never the whole list', () => {
    // `toHaveLength(MAX_SPONSORS)` alone proves nothing here -- the FINAL slice guarantees it
    // whether or not the pre-slice exists. What the pre-slice actually buys is not parsing
    // entries beyond the window, so this counts the parses: a getter on `logoUrl` fires once per
    // entry the pipeline touches.
    //
    // The caller that passes a wider factor is `campaign.controller.ts` (a DIRECT request, whose
    // list is unbounded), not the scrape path.
    let parsed = 0;
    const counting = Array.from({ length: 5000 }, (_, i) => ({
      name: `S${i}`,
      get logoUrl(): string {
        parsed++;
        return logo(i);
      },
    }));

    expect(normalizeSponsors(counting)).toHaveLength(MAX_SPONSORS);
    expect(parsed).toBe(MAX_SPONSORS);
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
