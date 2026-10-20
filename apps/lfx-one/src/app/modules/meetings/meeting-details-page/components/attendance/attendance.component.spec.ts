// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingTimeState, PastMeetingParticipant, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingAttendanceComponent } from './attendance.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const PAST_ID = 'meeting-1-1700000000000';

const participant = (uid: string, attended: boolean, invited = true): PastMeetingParticipant =>
  ({ uid, first_name: uid, last_name: 'Example', is_attended: attended, is_invited: invited }) as unknown as PastMeetingParticipant;

/** V1 parity: the attended / absent / rate figures of V1's `attendance-summary`, same source and gating. */
describe('MeetingAttendanceComponent', () => {
  let fixture: ComponentFixture<MeetingAttendanceComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let matchesRoute: WritableSignal<boolean>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let pastMeetingFullAccess: WritableSignal<boolean>;
  let authenticated: WritableSignal<boolean>;
  let getPastMeetingParticipants: ReturnType<typeof vi.fn>;

  const setup = async (read: () => Observable<PastMeetingParticipant[]> = () => of([])): Promise<void> => {
    getPastMeetingParticipants.mockImplementation(read);
    await TestBed.configureTestingModule({
      imports: [MeetingAttendanceComponent],
      providers: [
        { provide: MeetingDetailsStateService, useValue: { meeting, matchesRoute, timeState, pastMeetingFullAccess } },
        { provide: MeetingService, useValue: { getPastMeetingParticipants } },
        { provide: UserService, useValue: { authenticated } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingAttendanceComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    // A past payload can carry the series id in `id` and the occurrence in `meeting_and_occurrence_id`.
    meeting = signal<LoadedMeeting | undefined>({ id: 'meeting-1', meeting_and_occurrence_id: PAST_ID, project: {} } as unknown as LoadedMeeting);
    matchesRoute = signal(true);
    timeState = signal<MeetingTimeState | null>('ended');
    pastMeetingFullAccess = signal(true);
    authenticated = signal(true);
    getPastMeetingParticipants = vi.fn();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('reads the participants by the past resource id and counts attended, absent and the rate from them', async () => {
    await setup(() => of([participant('a', true), participant('b', true), participant('c', false)]));

    expect(getPastMeetingParticipants).toHaveBeenCalledWith(PAST_ID);
    expect(query('attendance-section')).not.toBeNull();
    expect(text('attendance-section-attended')).toBe('2 attended');
    expect(text('attendance-section-absent')).toBe('1 absent');
    // V1 rounds: 2 of 3 is 67%.
    expect(text('attendance-section-rate')).toBe('67% rate');
  });

  // V1: "shows the server attendance counts when the participants are hidden from the viewer".
  it("falls back to the past endpoint's counts when the participants come back empty", async () => {
    meeting.update((m) => ({ ...m!, participant_count: 8, attended_count: 6 }));
    await setup(() => of([]));

    expect(getPastMeetingParticipants).toHaveBeenCalledTimes(1);
    expect(text('attendance-section-attended')).toBe('6 attended');
    expect(text('attendance-section-absent')).toBe('2 absent');
    expect(text('attendance-section-rate')).toBe('75% rate');
  });

  it("falls back to the past endpoint's counts when the participants read fails", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    meeting.update((m) => ({ ...m!, participant_count: 4, attended_count: 1 }));
    await setup(() => throwError(() => new Error('boom')));

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    expect(text('attendance-section-attended')).toBe('1 attended');
    expect(text('attendance-section-absent')).toBe('3 absent');
    expect(text('attendance-section-rate')).toBe('25% rate');
  });

  it('renders nothing when there is nobody to count', async () => {
    await setup(() => of([]));

    expect(query('attendance-section')).toBeNull();
  });

  it('does not read the participants without full access, and shows no figures without counts', async () => {
    pastMeetingFullAccess.set(false);
    await setup();

    expect(getPastMeetingParticipants).not.toHaveBeenCalled();
    expect(query('attendance-section')).toBeNull();
  });

  it('does not read the participants for a signed-out viewer', async () => {
    authenticated.set(false);
    await setup();

    expect(getPastMeetingParticipants).not.toHaveBeenCalled();
  });

  it('shows nothing before the meeting has ended, even with counts', async () => {
    timeState.set('live');
    meeting.update((m) => ({ ...m!, participant_count: 3, attended_count: 3 }));
    await setup(() => of([participant('a', true)]));

    expect(query('attendance-section')).toBeNull();
  });

  it('never counts a read still in flight for the previous meeting against the one now shown', async () => {
    const first = new Subject<PastMeetingParticipant[]>();
    const responses = [first.asObservable(), of([participant('x', false)])];
    await setup(() => responses.shift()!);

    meeting.set({ id: 'meeting-2', meeting_and_occurrence_id: 'meeting-2-1700000000000', project: {} } as unknown as LoadedMeeting);
    fixture.detectChanges();
    await fixture.whenStable();
    first.next([participant('a', true), participant('b', true)]);
    fixture.detectChanges();

    expect(getPastMeetingParticipants).toHaveBeenLastCalledWith('meeting-2-1700000000000');
    expect(text('attendance-section-attended')).toBe('0 attended');
    expect(text('attendance-section-absent')).toBe('1 absent');
    expect(text('attendance-section-rate')).toBe('0% rate');
  });
});
