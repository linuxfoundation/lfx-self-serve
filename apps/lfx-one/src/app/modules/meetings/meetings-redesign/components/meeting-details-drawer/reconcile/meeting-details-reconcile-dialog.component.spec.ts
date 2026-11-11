// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AttendanceReconciliationResult,
  Meeting,
  MeetingHomeRow,
  MeetingReconcileDialogData,
  ReconcilePastMeetingParticipantsResponse,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsReconcileDialogComponent } from './meeting-details-reconcile-dialog.component';

const PAST_ID = 'synthetic-meeting-1762362000000';
const CANDIDATE = {
  candidate_id: 'c-1',
  source: 'invitee',
  email: 'jane@acme-motors.example',
  username: 'jdoe',
  lf_user_id: 'lfid-1',
  first_name: 'Jane',
  last_name: 'Doe',
  org_name: 'Acme Motors',
} as const;

const result = (overrides: Partial<AttendanceReconciliationResult> = {}): AttendanceReconciliationResult => ({
  attendee_id: 'a1',
  zoom_user_name: 'Jane iPhone',
  confidence: 'medium',
  method: 'ai',
  auto_applied: false,
  ...overrides,
});

const response = (
  results: AttendanceReconciliationResult[],
  overrides: Partial<ReconcilePastMeetingParticipantsResponse> = {}
): ReconcilePastMeetingParticipantsResponse => ({
  results,
  candidate_pool_size: 3,
  auto_applied_count: 0,
  needs_review_count: 0,
  pool_degraded: false,
  ...overrides,
});

describe('MeetingDetailsReconcileDialogComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsReconcileDialogComponent>;
  let reconcile: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let onChange: ReturnType<typeof vi.fn<() => void>>;

  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => find(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const render = async (reply: Observable<ReconcilePastMeetingParticipantsResponse>): Promise<void> => {
    reconcile.mockReturnValue(reply);
    fixture = TestBed.createComponent(MeetingDetailsReconcileDialogComponent);
    await settle();
  };
  const click = async (testId: string): Promise<void> => {
    (find(testId)?.querySelector('button') as HTMLButtonElement).click();
    await settle();
  };
  const type = async (testId: string, value: string): Promise<void> => {
    const input = find(testId)?.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const selectTab = async (value: string): Promise<void> => {
    (find(`ui-tab-${value}`) as HTMLButtonElement).click();
    await settle();
  };
  const rowIds = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="meeting-details-reconcile-row-"]')).map((row) =>
      (row as HTMLElement).dataset['testid']!.replace('meeting-details-reconcile-row-', '')
    );

  beforeEach(() => {
    reconcile = vi.fn();
    update = vi.fn().mockReturnValue(of({}));
    toastShow = vi.fn();
    onChange = vi.fn<() => void>();
    const row = { key: 'synthetic-meeting', meeting: { id: 'synthetic-meeting' } as Meeting, title: 'Synthetic sync' } as MeetingHomeRow;
    const data: MeetingReconcileDialogData = { row, pastMeetingId: PAST_ID, onChange };

    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: MeetingService, useValue: { reconcilePastMeetingParticipants: reconcile, updatePastMeetingParticipant: update } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
  });

  it('runs the reconciliation on open behind a spinner', async () => {
    await render(NEVER);
    expect(reconcile).toHaveBeenCalledWith(PAST_ID);
    expect(find('meeting-details-reconcile-loading')).not.toBeNull();
    expect(find('meeting-dialog-context-divider')).not.toBeNull();
    expect(find('meeting-details-reconcile-tabs')).toBeNull();
    expect(text('ui-modal-title')).toBe('Reconcile Attendance');
    expect(text('ui-modal-subtitle')).toBe('Review AI-matched attendees and confirm, reassign, or leave them unknown');
  });

  it('sorts results into Needs Review, Unmatched and Auto-matched, with counts', async () => {
    await render(
      of(
        response([
          result({ attendee_id: 'a1', confidence: 'medium' }),
          // A degraded pool leaves a high-confidence match unapplied, so it needs review.
          result({ attendee_id: 'a2', confidence: 'high' }),
          result({ attendee_id: 'a3', confidence: 'low' }),
          result({ attendee_id: 'a4', confidence: 'none' }),
          result({ attendee_id: 'a5', confidence: 'high', auto_applied: true }),
        ])
      )
    );

    expect(text('ui-tab-count-needs-review')).toBe('2');
    expect(text('ui-tab-count-unmatched')).toBe('2');
    expect(text('ui-tab-count-auto-matched')).toBe('1');
    expect(rowIds()).toEqual(['a1', 'a2']);
    await selectTab('unmatched');
    expect(rowIds()).toEqual(['a3', 'a4']);
    await selectTab('auto-matched');
    expect(rowIds()).toEqual(['a5']);
    expect(find('meeting-details-reconcile-assign-a5')).toBeNull();
  });

  it('shows the row text, the suggestion and the matched candidate', async () => {
    await render(
      of(
        response([
          result({ attendee_id: 'a1', zoom_user_name: undefined, matched_candidate: CANDIDATE }),
          result({ attendee_id: 'a2', confidence: 'high', method: 'deterministic', auto_applied: true, matched_candidate: CANDIDATE }),
        ])
      )
    );

    const row = text('meeting-details-reconcile-row-a1');
    expect(row).toContain('Unknown attendee');
    expect(row).toContain('medium confidence · ai');
    expect(find('meeting-details-reconcile-candidate')?.textContent?.trim()).toBe('Suggested: Jane Doe (jane@acme-motors.example) · Acme Motors');
    await selectTab('auto-matched');
    expect(find('meeting-details-reconcile-candidate')?.textContent?.trim()).toBe('Matched: Jane Doe (jane@acme-motors.example) · Acme Motors');
  });

  it('shows the degraded note and the empty tab', async () => {
    await render(of(response([], { pool_degraded: true })));
    expect(text('meeting-details-reconcile-degraded')).toBe(
      'Some candidate sources failed to load, so no matches were auto-applied this run. Review all results below.'
    );
    expect(text('meeting-details-reconcile-empty')).toBe('No attendees in this tab.');
  });

  it('reports a failed run and shows empty tabs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await render(throwError(() => new Error('boom')));
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'Error', description: 'Failed to run attendance reconciliation. Please try again.' })
    );
    expect(text('meeting-details-reconcile-empty')).toBe('No attendees in this tab.');
  });

  it('tells the opener when the run applied matches itself', async () => {
    await render(of(response([], { auto_applied_count: 2 })));
    expect(onChange).toHaveBeenCalledTimes(1);
    fixture.destroy();

    onChange.mockClear();
    await render(of(response([])));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still tells the opener about applied matches when closed before the run returns', async () => {
    const reply = new Subject<ReconcilePastMeetingParticipantsResponse>();
    await render(reply);
    fixture.destroy();
    reply.next(response([], { auto_applied_count: 1 }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('confirms a match with the candidate, removes the row and tells the opener', async () => {
    await render(of(response([result({ matched_candidate: CANDIDATE })])));
    await click('meeting-details-reconcile-confirm-a1');

    expect(update).toHaveBeenCalledWith(PAST_ID, 'a1', {
      is_attended: true,
      email: CANDIDATE.email,
      username: CANDIDATE.username,
      lf_user_id: CANDIDATE.lf_user_id,
      first_name: CANDIDATE.first_name,
      last_name: CANDIDATE.last_name,
      is_verified: true,
      is_unknown: false,
      is_ai_reconciled: true,
    });
    expect(rowIds()).toEqual([]);
    expect(text('ui-tab-count-needs-review')).toBe('0');
    expect(toastShow).toHaveBeenCalledWith({
      variant: 'success',
      position: 'bottom-center',
      message: 'Attendee Updated',
      description: 'The attendance record has been updated.',
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('marks a deterministic match as not AI-reconciled, and offers no Confirm without a candidate', async () => {
    await render(of(response([result({ method: 'deterministic', confidence: 'high', matched_candidate: CANDIDATE }), result({ attendee_id: 'a2' })])));
    expect(find('meeting-details-reconcile-confirm-a2')).toBeNull();
    await click('meeting-details-reconcile-confirm-a1');
    expect(update).toHaveBeenCalledWith(PAST_ID, 'a1', expect.objectContaining({ is_ai_reconciled: false }));
  });

  it('leaves an unmatched attendee unknown', async () => {
    await render(of(response([result({ confidence: 'none' })])));
    await selectTab('unmatched');
    await click('meeting-details-reconcile-leave-a1');
    expect(update).toHaveBeenCalledWith(PAST_ID, 'a1', { is_attended: true, is_verified: false, is_unknown: true, is_ai_reconciled: false });
    expect(rowIds()).toEqual([]);
  });

  it('keeps the row and reports a failed action', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    update.mockReturnValue(throwError(() => new Error('boom')));
    await render(of(response([result({ confidence: 'low' })])));
    await selectTab('unmatched');
    await click('meeting-details-reconcile-leave-a1');
    expect(rowIds()).toEqual(['a1']);
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'Error', description: 'Failed to update this attendee. Please try again.' })
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('assign', () => {
    it('prefills the form from the candidate and sends the trimmed fields', async () => {
      await render(of(response([result({ matched_candidate: CANDIDATE })])));
      await click('meeting-details-reconcile-assign-a1');
      expect((find('meeting-details-reconcile-assign-email')?.querySelector('input') as HTMLInputElement).value).toBe(CANDIDATE.email);

      await type('meeting-details-reconcile-assign-email', '  new@acme-motors.example ');
      await type('meeting-details-reconcile-assign-username', '   ');
      await click('meeting-details-reconcile-assign-save');
      expect(update).toHaveBeenCalledWith(PAST_ID, 'a1', {
        is_attended: true,
        email: 'new@acme-motors.example',
        username: undefined,
        first_name: 'Jane',
        last_name: 'Doe',
        is_verified: true,
        is_unknown: false,
        is_ai_reconciled: false,
      });
      expect(find('meeting-details-reconcile-assign-form')).toBeNull();
    });

    it('asks for an email and sends nothing without one', async () => {
      await render(of(response([result({ confidence: 'low' })])));
      await selectTab('unmatched');
      await click('meeting-details-reconcile-assign-a1');
      await type('meeting-details-reconcile-assign-email', '   ');
      await click('meeting-details-reconcile-assign-save');
      expect(update).not.toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: 'Email Required', description: 'Enter an email to assign this attendee.' })
      );
    });

    it('closes on Cancel, and stays open when another row is updated', async () => {
      await render(of(response([result({ confidence: 'low' }), result({ attendee_id: 'a2', confidence: 'low' })])));
      await selectTab('unmatched');
      await click('meeting-details-reconcile-assign-a2');
      await type('meeting-details-reconcile-assign-email', 'pending@acme-motors.example');
      await click('meeting-details-reconcile-leave-a1');
      expect((find('meeting-details-reconcile-assign-email')?.querySelector('input') as HTMLInputElement).value).toBe('pending@acme-motors.example');

      await click('meeting-details-reconcile-assign-cancel');
      expect(find('meeting-details-reconcile-assign-form')).toBeNull();
    });
  });
});
