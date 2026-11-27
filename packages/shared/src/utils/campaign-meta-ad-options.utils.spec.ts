// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { CampaignCapabilityReadState, MetaAdOptionsEnabled } from '../interfaces/campaign.interface';
import {
  compactMetaAdOptions,
  metaAdOptionLabel,
  metaAdOptionsBlock,
  metaAdOptionsForCreate,
  metaAdOptionsForObjective,
  metaAdOptionsRefusal,
  metaAdOptionsWithChoice,
  metaAdOptionsWithoutUnsupported,
  metaConfigRecord,
  metaConfigKeyVariant,
} from './campaign-meta-ad-options.utils';

describe('metaAdOptionsRefusal', () => {
  it.each([
    [undefined, 'traffic', false],
    [{}, 'conversions', true],
    [{ callToAction: 'sign_up', conversionEvent: null, optimizationGoal: ' ' }, 'awareness', false],
    [{ callToAction: 'BUY_TICKETS', conversionEvent: 'COMPLETE_REGISTRATION' }, 'conversions', false],
    // An absent objective is campaign-service's default, traffic.
    [{ optimizationGoal: 'LANDING_PAGE_VIEWS' }, undefined, false],
    [{ optimizationGoal: 'LINK_CLICKS' }, 'traffic', true],
    // The objective is matched ignoring case, as campaign-service does.
    [{ conversionEvent: 'LEAD' }, ' CONVERSIONS ', false],
    [{ optimizationGoal: 'LINK_CLICKS' }, 'Traffic', false],
  ])('accepts %j under %s (manual bidding %s)', (raw, objective, manual) => {
    expect(metaAdOptionsRefusal(raw, objective, manual)).toBeNull();
  });

  it.each([
    ['a non-string', { callToAction: 3 }, 'traffic', false, 'metaConfig.callToAction'],
    ['a call to action outside the list', { callToAction: 'REGISTER_NOW' }, 'traffic', false, 'metaConfig.callToAction'],
    ['a conversion event outside the list', { conversionEvent: 'VIEW_CONTENT' }, 'conversions', false, 'metaConfig.conversionEvent'],
    ['a conversion event off conversions', { conversionEvent: 'LEAD' }, 'traffic', false, 'metaConfig.conversionEvent'],
    ['an optimization goal off traffic', { optimizationGoal: 'LINK_CLICKS' }, 'leads', false, 'metaConfig.optimizationGoal'],
    ['landing page views with manual bidding', { optimizationGoal: 'landing_page_views' }, 'traffic', true, 'metaConfig.optimizationGoal'],
  ])('refuses %s', (_label, raw, objective, manual, field) => {
    expect(metaAdOptionsRefusal(raw, objective, manual)?.field).toBe(field);
  });
});

describe('compactMetaAdOptions', () => {
  it('keeps every explicit value, the defaults included, trimmed and upper case, and drops "Not set"', () => {
    expect(compactMetaAdOptions({ callToAction: ' learn_more ', conversionEvent: '', optimizationGoal: null })).toEqual({ callToAction: 'LEARN_MORE' });
    expect(compactMetaAdOptions(undefined)).toEqual({});
  });

  it('labels a value for the dropdown', () => {
    expect(metaAdOptionLabel('COMPLETE_REGISTRATION')).toBe('Complete registration');
  });

  it.each([[null], ['SIGN_UP'], [['SIGN_UP']], [42]])('treats a non-object body (%j) as no choices, never a cast', (raw) => {
    expect(metaConfigRecord(raw)).toBeUndefined();
    expect(metaAdOptionsRefusal(raw, 'traffic', false)).toBeNull();
    expect(compactMetaAdOptions(raw)).toEqual({});
  });
});

describe('metaAdOptionsForCreate', () => {
  const enabled: MetaAdOptionsEnabled = { callToAction: true, conversionEvent: false, optimizationGoal: null };

  it('sends each choice only on an explicit yes, compacted', () => {
    expect(metaAdOptionsForCreate({ callToAction: ' sign_up ', conversionEvent: 'LEAD', optimizationGoal: 'LINK_CLICKS' }, enabled)).toEqual({
      callToAction: 'SIGN_UP',
    });
  });

  it('never sends a "Not set" choice', () => {
    expect(metaAdOptionsForCreate({ callToAction: '  ' }, enabled)).toEqual({});
    expect(metaAdOptionsForCreate({}, { callToAction: true })).toEqual({});
  });
});

describe('metaAdOptionsWithChoice', () => {
  it.each([
    [{}, 'callToAction', 'SIGN_UP', { callToAction: 'SIGN_UP' }],
    [{ callToAction: 'SIGN_UP' }, 'callToAction', 'LEARN_MORE', { callToAction: 'LEARN_MORE' }],
    // "Not set" (empty or null) removes the key, so nothing is sent.
    [{ callToAction: 'SIGN_UP', conversionEvent: 'LEAD' }, 'callToAction', '', { conversionEvent: 'LEAD' }],
    [{ callToAction: 'SIGN_UP' }, 'callToAction', null, {}],
  ] as const)('%j with %s = %j gives %j', (options, key, value, expected) => {
    const before = { ...options };
    expect(metaAdOptionsWithChoice(options, key, value)).toEqual(expected);
    expect(options).toEqual(before);
  });
});

describe('metaAdOptionsForObjective', () => {
  const all = { callToAction: 'SIGN_UP', conversionEvent: 'LEAD', optimizationGoal: 'LINK_CLICKS' };

  it.each([
    ['conversions', { callToAction: 'SIGN_UP', conversionEvent: 'LEAD' }],
    ['traffic', { callToAction: 'SIGN_UP', optimizationGoal: 'LINK_CLICKS' }],
    ['awareness', { callToAction: 'SIGN_UP' }],
    // A blank objective is traffic, as upstream.
    ['', { callToAction: 'SIGN_UP', optimizationGoal: 'LINK_CLICKS' }],
  ])('keeps under %j: %j', (objective, expected) => {
    expect(metaAdOptionsForObjective(all, objective)).toEqual(expected);
  });

  it('drops a key that is not a Meta ad choice', () => {
    const raw: Record<string, string> = { bogus: 'X' };
    expect(metaAdOptionsForObjective(raw, 'traffic')).toEqual({});
  });
});

describe('metaAdOptionsWithoutUnsupported', () => {
  it('drops only the choices answered no; unanswered ones stay held', () => {
    expect(
      metaAdOptionsWithoutUnsupported(
        { callToAction: 'SIGN_UP', conversionEvent: 'LEAD', optimizationGoal: 'LINK_CLICKS' },
        { callToAction: false, conversionEvent: null }
      )
    ).toEqual({ conversionEvent: 'LEAD', optimizationGoal: 'LINK_CLICKS' });
  });
});

describe('metaAdOptionsBlock', () => {
  const kind = (options: Record<string, string>, enabled: MetaAdOptionsEnabled, read: CampaignCapabilityReadState, briefId: string | null) =>
    metaAdOptionsBlock(options, enabled, read, briefId)?.kind ?? null;

  it.each([
    // Nothing held: nothing chosen, "Not set" only, or every choice an explicit yes.
    [{}, {}, 'ready', 'brief-1', null],
    [{ callToAction: '  ' }, {}, 'ready', 'brief-1', null],
    [{ callToAction: 'SIGN_UP' }, { callToAction: true }, 'pending', 'brief-1', null],
    // Every held choice an explicit no: Clear is offered.
    [{ callToAction: 'SIGN_UP', conversionEvent: 'LEAD' }, { callToAction: false, conversionEvent: false }, 'pending', 'brief-1', 'unsupported'],
    // One unanswered among them: wait, Retry, or save first.
    [{ callToAction: 'SIGN_UP', conversionEvent: 'LEAD' }, { callToAction: false }, 'pending', 'brief-1', 'pending'],
    [{ callToAction: 'SIGN_UP' }, {}, 'ready', null, 'unsaved'],
    [{ callToAction: 'SIGN_UP' }, { callToAction: null }, 'failed', 'brief-1', 'failed'],
  ] as [Record<string, string>, MetaAdOptionsEnabled, CampaignCapabilityReadState, string | null, string | null][])(
    '%j with %j (read %s, brief %j) blocks as %j',
    (options, enabled, read, briefId, expected) => {
      expect(kind(options, enabled, read, briefId)).toBe(expected);
    }
  );

  it('names the held choices in field order', () => {
    expect(
      metaAdOptionsBlock({ optimizationGoal: 'LINK_CLICKS', callToAction: 'SIGN_UP' }, { callToAction: false, optimizationGoal: false }, 'ready', 'brief-1')
        ?.message
    ).toBe('This deployment cannot send the Meta call to action, optimization goal on this brief. Clear it to create the campaign.');
  });
});

describe('metaConfigKeyVariant', () => {
  it.each([
    [{ targeting: {}, objective: 'traffic', placements: { audienceNetwork: true } }, null],
    [{ Targeting: {} }, 'metaConfig.targeting'],
    [{ OBJECTIVE: 'awareness' }, 'metaConfig.objective'],
    [{ lifetimebudget: true }, 'metaConfig.lifetimeBudget'],
    // Go folds U+017F (long s) to s, which lower-casing alone misses.
    [{ ['adſchedule']: {} }, 'metaConfig.adSchedule'],
    [{ placements: { AudienceNetwork: true } }, 'metaConfig.placements.audienceNetwork'],
    // Every targeting key too, so a differently cased list never slips past its flag gate.
    [{ targeting: { Regions: ['3847'] } }, 'metaConfig.targeting.regions'],
    [{ targeting: { CITIES: ['2420379'] } }, 'metaConfig.targeting.cities'],
    [{ targeting: { Interests: ['6003'] } }, 'metaConfig.targeting.interests'],
    [{ targeting: { ageMin: 30, locales: [6], regions: ['3847'] } }, null],
    // The carousel format and its cards (#6331), so a differently cased one never slips past the carousel gate.
    [{ Format: 'carousel' }, 'metaConfig.format'],
    [{ VARIANTS: [] }, 'metaConfig.variants'],
    [{ variants: [], geoTargets: [] }, null],
    [null, null],
  ])('finds the field %j sends under another spelling: %s', (raw, field) => {
    expect(metaConfigKeyVariant(raw)).toBe(field);
  });
});
