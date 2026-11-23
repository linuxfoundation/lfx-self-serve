// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { META_AD_OPTION_FIELDS } from '../constants/campaign.constants';
import type { MetaAdOptionsEnabled, MetaAdOptionView } from '../interfaces/campaign.interface';
import { metaAdOptionApplies, metaAdOptionLabel } from './campaign-meta-ad-options.utils';
import { metaCallToActionAllowedWithLeadForm } from './campaign-meta-lead-form.utils';

// Its own file because it reads both the ad-option and the lead-form rules, and the lead-form utils already
// import the ad-option utils: kept here, neither of those two imports the other back.

/**
 * The Meta ad choice dropdowns the Implement tab offers: each only on an explicit yes and where the
 * objective takes it. Landing page views is disabled under manual bidding, and a call to action a lead
 * form cannot carry is disabled while the create carries one.
 */
export function metaAdOptionViews(enabled: MetaAdOptionsEnabled, objective: string, manualBidding: boolean, leadFormRequested: boolean): MetaAdOptionView[] {
  return META_AD_OPTION_FIELDS.filter((field) => enabled[field.key] === true && metaAdOptionApplies(field, objective)).map((field) => ({
    key: field.key,
    label: field.label,
    notSetLabel: `Not set (${metaAdOptionLabel(field.values[0])})`,
    options: field.values.map((value) => ({
      value,
      label: metaAdOptionLabel(value),
      disabled:
        (field.key === 'optimizationGoal' && value === 'LANDING_PAGE_VIEWS' && manualBidding) ||
        (field.key === 'callToAction' && !metaCallToActionAllowedWithLeadForm(value, leadFormRequested)),
    })),
  }));
}
