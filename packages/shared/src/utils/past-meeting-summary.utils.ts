// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { Meeting, PastMeetingSummary } from '../interfaces';

/**
 * AI summary approval gating, kept free of Angular imports so the pure logic can
 * be exercised in isolation (e.g. the Playwright suite) without bootstrapping the
 * Angular runtime — see meeting.utils.ts for the Angular-coupled summary helpers.
 */

export type SummaryApprovalFlags = Pick<PastMeetingSummary, 'approved' | 'requires_approval'>;

/**
 * Determines whether a past-meeting AI summary should be visible to viewers.
 *
 * A summary is viewable once it is approved, OR when the meeting never required
 * approval in the first place. Only a summary that requires approval and has not
 * yet been approved stays hidden (pending organizer review). This is the gate
 * that lets non-organizers and unauthenticated viewers see summaries whose
 * meeting had "Require AI Summary Approval" disabled.
 *
 * @param summary - The past meeting summary (or null/undefined when not loaded)
 * @returns true when the summary is approved or approval is not required
 */
export function isPastMeetingSummaryVisible(summary: SummaryApprovalFlags | null | undefined): boolean {
  if (!summary) return false;
  return summary.approved || !summary.requires_approval;
}

/**
 * Determines whether a past-meeting AI summary is awaiting organizer approval.
 *
 * True only when the summary requires approval and has not yet been approved —
 * the single state in which the summary stays hidden from non-organizers and the
 * organizer review banner / "Pending" badge should appear.
 *
 * @param summary - The past meeting summary (or null/undefined when not loaded)
 * @returns true when approval is required and not yet granted
 */
export function isPastMeetingSummaryAwaitingApproval(summary: SummaryApprovalFlags | null | undefined): boolean {
  if (!summary) return false;
  return summary.requires_approval && !summary.approved;
}

/**
 * Whether the summary modal opens read-only for this viewer: the Edit and Approve actions are only
 * offered when the viewer holds organizer rights on the meeting (the same relation the upstream
 * write checks) and the summary has a uid to write back to. Fails closed on missing input.
 *
 * @param meeting - The meeting the summary belongs to; `organizer` is the access-check flag the
 *   BFF adds to the response (or null/undefined when not loaded)
 * @param summary - The past meeting summary (or null/undefined when not loaded)
 * @returns true when the viewer may only read the summary
 */
export function isPastMeetingSummaryReadOnly(
  meeting: Pick<Meeting, 'organizer'> | null | undefined,
  summary: Pick<PastMeetingSummary, 'uid'> | null | undefined
): boolean {
  return meeting?.organizer !== true || !summary?.uid;
}
