// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_SETTINGS_BID_AMOUNT_FIELD,
  CAMPAIGN_SETTINGS_BID_CURRENCY_FIELD,
  CAMPAIGN_SETTINGS_FIELD_LABELS,
  CAMPAIGN_SETTINGS_UNKNOWN_NOTES,
  CAMPAIGN_SETTINGS_VERDICT_LABELS,
  CAMPAIGN_SETTINGS_VERDICT_SEVERITIES,
} from '../constants/campaign-optimize.constants';
import type { CampaignServiceCampaignRef } from '../interfaces/campaign.interface';
import type {
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
 * echoed `platform_campaign_id` is the id that was asked about (compared by `canonicalCampaignId`, so a
 * numeric id that reached the UI as a number, or padded, still matches its echo), and every match names a
 * campaign and a brief. Anything else is `unexpected` and must not be acted on: not as a match (which
 * would change a campaign), not as no match (which would unlock a second adoption), and not as a
 * confirmed adoption.
 */
export function readCampaignRefResolution(resolution: unknown, requestedId: string | number): CampaignRefVerdict {
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
  const requested = canonicalCampaignId(requestedId);
  if (requested === null || canonicalCampaignId(echoed) !== requested || !Array.isArray(matches) || typeof count !== 'number' || count !== matches.length) {
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
 * A platform campaign id in one canonical form for comparison: trimmed, and an all-digit id (LinkedIn,
 * Meta, Microsoft; or one that arrived as a JSON number) as its decimal string without leading zeros.
 * `null` for anything that cannot be an id, which never matches.
 */
export function canonicalCampaignId(value: unknown): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      return null;
    }
    text = BigInt(value).toString();
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  if (text === '') {
    return null;
  }
  return /^[0-9]+$/.test(text) ? text.replace(/^0+(?=[0-9])/, '') : text;
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
