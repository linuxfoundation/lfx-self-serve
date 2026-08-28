// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignServiceAudience, CampaignServiceKeywords } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { toAudienceDemographics, toKeywordMetricsResponse, windowForDays } from './campaign-insights-mapper';

// These tests exist for the unit conversions specifically. Every difference between
// campaign-service's vocabulary and the UI's is silent when wrong: micro-units rendered as
// currency are a million times too large, a fraction rendered as a percentage is 0.0%, and
// neither throws or fails a type check. The assertions below therefore pin VALUES, and use
// numbers where a missed or doubled conversion cannot coincide with the right answer.

const PULLED_AT = '2026-08-28T00:00:00.000Z';

function keywordsPayload(overrides: Partial<CampaignServiceKeywords['rows'][number]> = {}): CampaignServiceKeywords {
  return {
    window: 'last_30_days',
    row_count: 1,
    truncated: false,
    rows: [
      {
        criterion_id: '305729261',
        ad_group_id: '176216228',
        campaign_id: '555',
        ad_group_name: 'Registration - Exact',
        campaign_name: 'KubeCon NA 2026 - Search',
        text: 'kubernetes training',
        match_type: 'EXACT',
        status: 'ENABLED',
        impressions: 1000,
        clicks: 40,
        cost_micros: 25_000_000,
        ctr: 0.04,
        conversions: 12.5,
        quality_score: 7,
        ...overrides,
      },
    ],
  };
}

describe('windowForDays', () => {
  // The three the UI's range selector actually offers.
  it.each([
    [7, 'last_7_days', 7],
    [14, 'last_14_days', 14],
    [30, 'last_30_days', 30],
  ])('maps %i days to %s', (days, window, effectiveDays) => {
    expect(windowForDays(days)).toEqual({ window, effectiveDays });
  });

  // The HTTP route accepts an arbitrary ?days=, so values between the offered ones must snap
  // UP to a window that covers them rather than down to one that does not.
  it.each([
    [1, 'last_7_days', 7],
    [8, 'last_14_days', 14],
    [20, 'last_30_days', 30],
    [365, 'last_30_days', 30],
  ])('snaps %i days to %s', (days, window, effectiveDays) => {
    expect(windowForDays(days)).toEqual({ window, effectiveDays });
  });

  // The reported day count must be the EFFECTIVE one, never the requested one — the number is
  // shown beside the figures, so echoing 20 over a 30-day window mislabels a month as three
  // weeks.
  it('reports the effective day count, not the requested one', () => {
    expect(windowForDays(20).effectiveDays).toBe(30);
    expect(windowForDays(9).effectiveDays).toBe(14);
  });

  // An unusable value must not become the NARROWEST window: that would answer a different
  // question than the caller asked, quietly.
  it.each([[0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY]])('falls back to the widest window for %p', (days) => {
    expect(windowForDays(days as number)).toEqual({ window: 'last_30_days', effectiveDays: 30 });
  });
});

describe('toKeywordMetricsResponse', () => {
  it('converts micro-units to a currency amount', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload(), 30, PULLED_AT);
    // 25_000_000 micros = 25.00. A missed conversion yields 25000000, a doubled one 0.000025;
    // neither can be mistaken for 25.
    expect(keywords[0].spend).toBe(25);
  });

  it('converts the CTR fraction to a percentage', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload(), 30, PULLED_AT);
    // 0.04 -> 4. Not 0.04 (unconverted) and not 400 (doubled).
    expect(keywords[0].ctr).toBe(4);
  });

  it('derives avgCpc in currency units', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload(), 30, PULLED_AT);
    // 25.00 spend over 40 clicks.
    expect(keywords[0].avgCpc).toBe(0.625);
  });

  // A keyword with impressions but no clicks is ordinary, not an error — dividing by zero
  // would put Infinity into a currency column, which renders but is not a number.
  it('reports avgCpc as 0 when a keyword has no clicks', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload({ clicks: 0 }), 30, PULLED_AT);
    expect(keywords[0].avgCpc).toBe(0);
    expect(Number.isFinite(keywords[0].avgCpc)).toBe(true);
  });

  it('maps the display names onto the UI fields', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload(), 30, PULLED_AT);
    // Asserted separately, with different values: a mapper that crossed the two would pass
    // against a shared placeholder.
    expect(keywords[0].adGroup).toBe('Registration - Exact');
    expect(keywords[0].campaign).toBe('KubeCon NA 2026 - Search');
  });

  // An unrated keyword must reach the UI as null. Zero is off the 1-10 scale, so a
  // zero-defaulted score presents every unrated keyword as the worst-rated one.
  it('maps an absent quality score to null, not 0', () => {
    const payload = keywordsPayload();
    delete payload.rows[0].quality_score;
    const { keywords } = toKeywordMetricsResponse(payload, 30, PULLED_AT);
    expect(keywords[0].qualityScore).toBeNull();
  });

  it('keeps a present quality score', () => {
    const { keywords } = toKeywordMetricsResponse(keywordsPayload(), 30, PULLED_AT);
    expect(keywords[0].qualityScore).toBe(7);
  });

  // Totals are summed from CONVERTED rows, so a double conversion here would show up as a
  // total that disagrees with its own rows.
  it('totals spend in currency units across rows', () => {
    const payload = keywordsPayload();
    payload.rows.push({ ...payload.rows[0], criterion_id: '2', cost_micros: 5_000_000, clicks: 10, impressions: 500 });
    const { totals } = toKeywordMetricsResponse(payload, 30, PULLED_AT);
    expect(totals.spend).toBe(30);
  });

  // avgCtr must be recomputed from summed counters, never averaged over per-row CTRs —
  // averaging weights a 500-impression keyword the same as a 1000-impression one.
  it('recomputes avgCtr from summed counters rather than averaging row CTRs', () => {
    const payload = keywordsPayload();
    // Row 2 has a 0% CTR. Weighted: 40 clicks / 1500 impressions = 2.666…%.
    // A naive average of the two row CTRs (4% and 0%) would give 2%.
    payload.rows.push({ ...payload.rows[0], criterion_id: '2', impressions: 500, clicks: 0, ctr: 0 });
    const { totals } = toKeywordMetricsResponse(payload, 30, PULLED_AT);
    expect(totals.avgCtr).toBeCloseTo((40 / 1500) * 100, 10);
    expect(totals.avgCtr).not.toBeCloseTo(2, 10);
  });

  it('reports zero avgCtr without dividing by zero when there are no impressions', () => {
    const { totals } = toKeywordMetricsResponse({ window: 'last_30_days', rows: [], row_count: 0, truncated: false }, 30, PULLED_AT);
    expect(totals.avgCtr).toBe(0);
    expect(totals.impressions).toBe(0);
  });

  // totalKeywords counts the rows PRESENT. Inflating it to mean "how many exist upstream"
  // would make the table's footer disagree with the rows beneath it.
  it('counts the rows present even when the result is truncated', () => {
    const payload = keywordsPayload();
    payload.truncated = true;
    const result = toKeywordMetricsResponse(payload, 30, PULLED_AT);
    expect(result.totalKeywords).toBe(1);
  });

  it('reports the effective day count it was given', () => {
    expect(toKeywordMetricsResponse(keywordsPayload(), 14, PULLED_AT).days).toBe(14);
  });
});

describe('toAudienceDemographics', () => {
  const payload: CampaignServiceAudience = {
    window: 'last_30_days',
    bucket_count: 4,
    buckets: [
      { dimension: 'age', value: 'AGE_RANGE_25_34', impressions: 1000, clicks: 40, cost_micros: 25_000_000, ctr: 0.04, conversions: 12.5 },
      { dimension: 'age', value: 'AGE_RANGE_35_44', impressions: 500, clicks: 10, cost_micros: 5_000_000, ctr: 0.02, conversions: 3 },
      { dimension: 'gender', value: 'MALE', impressions: 900, clicks: 30, cost_micros: 9_000_000, ctr: 0.0333, conversions: 8 },
      { dimension: 'device', value: 'MOBILE', impressions: 700, clicks: 21, cost_micros: 7_000_000, ctr: 0.03, conversions: 5 },
    ],
  };

  // The flat, dimension-discriminated array must be regrouped into the three the UI renders.
  it('splits the flat bucket array into age, gender and device', () => {
    const result = toAudienceDemographics(payload, 30, PULLED_AT);
    expect(result.age.map((b) => b.label)).toEqual(['AGE_RANGE_25_34', 'AGE_RANGE_35_44']);
    expect(result.gender.map((b) => b.label)).toEqual(['MALE']);
    expect(result.device.map((b) => b.label)).toEqual(['MOBILE']);
  });

  it('converts bucket micro-units and CTR fractions', () => {
    const result = toAudienceDemographics(payload, 30, PULLED_AT);
    expect(result.age[0].spend).toBe(25);
    expect(result.age[0].ctr).toBe(4);
    expect(result.age[0].conversions).toBe(12.5);
  });

  // Upstream orders by impressions descending within a dimension; the regrouping must not
  // disturb it, or the tables lose their meaningful sort.
  it('preserves the upstream order within a dimension', () => {
    const result = toAudienceDemographics(payload, 30, PULLED_AT);
    expect(result.age[0].impressions).toBeGreaterThan(result.age[1].impressions);
  });

  // A dimension campaign-service adds later must land in none of the three rather than being
  // appended to whichever branch happened to be last.
  it('ignores a dimension the UI does not render', () => {
    const withUnknown: CampaignServiceAudience = {
      ...payload,
      buckets: [
        ...payload.buckets,
        { dimension: 'household_income' as never, value: 'TOP_10', impressions: 5, clicks: 1, cost_micros: 0, ctr: 0.2, conversions: 0 },
      ],
    };
    const result = toAudienceDemographics(withUnknown, 30, PULLED_AT);
    expect(result.age).toHaveLength(2);
    expect(result.gender).toHaveLength(1);
    expect(result.device).toHaveLength(1);
  });

  it('returns empty arrays for a project with no buckets', () => {
    const result = toAudienceDemographics({ window: 'last_30_days', buckets: [], bucket_count: 0 }, 30, PULLED_AT);
    expect(result.age).toEqual([]);
    expect(result.gender).toEqual([]);
    expect(result.device).toEqual([]);
  });
});
