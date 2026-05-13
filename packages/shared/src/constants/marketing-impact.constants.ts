// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { MarketingImpactTabOption } from '../interfaces/marketing-impact.interface';

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
