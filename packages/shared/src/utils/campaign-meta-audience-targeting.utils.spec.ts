// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { DEFAULT_META_AUDIENCE_TARGETING } from '../constants/campaign.constants';
import type { MetaAudienceTargetingBlockInput } from '../interfaces/campaign.interface';
import {
  compactMetaAudienceTargeting,
  metaAudienceTargetingBlock,
  metaAudienceTargetingCapabilities,
  metaAudienceTargetingRefusal,
  metaTargetingNamesCustomAudiences,
} from './campaign-meta-audience-targeting.utils';

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

describe('metaAudienceTargetingCapabilities', () => {
  it.each([
    // Only an explicit yes offers targeting; custom audiences also need targeting itself.
    [null, null, false, false],
    [false, true, false, false],
    [null, true, false, false],
    [true, null, true, false],
    [true, false, true, false],
    [true, true, true, true],
  ])('targeting %s, custom audiences %s: %s, %s', (targeting, custom, targetingAvailable, customAudiencesAvailable) => {
    expect(metaAudienceTargetingCapabilities(targeting, custom)).toEqual({ targetingAvailable, customAudiencesAvailable });
  });
});

describe('metaAudienceTargetingBlock', () => {
  const ages = { ...DEFAULT_META_AUDIENCE_TARGETING, ageMin: 25 };
  const custom = { ...DEFAULT_META_AUDIENCE_TARGETING, customAudiences: ['1001'] };
  const base: MetaAudienceTargetingBlockInput = {
    targeting: ages,
    targetingEnabled: true,
    customAudiencesEnabled: true,
    createCapabilityRead: 'ready',
    briefId: 'brief-1',
  };
  const kind = (overrides: Partial<MetaAudienceTargetingBlockInput>) => metaAudienceTargetingBlock({ ...base, ...overrides })?.kind ?? null;

  it.each([
    // Nothing chosen (defaults only) never holds Create, whatever the deployment says.
    [{ targeting: DEFAULT_META_AUDIENCE_TARGETING, targetingEnabled: false }, null],
    [{ targeting: null, targetingEnabled: null }, null],
    // Sendable: targeting on, and custom audiences either unused or allowed.
    [{}, null],
    [{ targeting: custom }, null],
    [{ targetingEnabled: true, customAudiencesEnabled: false }, null],
    // Targeting answered no: Clear.
    [{ targetingEnabled: false }, 'unsupported'],
    // Custom audiences answered no for this caller: Remove.
    [{ targeting: custom, customAudiencesEnabled: false }, 'restricted'],
    // Unanswered: wait, save first, or Retry.
    [{ targetingEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    [{ targetingEnabled: null, briefId: null }, 'unsaved'],
    [{ targetingEnabled: null, createCapabilityRead: 'failed' }, 'failed'],
    [{ targeting: custom, customAudiencesEnabled: null, createCapabilityRead: 'pending' }, 'pending'],
    [{ targeting: custom, customAudiencesEnabled: null, createCapabilityRead: 'failed' }, 'failed'],
  ] as [Partial<MetaAudienceTargetingBlockInput>, string | null][])('%j holds as %j', (overrides, expected) => {
    expect(kind(overrides)).toBe(expected);
  });

  it('names custom audiences, and offers Remove, once targeting itself is sendable', () => {
    expect(metaAudienceTargetingBlock({ ...base, targeting: custom, customAudiencesEnabled: null, createCapabilityRead: 'failed' })?.message).toBe(
      'Could not confirm that you can send Meta custom audiences, so Create waits rather than dropping the targeting on this brief. Retry the check, or remove them.'
    );
    expect(metaAudienceTargetingBlock({ ...base, targetingEnabled: null, briefId: null })?.message).toBe(
      "Meta audience targeting can't be checked until this brief is saved. Save the brief."
    );
  });
});
