// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { toPlatformAudienceView } from './campaign-audience.utils';

describe('toPlatformAudienceView', () => {
  it('splits Meta buckets into age/gender and placement, labels missing values Unknown, and converts micros', () => {
    const view = toPlatformAudienceView('meta-ads', {
      window: 'last_30_days',
      bucket_count: 3,
      account_currency: 'EUR',
      buckets: [
        { dimension: 'age_gender', age: '25-34', gender: 'female', impressions: 1000, clicks: 50, cost_micros: 2_500_000, ctr: 0.05 },
        { dimension: 'age_gender', age: '35-44', impressions: 500, clicks: 5, cost_micros: 1_000_000, ctr: 0.01 },
        { dimension: 'placement', publisher_platform: 'instagram', platform_position: 'feed', impressions: 900, clicks: 9, cost_micros: 0, ctr: 0.01 },
      ],
    });

    expect(view.sections.map((s) => s.key)).toEqual(['age_gender', 'placement']);
    expect(view.currency).toBe('EUR');
    const [first, second] = view.sections[0].rows;
    expect(first).toMatchObject({ label: '25-34 · female', impressions: 1000, spend: 2.5, barPct: 100 });
    expect(second).toMatchObject({ label: '35-44 · Unknown', barPct: 50 });
    // A measured zero stays a zero: only an ABSENT counter is "not measured".
    expect(view.sections[1].rows[0].spend).toBe(0);
  });

  it('reports a counter absent on the wire as not measured (null), never as 0', () => {
    const view = toPlatformAudienceView('meta-ads', {
      window: 'last_30_days',
      bucket_count: 1,
      buckets: [{ dimension: 'age_gender', age: '25-34', gender: 'male', impressions: 10 } as never],
    });

    const row = view.sections[0].rows[0];
    expect(row.impressions).toBe(10);
    expect(row.clicks).toBeNull();
    expect(row.spend).toBeNull();
    expect(row.ctr).toBeNull();
    expect(view.currency).toBeNull();
  });

  it('marks an all-zero X breakdown as NOT MEASURED when X says some counters were null', () => {
    const view = toPlatformAudienceView('twitter-ads', {
      window: 'last_7_days',
      bucket_count: 2,
      all_counters_null: true,
      buckets: [
        { dimension: 'age', value: '25-34', impressions: 100, clicks: 3, cost_micros: 10, ctr: 0.03 },
        { dimension: 'gender', value: 'Female', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 },
      ],
    });

    expect(view.someNotMeasured).toBe(true);
    const age = view.sections.find((s) => s.key === 'age');
    const gender = view.sections.find((s) => s.key === 'gender');
    expect(age?.notMeasured).toBe(false);
    expect(age?.rows[0].impressions).toBe(100);
    expect(gender?.notMeasured).toBe(true);
    expect(gender?.rows[0]).toMatchObject({ impressions: null, clicks: null, spend: null, ctr: null });
  });

  it('keeps an all-zero X breakdown as measured zeros when X did not flag null counters', () => {
    const view = toPlatformAudienceView('twitter-ads', {
      window: 'last_7_days',
      bucket_count: 1,
      all_counters_null: false,
      buckets: [{ dimension: 'platform', value: 'iOS', impressions: 0, clicks: 0, cost_micros: 0, ctr: 0 }],
    });

    expect(view.sections[0].notMeasured).toBe(false);
    expect(view.sections[0].rows[0].impressions).toBe(0);
  });

  it('states a Microsoft read with no finished report as building, not as empty data', () => {
    const view = toPlatformAudienceView('microsoft-ads', {
      window: 'last_30_days',
      buckets: [],
      bucket_count: 0,
      metrics_pending: true,
      data_incomplete: false,
    });

    expect(view.reportBuilding).toBe(true);
    expect(view.metricsPending).toBe(true);
    expect(view.empty).toBe(true);
  });

  it('splits Reddit into gender, country and community, and labels a value-less bucket Unattributed', () => {
    const view = toPlatformAudienceView('reddit-ads', {
      window: 'last_30_days',
      bucket_count: 3,
      buckets: [
        { dimension: 'community', value: 'kubernetes', impressions: 50, clicks: 5, cost_micros: 500_000, ctr: 0.1 },
        { dimension: 'gender', impressions: 30, clicks: 1, cost_micros: 0, ctr: 0.03 },
        { dimension: 'country', value: 'US', impressions: 80, clicks: 8, cost_micros: 1_000_000, ctr: 0.1 },
      ],
    });

    expect(view.sections.map((s) => s.title)).toEqual(['Gender', 'Country', 'Community (subreddit)']);
    expect(view.sections[0].rows[0].label).toBe('Unattributed');
    // Reddit does not report the account's currency.
    expect(view.currency).toBeNull();
  });

  it('orders LinkedIn pivots by the contract, prices them in USD and flags them approximate', () => {
    const view = toPlatformAudienceView('linkedin-ads', {
      window: 'last_30_days',
      bucket_count: 2,
      approximate: true,
      buckets: [
        { dimension: 'country', value: 'urn:li:geo:103644278', impressions: 10, clicks: 1, cost_micros: 1, ctr: 0.1 },
        { dimension: 'job_function', value: 'urn:li:function:8', impressions: 20, clicks: 2, cost_micros: 2, ctr: 0.1 },
      ],
    });

    expect(view.sections.map((s) => s.title)).toEqual(['Job function', 'Country']);
    expect(view.sections[0].rows[0].label).toBe('urn:li:function:8');
    expect(view.currency).toBe('USD');
    expect(view.approximate).toBe(true);
  });
});
