// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type {
  AttributionModelOption,
  MarketingImpactFocusProgram,
  MarketingImpactTab,
  MarketingImpactTabOption,
} from '../interfaces/marketing-impact.interface';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/** Focus program filter options for the Marketing Impact FOCUS bar. Labels match Snowflake LF_SUB_DOMAIN_CLASSIFICATION values. */
export const MARKETING_IMPACT_FOCUS_OPTIONS: FilterPillOption[] = [
  { id: 'all', label: 'All programs' },
  { id: 'lfCorporate', label: 'LF Corporate' },
  { id: 'lfEvents', label: 'LF Events' },
  { id: 'lfTraining', label: 'LF Training' },
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

/**
 * Human-readable definitions for each consolidated attribution channel label, keyed by the UI
 * label produced server-side (see mapChannel in project.service.ts). Surfaced as per-channel
 * tooltips in the Marketing attribution table so viewers know what each grouping includes.
 */
export const ATTRIBUTION_CHANNEL_DESCRIPTIONS: Record<string, string> = {
  'Paid Performance': 'Paid search and paid social campaigns.',
  Email: 'Email and HubSpot marketing sends.',
  'Internal & Banner': 'Internal cross-site links and on-site promotional banners.',
  Organic: 'Unpaid organic search traffic.',
  Other: 'Other tracked sources that do not fall into a primary channel.',
  'Direct & Unknown': 'Direct visits plus sessions with no identifiable referring source.',
};

/** Maps MarketingImpactFocusProgram IDs to Snowflake LF_SUB_DOMAIN_CLASSIFICATION values. 'all' maps to undefined (no filter). */
export const FOCUS_TO_CLASSIFICATION: Record<MarketingImpactFocusProgram, string | undefined> = {
  all: undefined,
  lfCorporate: 'LF Corporate',
  lfEvents: 'LF Events',
  lfTraining: 'LF Training',
  projectWebsites: 'Project Websites',
};

export const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set(Object.values(FOCUS_TO_CLASSIFICATION).filter((v): v is string => v !== undefined));

/** Which tabs are visible for each focus area. Social tabs are hidden for non-"all" focuses (no classification filtering); Email is additionally hidden for projectWebsites (no email campaign data). */
export const FOCUS_VISIBLE_TABS: Record<MarketingImpactFocusProgram, ReadonlySet<MarketingImpactTab>> = {
  all: new Set<MarketingImpactTab>(['overview', 'attribution', 'performance-marketing', 'email', 'web-activity', 'social-accounts', 'social-listening']),
  lfCorporate: new Set<MarketingImpactTab>(['overview', 'attribution', 'performance-marketing', 'email', 'web-activity']),
  lfEvents: new Set<MarketingImpactTab>(['overview', 'attribution', 'performance-marketing', 'email', 'web-activity']),
  lfTraining: new Set<MarketingImpactTab>(['overview', 'attribution', 'performance-marketing', 'email', 'web-activity']),
  projectWebsites: new Set<MarketingImpactTab>(['overview', 'attribution', 'performance-marketing', 'web-activity']),
};
