// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  redditGeoTargetsBesideSubCountry,
  redditSubCountryGeoAddRefusal,
  redditSubCountryGeoCapability,
  redditSubCountryGeoDraftRefusal,
  redditSubCountryGeoEntry,
  redditSubCountryGeoField,
  redditSubCountryGeoFromDraft,
  redditSubCountryGeoLabel,
  redditSubCountryGeoRefusal,
} from './campaign-reddit-subcountry-geo.utils';

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
    expect(redditSubCountryGeoRefusal({ geoTargets: ['US'], subCountryGeoTargets: ['US-WA'] }, true)?.message).not.toContain('US-WA');
    expect(redditSubCountryGeoRefusal({ excludedGeoTargets: ['GB'], subCountryGeoTargets: ['GB:2641599'] }, true)?.message).not.toContain('GB');
  });
});

// The Implement tab's editor (#6108 row 7).
describe('redditSubCountryGeoCapability', () => {
  it.each<[boolean | null, boolean]>([
    [true, true],
    [false, false],
    [null, false],
  ])('%s offers the editor: %s', (enabled, expected) => {
    expect(redditSubCountryGeoCapability(enabled)).toBe(expected);
  });
});

describe('redditSubCountryGeoEntry and redditSubCountryGeoLabel', () => {
  it.each<[string, string, string]>([
    [' us-ca ', 'US-CA', 'US-CA (region)'],
    ['ca:6167865', 'CA:6167865', 'CA:6167865 (city)'],
    ['662', '662', '662 (DMA)'],
    ['uſ-ca', 'US-CA', 'US-CA (region)'],
    ['nope', 'NOPE', 'NOPE'],
  ])('holds %j as %j, shown as %j', (raw, entry, label) => {
    expect(redditSubCountryGeoEntry(raw)).toBe(entry);
    expect(redditSubCountryGeoLabel(entry)).toBe(label);
  });
});

describe('redditSubCountryGeoAddRefusal', () => {
  const full = Array.from({ length: 50 }, (_v, i) => `US-${i}`);
  it.each<[string, string[], string, string[], string | null]>([
    ['a region', [], 'US-CA', [], null],
    ['a city and a DMA beside an excluded other country', ['US-CA'], '662', ['CA'], null],
    ['a blank id', [], '', [], 'Enter a Reddit geolocation id.'],
    ['a whole country', [], 'US', [], 'whole country'],
    ['a postal code', [], 'US-94107', [], 'Enter a Reddit region (US-CA)'],
    ['an unassigned country', [], 'ZZ-CA', [], 'Enter a Reddit region (US-CA)'],
    ['a city inside an excluded country', [], 'CA:6167865', [' ca '], 'CA is excluded'],
    ['a DMA while the US is excluded', [], '662', ['US'], 'US is excluded'],
    ['a 51st location', full, 'US-CA', [], 'at most 50'],
    ['one the full list already holds', full, 'US-0', [], null],
  ])('%s', (_name, held, entry, excluded, expected) => {
    const refusal = redditSubCountryGeoAddRefusal(held, entry, excluded);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('redditGeoTargetsBesideSubCountry', () => {
  it.each<[string, string[], string[], boolean | null, string[]]>([
    ['the geo targets as before while unanswered', ['US', 'CA'], ['US-CA'], null, ['US', 'CA']],
    ['the geo targets as before once off', ['US', 'CA'], ['US-CA'], false, ['US', 'CA']],
    ['the geo targets as before with no location', ['US', 'CA'], [], true, ['US', 'CA']],
    ['each location country dropped', ['US', 'CA', 'GB'], ['us-ca', 'CA:6167865'], true, ['GB']],
    ['the US dropped for a DMA', ['US'], ['662'], true, []],
    ['nothing dropped for a malformed id, which the refusal names', ['US'], ['nope'], true, ['US']],
  ])('sends %s', (_name, geoTargets, subCountry, enabled, expected) => {
    expect(redditGeoTargetsBesideSubCountry(geoTargets, subCountry, enabled)).toEqual(expected);
  });
});

describe('redditSubCountryGeoField', () => {
  it.each<[string, string[], boolean | null, object]>([
    ['the list on a yes', ['US-CA'], true, { subCountryGeoTargets: ['US-CA'] }],
    ['nothing for an empty list', [], true, {}],
    ['nothing while unanswered', ['US-CA'], null, {}],
    ['nothing once off', ['US-CA'], false, {}],
  ])('sends %s', (_name, list, enabled, expected) => {
    expect(redditSubCountryGeoField(list, enabled)).toEqual(expected);
  });
});

describe('redditSubCountryGeoDraftRefusal', () => {
  it.each<[string, string[], string[], string[], boolean | null, string | null]>([
    ['locations beside other countries', ['US-CA'], ['GB'], [], true, null],
    ['a location inside an excluded country, added after it', ['CA:6167865'], [], ['CA'], true, 'Location 1 (CA:6167865) is inside an excluded country'],
    ['a location inside a targeted country', ['US-CA'], ['US'], [], true, 'already target'],
    ['a malformed restored entry, named by its id', ['US-CA', 'nope'], [], [], true, 'Location 2 (nope) is not a Reddit region'],
    ['nothing while off, as nothing is sent', ['nope'], [], [], false, null],
    ['nothing with no location', [], ['US'], [], true, null],
  ])('%s', (_name, list, geoTargets, excluded, enabled, expected) => {
    const refusal = redditSubCountryGeoDraftRefusal(list, geoTargets, excluded, enabled);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toContain(expected);
  });
});

describe('redditSubCountryGeoFromDraft', () => {
  it.each<[unknown, unknown]>([
    [undefined, undefined],
    ['US-CA', undefined],
    [
      ['US-CA', 4, '662'],
      ['US-CA', '662'],
    ],
  ])('reads %j as %j', (stored, expected) => {
    expect(redditSubCountryGeoFromDraft(stored)).toEqual(expected);
  });
});
