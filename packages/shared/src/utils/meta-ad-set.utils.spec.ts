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

    expect(row).toMatchObject({ action: 'PAUSED', actionLabel: 'Pause', budget: '50.00 USD daily', effectiveStatus: null, recordPause: false });
  });

  it('offers Resume on the created ad set and shows an effective status that differs', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', deliberately_paused: true }), 'USD');

    expect(row).toMatchObject({ action: 'ACTIVE', actionLabel: 'Resume', effectiveStatus: 'CAMPAIGN_PAUSED', recordPause: false });
  });

  it('also offers Pause again (record) when the created ad set is paused but its pause is not recorded', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: false }), 'USD');

    expect(row.action).toBe('ACTIVE');
    expect(row.recordPause).toBe(true);
  });

  it('offers neither Resume nor a record on a paused ad set this service did not create', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', recorded: false }), 'USD');

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_RESUME_ELSEWHERE_REASON, recordPause: false });
  });

  it.each([
    ['deleted', { status: 'DELETED' }],
    ['no longer listed', { listed: false, status: 'PAUSED' }],
    ['unreported', { status: undefined }],
  ])('offers no action on an ad set that is %s', (_label, over) => {
    const row = toMetaAdSetDisplayRow(adSet(over as Partial<CampaignServiceMetaAdSet>), 'USD');

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_NO_ACTION_REASON, recordPause: false });
  });

  it('falls back to the id for a missing name and omits a budget whose type is not reported', () => {
    const row = toMetaAdSetDisplayRow(adSet({ name: undefined, budget_amount: '10.00' }), 'EUR');

    expect(row.name).toBe('111');
    expect(row.budget).toBeNull();
  });
});
