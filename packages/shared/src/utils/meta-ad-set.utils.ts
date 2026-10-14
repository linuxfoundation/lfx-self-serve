// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { META_AD_SET_NO_ACTION_REASON, META_AD_SET_RESUME_ELSEWHERE_REASON } from '../constants/campaign-optimize.constants';
import type { CampaignServiceMetaAdSet, MetaAdSetDisplayRow } from '../interfaces/campaign-optimize.interface';

/**
 * One Meta ad set as the Optimize tab's ad-set panel renders it, and the actions it may offer.
 *
 * - ACTIVE (and still listed): Pause.
 * - PAUSED, the ad set this service created: Resume. campaign-service activates no other ad set
 *   (409), so any other paused one says where to resume it instead.
 * - PAUSED, the created one, but NOT recorded as deliberately paused: also "Pause again (record)".
 *   An unconfirmed pause can leave Meta reporting it PAUSED with no record, and a campaign resume
 *   would then re-activate it. Re-sending PAUSED activates nothing: campaign-service answers
 *   ALREADY_IN_STATE and writes the record.
 * - Anything else (DELETED, ARCHIVED, unreported, or no longer listed by Meta): no action.
 *
 * Every descriptive field is read defensively off the unvalidated wire; an absent name falls back
 * to the ad set's id, and a budget is shown only when both its amount and its type are reported.
 */
export function toMetaAdSetDisplayRow(adSet: CampaignServiceMetaAdSet, currency: string): MetaAdSetDisplayRow {
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
  return {
    adSet,
    name: typeof adSet.name === 'string' && adSet.name !== '' ? adSet.name : adSet.id,
    status,
    effectiveStatus: effective !== null && effective !== status ? effective : null,
    budget,
    action,
    actionLabel: action === 'PAUSED' ? 'Pause' : 'Resume',
    noActionReason,
    recordPause: listed && recorded && status === 'PAUSED' && adSet.deliberately_paused !== true,
  };
}
