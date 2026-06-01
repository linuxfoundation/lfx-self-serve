// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Past-meeting AI summary visibility — LFXV2-2052.
 *
 * The bug: AI summaries were gated on `approved` alone, so a summary whose
 * meeting never required approval ("Require AI Summary Approval" disabled) stayed
 * hidden from non-organizers / unauthenticated viewers because nobody approved it.
 *
 * The fix extracts the gate into two pure helpers in `@lfx-one/shared/utils`:
 *   - isPastMeetingSummaryVisible      → approved OR approval not required
 *   - isPastMeetingSummaryAwaitingApproval → requires approval AND not approved
 *
 * These drive the "See AI Summary" affordance and the organizer review / "Pending"
 * banner across meeting-card, meeting-join, and past-meeting-details.
 *
 * NOTE: this repo has no unit-test runner wired up (angular.json has no `test`
 * target and there are no co-located *.spec.ts unit files), so the visibility
 * logic is verified here in the Playwright suite against the extracted helpers —
 * the single source of truth the three view surfaces consume. Covers the
 * approved-only, requires_approval-only, and neither cases the ticket calls for.
 */

// Deep import the Angular-free helper module directly (not the '@lfx-one/shared/utils'
// barrel) so the suite can load the pure logic without bootstrapping Angular.
import { isPastMeetingSummaryAwaitingApproval, isPastMeetingSummaryVisible } from '@lfx-one/shared/utils/past-meeting-summary.utils';
import { expect, test } from '@playwright/test';

interface ApprovalFlags {
  approved: boolean;
  requires_approval: boolean;
}

const summary = (approved: boolean, requires_approval: boolean): ApprovalFlags => ({ approved, requires_approval });

test.describe('past-meeting AI summary visibility (LFXV2-2052)', () => {
  test('approved-only: approved summary is visible and not awaiting approval', () => {
    // Approval was required and granted — the classic visible case.
    const s = summary(true, true);
    expect(isPastMeetingSummaryVisible(s)).toBe(true);
    expect(isPastMeetingSummaryAwaitingApproval(s)).toBe(false);
  });

  test('requires_approval-only: unapproved + requires approval stays hidden and pending', () => {
    // The only state in which the summary is withheld from viewers.
    const s = summary(false, true);
    expect(isPastMeetingSummaryVisible(s)).toBe(false);
    expect(isPastMeetingSummaryAwaitingApproval(s)).toBe(true);
  });

  test('neither: approval not required is visible without ever being approved (the bug fix)', () => {
    // "Require AI Summary Approval" was never enabled — must be visible to all,
    // and must NOT show a "Pending" badge.
    const s = summary(false, false);
    expect(isPastMeetingSummaryVisible(s)).toBe(true);
    expect(isPastMeetingSummaryAwaitingApproval(s)).toBe(false);
  });

  test('approved without requiring approval is visible and not pending', () => {
    const s = summary(true, false);
    expect(isPastMeetingSummaryVisible(s)).toBe(true);
    expect(isPastMeetingSummaryAwaitingApproval(s)).toBe(false);
  });

  test('missing summary is neither visible nor awaiting approval', () => {
    expect(isPastMeetingSummaryVisible(null)).toBe(false);
    expect(isPastMeetingSummaryVisible(undefined)).toBe(false);
    expect(isPastMeetingSummaryAwaitingApproval(null)).toBe(false);
    expect(isPastMeetingSummaryAwaitingApproval(undefined)).toBe(false);
  });
});
