// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Engagement rollup for the caller's visible set of groups (mine semantics, no scope param).
 * Backed by the same dbt engagement model as LFXV2-1705; fields are `null` when that model
 * isn't readable yet (see `ENGAGEMENT_BACKEND=live` stub in `groups-engagement-stats.service.ts`).
 */
export interface GroupsEngagementStats {
  /** Distinct members who attended at least one meeting in the trailing 30 days. `null` when not computable. */
  active_members: number | null;
  /** Meeting occurrences within the current calendar month. `null` when not computable. */
  meetings_this_month: number | null;
  /** ISO timestamp this rollup was computed — used to render a freshness label client-side. */
  computed_at: string;
  /**
   * Which backend produced this response. `'mock'` values are deterministic fixtures, not real
   * data — the client renders a visible "Sample data" marker when this is `'mock'` so fabricated
   * numbers can never be mistaken for live ones during local/synced-prod-data validation.
   */
  source: 'mock' | 'live';
}
