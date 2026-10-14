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
import type {
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
