// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { RESUMABLE_CAMPAIGN_STATUSES } from '../constants/campaign.constants';
import {
  META_AD_CREATIVE_NOT_REPORTED,
  META_AD_SET_BUDGET_AMOUNT_NOT_REPORTED,
  META_AD_SET_BUDGET_NONE_REPORTED,
  META_AD_SET_BUDGET_NOT_REPORTED,
  META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON,
  META_AD_SET_CLEAR_RECORD_LABEL,
  META_AD_SET_NO_ACTION_REASON,
  META_AD_SET_RECORD_PAUSE_LABEL,
  META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON,
  META_AD_SET_RESUME_ELSEWHERE_REASON,
} from '../constants/campaign-optimize.constants';
import type {
  CampaignServiceMetaAd,
  CampaignServiceMetaAdSet,
  MetaAdDisplayRow,
  MetaAdSetCampaignEligibility,
  MetaAdSetDisplayRow,
  MetaAdSetStatus,
} from '../interfaces/campaign-optimize.interface';

/**
 * Which ad-set directions campaign-service accepts for a campaign in `campaignStatus`, mirroring
 * `ToggleMetaAdSetStatus` (internal/service/meta_ad_sets.go) exactly:
 *
 *   allowed = CampaignStatusToggleable(status) || (status == created_degraded && direction == PAUSED)
 *
 * `CampaignStatusToggleable` is exactly `created`, `active`, `paused`, which
 * `RESUMABLE_CAMPAIGN_STATUSES` already mirrors for the campaign toggle. So:
 * - toggleable: both directions;
 * - `created_degraded`: PAUSE only — it is live upstream but needs reconciliation, so nothing may be
 *   switched on beneath it;
 * - anything else (`pending`, `group_created`, `unconfirmed`, `deleted`, a status this UI has never
 *   seen): neither. An allow-list, so an unknown status fails CLOSED.
 *
 * Compared case-insensitively; a non-string status is unknown.
 */
export function metaAdSetCampaignEligibility(campaignStatus: unknown): MetaAdSetCampaignEligibility {
  const status = typeof campaignStatus === 'string' ? campaignStatus.toLowerCase() : '';
  if (RESUMABLE_CAMPAIGN_STATUSES.has(status)) {
    return { pause: true, resume: true, reason: '' };
  }
  if (status === 'created_degraded') {
    return { pause: true, resume: false, reason: META_AD_SET_RESUME_BLOCKED_DEGRADED_REASON };
  }
  return { pause: false, resume: false, reason: META_AD_SET_CHANGE_BLOCKED_CAMPAIGN_STATE_REASON };
}

/** Whether `eligibility` allows sending `direction`. */
export function metaAdSetDirectionAllowed(eligibility: MetaAdSetCampaignEligibility, direction: MetaAdSetStatus): boolean {
  return direction === 'PAUSED' ? eligibility.pause : eligibility.resume;
}

/**
 * One Meta ad set as the Optimize tab's ad-set panel renders it, and the actions it may offer.
 *
 * - ACTIVE (and still listed): Pause.
 * - PAUSED, the ad set this service created: Resume. campaign-service activates no other ad set
 *   (409), so any other paused one says where to resume it instead.
 * - PAUSED, the created one, with `deliberately_paused: false`: also "Pause again (record)". An
 *   unconfirmed pause can leave Meta reporting it PAUSED with no record, and a campaign resume would
 *   then re-activate it. Re-sending PAUSED activates nothing: campaign-service answers
 *   ALREADY_IN_STATE and writes the record.
 * - ACTIVE, the created one, with `deliberately_paused: true`: also "Resume again (clear record)".
 *   An unconfirmed resume leaves the record, and a campaign resume would then leave it paused.
 *   Re-sending ACTIVE answers ALREADY_IN_STATE and clears it.
 * - An ABSENT `deliberately_paused` is unknown, not false: no record action is offered on it.
 * - Anything else (DELETED, ARCHIVED, unreported, or no longer listed by Meta): no action.
 *
 * Each action is then checked against the CAMPAIGN's state (`eligibility`, from
 * `metaAdSetCampaignEligibility`) by direction: a refused one is still offered, but carries the
 * reason it cannot be sent (`actionBlockedReason`, `recordActionBlockedReason`), so the operator
 * sees why rather than a button that always answers 409.
 *
 * Every descriptive field is read defensively off the unvalidated wire; an absent name falls back
 * to the ad set's id, and a budget is shown only when both its amount and its type are reported.
 * Otherwise `budgetNote` says what is missing, never that there is no budget.
 */
export function toMetaAdSetDisplayRow(adSet: CampaignServiceMetaAdSet, currency: string, eligibility: MetaAdSetCampaignEligibility): MetaAdSetDisplayRow {
  const status = typeof adSet.status === 'string' && adSet.status !== '' ? adSet.status : null;
  const effective = typeof adSet.effective_status === 'string' && adSet.effective_status !== '' ? adSet.effective_status : null;
  const budget =
    typeof adSet.budget_amount === 'string' && adSet.budget_amount !== '' && adSet.budget_type
      ? `${adSet.budget_amount} ${currency} ${adSet.budget_type}`.replace(/\s+/g, ' ')
      : null;
  const listed = adSet.listed === true;
  const recorded = adSet.recorded === true;
  let action: MetaAdSetDisplayRow['action'] = null;
  let noActionReason = META_AD_SET_NO_ACTION_REASON;
  if (listed && status === 'ACTIVE') {
    action = 'PAUSED';
    noActionReason = '';
  } else if (listed && status === 'PAUSED') {
    action = recorded ? 'ACTIVE' : null;
    noActionReason = recorded ? '' : META_AD_SET_RESUME_ELSEWHERE_REASON;
  }
  let recordAction: MetaAdSetDisplayRow['recordAction'] = null;
  if (listed && recorded && status === 'PAUSED' && adSet.deliberately_paused === false) {
    recordAction = 'PAUSED';
  } else if (listed && recorded && status === 'ACTIVE' && adSet.deliberately_paused === true) {
    recordAction = 'ACTIVE';
  }
  return {
    adSet,
    name: typeof adSet.name === 'string' && adSet.name !== '' ? adSet.name : adSet.id,
    status,
    effectiveStatus: effective !== null && effective !== status ? effective : null,
    budget,
    action,
    actionLabel: action === 'PAUSED' ? 'Pause' : 'Resume',
    noActionReason,
    recordAction,
    recordActionLabel: recordActionLabel(recordAction),
    actionBlockedReason: action !== null && !metaAdSetDirectionAllowed(eligibility, action) ? eligibility.reason : '',
    recordActionBlockedReason: recordAction !== null && !metaAdSetDirectionAllowed(eligibility, recordAction) ? eligibility.reason : '',
    budgetNote: budget === null ? budgetNoteFor(adSet, listed) : '',
  };
}

/**
 * Why no budget is shown. The contract leaves `budget_type` absent when the ad set holds no budget
 * of its own and `budget_amount` absent also when the currency's scale is unknown, but neither is
 * validated here, so the note names what is MISSING rather than asserting there is no budget.
 */
function budgetNoteFor(adSet: CampaignServiceMetaAdSet, listed: boolean): string {
  if (!listed) {
    return META_AD_SET_BUDGET_NOT_REPORTED;
  }
  // Read as `unknown`: the wire is unvalidated, so an empty or unexpected string is possible.
  const rawType: unknown = adSet.budget_type;
  const type = typeof rawType === 'string' && rawType !== '' ? rawType : null;
  if (type !== null) {
    return META_AD_SET_BUDGET_AMOUNT_NOT_REPORTED.replace('{type}', type.charAt(0).toUpperCase() + type.slice(1));
  }
  const amountReported = typeof adSet.budget_amount === 'string' && adSet.budget_amount !== '';
  return amountReported ? META_AD_SET_BUDGET_NOT_REPORTED : META_AD_SET_BUDGET_NONE_REPORTED;
}

/**
 * One Meta ad as the ad-set panel's read-only Ads section renders it. Every field is read
 * defensively off the unvalidated wire, as for ad sets: an absent name falls back to the ad's id,
 * the creative is its name, else its id, else says it was not reported, and an effective status is
 * shown only when it differs from the configured one. A counter that is not a finite number is
 * `null` (shown as not reported), never `0`.
 */
export function toMetaAdDisplayRow(ad: CampaignServiceMetaAd): MetaAdDisplayRow {
  const status = nonEmpty(ad.status);
  const effective = nonEmpty(ad.effective_status);
  const costMicros = finite(ad.cost_micros);
  return {
    id: ad.id,
    name: nonEmpty(ad.name) ?? ad.id,
    listed: ad.listed === true,
    status,
    effectiveStatus: effective !== null && effective !== status ? effective : null,
    creative: nonEmpty(ad.creative_name) ?? nonEmpty(ad.creative_id) ?? META_AD_CREATIVE_NOT_REPORTED,
    impressions: finite(ad.impressions),
    clicks: finite(ad.clicks),
    ctr: finite(ad.ctr),
    spend: costMicros === null ? null : costMicros / 1_000_000,
  };
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordActionLabel(action: MetaAdSetDisplayRow['recordAction']): string {
  if (action === 'PAUSED') {
    return META_AD_SET_RECORD_PAUSE_LABEL;
  }
  return action === 'ACTIVE' ? META_AD_SET_CLEAR_RECORD_LABEL : '';
}
