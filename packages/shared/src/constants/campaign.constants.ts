// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignGoal, CampaignPlatform, CampaignTabOption } from '../interfaces/campaign.interface';

/** Tab definitions for the Campaigns page tab navigation. */
export const CAMPAIGN_TABS: CampaignTabOption[] = [
  { id: 'planning', label: 'Planning', icon: 'fa-light fa-clipboard-list' },
  { id: 'implementation', label: 'Implementation', icon: 'fa-light fa-rocket' },
  { id: 'monitoring', label: 'Monitoring', icon: 'fa-light fa-chart-mixed' },
  { id: 'optimization', label: 'Optimization', icon: 'fa-light fa-gauge-high' },
] as const;

export interface CampaignPlatformOption {
  id: CampaignPlatform;
  label: string;
  icon: string;
  disabled?: boolean;
}

export const CAMPAIGN_PLATFORMS: readonly CampaignPlatformOption[] = [
  { id: 'google-ads', label: 'Google Ads', icon: 'fa-brands fa-google' },
  { id: 'microsoft-ads', label: 'Microsoft Ads', icon: 'fa-brands fa-microsoft', disabled: true },
  { id: 'linkedin-ads', label: 'LinkedIn Ads', icon: 'fa-brands fa-linkedin', disabled: true },
  { id: 'meta-ads', label: 'Meta Ads', icon: 'fa-brands fa-meta', disabled: true },
  { id: 'reddit-ads', label: 'Reddit Ads', icon: 'fa-brands fa-reddit', disabled: true },
  { id: 'brave-ads', label: 'Brave Ads', icon: 'fa-light fa-shield', disabled: true },
  { id: 'feathr', label: 'Feathr', icon: 'fa-light fa-bullseye-arrow', disabled: true },
  { id: 'twitter-ads', label: 'X / Twitter Ads', icon: 'fa-brands fa-x-twitter', disabled: true },
] as const;

export interface CampaignGoalOption {
  id: CampaignGoal;
  label: string;
}

export const CAMPAIGN_GOALS: readonly CampaignGoalOption[] = [
  { id: 'conversions', label: 'Conversions / Registrations' },
  { id: 'brand-awareness', label: 'Brand Awareness' },
  { id: 'traffic', label: 'Traffic / Clicks' },
  { id: 'lead-generation', label: 'Lead Generation' },
  { id: 'engagement', label: 'Engagement' },
] as const;

export const CAMPAIGN_JOB_POLL_INTERVAL_MS = 2000;

/**
 * Upper-bound thresholds for each pacing label (percentage of budget spent).
 * A campaign's pacingPct falls into the first bucket whose threshold it does not exceed:
 *   pacingPct < 50  → underspending
 *   pacingPct < 90  → normal
 *   pacingPct < 100 → constrained
 *   pacingPct ≥ 100 → overspending (130 marks severe overspending)
 */
export const CAMPAIGN_PACING_THRESHOLDS = {
  underspending: 50,
  normal: 90,
  constrained: 100,
  overspending: 130,
} as const;

export const CAMPAIGN_CHAR_LIMITS = {
  searchHeadline: 30,
  searchDescription: 90,
  displayHeadline: 40,
  displayDescription: 90,
  displayBusinessName: 25,
  sitelinkHeadline: 25,
  sitelinkDescription: 35,
} as const;

export const CAMPAIGN_BUDGET_DEFAULTS = {
  searchBudgetPct: 70,
  displayBudgetPct: 30,
} as const;
