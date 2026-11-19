// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { compactMetaAdOptions, metaAdOptionLabel, metaAdOptionsRefusal } from './campaign-meta-ad-options.utils';

describe('metaAdOptionsRefusal', () => {
  it.each([
    [undefined, 'traffic', false],
    [{}, 'conversions', true],
    [{ callToAction: 'sign_up', conversionEvent: null, optimizationGoal: ' ' }, 'awareness', false],
    [{ callToAction: 'BUY_TICKETS', conversionEvent: 'COMPLETE_REGISTRATION' }, 'conversions', false],
    // An absent objective is campaign-service's default, traffic.
    [{ optimizationGoal: 'LANDING_PAGE_VIEWS' }, undefined, false],
    [{ optimizationGoal: 'LINK_CLICKS' }, 'traffic', true],
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
});
