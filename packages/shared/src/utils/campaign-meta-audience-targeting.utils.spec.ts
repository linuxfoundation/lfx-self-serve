// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_META_AUDIENCE_TARGETING } from '../constants/campaign.constants';
import { compactMetaAudienceTargeting, metaAudienceTargetingRefusal, metaTargetingNamesCustomAudiences } from './campaign-meta-audience-targeting.utils';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(1000 + i));

describe('metaAudienceTargetingRefusal', () => {
  it.each([
    [undefined],
    [null],
    [{}],
    [DEFAULT_META_AUDIENCE_TARGETING],
    [{ ageMin: 25, ageMax: 65, advantageAudience: true, genders: ['Male'] }],
    [{ ageMin: 40, ageMax: 50, advantageAudience: false }],
  ])('accepts %j', (raw) => expect(metaAudienceTargetingRefusal(raw)).toBeNull());

  it.each([
    ['a non-object', 'x', 'metaConfig.targeting'],
    ['an age below 18', { ageMin: 17 }, 'metaConfig.targeting.ageMin'],
    ['a fractional age', { ageMax: 30.5 }, 'metaConfig.targeting.ageMax'],
    ['a string age', { ageMin: '20' }, 'metaConfig.targeting.ageMin'],
    ['ageMin above ageMax', { ageMin: 40, ageMax: 30 }, 'metaConfig.targeting.ageMin'],
    ['an unknown gender', { genders: ['other'] }, 'metaConfig.targeting.genders'],
    ['a non-numeric audience id', { customAudiences: ['abc'] }, 'metaConfig.targeting.customAudiences'],
    ['a leading-zero audience id', { excludedCustomAudiences: ['0123'] }, 'metaConfig.targeting.excludedCustomAudiences'],
    ['26 distinct audiences', { customAudiences: ids(26) }, 'metaConfig.targeting.customAudiences'],
    ['an id in both lists', { customAudiences: ['1001'], excludedCustomAudiences: [' 1001'] }, 'metaConfig.targeting.excludedCustomAudiences'],
    ['a non-boolean advantageAudience', { advantageAudience: 'yes' }, 'metaConfig.targeting.advantageAudience'],
    ['Advantage+ with ageMin over 25', { advantageAudience: true, ageMin: 30 }, 'metaConfig.targeting.advantageAudience'],
    ['Advantage+ with ageMax under 65', { advantageAudience: true, ageMax: 60 }, 'metaConfig.targeting.advantageAudience'],
  ])('refuses %s', (_label, raw, field) => {
    expect(metaAudienceTargetingRefusal(raw)?.field).toBe(field);
  });

  it('counts distinct ids against the cap', () => {
    expect(metaAudienceTargetingRefusal({ customAudiences: [...ids(25), '1000'] })).toBeNull();
  });
});

describe('compactMetaAudienceTargeting', () => {
  it('sends nothing for the defaults', () => {
    expect(compactMetaAudienceTargeting(DEFAULT_META_AUDIENCE_TARGETING)).toBeNull();
    expect(compactMetaAudienceTargeting({ genders: ['male', 'female'], advantageAudience: undefined })).toBeNull();
  });

  it('keeps an explicit Advantage+ choice, false included, which alone is something to send', () => {
    expect(compactMetaAudienceTargeting({ advantageAudience: false })).toEqual({ advantageAudience: false });
    expect(compactMetaAudienceTargeting({ excludedCustomAudiences: ['1001'], advantageAudience: false })).toEqual({
      excludedCustomAudiences: ['1001'],
      advantageAudience: false,
    });
  });

  it('keeps only what differs from Meta defaults, trimmed and de-duplicated', () => {
    expect(
      compactMetaAudienceTargeting({
        ageMin: 25,
        ageMax: 65,
        genders: ['female', 'female'],
        customAudiences: [' 1001', '1001'],
        excludedCustomAudiences: [],
        advantageAudience: true,
      })
    ).toEqual({ ageMin: 25, genders: ['female'], customAudiences: ['1001'], advantageAudience: true });
  });

  it('reports whether a custom audience is named', () => {
    expect(metaTargetingNamesCustomAudiences(compactMetaAudienceTargeting({ excludedCustomAudiences: ['1001'] }))).toBe(true);
    expect(metaTargetingNamesCustomAudiences(compactMetaAudienceTargeting({ ageMin: 30 }))).toBe(false);
  });
});
