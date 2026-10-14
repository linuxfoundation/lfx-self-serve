// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { META_AD_SET_NO_ACTION_REASON, META_AD_SET_RESUME_ELSEWHERE_REASON } from '../constants/campaign-optimize.constants';
import type { CampaignServiceMetaAdSet } from '../interfaces/campaign-optimize.interface';
import { toMetaAdSetDisplayRow } from './meta-ad-set.utils';

const adSet = (over: Partial<CampaignServiceMetaAdSet> = {}): CampaignServiceMetaAdSet => ({
  id: '111',
  listed: true,
  name: 'Leads — US',
  status: 'ACTIVE',
  effective_status: 'ACTIVE',
  impressions: 0,
  clicks: 0,
  cost_micros: 0,
  ctr: 0,
  recorded: true,
  deliberately_paused: false,
  ...over,
});

describe('toMetaAdSetDisplayRow', () => {
  it('offers Pause on an active ad set, with its budget and no redundant effective status', () => {
    const row = toMetaAdSetDisplayRow(adSet({ budget_type: 'daily', budget_amount: '50.00' }), 'USD');

    expect(row).toMatchObject({ action: 'PAUSED', actionLabel: 'Pause', budget: '50.00 USD daily', effectiveStatus: null, recordAction: null });
  });

  it('offers Resume on the created ad set and shows an effective status that differs', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', deliberately_paused: true }), 'USD');

    expect(row).toMatchObject({ action: 'ACTIVE', actionLabel: 'Resume', effectiveStatus: 'CAMPAIGN_PAUSED', recordAction: null });
  });

  it('also offers Pause again (record) when the created ad set is paused and explicitly not recorded', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: false }), 'USD');

    expect(row.action).toBe('ACTIVE');
    expect(row).toMatchObject({ recordAction: 'PAUSED', recordActionLabel: 'Pause again (record)' });
  });

  it('offers Resume again (clear record) when the created ad set is active but still recorded as deliberately paused', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'ACTIVE', deliberately_paused: true }), 'USD');

    expect(row.action).toBe('PAUSED');
    expect(row).toMatchObject({ recordAction: 'ACTIVE', recordActionLabel: 'Resume again (clear record)' });
  });

  it.each(['PAUSED', 'ACTIVE'])('offers no record action on a %s ad set whose deliberately_paused is ABSENT (unknown is not false)', (status) => {
    const raw = adSet({ status });
    delete (raw as Partial<CampaignServiceMetaAdSet>).deliberately_paused;

    expect(toMetaAdSetDisplayRow(raw, 'USD')).toMatchObject({ recordAction: null, recordActionLabel: '' });
  });

  it('offers neither Resume nor a record on a paused ad set this service did not create', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', recorded: false }), 'USD');

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_RESUME_ELSEWHERE_REASON, recordAction: null });
  });

  it.each([
    ['deleted', { status: 'DELETED' }],
    ['no longer listed', { listed: false, status: 'PAUSED' }],
    ['unreported', { status: undefined }],
  ])('offers no action on an ad set that is %s', (_label, over) => {
    const row = toMetaAdSetDisplayRow(adSet(over as Partial<CampaignServiceMetaAdSet>), 'USD');

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_NO_ACTION_REASON, recordAction: null });
  });

  it('falls back to the id for a missing name and omits a budget whose type is not reported', () => {
    const row = toMetaAdSetDisplayRow(adSet({ name: undefined, budget_amount: '10.00' }), 'EUR');

    expect(row.name).toBe('111');
    expect(row.budget).toBeNull();
  });
});
