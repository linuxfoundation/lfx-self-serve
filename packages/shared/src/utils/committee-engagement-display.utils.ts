// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '../constants/committee-engagement.constants';
import type { CommitteeMemberEngagement, CommitteeEngagementWindow } from '../interfaces/committee-engagement.interface';

/**
 * Narrows an untyped window id (e.g. a filter-pill's emitted string) to a supported
 * `CommitteeEngagementWindow`, or `null` for anything the endpoint wouldn't accept. The UI-side
 * counterpart of the server's `parseCommitteeEngagementWindow` (which throws a 400 instead).
 */
export function toCommitteeEngagementWindow(windowId: string): CommitteeEngagementWindow | null {
  return COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS.find((window) => window === windowId) ?? null;
}

/**
 * At-Risk predicate over a `CommitteeMemberEngagement` response row (LFXV2-1705 UI slice). Mirrors
 * the server's `isCommitteeMemberAtRisk` rule — `Low`, or `Inactive` with at least one real invite
 * (there is signal to act on, unlike a never-invited member) — but operates on the already-classified
 * response row rather than re-deriving the tier client-side. Re-deriving from the response's rounded
 * `rate` would disagree with the server at threshold boundaries (e.g. 0.395 displays as 0.40 but
 * classifies `Low`), so the served `classification` is authoritative. `Emeritus`, `LF Staff`
 * (LFXV2-3101), and the tenure-grace `High` can never match. Rows from a degraded response
 * (`data_available: false`) are zeroed with `invited: 0` and classify `Inactive` — or `Emeritus` /
 * tenure-grace `High` for the roster exceptions the response contract documents — so they never
 * read as at-risk here.
 */
export function isCommitteeEngagementRowAtRisk(row: CommitteeMemberEngagement): boolean {
  return row.classification === 'Low' || (row.classification === 'Inactive' && row.invited > 0);
}

/**
 * "Meetings" cell text for the members table: personal `attended/invited` for the selected window
 * (e.g. `12/12` — never `attended/committee_meetings`, which would misread tenure-limited members).
 * Em-dash when the engagement read degraded (`data_available: false`), the member has no engagement
 * row (e.g. joined after the rollup was computed), or no response has loaded at all — the roster
 * must stay fully readable without attendance data.
 */
export function formatCommitteeEngagementMeetings(row: CommitteeMemberEngagement | null | undefined, dataAvailable: boolean): string {
  if (!dataAvailable || !row) {
    return '—';
  }
  return `${row.attended}/${row.invited}`;
}

/**
 * Whole-percent display for `CommitteeEngagementSummary.attendance_rate` (a `[0, 1]` ratio),
 * e.g. `0.784` → `'78%'`. Display-only rounding — never feed this back into classification.
 */
export function formatCommitteeEngagementRatePercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
