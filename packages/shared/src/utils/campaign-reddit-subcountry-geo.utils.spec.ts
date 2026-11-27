// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { redditSubCountryGeoRefusal } from './campaign-reddit-subcountry-geo.utils';

const FIELD = 'redditConfig.subCountryGeoTargets';

describe('redditSubCountryGeoRefusal', () => {
  it.each<[string, unknown, boolean]>([
    ['not an object', null, true],
    ['nothing set, without the flag', { budgetUsd: 50 }, false],
    // campaign-service reads null and an empty list as absent, so they need no flag.
    ['null, without the flag', { subCountryGeoTargets: null }, false],
    ['an empty list, without the flag', { subCountryGeoTargets: [] }, false],
    ['a region, a city and a DMA', { geoTargets: [], subCountryGeoTargets: ['US-CA', 'CA:6167865', '662'] }, true],
    ['lower case and padded entries, as campaign-service reads them', { subCountryGeoTargets: [' us-ca ', 'gb:2641599'] }, true],
    ['ſ and ı, which Go upper-cases to S and I', { subCountryGeoTargets: ['uſ-ca', 'ın-dl'] }, true],
    ['a numeric region part', { subCountryGeoTargets: ['FR-75'] }, true],
    ['locations beside a different targeted country', { geoTargets: ['CA'], subCountryGeoTargets: ['US-NY', '501'] }, true],
    ['locations beside a different excluded country', { excludedGeoTargets: ['CA'], subCountryGeoTargets: ['US-NY'] }, true],
    // Without geoTargets the US default does not apply once this list is set, so a US location is no overlap.
    ['a US location with no geoTargets', { subCountryGeoTargets: ['US-TX'] }, true],
    // campaign-service drops duplicates rather than refusing them.
    ['a repeated id', { subCountryGeoTargets: ['US-CA', 'us-ca'] }, true],
    ['50 entries', { subCountryGeoTargets: Array.from({ length: 50 }, () => 'US-CA') }, true],
  ])('accepts %s', (_name, raw, enabled) => {
    expect(redditSubCountryGeoRefusal(raw, enabled)).toBeNull();
  });

  it.each<[string, unknown, boolean, string]>([
    ['a case variant of the key, whatever the flag', { SubCountryGeoTargets: ['US-CA'] }, false, 'spelled exactly'],
    ['a list that is not an array', { subCountryGeoTargets: 'US-CA' }, true, 'list of text'],
    ['a list with a non-text entry', { subCountryGeoTargets: ['US-CA', 662] }, true, 'list of text'],
    ['a list without the flag', { subCountryGeoTargets: ['US-CA'] }, false, 'not enabled'],
    // Any non-empty list counts as set, whatever its entries.
    ['a blank-only list without the flag', { subCountryGeoTargets: [' '] }, false, 'not enabled'],
    ['51 entries', { subCountryGeoTargets: Array.from({ length: 51 }, () => 'US-CA') }, true, 'at most 50'],
    // The cap is counted before blanks and malformed ids.
    ['51 blank entries', { subCountryGeoTargets: Array.from({ length: 51 }, () => '') }, true, 'at most 50'],
    ['a blank entry', { subCountryGeoTargets: ['US-CA', '  '] }, true, 'Location 2 is blank'],
    ['a bare country', { subCountryGeoTargets: ['us'] }, true, 'Location 1 is a whole country'],
    ['a postal code', { subCountryGeoTargets: ['US-90210'] }, true, 'not a Reddit region'],
    ['a city id of zero', { subCountryGeoTargets: ['CA:0'] }, true, 'not a Reddit region'],
    ['a city id of eleven digits', { subCountryGeoTargets: ['CA:12345678901'] }, true, 'not a Reddit region'],
    ['a bare numeric id', { subCountryGeoTargets: ['6252001'] }, true, 'not a Reddit region'],
    ['a two-digit DMA', { subCountryGeoTargets: ['66'] }, true, 'not a Reddit region'],
    ['a DMA with a leading zero', { subCountryGeoTargets: ['062'] }, true, 'not a Reddit region'],
    ['an unassigned country', { subCountryGeoTargets: ['XX-CA'] }, true, 'not a Reddit region'],
    // Go upper-cases code point by code point, so ß is not SS there.
    ['ß, which JavaScript would upper-case to SS', { subCountryGeoTargets: ['ß-CA'] }, true, 'not a Reddit region'],
    ['a region inside a targeted country', { geoTargets: [' us '], subCountryGeoTargets: ['US-CA'] }, true, 'Location 1 is inside a country the geo targets'],
    ['a DMA beside a targeted US', { geoTargets: ['US'], subCountryGeoTargets: ['662'] }, true, 'already target as a whole'],
    // campaign-service decodes keys ignoring case, so a case variant of geoTargets is the targeting it compares against.
    ['a city inside a case-variant geoTargets country', { GeoTargets: ['CA'], subCountryGeoTargets: ['CA:6167865'] }, true, 'already target as a whole'],
    [
      'a city inside an excluded country',
      { geoTargets: [], excludedGeoTargets: ['ca'], subCountryGeoTargets: ['CA:6167865'] },
      true,
      'inside an excluded country',
    ],
    // The targeted-country rule comes before the excluded-country rule, as in campaign-service.
    ['a region both targeted and excluded', { geoTargets: ['US'], excludedGeoTargets: ['US'], subCountryGeoTargets: ['US-CA'] }, true, 'already target'],
    // Malformed ids are refused in list order, before any overlap later in the list.
    ['an overlap then a malformed id', { geoTargets: ['US'], subCountryGeoTargets: ['US-CA', 'nope'] }, true, 'Location 1 is inside'],
    ['a malformed id then an overlap', { geoTargets: ['US'], subCountryGeoTargets: ['nope', 'US-CA'] }, true, 'Location 1 is not a Reddit region'],
  ])('refuses %s', (_name, raw, enabled, message) => {
    const refusal = redditSubCountryGeoRefusal(raw, enabled);
    expect(refusal?.field).toBe(FIELD);
    expect(refusal?.message).toContain(message);
  });

  it('never echoes a caller value', () => {
    expect(redditSubCountryGeoRefusal({ subCountryGeoTargets: ['<script>'] }, true)?.message).not.toContain('<script>');
    expect(redditSubCountryGeoRefusal({ geoTargets: ['US'], subCountryGeoTargets: ['US-CA'] }, true)?.message).not.toContain('US');
  });
});
