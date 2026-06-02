// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignTabOption } from '../interfaces/campaign.interface';

/** Tab definitions for the Campaigns page tab navigation. */
export const CAMPAIGN_TABS: CampaignTabOption[] = [
  { id: 'planning', label: 'Planning', icon: 'fa-light fa-clipboard-list' },
  { id: 'implementation', label: 'Implementation', icon: 'fa-light fa-rocket' },
  { id: 'monitoring', label: 'Monitoring', icon: 'fa-light fa-chart-line' },
  { id: 'optimization', label: 'Optimization', icon: 'fa-light fa-wand-magic-sparkles' },
];
