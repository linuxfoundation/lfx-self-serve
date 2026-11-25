// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { linkedInGeoSearchLocations, linkedInGeoSearchOptions, linkedInGeoSearchQueryRefusal, linkedInGeoSearchQueryText } from './campaign-linkedin-geo.utils';

describe('linkedInGeoSearchQueryRefusal', () => {
  it.each([
    ['Berlin', null],
    ['  SF  ', null],
    ['x'.repeat(100), null],
    [42, 'Enter a location to search for.'],
    [undefined, 'Enter a location to search for.'],
    [' a ', 'Enter at least 2 characters to search.'],
    ['x'.repeat(101), 'Search with at most 100 characters.'],
    ['Ber\nlin', 'Search with letters, numbers and punctuation only.'],
    ['Ber\u0085lin', 'Search with letters, numbers and punctuation only.'],
  ])('%j → %j', (raw, expected) => {
    expect(linkedInGeoSearchQueryRefusal(raw)).toBe(expected);
  });
});

describe('linkedInGeoSearchLocations', () => {
  it('keeps geo URNs once, in order, labelled by name', () => {
    expect(
      linkedInGeoSearchLocations([
        { urn: 'urn:li:geo:103035651', name: 'Berlin, Germany' },
        { urn: 'urn:li:geo:101282230', name: ' Germany ' },
        { urn: 'urn:li:geo:103035651', name: 'Berlin again' },
        { urn: 'urn:li:geo:90000084', name: '' },
      ])
    ).toEqual([
      { urn: 'urn:li:geo:103035651', label: 'Berlin, Germany' },
      { urn: 'urn:li:geo:101282230', label: 'Germany' },
      { urn: 'urn:li:geo:90000084', label: 'urn:li:geo:90000084' },
    ]);
  });

  it.each([
    ['a non-geo URN', [{ urn: 'urn:li:skill:1', name: 'Skill' }]],
    ['a malformed geo URN', [{ urn: 'urn:li:geo:abc', name: 'Bad' }]],
    ['a non-object entry', ['urn:li:geo:1', null]],
    ['a value that is not a list', 'none'],
  ])('drops %s', (_name, raw) => {
    expect(linkedInGeoSearchLocations(raw)).toEqual([]);
  });
});

describe('linkedInGeoSearchQueryText', () => {
  it.each([
    ['  Berlin ', 'Berlin'],
    ['\u0085Berlin', 'Berlin'],
    ['x'.repeat(120), 'x'.repeat(100)],
  ])('%j → %j', (typed, expected) => {
    expect(linkedInGeoSearchQueryText(typed)).toBe(expected);
  });
});

describe('linkedInGeoSearchOptions', () => {
  it('marks a location already targeted as disabled', () => {
    const berlin = { urn: 'urn:li:geo:103035651', label: 'Berlin, Germany' };
    const us = { urn: 'urn:li:geo:103644278', label: 'United States' };
    expect(linkedInGeoSearchOptions([berlin, us], [us])).toEqual([
      { ...berlin, disabled: false },
      { ...us, disabled: true },
    ]);
  });
});
