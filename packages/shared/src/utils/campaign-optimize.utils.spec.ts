// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CAMPAIGN_SETTINGS_UNKNOWN_NOTES } from '../constants/campaign-optimize.constants';
import type { CampaignServiceSettingsField, CampaignServiceSettingsReadback } from '../interfaces/campaign-optimize.interface';
import { buildCampaignSettingsDrift, campaignBudgetPacingFromSettings, readCampaignRefResolution, withAdoptedMarker } from './campaign-optimize.utils';

function readback(fields: CampaignServiceSettingsField[], platform = 'linkedin-ads'): CampaignServiceSettingsReadback {
  return {
    campaign_id: 'c-1',
    platform_campaign_id: '123',
    platform,
    read_at: '2026-10-13T10:00:00Z',
    fields,
    diverged_count: 99,
    unknown_count: 99,
  };
}

describe('buildCampaignSettingsDrift', () => {
  it('labels known fields, keeps an unrecognised field under its own name, and counts from the rows', () => {
    const drift = buildCampaignSettingsDrift(
      readback([
        { field: 'budget_amount', recorded: '50.00', upstream: '75.00', comparison: 'diverged' },
        { field: 'campaign_name', recorded: 'KubeCon', upstream: 'KubeCon', comparison: 'match' },
        { field: 'brand_new_field', upstream: 'X', comparison: 'unknown' },
      ])
    );

    expect(drift.rows.map((r) => r.label)).toEqual(['Budget amount', 'Campaign name', 'brand_new_field']);
    expect(drift.rows[0]).toMatchObject({ intended: '50.00', live: '75.00', verdictLabel: 'Differs', verdictSeverity: 'warn', note: '' });
    expect(drift.rows[1]).toMatchObject({ verdictLabel: 'Matches', verdictSeverity: 'success' });
    // The header agrees with the table, not with the readback's own counters.
    expect(drift).toMatchObject({ divergedCount: 1, matchCount: 1, unknownCount: 1, platform: 'linkedin-ads', readAt: '2026-10-13T10:00:00Z' });
  });

  it('keeps an absent side null and explains the unknown verdict by which side is missing', () => {
    const drift = buildCampaignSettingsDrift(
      readback([
        { field: 'status', upstream: 'PAUSED', comparison: 'unknown' },
        { field: 'start_date', recorded: '2026-11-01', comparison: 'unknown' },
        { field: 'end_date', comparison: 'unknown' },
        { field: 'budget_type', recorded: 'daily', upstream: 'daily', comparison: 'unknown' },
      ])
    );

    expect(drift.rows.map((r) => [r.intended, r.live, r.note])).toEqual([
      [null, 'PAUSED', CAMPAIGN_SETTINGS_UNKNOWN_NOTES.liveOnly],
      ['2026-11-01', null, CAMPAIGN_SETTINGS_UNKNOWN_NOTES.notReported],
      [null, null, CAMPAIGN_SETTINGS_UNKNOWN_NOTES.neither],
      ['daily', 'daily', CAMPAIGN_SETTINGS_UNKNOWN_NOTES.both],
    ]);
    // Equal values under an `unknown` verdict are NOT promoted to a match.
    expect(drift.rows[3].verdictLabel).toBe('Not compared');
    expect(drift.matchCount).toBe(0);
  });

  it('treats an empty string or an unseen verdict as unknown rather than as agreement', () => {
    const drift = buildCampaignSettingsDrift(readback([{ field: 'budget_amount', recorded: '', upstream: '', comparison: 'maybe' as unknown as 'match' }]));

    expect(drift.rows[0]).toMatchObject({ intended: null, live: null, comparison: 'unknown' });
    expect(drift.matchCount).toBe(0);
  });

  it('shows a LinkedIn bid with its currency in one row', () => {
    const drift = buildCampaignSettingsDrift(
      readback([
        { field: 'cost_type', upstream: 'CPC', comparison: 'unknown' },
        { field: 'unit_cost', upstream: '12.50', comparison: 'unknown' },
        { field: 'unit_cost_currency', upstream: 'EUR', comparison: 'unknown' },
      ])
    );

    expect(drift.rows.map((r) => r.field)).toEqual(['cost_type', 'unit_cost']);
    expect(drift.rows[1]).toMatchObject({ label: 'Bid', live: '12.50 EUR' });
  });

  it('never shows a bare LinkedIn bid amount as if it had a currency', () => {
    // campaign-service omits the amount when no currency came back; the currency row then stands alone.
    const onlyCurrency = buildCampaignSettingsDrift(readback([{ field: 'unit_cost_currency', upstream: 'USD', comparison: 'unknown' }]));
    expect(onlyCurrency.rows).toEqual([expect.objectContaining({ field: 'unit_cost_currency', label: 'Bid currency', live: 'USD' })]);

    const noCurrency = buildCampaignSettingsDrift(readback([{ field: 'unit_cost', upstream: '3.00', comparison: 'unknown' }]));
    expect(noCurrency.rows[0].live).toBe('3.00');
  });

  it('drops malformed entries and tolerates a missing fields array', () => {
    const malformed = readback([null as unknown as CampaignServiceSettingsField, { comparison: 'match' } as unknown as CampaignServiceSettingsField]);
    expect(buildCampaignSettingsDrift(malformed).rows).toEqual([]);

    const missing = { ...readback([]), fields: undefined } as unknown as CampaignServiceSettingsReadback;
    expect(buildCampaignSettingsDrift(missing)).toMatchObject({ rows: [], divergedCount: 0, matchCount: 0, unknownCount: 0 });
  });
});

describe('readCampaignRefResolution', () => {
  const ref = { campaign_id: 'c-1', brief_id: 'b-1' };

  it('reads a self-consistent answer as none, one or several', () => {
    expect(readCampaignRefResolution({ platform_campaign_id: '42', matches: [], match_count: 0 }, '42', 'meta-ads')).toEqual({ kind: 'none' });
    expect(readCampaignRefResolution({ platform_campaign_id: '42', matches: [ref], match_count: 1 }, '42', 'meta-ads')).toEqual({ kind: 'one', match: ref });
    expect(readCampaignRefResolution({ platform_campaign_id: '42', matches: [ref, ref], match_count: 2 }, '42', 'meta-ads')).toEqual({
      kind: 'several',
      count: 2,
    });
  });

  it.each([
    ['a LinkedIn id passed as a number', 'linkedin-ads', 5_123_456_789, '5123456789'],
    ['a LinkedIn id passed as a string', 'linkedin-ads', '5123456789', '5123456789'],
    ['a LinkedIn id with leading zeros', 'linkedin-ads', '005123456789', '5123456789'],
    ['a LinkedIn id echoed as a number', 'linkedin-ads', '5123456789', 5123456789],
    ['a Microsoft id with leading zeros', 'microsoft-ads', '00413296582', '413296582'],
    ['a Meta id passed as a number', 'meta-ads', 120210000000555, '120210000000555'],
    ['an id with surrounding spaces', 'reddit-ads', ' t2_abc ', 't2_abc'],
  ])('matches %s against its echo', (_label, platform, requested, echoed) => {
    expect(readCampaignRefResolution({ platform_campaign_id: echoed, matches: [ref], match_count: 1 }, requested as string | number, platform)).toEqual({
      kind: 'one',
      match: ref,
    });
  });

  it.each(['reddit-ads', 'meta-ads', 'twitter-ads'])('does not treat %s ids 0123 and 123 as one id', (platform) => {
    expect(readCampaignRefResolution({ platform_campaign_id: '123', matches: [ref], match_count: 1 }, '0123', platform)).toEqual({ kind: 'unexpected' });
    expect(readCampaignRefResolution({ platform_campaign_id: '0123', matches: [ref], match_count: 1 }, '123', platform)).toEqual({ kind: 'unexpected' });
  });

  it('still refuses a different number, or an id that cannot be one', () => {
    expect(readCampaignRefResolution({ platform_campaign_id: '5123456780', matches: [ref], match_count: 1 }, 5_123_456_789, 'linkedin-ads')).toEqual({
      kind: 'unexpected',
    });
    expect(readCampaignRefResolution({ platform_campaign_id: '1.5', matches: [ref], match_count: 1 }, 1.5, 'linkedin-ads')).toEqual({ kind: 'unexpected' });
    expect(readCampaignRefResolution({ platform_campaign_id: '', matches: [], match_count: 0 }, '  ', 'reddit-ads')).toEqual({ kind: 'unexpected' });
  });

  it.each([
    ['a count below the list', { platform_campaign_id: '42', matches: [ref], match_count: 0 }],
    ['a count above the list', { platform_campaign_id: '42', matches: [], match_count: 1 }],
    ['a missing count', { platform_campaign_id: '42', matches: [ref] }],
    ['another id echoed back', { platform_campaign_id: '43', matches: [ref], match_count: 1 }],
    ['no id echoed back', { matches: [], match_count: 0 }],
    ['a match naming no campaign', { platform_campaign_id: '42', matches: [{ brief_id: 'b-1' }], match_count: 1 }],
    ['no matches array', { platform_campaign_id: '42', match_count: 0 }],
    ['no answer at all', null],
  ])('refuses %s as unexpected', (_label, answer) => {
    expect(readCampaignRefResolution(answer, '42', 'meta-ads')).toEqual({ kind: 'unexpected' });
  });
});

describe('campaignBudgetPacingFromSettings (#3299)', () => {
  it.each(['daily', 'lifetime'] as const)('reads an upstream %s pacing', (pacing) => {
    expect(campaignBudgetPacingFromSettings(readback([{ field: 'budget_type', upstream: pacing, comparison: 'unknown' }], 'twitter-ads'))).toBe(pacing);
  });

  // The recorded side is what dispatch ASKED for; only the platform's own answer says what it holds.
  it('ignores the recorded pacing when the platform reported none', () => {
    expect(campaignBudgetPacingFromSettings(readback([{ field: 'budget_type', recorded: 'daily', comparison: 'unknown' }], 'twitter-ads'))).toBe('unknown');
  });

  it.each([
    ['no budget_type field', readback([{ field: 'campaign_name', upstream: 'x', comparison: 'unknown' }], 'twitter-ads')],
    ['an unmapped upstream value', readback([{ field: 'budget_type', upstream: 'total', comparison: 'unknown' }], 'twitter-ads')],
    ['no readback', null],
    ['a readback with no fields array', { fields: null } as unknown as CampaignServiceSettingsReadback],
  ])('answers unknown for %s', (_label, value) => {
    expect(campaignBudgetPacingFromSettings(value)).toBe('unknown');
  });
});

describe('withAdoptedMarker', () => {
  it('keeps a literal true', () => {
    expect(withAdoptedMarker({ id: 'c-1', adopted: true })).toEqual({ id: 'c-1', adopted: true });
  });

  it('leaves a row without the field untouched', () => {
    const row = { id: 'c-1' } as { id: string; adopted?: boolean };
    expect(withAdoptedMarker(row)).toBe(row);
  });

  it.each([[false], ['true'], [1], [null]])('drops %s rather than keeping a non-true value', (value) => {
    const result = withAdoptedMarker({ id: 'c-1', adopted: value as unknown as boolean });
    expect('adopted' in result).toBe(false);
    expect(result).toEqual({ id: 'c-1' });
  });
});
