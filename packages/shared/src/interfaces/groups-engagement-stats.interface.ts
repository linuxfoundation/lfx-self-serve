// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Engagement rollup for the caller's visible set of groups (mine semantics, no scope param).
 * Backed by the same dbt engagement model as LFXV2-1705. `active_members` reads live; `null` means
 * the count couldn't be computed — a missing committee-set lookup, a Snowflake missing-object error,
 * or incomplete warehouse coverage across the caller's visible committees. That last case isn't
 * "zero rows across the board" — it's checked per-committee, so a caller with 10 visible committees
 * where even 1 lacks a covered row (not yet synced into the model, or its v2 uid never resolved to a
 * v1 id) gets `null`, not a plausible-but-incomplete count for the other 9 (see `computeActiveMembers`
 * in `groups-engagement-stats.service.ts`). A `0` is always a real, computed answer (no visible
 * committees at all, or full coverage with nobody active) — never a stand-in for "unavailable", and
 * `null` is never a disguised real zero. `meetings_this_month` stays `null` in live mode — the model
 * has no calendar-month grain yet (LFXV2-2961).
 */
export interface GroupsEngagementStats {
  /**
   * Distinct members active on any visible committee — attended >=1 meeting in the trailing 30
   * days, or joined within it (tenure grace), excluding Emeritus (`isCommitteeMemberActive`, the
   * same rule LFXV2-1705 uses). A member active on multiple visible committees is counted once, not
   * once per committee. `null` when not computable — see this interface's doc comment for exactly
   * which cases that covers.
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
