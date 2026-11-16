// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeetingRegistrationRemovalResult, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingSelfRemovalService } from './meeting-self-removal.service';

describe('MeetingSelfRemovalService', () => {
  const MEETING_ID = 'synthetic-meeting';
  const complete: MeetingRegistrationRemovalResult = { removed_registrant_ids: ['synthetic-reg'], remaining_registrant_ids: [] };
  const partial: MeetingRegistrationRemovalResult = { removed_registrant_ids: ['synthetic-reg'], remaining_registrant_ids: ['synthetic-other-reg'] };

  let service: MeetingSelfRemovalService;
  let user: WritableSignal<User | null>;
  let removeMyMeetingRegistration: ReturnType<typeof vi.fn>;
  let markRegistrationRemoved: ReturnType<typeof vi.fn>;
  let rememberRemovedRegistrants: ReturnType<typeof vi.fn>;
  let clearConfirmedMeetingRsvps: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    user = signal({ sub: 'synthetic-subject' } as User);
    removeMyMeetingRegistration = vi.fn().mockReturnValue(of(complete));
    markRegistrationRemoved = vi.fn();
    rememberRemovedRegistrants = vi.fn();
    clearConfirmedMeetingRsvps = vi.fn();
    refreshUserMeetings = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { removeMyMeetingRegistration, markRegistrationRemoved, rememberRemovedRegistrants } },
        { provide: UserService, useValue: { user, viewerUsername: signal(null), clearConfirmedMeetingRsvps, refreshUserMeetings } },
      ],
    });
    service = TestBed.inject(MeetingSelfRemovalService);
  });

  it('does nothing until subscribed', () => {
    service.remove$(MEETING_ID, 'meetings-home');

    expect(removeMyMeetingRegistration).not.toHaveBeenCalled();
  });

  it('removes the registration, clears its confirmed answers and marks the meeting removed', async () => {
    await expect(firstValueFrom(service.remove$(MEETING_ID, 'meetings-home'))).resolves.toEqual(complete);

    expect(removeMyMeetingRegistration).toHaveBeenCalledWith(MEETING_ID, 'meetings-home');
    expect(clearConfirmedMeetingRsvps).toHaveBeenCalledWith(MEETING_ID, 'synthetic-subject', complete);
    expect(markRegistrationRemoved).toHaveBeenCalledWith(MEETING_ID, ['synthetic-reg']);
    expect(refreshUserMeetings).not.toHaveBeenCalled();
  });

  it('keeps the meeting and defers a feed refresh when some registrations remain', async () => {
    removeMyMeetingRegistration.mockReturnValue(of(partial));

    await expect(firstValueFrom(service.remove$(MEETING_ID, 'meetings-home'))).resolves.toEqual(partial);

    expect(clearConfirmedMeetingRsvps).toHaveBeenCalledWith(MEETING_ID, 'synthetic-subject', partial);
    expect(markRegistrationRemoved).not.toHaveBeenCalled();
    expect(rememberRemovedRegistrants).toHaveBeenCalledWith(MEETING_ID, ['synthetic-reg']);
    expect(refreshUserMeetings).toHaveBeenCalledWith(false);
  });

  it('clears the previous viewer but completes silently when the viewer changed in flight', async () => {
    const removal$ = new Subject<MeetingRegistrationRemovalResult>();
    removeMyMeetingRegistration.mockReturnValue(removal$);
    const emitted = firstValueFrom(service.remove$(MEETING_ID, 'meetings-home').pipe(toArray()));

    user.set({ sub: 'synthetic-other-subject' } as User);
    removal$.next(complete);
    removal$.complete();

    await expect(emitted).resolves.toEqual([]);
    expect(clearConfirmedMeetingRsvps).toHaveBeenCalledWith(MEETING_ID, 'synthetic-subject', complete);
    expect(markRegistrationRemoved).not.toHaveBeenCalled();
  });

  it('passes errors through untouched', async () => {
    const error = new HttpErrorResponse({ status: 500 });
    removeMyMeetingRegistration.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(service.remove$(MEETING_ID, 'meetings-home'))).rejects.toBe(error);
    expect(markRegistrationRemoved).not.toHaveBeenCalled();
  });

  describe('describeFailure', () => {
    it("shows the BFF's validation message", () => {
      const error = new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'The registration could not be removed.' } });

      expect(service.describeFailure(error)).toContain('The registration could not be removed.');
    });

    it('falls back to generic copy for anything else', () => {
      expect(service.describeFailure(new HttpErrorResponse({ status: 500, error: 'boom' }))).toBe('Unable to remove you from this meeting. Please try again.');
    });
  });
});
