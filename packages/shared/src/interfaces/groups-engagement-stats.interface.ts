// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Engagement rollup for the caller's visible set of groups (mine semantics, no scope param).
 * Backed by the same dbt engagement model as LFXV2-1705. `active_members` reads live, counted over
 * the *covered* subset of the caller's visible committees only (LFXV2-2978) — a committee is
 * covered when its v2 uid resolved to a v1 id via `resolveCommitteeV2UidsToV1Ids` AND the model has
 * at least one row for that v1 id. `coverage` discloses how much of the caller's visible set that
 * subset represents, so the client can render "across N of M groups" instead of silently reporting
 * a number that's quietly incomplete. `active_members` is `null` only when *zero* committees are
 * covered (nothing to count) or the computation itself failed (missing committee-set lookup, a
 * Snowflake missing-object error, or any other unexpected failure) — see `computeActiveMembers` in
 * `groups-engagement-stats.service.ts`. A `0` is always a real, computed answer (no visible
 * committees at all, or nobody active across the covered subset — whether that subset is full or
 * partial, check `coverage` to tell which) — never a stand-in for "unavailable", and `null` is never
 * a disguised real zero. `meetings_this_month` stays `null` in live mode — the model
 * has no calendar-month grain yet (LFXV2-2961).
 */
export interface GroupsEngagementStats {
  /**
   * Distinct members active on any *covered* visible committee — attended >=1 meeting in the
   * trailing 30 days, or joined within it (tenure grace), excluding Emeritus
   * (`isCommitteeMemberActive`, the same rule LFXV2-1705 uses). A member active on multiple visible
   * committees is counted once, not once per committee. `null` only when `coverage.covered` is `0`
   * or the computation failed — see this interface's doc comment for exactly which cases that
   * covers.
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
  /**
   * How many of the caller's visible committees (`total`) contributed to `active_members`
   * (`covered`) — see this interface's doc comment for what "covered" means. `covered === total`
   * means the count is complete; `covered < total` means it's a real but partial count, and the
   * client should disclose that (e.g. "across 2 of 3 groups"). Mock responses always report full
   * coverage (`covered === total`) so the mock path stays exercisable without fabricating a
   * misleading partial state.
   */
  coverage: { covered: number; total: number };
}
