// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { AttributionModelOption, MarketingImpactFocusProgram, MarketingImpactTabOption } from '../interfaces/marketing-impact.interface';

/** Focus program filter options for the Marketing Impact FOCUS bar. Labels match Snowflake LF_SUB_DOMAIN_CLASSIFICATION values. */
export const MARKETING_IMPACT_FOCUS_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All programs' },
  { id: 'lfCorporate', label: 'LF Corporate' },
  { id: 'lfEvents', label: 'LF Events' },
  { id: 'lfTraining', label: 'LF Training' },
  { id: 'lfxPlatform', label: 'LFX Platform' },
  { id: 'projectWebsites', label: 'Project Websites' },
];

/** Tab definitions for the Marketing Impact section tabs. */
export const MARKETING_IMPACT_TABS: MarketingImpactTabOption[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'performance-marketing', label: 'Performance Marketing' },
  { id: 'email', label: 'Email' },
  { id: 'web-activity', label: 'Web Activity' },
  { id: 'social-accounts', label: 'Social Accounts' },
  { id: 'social-listening', label: 'Social Listening' },
];

/** Attribution model options for the model selector dropdown. */
export const ATTRIBUTION_MODEL_OPTIONS: AttributionModelOption[] = [
  { label: 'Linear', value: 'linear' },
  { label: 'First Touch', value: 'firstTouch' },
  { label: 'Last Touch', value: 'lastTouch' },
  { label: 'Time Decay', value: 'timeDecay' },
];

/** Maps MarketingImpactFocusProgram IDs to Snowflake LF_SUB_DOMAIN_CLASSIFICATION values. 'all' maps to undefined (no filter). */
export const FOCUS_TO_CLASSIFICATION: Record<MarketingImpactFocusProgram, string | undefined> = {
  all: undefined,
  lfCorporate: 'LF Corporate',
  lfEvents: 'LF Events',
  lfTraining: 'LF Training',
  lfxPlatform: 'LFX Platform',
  projectWebsites: 'Project Websites',
};

export const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set(Object.values(FOCUS_TO_CLASSIFICATION).filter((v): v is string => v !== undefined));

/** Funnel stage filter options for the Performance Marketing tab. */
export const FUNNEL_STAGE_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All stages' },
  { id: 'tofu', label: 'Top of funnel' },
  { id: 'mofu', label: 'Middle of funnel' },
  { id: 'bofu', label: 'Bottom of funnel' },
];
