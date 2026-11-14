// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  PLATFORM_AUDIENCE_SECTION_TITLES,
  PLATFORM_AUDIENCE_UNATTRIBUTED_LABEL,
  PLATFORM_AUDIENCE_UNKNOWN_LABEL,
} from '../constants/campaign-optimize.constants';
import type {
  CampaignServiceLinkedInAdsAudience,
  CampaignServiceMetaAdsAudience,
  CampaignServiceMicrosoftAdsAudience,
  CampaignServicePlatformAudienceMap,
  CampaignServiceRedditAdsAudience,
  CampaignServiceTwitterAdsAudience,
  PlatformAudiencePanelPlatform,
  PlatformAudienceRow,
  PlatformAudienceSection,
  PlatformAudienceView,
} from '../interfaces/campaign-optimize.interface';

/** The counters every audience bucket carries, read defensively off the unvalidated wire. */
interface AudienceCounters {
  impressions?: unknown;
  clicks?: unknown;
  cost_micros?: unknown;
  ctr?: unknown;
}

/** One bucket on its way to a row: the section it belongs to, its label, and its counters. */
interface PendingRow {
  section: string;
  label: string;
  counters: AudienceCounters;
}

/**
 * Normalise one platform's audience read into the panel's sections.
 *
 * The rule the panel exists to keep: a counter that was NOT measured is `null`, never `0`. That is
 * a counter absent (or not a finite number) on the wire, and every counter of a breakdown the
 * platform said it did not measure — X's `all_counters_null` names no dimension, so a breakdown is
 * taken as unmeasured when every one of its counters is zero (a measured breakdown with traffic
 * cannot be all zeros). A label the platform did not report is shown as Unknown, not dropped.
 *
 * Sections follow `PLATFORM_AUDIENCE_SECTION_TITLES` order; a breakdown the platform returned no
 * bucket for is omitted rather than shown empty. Rows keep upstream's own order (impressions
 * descending within a dimension).
 */
export function toPlatformAudienceView<P extends PlatformAudiencePanelPlatform>(
  platform: P,
  data: CampaignServicePlatformAudienceMap[P]
): PlatformAudienceView {
  const view: PlatformAudienceView = {
    sections: [],
    currency: null,
    approximate: false,
    reportBuilding: false,
    metricsPending: false,
    dataIncomplete: false,
    metricsAsOf: null,
    someNotMeasured: false,
    empty: true,
  };
  let pending: PendingRow[] = [];

  switch (platform) {
    case 'meta-ads': {
      const meta = data as CampaignServiceMetaAdsAudience;
      view.currency = readCurrency(meta.account_currency);
      pending = bucketsOf(meta).map((bucket) =>
        bucket.dimension === 'placement'
          ? { section: 'placement', label: joinLabel(bucket.publisher_platform, bucket.platform_position), counters: bucket }
          : { section: 'age_gender', label: joinLabel(bucket.age, bucket.gender), counters: bucket }
      );
      break;
    }
    case 'linkedin-ads': {
      const linkedIn = data as CampaignServiceLinkedInAdsAudience;
      // LinkedIn reports cost as costInUsd, and every counter as an estimate.
      view.currency = 'USD';
      view.approximate = linkedIn.approximate !== false;
      pending = bucketsOf(linkedIn).map((bucket) => ({ section: String(bucket.dimension), label: labelOf(bucket.value), counters: bucket }));
      break;
    }
    case 'microsoft-ads': {
      const microsoft = data as CampaignServiceMicrosoftAdsAudience;
      view.metricsAsOf = typeof microsoft.metrics_as_of === 'string' && microsoft.metrics_as_of !== '' ? microsoft.metrics_as_of : null;
      view.reportBuilding = view.metricsAsOf === null;
      view.metricsPending = microsoft.metrics_pending === true;
      view.dataIncomplete = microsoft.data_incomplete === true;
      pending = bucketsOf(microsoft).map((bucket) => ({ section: 'age_gender', label: joinLabel(bucket.age_group, bucket.gender), counters: bucket }));
      break;
    }
    case 'reddit-ads': {
      // No currency on the read: spend is in the ad account's own, which Reddit does not report.
      const reddit = data as CampaignServiceRedditAdsAudience;
      pending = bucketsOf(reddit).map((bucket) => ({
        section: String(bucket.dimension),
        label: labelOf(bucket.value, PLATFORM_AUDIENCE_UNATTRIBUTED_LABEL),
        counters: bucket,
      }));
      break;
    }
    case 'twitter-ads': {
      const twitter = data as CampaignServiceTwitterAdsAudience;
      view.currency = readCurrency(twitter.account_currency);
      view.someNotMeasured = twitter.all_counters_null === true;
      pending = bucketsOf(twitter).map((bucket) => ({ section: String(bucket.dimension), label: labelOf(bucket.value), counters: bucket }));
      break;
    }
  }

  const titles = PLATFORM_AUDIENCE_SECTION_TITLES[platform];
  for (const [key, title] of Object.entries(titles)) {
    const members = pending.filter((row) => row.section === key);
    if (members.length > 0) {
      view.sections.push(toSection(key, title, members, view.someNotMeasured));
    }
  }
  view.empty = view.sections.length === 0;
  return view;
}

function toSection(key: string, title: string, members: PendingRow[], platformSaidUnmeasured: boolean): PlatformAudienceSection {
  const allZero = members.every(
    (row) => readCounter(row.counters.impressions) === 0 && readCounter(row.counters.clicks) === 0 && readCounter(row.counters.cost_micros) === 0
  );
  const notMeasured = platformSaidUnmeasured && allZero;
  const rows: PlatformAudienceRow[] = members.map((row, index) => {
    const impressions = notMeasured ? null : readCounter(row.counters.impressions);
    const clicks = notMeasured ? null : readCounter(row.counters.clicks);
    const costMicros = notMeasured ? null : readCounter(row.counters.cost_micros);
    const ctr = notMeasured ? null : readCounter(row.counters.ctr);
    return { key: `${key}-${index}`, label: row.label, impressions, clicks, spend: costMicros === null ? null : costMicros / 1_000_000, ctr, barPct: 0 };
  });
  const max = Math.max(0, ...rows.map((row) => row.impressions ?? 0));
  for (const row of rows) {
    row.barPct = max > 0 && row.impressions !== null ? (row.impressions / max) * 100 : 0;
  }
  return { key, title, rows, notMeasured };
}

function bucketsOf<T>(data: { buckets?: T[] } | null | undefined): T[] {
  return Array.isArray(data?.buckets) ? data.buckets : [];
}

/** A finite counter, or `null` when the wire did not carry one. Never defaults to 0. */
function readCounter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readCurrency(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
}

function labelOf(value: unknown, missing: string = PLATFORM_AUDIENCE_UNKNOWN_LABEL): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : missing;
}

/** `"25-34 · female"`; a missing half is shown as Unknown rather than dropped. */
function joinLabel(first: unknown, second: unknown): string {
  return `${labelOf(first)} · ${labelOf(second)}`;
}
