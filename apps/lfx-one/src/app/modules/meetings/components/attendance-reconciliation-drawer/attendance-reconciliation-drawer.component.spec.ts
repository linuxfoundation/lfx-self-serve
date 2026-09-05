// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AttendanceReconciliationResult, ReconcilePastMeetingParticipantsResponse } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceReconciliationDrawerComponent } from './attendance-reconciliation-drawer.component';

describe('AttendanceReconciliationDrawerComponent', () => {
  const PAST_MEETING_ID = 'past-meeting-1';

  let reconcilePastMeetingParticipants: ReturnType<typeof vi.fn>;
  let updatePastMeetingParticipant: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const buildResult = (overrides: Partial<AttendanceReconciliationResult> = {}): AttendanceReconciliationResult =>
    ({
      attendee_id: 'attendee-1',
      zoom_user_name: 'Jane Doe',
      confidence: 'medium',
      method: 'ai',
      auto_applied: false,
      matched_candidate: undefined,
      ...overrides,
    }) as AttendanceReconciliationResult;

  const buildResponse = (results: AttendanceReconciliationResult[], overrides: Partial<ReconcilePastMeetingParticipantsResponse> = {}) =>
    ({
      results,
      pool_degraded: false,
      ...overrides,
    }) as ReconcilePastMeetingParticipantsResponse;

  const createComponent = () => TestBed.createComponent(AttendanceReconciliationDrawerComponent);

  const openDrawer = async (fixture: ReturnType<typeof createComponent>) => {
    fixture.componentRef.setInput('pastMeetingId', PAST_MEETING_ID);
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.componentInstance.visible.set(true);
    await TestBed.inject(ApplicationRef).whenStable();
  };

  beforeEach(() => {
    reconcilePastMeetingParticipants = vi.fn().mockReturnValue(of(buildResponse([])));
    updatePastMeetingParticipant = vi.fn().mockReturnValue(of({}));
    messageAdd = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MeetingService, useValue: { reconcilePastMeetingParticipants, updatePastMeetingParticipant } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
  });

  it('does not call the reconcile endpoint until the drawer becomes visible', async () => {
    const fixture = createComponent();
    fixture.componentRef.setInput('pastMeetingId', PAST_MEETING_ID);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(reconcilePastMeetingParticipants).not.toHaveBeenCalled();
  });

  it('buckets results into needs-review, unmatched, and auto-matched by confidence', async () => {
    const results = [
      buildResult({ attendee_id: 'a1', confidence: 'medium' }),
      buildResult({ attendee_id: 'a2', confidence: 'low' }),
      buildResult({ attendee_id: 'a3', confidence: 'none' }),
      buildResult({ attendee_id: 'a4', confidence: 'high', auto_applied: true }),
    ];
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse(results)));

    const fixture = createComponent();
    await openDrawer(fixture);

    expect(fixture.componentInstance.needsReviewResults().map((r) => r.attendee_id)).toEqual(['a1']);
    expect(fixture.componentInstance.unmatchedResults().map((r) => r.attendee_id)).toEqual(['a2', 'a3']);
    expect(fixture.componentInstance.autoMatchedResults().map((r) => r.attendee_id)).toEqual(['a4']);
    expect(fixture.componentInstance.visibleResults().map((r) => r.attendee_id)).toEqual(['a1']);
  });

  it('surfaces the pool-degraded flag from the reconcile response', async () => {
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([], { pool_degraded: true })));

    const fixture = createComponent();
    await openDrawer(fixture);

    expect(fixture.componentInstance.poolDegraded()).toBe(true);
  });

  it('shows an error toast and stops loading when the reconcile call fails', async () => {
    reconcilePastMeetingParticipants.mockReturnValue(throwError(() => new Error('boom')));

    const fixture = createComponent();
    await openDrawer(fixture);

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('confirmMatch attaches the matched candidate identity and removes the row on success', async () => {
    const candidate = { email: 'jane@example.com', username: 'jdoe', lf_user_id: 'lfid-1', first_name: 'Jane', last_name: 'Doe' };
    const result = buildResult({ attendee_id: 'a1', confidence: 'medium', matched_candidate: candidate as never });
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([result])));

    const fixture = createComponent();
    await openDrawer(fixture);

    fixture.componentInstance.confirmMatch(result);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(updatePastMeetingParticipant).toHaveBeenCalledWith(
      PAST_MEETING_ID,
      'a1',
      expect.objectContaining({
        email: candidate.email,
        username: candidate.username,
        lf_user_id: candidate.lf_user_id,
        first_name: candidate.first_name,
        last_name: candidate.last_name,
        is_verified: true,
        is_ai_reconciled: true,
      })
    );
    expect(fixture.componentInstance.needsReviewResults()).toEqual([]);
  });

  it('leaveUnknown marks the attendee reviewed without attaching an identity', async () => {
    const result = buildResult({ attendee_id: 'a2', confidence: 'none' });
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([result])));

    const fixture = createComponent();
    await openDrawer(fixture);

    fixture.componentInstance.leaveUnknown(result);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(updatePastMeetingParticipant).toHaveBeenCalledWith(PAST_MEETING_ID, 'a2', { is_verified: false, is_ai_reconciled: false });
    expect(fixture.componentInstance.unmatchedResults()).toEqual([]);
  });

  it('submitAssign rejects an empty email without calling the update endpoint', async () => {
    const result = buildResult({ attendee_id: 'a3', confidence: 'low' });
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([result])));

    const fixture = createComponent();
    await openDrawer(fixture);

    fixture.componentInstance.openAssign(result);
    fixture.componentInstance.updateAssignForm('email', '   ');
    fixture.componentInstance.submitAssign(result);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(updatePastMeetingParticipant).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Email Required' }));
  });

  it('submitAssign persists the manually-entered identity and clears the assign form on success', async () => {
    const result = buildResult({ attendee_id: 'a4', confidence: 'low' });
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([result])));

    const fixture = createComponent();
    await openDrawer(fixture);

    fixture.componentInstance.openAssign(result);
    fixture.componentInstance.updateAssignForm('email', 'manual@example.com');
    fixture.componentInstance.submitAssign(result);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(updatePastMeetingParticipant).toHaveBeenCalledWith(
      PAST_MEETING_ID,
      'a4',
      expect.objectContaining({ email: 'manual@example.com', is_verified: true, is_ai_reconciled: false })
    );
    expect(fixture.componentInstance.assigningAttendeeId()).toBeNull();
  });

  it('shows an error toast and keeps the row when a row action fails', async () => {
    const result = buildResult({ attendee_id: 'a5', confidence: 'none' });
    reconcilePastMeetingParticipants.mockReturnValue(of(buildResponse([result])));
    updatePastMeetingParticipant.mockReturnValue(throwError(() => new Error('boom')));

    const fixture = createComponent();
    await openDrawer(fixture);

    fixture.componentInstance.leaveUnknown(result);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(fixture.componentInstance.isRowLoading('a5')).toBe(false);
    expect(fixture.componentInstance.unmatchedResults().map((r) => r.attendee_id)).toEqual(['a5']);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
