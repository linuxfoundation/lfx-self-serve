// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Member360SortColumn } from '../interfaces/member-360.interface';

// Mirrored from marketing-os-agents main 45734bc6, agents/member-360/src/model.ts.
export const CATEGORY_KEYS = ['committees', 'events', 'speaking', 'content', 'community_programs', 'marketing_social'] as const;

/** Category display names, verbatim from the weights table. */
export const CATEGORY_LABELS: Readonly<Record<(typeof CATEGORY_KEYS)[number], string>> = {
  committees: 'Committees & governance',
  events: 'Events',
  speaking: 'Speaking',
  content: 'Content & thought leadership',
  community_programs: 'Community programs',
  marketing_social: 'Marketing engagement & social',
};

export const MEMBER_360_SORT_COLUMNS: Member360SortColumn[] = [
  { key: 'rank', label: '#' },
  { key: 'member_organization', label: 'Member' },
  { key: 'engagement_tier', label: 'Tier' },
  { key: 'engagement_score', label: 'Score' },
  { key: null, label: 'Six categories' },
  { key: 'trend', label: 'Trend' },
  { key: 'days_to_renewal', label: 'Renewal' },
  { key: 'recommended_next_action', label: 'Next action' },
  { key: 'action_owner', label: 'Owner' },
  { key: 'priority', label: 'Priority' },
];

/** Default weights (percent), verbatim from the weights table; sum to 100. */
export const DEFAULT_WEIGHTS: Readonly<Record<(typeof CATEGORY_KEYS)[number], number>> = {
  committees: 20,
  events: 20,
  speaking: 15,
  content: 15,
  community_programs: 10,
  marketing_social: 20,
};

export const ENGAGEMENT_TIERS = ['Champion', 'Engaged', 'Passive', 'At Risk', 'Dormant'] as const;
export const ACTION_OWNERS = ['Marketing', 'Member Success', 'Sales'] as const;
export const MEMBER_360_TIER_OPTIONS = [{ label: 'All', value: '' }, ...ENGAGEMENT_TIERS.map((value) => ({ label: value, value }))];
export const MEMBER_360_OWNER_OPTIONS = [{ label: 'All', value: '' }, ...ACTION_OWNERS.map((value) => ({ label: value, value }))];
export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const DATA_SOURCES = ['lfx_platform', 'uploaded_trackers', 'web_research', 'hubspot', 'social_listening', 'google_drive'] as const;
export const SCOPE_WARNINGS = ['all_lf_requested'] as const;
export const CATEGORY_SCORE_KEYS = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, `${k}_score`])) as Record<
  (typeof CATEGORY_KEYS)[number],
  `${(typeof CATEGORY_KEYS)[number]}_score`
>;
export const MEMBER_360_COMPARISON_UNAVAILABLE = 'MEMBER_360_COMPARISON_UNAVAILABLE';
export const MEMBER_360_INVALID_RESULT = 'MEMBER_360_INVALID_RESULT';
export const MEMBER_360_CONTRACT_ID = 'member-360-output/v1';
export const MEMBER_360_FINALIZE_TOOL = 'finalize_member_360';
export const MEMBER_360_QUESTIONS_MARKER = 'member-360-questions/v1';
export const MEMBER_360_API = '/api/mktg-agents/member-360';
export const MEMBER_360_MAX_BYTES = 5 * 1024 * 1024;
export const MEMBER_360_MAX_TRACKERS = 10;
export const MEMBER_360_MAX_TRACKER_ROWS = 2000;
export const MEMBER_360_MAX_TRACKER_COLUMNS = 100;
export const MEMBER_360_TRACKER_FILENAME_REGEX = /^[^\r\n/\\]{1,200}\.(csv|xlsx)$/i;
export const MEMBER_360_CONTACT_PLACEHOLDERS = ['tbd', 'n/a', 'none', 'unknown', 'not available', 'not provided'] as const;
export const MEMBER_360_REDACTED_SUMMARY =
  'Member 360 analysis is available in the ranking, team actions, evidence and method sections. Contact details have been removed from this stored run.';
export const MEMBER_360_TRACKER_KINDS = ['event_sponsors', 'attendees', 'speaking', 'ambassadors', 'content', 'webinars', 'other'] as const;
export const MEMBER_360_HEAT_ORDER = ['events', 'speaking', 'community_programs', 'committees', 'content', 'marketing_social'] as const;
export const MEMBER_360_WINDOW_OPTIONS = [
  { label: 'Trailing 12 months, recent quarter emphasised (default)', value: '12' },
  { label: 'Trailing 6 months', value: '6' },
  { label: 'Calendar year', value: 'year' },
] as const;
export const MEMBER_360_INTRO =
  "Scores every member's engagement across events, speaking, ambassadors, committees, content and marketing, finds the gaps and recommends one next action per member. The data comes from LFX; you add anything LFX does not know.";
