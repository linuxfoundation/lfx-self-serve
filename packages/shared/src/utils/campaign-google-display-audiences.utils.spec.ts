// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  googleDisplayAudienceListRefusal,
  googleDisplayAudiencesCarried,
  googleDisplayAudiencesRefusal,
  googleDisplayAudiencesTypeRefusal,
} from './campaign-google-display-audiences.utils';

const LIST = 'customers/111/userLists/5';
const LIST_B = 'customers/111/userLists/6';
const CUSTOM = 'customers/111/customAudiences/7';
const AFFINITY = 'customers/111/customInterests/8';
const INTEREST = 'customers/111/userInterests/80001';

describe('googleDisplayAudienceListRefusal', () => {
  it('accepts absent, empty and well-formed lists, repeats and padding included', () => {
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', undefined)).toBeNull();
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', [])).toBeNull();
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', [LIST, ` ${LIST} `], '111')).toBeNull();
    expect(googleDisplayAudienceListRefusal('X', 'customAffinities', [AFFINITY], '111')).toBeNull();
  });

  it('refuses a value Go cannot decode into []string', () => {
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', 'nope')).toBe('X must be a list of Google Ads resource names.');
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', [1])).toBe('X must be a list of Google Ads resource names.');
  });

  it('refuses more than 20 raw entries, repeats counted', () => {
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', Array(21).fill(LIST))).toContain('hold 21 entries');
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', Array(20).fill(LIST))).toBeNull();
  });

  it('refuses each entry fault in upstream order, naming the entry by position', () => {
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', [LIST, '  '])).toBe('X: entry 2 is blank. Remove it.');
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', ['customers/1/userLists/x'])).toContain('entry 1 is not a Google Ads resource name');
    expect(googleDisplayAudienceListRefusal('X', 'audienceSegments', ['customers/1/audiences/2'])).toContain('is a Google Ads Audience');
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', [INTEREST])).toContain('pick it under Interests instead');
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', ['customers/1/campaigns/2'])).toContain('is not a Google Ads resource name');
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', [CUSTOM], '222')).toContain('another Google Ads account');
    expect(googleDisplayAudienceListRefusal('X', 'customAudiences', ['customers/111/customAudiences/07'], '111')).toContain('leading zeros');
  });

  it('judges the account only when it is known', () => {
    expect(googleDisplayAudienceListRefusal('X', 'userInterests', [INTEREST], '')).toBeNull();
  });

  it('refuses an exclusion of another segment kind before the cap', () => {
    expect(googleDisplayAudienceListRefusal('X', 'excludedAudienceSegments', [...Array(21).fill(LIST), CUSTOM])).toBe(
      'X: entry 22 is not a user list. Only user lists can be excluded on Display.'
    );
    expect(googleDisplayAudienceListRefusal('X', 'excludedAudienceSegments', [LIST])).toBeNull();
  });
});

describe('googleDisplayAudiencesRefusal', () => {
  it('accepts the live campaign shape on the single ad group', () => {
    expect(
      googleDisplayAudiencesRefusal(
        { audienceSegments: [LIST], customAudiences: [CUSTOM], customAffinities: [AFFINITY], userInterests: [INTEREST], excludedAudienceSegments: [LIST_B] },
        undefined,
        '111'
      )
    ).toBeNull();
  });

  it('judges the single lists before the exclusions', () => {
    expect(googleDisplayAudiencesRefusal({ customAffinities: [' '], excludedAudienceSegments: [CUSTOM] }, undefined)).toContain(
      "The single ad group's custom affinity segments: entry 1 is blank"
    );
  });

  it('refuses a user list both targeted and excluded, at either level', () => {
    expect(googleDisplayAudiencesRefusal({ audienceSegments: [` ${LIST}`], excludedAudienceSegments: [LIST] }, undefined)).toContain('also excludes');
    expect(googleDisplayAudiencesRefusal({ excludedAudienceSegments: [LIST] }, [{ audienceSegments: [LIST_B] }, { audienceSegments: [LIST] }])).toBe(
      "Display ad group 2's user lists target a user list the campaign also excludes. Keep it in one of the two and create again."
    );
  });

  it('refuses the single ad group lists beside named groups, but not the exclusions', () => {
    expect(googleDisplayAudiencesRefusal({ userInterests: [INTEREST] }, [{}])).toContain('cannot be sent with named ad groups');
    expect(googleDisplayAudiencesRefusal({ excludedAudienceSegments: [LIST] }, [{ customAudiences: [CUSTOM] }])).toBeNull();
  });

  it("names a group's bad entry by group and position", () => {
    expect(googleDisplayAudiencesRefusal(undefined, [{}, { customAudiences: [CUSTOM] }], '222')).toContain("Display ad group 2's custom audiences: entry 1");
  });
});

describe('googleDisplayAudiencesCarried', () => {
  it('counts every account-owned list at both levels, malformed values included', () => {
    expect(googleDisplayAudiencesCarried({ audienceSegments: [LIST] }, undefined)).toBe(true);
    expect(googleDisplayAudiencesCarried({ customAffinities: 'x' }, undefined)).toBe(true);
    expect(googleDisplayAudiencesCarried({ excludedAudienceSegments: [LIST] }, undefined)).toBe(true);
    expect(googleDisplayAudiencesCarried('x', undefined)).toBe(true);
    expect(googleDisplayAudiencesCarried(undefined, [{ name: 'a' }, { customAudiences: [CUSTOM] }])).toBe(true);
    expect(googleDisplayAudiencesCarried(undefined, [{ excludedAudienceSegments: [LIST] }])).toBe(true);
  });

  it('does not count user interests, empty lists or nothing', () => {
    expect(googleDisplayAudiencesCarried({ userInterests: [INTEREST], audienceSegments: [] }, [{ userInterests: [INTEREST] }])).toBe(false);
    expect(googleDisplayAudiencesCarried(null, undefined)).toBe(false);
    expect(googleDisplayAudiencesCarried({}, 'x')).toBe(false);
  });
});

describe('googleDisplayAudiencesTypeRefusal', () => {
  it('passes absent, null and lists of strings', () => {
    expect(googleDisplayAudiencesTypeRefusal(undefined, undefined)).toBeNull();
    expect(googleDisplayAudiencesTypeRefusal({ audienceSegments: null, userInterests: ['  '] }, [{ customAudiences: [] }, 'x'])).toBeNull();
  });

  it('refuses a non-object, a non-list at either level, and a group exclusion', () => {
    expect(googleDisplayAudiencesTypeRefusal([LIST], undefined)).toBe('Display audiences must be an object of audience lists.');
    expect(googleDisplayAudiencesTypeRefusal({ excludedAudienceSegments: LIST }, undefined)).toContain("The campaign's excluded user lists must be");
    expect(googleDisplayAudiencesTypeRefusal(undefined, [{ userInterests: [3] }])).toContain("Display ad group 1's interests must be");
    expect(googleDisplayAudiencesTypeRefusal(undefined, [{ excludedAudienceSegments: [LIST] }])).toContain('Display ad group 1 excludes user lists of its own');
  });
});
