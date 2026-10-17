// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  META_AD_CREATIVE_NOT_REPORTED,
  META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON,
  META_AD_SET_NO_ACTION_REASON,
  META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON,
  META_AD_SET_RESUME_ELSEWHERE_REASON,
} from '../constants/campaign-optimize.constants';
import type { CampaignServiceMetaAd, CampaignServiceMetaAdSet } from '../interfaces/campaign-optimize.interface';
import { metaAdSetCampaignEligibility, toMetaAdDisplayRow, toMetaAdSetDisplayRow } from './meta-ad-set.utils';

const TOGGLEABLE = metaAdSetCampaignEligibility('active');

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
    const row = toMetaAdSetDisplayRow(adSet({ budget_type: 'daily', budget_amount: '50.00' }), 'USD', TOGGLEABLE);

    expect(row).toMatchObject({ action: 'PAUSED', actionLabel: 'Pause', budget: '50.00 USD daily', effectiveStatus: null, recordAction: null });
  });

  it('offers Resume on the created ad set and shows an effective status that differs', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED', deliberately_paused: true }), 'USD', TOGGLEABLE);

    expect(row).toMatchObject({ action: 'ACTIVE', actionLabel: 'Resume', effectiveStatus: 'CAMPAIGN_PAUSED', recordAction: null });
  });

  it('also offers Pause again (record) when the created ad set is paused and explicitly not recorded', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: false }), 'USD', TOGGLEABLE);

    expect(row.action).toBe('ACTIVE');
    expect(row).toMatchObject({ recordAction: 'PAUSED', recordActionLabel: 'Pause again (record)' });
  });

  it('offers Resume again (clear record) when the created ad set is active but still recorded as deliberately paused', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'ACTIVE', deliberately_paused: true }), 'USD', TOGGLEABLE);

    expect(row.action).toBe('PAUSED');
    expect(row).toMatchObject({ recordAction: 'ACTIVE', recordActionLabel: 'Resume again (clear record)' });
  });

  it.each(['PAUSED', 'ACTIVE'])('offers no record action on a %s ad set whose deliberately_paused is ABSENT (unknown is not false)', (status) => {
    const raw = adSet({ status });
    delete (raw as Partial<CampaignServiceMetaAdSet>).deliberately_paused;

    expect(toMetaAdSetDisplayRow(raw, 'USD', TOGGLEABLE)).toMatchObject({ recordAction: null, recordActionLabel: '' });
  });

  it('offers neither Resume nor a record on a paused ad set this service did not create', () => {
    const row = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', recorded: false }), 'USD', TOGGLEABLE);

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_RESUME_ELSEWHERE_REASON, recordAction: null });
  });

  it.each([
    ['deleted', { status: 'DELETED' }],
    ['no longer listed', { listed: false, status: 'PAUSED' }],
    ['unreported', { status: undefined }],
  ])('offers no action on an ad set that is %s', (_label, over) => {
    const row = toMetaAdSetDisplayRow(adSet(over as Partial<CampaignServiceMetaAdSet>), 'USD', TOGGLEABLE);

    expect(row).toMatchObject({ action: null, noActionReason: META_AD_SET_NO_ACTION_REASON, recordAction: null });
  });

  it('falls back to the id for a missing name and omits a budget whose type is not reported', () => {
    const row = toMetaAdSetDisplayRow(adSet({ name: undefined, budget_amount: '10.00' }), 'EUR', TOGGLEABLE);

    expect(row.name).toBe('111');
    expect(row.budget).toBeNull();
  });

  it.each([
    ['the type is reported but not the amount', { budget_type: 'daily', budget_amount: undefined }, 'Daily budget, amount not reported'],
    ['neither is reported', { budget_type: undefined, budget_amount: undefined }, 'No ad set budget reported (it may use the campaign budget)'],
    ['only the amount is reported', { budget_type: undefined, budget_amount: '5.00' }, 'Budget not reported'],
    ['Meta no longer lists it', { listed: false }, 'Budget not reported'],
  ])('never claims there is no budget when %s', (_label, over, note) => {
    const row = toMetaAdSetDisplayRow(adSet(over as Partial<CampaignServiceMetaAdSet>), 'USD', TOGGLEABLE);

    expect(row.budget).toBeNull();
    expect(row.budgetNote).toBe(note);
  });

  it('carries no budget note when the budget is shown', () => {
    expect(toMetaAdSetDisplayRow(adSet({ budget_type: 'lifetime', budget_amount: '9.00' }), 'USD', TOGGLEABLE).budgetNote).toBe('');
  });
});

describe('metaAdSetCampaignEligibility', () => {
  it.each(['created', 'active', 'paused', 'ACTIVE'])('allows both directions on a toggleable campaign (%s)', (status) => {
    expect(metaAdSetCampaignEligibility(status)).toEqual({ pause: true, resume: true, reason: '' });
  });

  it('allows only PAUSE on a created_degraded campaign, saying why', () => {
    expect(metaAdSetCampaignEligibility('created_degraded')).toEqual({ pause: true, resume: false, reason: META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON });
  });

  it.each(['pending', 'group_created', 'unconfirmed', 'deleted', 'something_new', '', undefined, 42])(
    'allows neither direction on a campaign that is not toggleable (%s)',
    (status) => {
      expect(metaAdSetCampaignEligibility(status)).toEqual({ pause: false, resume: false, reason: META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON });
    }
  );
});

describe('toMetaAdSetDisplayRow — campaign-state directions', () => {
  const DEGRADED = metaAdSetCampaignEligibility('created_degraded');
  const PROVISIONING = metaAdSetCampaignEligibility('pending');

  it('keeps Pause and Pause again (record) usable under created_degraded', () => {
    expect(toMetaAdSetDisplayRow(adSet({ status: 'ACTIVE' }), 'USD', DEGRADED).actionBlockedReason).toBe('');
    const paused = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: false }), 'USD', DEGRADED);
    expect(paused.recordAction).toBe('PAUSED');
    expect(paused.recordActionBlockedReason).toBe('');
  });

  it('blocks Resume and Resume again (clear record) under created_degraded, with the reconciliation reason', () => {
    const paused = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: true }), 'USD', DEGRADED);
    expect(paused.action).toBe('ACTIVE');
    expect(paused.actionBlockedReason).toBe(META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON);

    const active = toMetaAdSetDisplayRow(adSet({ status: 'ACTIVE', deliberately_paused: true }), 'USD', DEGRADED);
    expect(active.recordAction).toBe('ACTIVE');
    expect(active.recordActionBlockedReason).toBe(META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON);
    expect(active.actionBlockedReason).toBe('');
  });

  it('blocks every direction on a campaign still provisioning', () => {
    const active = toMetaAdSetDisplayRow(adSet({ status: 'ACTIVE' }), 'USD', PROVISIONING);
    const paused = toMetaAdSetDisplayRow(adSet({ status: 'PAUSED', deliberately_paused: false }), 'USD', PROVISIONING);

    expect(active.actionBlockedReason).toBe(META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON);
    expect(paused.actionBlockedReason).toBe(META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON);
    expect(paused.recordActionBlockedReason).toBe(META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON);
  });
});

describe('toMetaAdDisplayRow', () => {
  const ad = (over: Partial<CampaignServiceMetaAd> = {}): CampaignServiceMetaAd => ({
    id: '999',
    listed: true,
    name: 'Leads — Image A',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    creative_id: '777',
    creative_name: 'Image A',
    impressions: 920,
    clicks: 21,
    cost_micros: 6_170_000,
    ctr: 0.0228,
    ...over,
  });

  it('maps a listed ad, converting spend from micros and hiding a redundant effective status', () => {
    expect(toMetaAdDisplayRow(ad())).toEqual({
      id: '999',
      name: 'Leads — Image A',
      listed: true,
      status: 'ACTIVE',
      effectiveStatus: null,
      creative: 'Image A',
      impressions: 920,
      clicks: 21,
      ctr: 0.0228,
      spend: 6.17,
    });
  });

  it('shows an effective status that differs, and falls back to the creative id', () => {
    const row = toMetaAdDisplayRow(ad({ effective_status: 'ADSET_PAUSED', creative_name: undefined }));

    expect(row).toMatchObject({ effectiveStatus: 'ADSET_PAUSED', creative: '777' });
  });

  it('describes an unlisted ad by its id alone and keeps its counters', () => {
    const row = toMetaAdDisplayRow({ id: '888', listed: false, impressions: 10, clicks: 1, cost_micros: 0, ctr: 0.1 });

    expect(row).toMatchObject({ name: '888', listed: false, status: null, effectiveStatus: null, creative: META_AD_CREATIVE_NOT_REPORTED, spend: 0 });
  });

  it('never turns a counter that is not a finite number into 0', () => {
    const raw = ad({ cost_micros: Number.NaN });
    // @ts-expect-error -- an explicit null off the unvalidated wire
    raw.impressions = null;
    // @ts-expect-error -- a string off the unvalidated wire
    raw.clicks = '3';
    const row = toMetaAdDisplayRow(raw);

    expect(row).toMatchObject({ impressions: null, clicks: null, spend: null, ctr: 0.0228 });
  });
});
