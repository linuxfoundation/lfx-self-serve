// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommitteeEngagementResponse, CommitteeMemberEngagement } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommitteeEngagementSummaryComponent } from './committee-engagement-summary.component';

/**
 * Covers the GH-1848 accessibility fix through the actual template bindings — the row's rendered
 * text and its `aria-label` attribute — not just the computed signals that feed them, so a spec
 * stays green only if `[attr.aria-label]="activeMembersAriaLabel()"`, `[attr.aria-label]=
 * "attendanceRateAriaLabel()"`, and their label interpolations (in
 * committee-engagement-summary.component.html's active-members and attendance-rate rows) are all
 * wired correctly. No flag, no server, no Playwright. These are the two branches on this card with
 * no other coverage besides a Playwright test that self-skips when the LD flag reads off.
 */
const RATE_ELIGIBLE_MEMBER: CommitteeMemberEngagement = {
  uid: 'm-1',
  attended: 5,
  invited: 6,
  rate: 0.83,
  classification: 'High',
  role: 'None',
  voting_status: 'Voting Rep',
  committee_meetings: 6,
};

const NON_VOTING_LF_STAFF_MEMBER: CommitteeMemberEngagement = {
  uid: 'm-2',
  attended: 0,
  invited: 0,
  rate: 0,
  classification: 'LF Staff',
  role: 'LF Staff',
  voting_status: 'None',
  committee_meetings: 6,
};

const RATE_ELIGIBLE_MEMBER_NEVER_INVITED: CommitteeMemberEngagement = {
  uid: 'm-3',
  attended: 0,
  invited: 0,
  rate: 0,
  classification: 'Inactive',
  role: 'None',
  voting_status: 'Observer',
  committee_meetings: 6,
};

function response(
  overrides: Partial<CommitteeEngagementResponse['summary']> = {},
  members: CommitteeMemberEngagement[] = [RATE_ELIGIBLE_MEMBER]
): CommitteeEngagementResponse {
  return {
    members,
    summary: { attendance_rate: 0.78, active_count: 4, eligible_count: 6, total_count: 9, at_risk_count: 2, ...overrides },
    computed_at: null,
    data_available: true,
    data_source: 'live',
  };
}

describe('CommitteeEngagementSummaryComponent', () => {
  let fixture: ComponentFixture<CommitteeEngagementSummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommitteeEngagementSummaryComponent] }).compileComponents();
    fixture = TestBed.createComponent(CommitteeEngagementSummaryComponent);
  });

  function activeMembersRow(): HTMLElement {
    const el = fixture.nativeElement.querySelector('[data-testid="committee-engagement-summary-active-members"]');
    if (!el) throw new Error('active-members row not rendered');
    return el as HTMLElement;
  }

  function attendanceRateRow(): HTMLElement {
    const el = fixture.nativeElement.querySelector('[data-testid="committee-engagement-summary-attendance-rate"]');
    if (!el) throw new Error('attendance-rate row not rendered');
    return el as HTMLElement;
  }

  it('renders the active/eligible ratio and embeds it in the aria-label when eligible_count is nonzero', async () => {
    fixture.componentRef.setInput('engagement', response());
    await fixture.whenStable();

    expect(activeMembersRow().textContent).toContain('4/6');
    expect(activeMembersRow().getAttribute('aria-label')).toContain('4/6');
    expect(activeMembersRow().getAttribute('aria-label')).not.toContain('not available');
  });

  it('renders an em-dash, not "0/0", and says "not available" in the aria-label when eligible_count is 0 (GH-1848)', async () => {
    fixture.componentRef.setInput('engagement', response({ eligible_count: 0, active_count: 0 }));
    await fixture.whenStable();

    const row = activeMembersRow();
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toContain('0/0');
    const ariaLabel = row.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('not available');
    // The single '—' from the label must not be interpolated raw next to the sentence's own
    // em-dash separator — that reads as two indistinguishable dashes to a screen reader.
    expect(ariaLabel).not.toMatch(/—\s*—/);
  });

  it('renders a real attendance rate and embeds it in the aria-label when a rate-eligible member exists', async () => {
    fixture.componentRef.setInput('engagement', response());
    await fixture.whenStable();

    expect(attendanceRateRow().textContent).toContain('78%');
    expect(attendanceRateRow().getAttribute('aria-label')).toContain('78%');
    expect(attendanceRateRow().getAttribute('aria-label')).not.toContain('not available');
  });

  it('renders an em-dash, not "0%", and says "not available" in the aria-label when every member is a non-voting LF Staff seat (GH-1848)', async () => {
    fixture.componentRef.setInput('engagement', response({ attendance_rate: 0 }, [NON_VOTING_LF_STAFF_MEMBER]));
    await fixture.whenStable();

    const row = attendanceRateRow();
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toContain('0%');
    const ariaLabel = row.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('not available');
    expect(ariaLabel).not.toMatch(/—\s*—/);
  });

  it('renders an em-dash, not "0%", and says "not available" in the aria-label when every rate-eligible member simply has zero invites this window', async () => {
    fixture.componentRef.setInput('engagement', response({ attendance_rate: 0 }, [RATE_ELIGIBLE_MEMBER_NEVER_INVITED, NON_VOTING_LF_STAFF_MEMBER]));
    await fixture.whenStable();

    const row = attendanceRateRow();
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toContain('0%');
    const ariaLabel = row.getAttribute('aria-label') ?? '';
    expect(ariaLabel).toContain('not available');
    expect(ariaLabel).not.toMatch(/—\s*—/);
  });

  it('shows the calm unavailable state, not the metrics row, when there is no engagement response at all', async () => {
    fixture.componentRef.setInput('engagement', null);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="committee-engagement-summary-unavailable-state"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="committee-engagement-summary-active-members"]')).toBeNull();
    // The underlying signals still degrade sensibly even though nothing renders them in this state.
    expect(fixture.componentInstance.activeMembersLabel()).toBe('—');
    expect(fixture.componentInstance.attendanceRateLabel()).toBe('—');
  });
});
