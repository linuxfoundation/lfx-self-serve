// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { AttributionModelOption, MarketingImpactTabOption } from '../interfaces/marketing-impact.interface';

/** Focus program filter options for the Marketing Impact FOCUS bar. */
export const MARKETING_IMPACT_FOCUS_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All programs' },
  { id: 'events', label: 'Events' },
  { id: 'newsletters', label: 'Newsletters' },
  { id: 'surveys', label: 'Surveys' },
  { id: 'trainings', label: 'Trainings' },
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

/**
 * Maps MarketingImpactFocusProgram IDs to Snowflake LF_SUB_DOMAIN_CLASSIFICATION values.
 * 'all' maps to undefined (no filter). Used by endpoints that support classification filtering.
 */
export const FOCUS_TO_CLASSIFICATION: Record<string, string | undefined> = {
  all: undefined,
  events: 'Events',
  newsletters: 'Corporate',
  surveys: 'Projects',
  trainings: 'Training',
};

/** Funnel stage filter options for the Performance Marketing tab. */
export const FUNNEL_STAGE_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All stages' },
  { id: 'tofu', label: 'Top of funnel' },
  { id: 'mofu', label: 'Middle of funnel' },
  { id: 'bofu', label: 'Bottom of funnel' },
];
