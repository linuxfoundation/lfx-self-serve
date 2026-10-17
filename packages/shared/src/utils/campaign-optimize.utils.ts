// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_EMAIL_CHANNEL_PLATFORM,
  CAMPAIGN_LIVE_COST_LABELS,
  CAMPAIGN_METRICS_WINDOW_LABELS,
  CAMPAIGN_REF_INT64_PLATFORMS,
  CAMPAIGN_SETTINGS_BID_AMOUNT_FIELD,
  CAMPAIGN_SETTINGS_BID_CURRENCY_FIELD,
  CAMPAIGN_SETTINGS_FIELD_LABELS,
  CAMPAIGN_SETTINGS_UNKNOWN_NOTES,
  CAMPAIGN_SETTINGS_VERDICT_LABELS,
  CAMPAIGN_SETTINGS_VERDICT_SEVERITIES,
  CAMPAIGN_USD_COST_PLATFORMS,
} from '../constants/campaign-optimize.constants';
import type { CampaignBudgetPacingRead, CampaignServiceCampaignMetrics, CampaignServiceCampaignRef } from '../interfaces/campaign.interface';
import type {
  CampaignLiveCounters,
  CampaignRefVerdict,
  CampaignServiceSettingsField,
  CampaignServiceSettingsReadback,
  CampaignSettingsComparison,
  CampaignSettingsDrift,
  CampaignSettingsDriftRow,
} from '../interfaces/campaign-optimize.interface';

/**
 * The live-settings drawer's view of one readback.
 *
 * Every field the readback carries becomes a row, in the readback's order, and an unrecognised
 * field keeps its own name: the vocabulary grows per platform. A side the readback omitted stays
 * `null` (never `''` or `0`), and a verdict outside `match`/`diverged` is treated as `unknown`, so
 * nothing the platform did not report can read as agreement.
 *
 * LinkedIn's bid is reported as two upstream-only fields, `unit_cost` and `unit_cost_currency`. When
 * both carry a live value they are shown as ONE row, the amount with its currency; otherwise each is
 * shown as it came (campaign-service omits the amount when the currency is not reported).
 *
 * The counts are taken from the rows rather than from `diverged_count`/`unknown_count`, so the
 * header always agrees with the table beneath it.
 */
export function buildCampaignSettingsDrift(readback: CampaignServiceSettingsReadback): CampaignSettingsDrift {
  const fields = Array.isArray(readback.fields) ? readback.fields.filter(isSettingsField) : [];
  const currency = fields.find((f) => f.field === CAMPAIGN_SETTINGS_BID_CURRENCY_FIELD);
  const amount = fields.find((f) => f.field === CAMPAIGN_SETTINGS_BID_AMOUNT_FIELD);
  const foldCurrency = hasValue(amount?.upstream) && hasValue(currency?.upstream);

  const rows: CampaignSettingsDriftRow[] = [];
  for (const field of fields) {
    if (foldCurrency && field === currency) {
      continue;
    }
    let live = hasValue(field.upstream) ? field.upstream : null;
    if (foldCurrency && field === amount && live !== null) {
      live = `${live} ${currency?.upstream as string}`;
    }
    rows.push(toDriftRow(field, live));
  }

  return {
    platform: typeof readback.platform === 'string' ? readback.platform : '',
    readAt: typeof readback.read_at === 'string' ? readback.read_at : '',
    rows,
    divergedCount: rows.filter((r) => r.comparison === 'diverged').length,
    matchCount: rows.filter((r) => r.comparison === 'match').length,
    unknownCount: rows.filter((r) => r.comparison === 'unknown').length,
  };
}

/**
 * The ONE reading of a campaign-ref answer that the act dialog and the adopt check both use.
 *
 * The answer is trusted only when it is self-consistent: `match_count` equals `matches.length`, the
 * echoed `platform_campaign_id` is the id that was asked about (`sameCampaignId`: exact after trimming,
 * or as the same integer only where ids ARE integers), and every match names a
 * campaign and a brief. Anything else is `unexpected` and must not be acted on: not as a match (which
 * would change a campaign), not as no match (which would unlock a second adoption), and not as a
 * confirmed adoption.
 */
export function readCampaignRefResolution(resolution: unknown, requestedId: string | number, platform: string): CampaignRefVerdict {
  if (!resolution || typeof resolution !== 'object') {
    return { kind: 'unexpected' };
  }
  const {
    platform_campaign_id: echoed,
    matches,
    match_count: count,
  } = resolution as {
    platform_campaign_id?: unknown;
    matches?: unknown;
    match_count?: unknown;
  };
  if (!sameCampaignId(requestedId, echoed, platform) || !Array.isArray(matches) || typeof count !== 'number' || count !== matches.length) {
    return { kind: 'unexpected' };
  }
  if (!matches.every(isCampaignRef)) {
    return { kind: 'unexpected' };
  }
  if (matches.length === 0) {
    return { kind: 'none' };
  }
  return matches.length === 1 ? { kind: 'one', match: matches[0] } : { kind: 'several', count: matches.length };
}

/**
 * Whether the id the UI asked about and the id campaign-service echoed name the same campaign.
 *
 * Compared as trimmed exact strings first. Only where an id IS an integer — LinkedIn and Microsoft
 * Ads (`CAMPAIGN_REF_INT64_PLATFORMS`), whose campaign ids are int64s, or either side arriving as a
 * JSON number — are two all-digit ids also compared as
 * integers (leading zeros ignored). Elsewhere `0123` and `123` are different ids: a Reddit or Meta id
 * is an opaque string, and treating them as one would act on a campaign nobody named.
 */
export function sameCampaignId(requested: unknown, echoed: unknown, platform: string): boolean {
  const a = campaignIdText(requested);
  const b = campaignIdText(echoed);
  if (a === null || b === null) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const integerIds = (CAMPAIGN_REF_INT64_PLATFORMS as ReadonlySet<string>).has(platform) || typeof requested === 'number' || typeof echoed === 'number';
  return integerIds && ALL_DIGITS.test(a) && ALL_DIGITS.test(b) && stripLeadingZeros(a) === stripLeadingZeros(b);
}

const ALL_DIGITS = /^[0-9]+$/;

/** A trimmed id; a JSON number as its exact decimal string. `null` for anything that cannot be an id. */
function campaignIdText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  return text === '' ? null : text;
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=[0-9])/, '');
}

function isCampaignRef(value: unknown): value is CampaignServiceCampaignRef {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const { campaign_id: campaignId, brief_id: briefId } = value as { campaign_id?: unknown; brief_id?: unknown };
  return typeof campaignId === 'string' && campaignId !== '' && typeof briefId === 'string' && briefId !== '';
}

function toDriftRow(field: CampaignServiceSettingsField, live: string | null): CampaignSettingsDriftRow {
  const intended = hasValue(field.recorded) ? field.recorded : null;
  const comparison = normalizeComparison(field.comparison);
  return {
    field: field.field,
    label: Object.prototype.hasOwnProperty.call(CAMPAIGN_SETTINGS_FIELD_LABELS, field.field) ? CAMPAIGN_SETTINGS_FIELD_LABELS[field.field] : field.field,
    intended,
    live,
    comparison,
    verdictLabel: CAMPAIGN_SETTINGS_VERDICT_LABELS[comparison],
    verdictSeverity: CAMPAIGN_SETTINGS_VERDICT_SEVERITIES[comparison],
    note: comparison === 'unknown' ? unknownNote(intended, live) : '',
  };
}

/** `match` and `diverged` as sent; anything else, including a value this UI has not seen, is `unknown`. */
function normalizeComparison(value: unknown): CampaignSettingsComparison {
  return value === 'match' || value === 'diverged' ? value : 'unknown';
}

function unknownNote(intended: string | null, live: string | null): string {
  if (intended === null && live !== null) {
    return CAMPAIGN_SETTINGS_UNKNOWN_NOTES.liveOnly;
  }
  if (intended !== null && live === null) {
    return CAMPAIGN_SETTINGS_UNKNOWN_NOTES.notReported;
  }
  if (intended === null) {
    return CAMPAIGN_SETTINGS_UNKNOWN_NOTES.neither;
  }
  return CAMPAIGN_SETTINGS_UNKNOWN_NOTES.both;
}

function hasValue(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isSettingsField(value: unknown): value is CampaignServiceSettingsField {
  return !!value && typeof value === 'object' && typeof (value as { field?: unknown }).field === 'string';
}

/**
 * The budget pacing a campaign's live settings readback reports for it: the UPSTREAM side of its
 * `budget_type` field, `daily` or `lifetime`, or `unknown` when the platform reported neither.
 *
 * Only the upstream value counts — the recorded side is what dispatch asked for, and an adopted
 * campaign records none. On X the readback reports a pacing only under campaign budget optimization
 * (a daily amount is `daily`, a total-only cap `lifetime`); anything else is absent and so `unknown`.
 */
export function campaignBudgetPacingFromSettings(readback: CampaignServiceSettingsReadback | null | undefined): Exclude<CampaignBudgetPacingRead, 'pending'> {
  const fields = Array.isArray(readback?.fields) ? readback.fields : [];
  const upstream = fields.find((field) => field?.field === 'budget_type')?.upstream;
  return upstream === 'daily' || upstream === 'lifetime' ? upstream : 'unknown';
}

/**
 * A row's live counters from one campaign-service measurement — a `get-campaign-metrics` read, or
 * the same-shaped `metrics` of an `ok` row in the brief-wide read.
 *
 * Cost arrives in MICRO-units and is shown in whole units to two decimals, formatted like the tab's
 * other amounts but WITHOUT a currency symbol. Its label names the currency as far as the read
 * allows: USD on LinkedIn (`costInUsd`), "ad account currency" elsewhere, where the read names none
 * and a `$` on a EUR account would be a false claim. CTR arrives as a fraction and becomes
 * a percentage. The window is the one campaign-service reports, which may be narrower than 30 days
 * when the platform cannot serve that range (X Ads).
 *
 * The email channel (the row's `platform`, or an `email` object on the measurement) is flagged so
 * the first counter reads as opens to date, and carries no cost: upstream's 0 there is not a spend.
 */
export function buildCampaignLiveCounters(metrics: CampaignServiceCampaignMetrics, platform = ''): CampaignLiveCounters {
  const isEmail = platform === CAMPAIGN_EMAIL_CHANNEL_PLATFORM || metrics.email !== undefined;
  return {
    isEmail,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    cost: isEmail ? null : (metrics.cost_micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    costLabel: CAMPAIGN_USD_COST_PLATFORMS.has(platform) ? CAMPAIGN_LIVE_COST_LABELS.usd : CAMPAIGN_LIVE_COST_LABELS.account,
    ctrPct: metrics.ctr * 100,
    windowLabel: CAMPAIGN_METRICS_WINDOW_LABELS[metrics.window] ?? metrics.window,
  };
}

/**
 * A campaign row from campaign-service or the index with its `adopted` marker normalized: kept only
 * as a literal `true` (lfx-v2-campaign-service#366 documents `true` or absent, never `false`), and
 * dropped otherwise, so a malformed value can never disable a control. Everything else is unchanged.
 */
export function withAdoptedMarker<T extends { adopted?: boolean }>(row: T): T {
  if (row.adopted === true || !('adopted' in row)) {
    return row;
  }
  const rest = { ...row };
  delete rest.adopted;
  return rest;
}
