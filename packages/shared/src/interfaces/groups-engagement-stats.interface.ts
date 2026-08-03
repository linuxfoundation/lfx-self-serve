// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Engagement rollup for the caller's visible set of groups (mine semantics, no scope param).
 * Backed by the same dbt engagement model as LFXV2-1705. `active_members` reads live; `null` means
 * the count couldn't be computed (missing committee-set lookup, or a Snowflake missing-object
 * error) — never a real zero passed off as unavailable, and never an unavailable state passed off
 * as zero (see `computeActiveMembers` in `groups-engagement-stats.service.ts`). `meetings_this_month`
 * stays `null` in live mode — the model has no calendar-month grain yet (LFXV2-2961).
 */
export interface GroupsEngagementStats {
  /**
   * Distinct members active on any visible committee — attended >=1 meeting in the trailing 30
   * days, or joined within it (tenure grace), excluding Emeritus (`isCommitteeMemberActive`, the
   * same rule LFXV2-1705 uses). A member active on multiple visible committees is counted once, not
   * once per committee. `null` when not computable.
   */
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
