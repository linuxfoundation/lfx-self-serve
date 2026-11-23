// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { metaAdOptionViews } from './campaign-meta-ad-option-views.utils';

describe('metaAdOptionViews', () => {
  const all = { callToAction: true, conversionEvent: true, optimizationGoal: true } as const;
  const keys = (enabled: Record<string, boolean | null>, objective: string) => metaAdOptionViews(enabled, objective, false, false).map((v) => v.key);
  const disabled = (objective: string, manualBidding: boolean, leadForm: boolean, key: string) =>
    metaAdOptionViews(all, objective, manualBidding, leadForm)
      .find((v) => v.key === key)
      ?.options.filter((o) => o.disabled)
      .map((o) => o.value);

  it.each([
    // Each dropdown only on an explicit yes and where the objective takes it.
    [all, 'conversions', ['callToAction', 'conversionEvent']],
    [all, 'traffic', ['callToAction', 'optimizationGoal']],
    [all, 'awareness', ['callToAction']],
    [{ callToAction: null, conversionEvent: true }, 'conversions', ['conversionEvent']],
    [{ callToAction: false }, 'traffic', []],
  ])('with %j under %s offers %j', (enabled, objective, expected) => {
    expect(keys(enabled, objective)).toEqual(expected);
  });

  it("labels the options and names campaign-service's default for Not set", () => {
    const goal = metaAdOptionViews(all, 'traffic', false, false).find((v) => v.key === 'optimizationGoal');
    expect(goal?.notSetLabel).toBe('Not set (Link clicks)');
    expect(goal?.options.map((o) => o.label)).toEqual(['Link clicks', 'Landing page views']);
  });

  it('disables landing page views only under manual bidding', () => {
    expect(disabled('traffic', true, false, 'optimizationGoal')).toEqual(['LANDING_PAGE_VIEWS']);
    expect(disabled('traffic', false, false, 'optimizationGoal')).toEqual([]);
  });

  it('disables the calls to action a lead form cannot carry only while one is sent', () => {
    expect(disabled('leads', false, true, 'callToAction')).toEqual(['BUY_TICKETS', 'BOOK_NOW', 'WATCH_MORE', 'CONTACT_US']);
    expect(disabled('leads', false, false, 'callToAction')).toEqual([]);
  });
});
