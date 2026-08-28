// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  AudienceBucket,
  AudienceDemographics,
  CampaignMetricsWindow,
  CampaignServiceAudience,
  CampaignServiceAudienceBucket,
  CampaignServiceKeywords,
  CampaignServiceKeywordRow,
  KeywordMetrics,
  KeywordMetricsResponse,
} from '@lfx-one/shared/interfaces';

// ---------------------------------------------------------------------------
// campaign-service → UI conversion for the Google Ads insight reads
//
// Campaign-service answers in ITS vocabulary — micro-units, a window token, CTR as a
// fraction, one flat bucket array — and the UI's interfaces predate it: currency amounts, a
// day count, CTR as a percentage, three separate arrays. Every one of those differences is a
// silent one. A micro-unit rendered as a currency amount reads as a plausible number a
// million times too large; a fraction rendered as a percentage reads as 0.0%; neither throws.
//
// So the conversion lives here, as pure functions over plain data, rather than inline in the
// controller: it is the part of the cutover that can be wrong while everything still compiles
// and renders, which makes it the part that has to be directly testable.
//
// This module deliberately does NOT import the legacy Google Ads path. It has to outlive
// `campaign-metrics.service.ts`, whose keyword and audience queries this cutover replaces.
// ---------------------------------------------------------------------------

/** Micro-units per unit of currency, as Google Ads reports `cost_micros`. */
const MICROS_PER_UNIT = 1_000_000;

/**
 * The day counts the UI's range selector offers, mapped to campaign-service's window tokens.
 *
 * The UI type is `7 | 14 | 30` (`DateRangeOption`), and the legacy BFF already snapped any
 * other value to one of those three via `resolveDateRange` — so this mapping is exactly the
 * behaviour that ships today, not a new restriction. The HTTP route still accepts an
 * arbitrary `?days=`, which is why `windowForDays` snaps rather than rejects.
 */
const WINDOW_BY_DAYS: readonly { maxDays: number; window: CampaignMetricsWindow; effectiveDays: number }[] = [
  { maxDays: 7, window: 'last_7_days', effectiveDays: 7 },
  { maxDays: 14, window: 'last_14_days', effectiveDays: 14 },
];

/** The window used for any request wider than the largest entry above. */
const WIDEST_WINDOW: { window: CampaignMetricsWindow; effectiveDays: number } = { window: 'last_30_days', effectiveDays: 30 };

/**
 * Snap a requested day count to the window campaign-service will actually apply.
 *
 * Returns the EFFECTIVE day count alongside it, never the requested one. The distinction
 * matters because the number is echoed back to the client and shown next to the figures: a
 * response that says `days: 20` over a 30-day window labels a month of spend as three weeks.
 * The legacy path made the same choice for the same reason.
 */
export function windowForDays(days: number): { window: CampaignMetricsWindow; effectiveDays: number } {
  // A non-finite or non-positive value is not a narrower request, it is an unusable one —
  // snapping it to the NARROWEST window would silently answer a different question than the
  // caller asked. The widest window is the same value the legacy path defaulted to.
  if (!Number.isFinite(days) || days <= 0) {
    return WIDEST_WINDOW;
  }
  for (const entry of WINDOW_BY_DAYS) {
    if (days <= entry.maxDays) {
      return { window: entry.window, effectiveDays: entry.effectiveDays };
    }
  }
  return WIDEST_WINDOW;
}

/** Micro-units to a currency amount. */
function spendFromMicros(costMicros: number): number {
  return costMicros / MICROS_PER_UNIT;
}

/** A fraction (0.045) to the percentage the UI renders (4.5). */
function percentFromFraction(fraction: number): number {
  return fraction * 100;
}

/**
 * Build the Google Ads deep link for a campaign.
 *
 * Kept identical to the legacy path's link so the cutover does not silently change where the
 * "open in Google Ads" affordance points.
 */
function buildGoogleAdsUrl(campaignId: string): string {
  return campaignId ? `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}` : '';
}

function toKeywordMetrics(row: CampaignServiceKeywordRow): KeywordMetrics {
  const spend = spendFromMicros(row.cost_micros);
  return {
    keyword: row.text,
    matchType: row.match_type,
    // `quality_score` is ABSENT for a keyword Google has not rated, and the UI's field is
    // `number | null`. Mapped to null rather than 0: zero is off the 1-10 scale, so it would
    // render as the worst possible rating for exactly the keywords that have none.
    qualityScore: row.quality_score ?? null,
    status: row.status,
    adGroup: row.ad_group_name,
    adGroupId: row.ad_group_id,
    criterionId: row.criterion_id,
    campaign: row.campaign_name,
    campaignId: row.campaign_id,
    googleAdsUrl: buildGoogleAdsUrl(row.campaign_id),
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: percentFromFraction(row.ctr),
    // Derived here because campaign-service does not send it. Guarded on clicks rather than
    // computed blindly: a keyword with impressions and no clicks is ordinary, and dividing by
    // zero would put Infinity into a currency column.
    avgCpc: row.clicks > 0 ? spend / row.clicks : 0,
    spend,
    conversions: row.conversions,
  };
}

/**
 * Convert campaign-service's keyword read into the UI's `KeywordMetricsResponse`.
 *
 * `truncated` has no home in the UI interface, so the caller is responsible for it — see the
 * controller, which logs it. It is deliberately not folded into `totalKeywords`: that field
 * is the count of rows PRESENT, and inflating it to mean "how many exist" would make the
 * table's own footer disagree with the rows beneath it.
 */
export function toKeywordMetricsResponse(payload: CampaignServiceKeywords, effectiveDays: number, pulledAt: string): KeywordMetricsResponse {
  const keywords = payload.rows.map(toKeywordMetrics);

  // Totals are summed from the CONVERTED rows, so spend is already in currency units and
  // cannot be double-converted. avgCtr is recomputed from the summed counters rather than
  // averaged over per-row CTRs — averaging percentages weights a ten-impression keyword the
  // same as a ten-thousand-impression one.
  const impressions = keywords.reduce((sum, k) => sum + k.impressions, 0);
  const clicks = keywords.reduce((sum, k) => sum + k.clicks, 0);

  return {
    pulledAt,
    days: effectiveDays,
    totalKeywords: keywords.length,
    totals: {
      impressions,
      clicks,
      spend: keywords.reduce((sum, k) => sum + k.spend, 0),
      conversions: keywords.reduce((sum, k) => sum + k.conversions, 0),
      avgCtr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    },
    keywords,
  };
}

function toAudienceBucket(bucket: CampaignServiceAudienceBucket): AudienceBucket {
  return {
    label: bucket.value,
    impressions: bucket.impressions,
    clicks: bucket.clicks,
    ctr: percentFromFraction(bucket.ctr),
    spend: spendFromMicros(bucket.cost_micros),
    conversions: bucket.conversions,
  };
}

/**
 * Convert campaign-service's audience read into the UI's `AudienceDemographics`.
 *
 * Campaign-service returns ONE array discriminated by `dimension`; the UI wants three. The
 * regrouping is a filter per dimension rather than a switch accumulating into three lists,
 * so a dimension campaign-service adds later lands in none of them instead of throwing or
 * being silently appended to whichever branch happened to be last.
 *
 * Upstream orders buckets by impressions descending within each dimension, and `filter`
 * preserves that order, so the tables keep their meaningful sort without re-sorting here.
 */
export function toAudienceDemographics(payload: CampaignServiceAudience, effectiveDays: number, pulledAt: string): AudienceDemographics {
  const forDimension = (dimension: CampaignServiceAudienceBucket['dimension']): AudienceBucket[] =>
    payload.buckets.filter((b) => b.dimension === dimension).map(toAudienceBucket);

  return {
    pulledAt,
    days: effectiveDays,
    age: forDimension('age'),
    gender: forDimension('gender'),
    device: forDimension('device'),
  };
}
