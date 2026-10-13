// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { PastMeetingSummary, PastMeetingSummaryApprovalState } from '../interfaces';

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
 * The one approval state of a summary (E4-03), for every surface that shows one: `approved`;
 * `pending` while it requires approval and has none; `not-required` when the meeting never required
 * approval. A summary that never needed approval is no longer read as "Pending Review".
 */
export function getPastMeetingSummaryApprovalState(summary: SummaryApprovalFlags): PastMeetingSummaryApprovalState {
  if (summary.approved) return 'approved';
  return summary.requires_approval ? 'pending' : 'not-required';
}

/**
 * A summary's markdown: the organizer's edit first, else the generated content. Each is trimmed
 * before the fallback, so an unedited (`''`) or blanked (whitespace-only) edit falls back to the
 * generated text. `''` when both are blank, so an empty-but-present record surfaces no affordance.
 */
export function getPastMeetingSummaryContent(summary: Pick<PastMeetingSummary, 'summary_data'> | null | undefined): string {
  return summary?.summary_data?.edited_content?.trim() || summary?.summary_data?.content?.trim() || '';
}

/**
 * A summary as the public past-meeting route gives it to a caller with no session (E4-04): an
 * allowlist of the text in effect (the organizer's edit, else the generated text), title, times and
 * approval flags. Never the Zoom summary document link or
 * its password, the Zoom configuration, the internal email flag, or anything upstream adds later.
 */
export function toPublicPastMeetingSummary(summary: PastMeetingSummary): PastMeetingSummary {
  const data = summary.summary_data;
  return {
    uid: summary.uid,
    meeting_id: summary.meeting_id,
    past_meeting_id: summary.past_meeting_id,
    platform: summary.platform,
    approved: summary.approved,
    requires_approval: summary.requires_approval,
    email_sent: false,
    password: '',
    summary_data: {
      title: data?.title ?? '',
      // Only the text in effect: an organizer's edit supersedes the generated text, so what it removed
      // must not stay readable alongside it.
      content: getPastMeetingSummaryContent(summary),
      edited_content: '',
      doc_url: '',
      start_time: data?.start_time ?? '',
      end_time: data?.end_time ?? '',
    },
    created_at: summary.created_at,
    updated_at: summary.updated_at,
  };
}
