// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Type-only imports — erased at compile time, so the interface file's own runtime import of
// COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS from this file cannot form a circular dependency.
import type { CommitteeEngagementClassification } from '../interfaces/committee-engagement.interface';
import type { TagSeverity } from '../interfaces/components.interface';
import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';

/**
 * Time windows the committee-member engagement warehouse model is built for (LFXV2-1705), and
 * therefore the only values `GET /api/committees/:uid/engagement` accepts for `?window=`.
 */
export const COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS = ['30d', '90d', 'ytd'] as const;

/** Window used when the `window` query parameter is omitted. */
export const COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW = '30d';

/**
 * Attendance-rate thresholds (attended / invited) for engagement classification, computed in the
 * BFF so they can be tuned without a dbt deploy once real distributions are observed. Applies once
 * a member has at least one real invite (`invited > 0`) — see
 * `committee-engagement-classifier.utils.ts`'s `classifyCommitteeEngagement` for the `Emeritus` and
 * tenure-clipping (`member_joined_at`) cases these thresholds don't cover.
 *   rate <= 0            → Inactive (invited, but attended nothing)
 *   0 < rate < medium     → Low
 *   medium <= rate < high → Medium
 *   rate >= high          → High
 */
export const COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS = {
  high: 0.75,
  medium: 0.4,
} as const;

/**
 * Window-selector pill options for the engagement UI (members table + overview summary). Ids are
 * the exact `?window=` values the endpoint accepts (`COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS`).
 */
export const COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS: FilterPillOption[] = [
  { id: '30d', label: '30d', fullLabel: 'Last 30 days' },
  { id: '90d', label: '90d', fullLabel: 'Last 90 days' },
  { id: 'ytd', label: 'YTD', fullLabel: 'Year to date' },
];

/**
 * Tag severity per engagement classification for the members-table chip. `Emeritus` is
 * deliberately neutral (`secondary`) — an honorific seat state, never at-risk styling — and
 * `Inactive` only reads as a danger signal on the chip; the actual At-Risk filter uses
 * `isCommitteeEngagementRowAtRisk` (Low, or Inactive with real invites), not this map.
 */
export const COMMITTEE_ENGAGEMENT_CLASSIFICATION_TAG_SEVERITY: Record<CommitteeEngagementClassification, TagSeverity> = {
  High: 'success',
  Medium: 'info',
  Low: 'warn',
  Inactive: 'danger',
  Emeritus: 'secondary',
};
