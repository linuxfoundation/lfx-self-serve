// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRsvp, MeetingRsvpSubmitError, User } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRsvpService } from './meeting-rsvp.service';

const OCCURRENCE_SECONDS = '4071031200';
const MEETING = { id: 'synthetic-meeting', title: 'Synthetic meeting', is_invite_responses_enabled: true } as Meeting;
const ACK: MeetingRsvp = {
  id: 'synthetic-rsvp',
  meeting_id: MEETING.id,
  registrant_id: 'synthetic-registrant',
  username: 'synthetic-viewer',
  email: 'synthetic@example.com',
  response_type: 'accepted',
  scope: 'all',
  created_at: '2026-10-10T09:00:00Z',
};

describe('MeetingRsvpService', () => {
  let service: MeetingRsvpService;
  let createMeetingRsvp: ReturnType<typeof vi.fn>;
  let recordConfirmedMeetingRsvp: ReturnType<typeof vi.fn>;
  let isMeetingRsvpCurrent: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let activeLens: ReturnType<typeof signal<string>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    createMeetingRsvp = vi.fn(() => of(ACK));
    recordConfirmedMeetingRsvp = vi.fn((rsvp: MeetingRsvp) => ({ ...rsvp, id: 'synthetic-retained' }));
    isMeetingRsvpCurrent = vi.fn(() => true);
    refreshUserMeetings = vi.fn();
    activeLens = signal('me');

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingService, useValue: { createMeetingRsvp } },
        {
          provide: UserService,
          useValue: {
            user: signal({ sub: 'synthetic-sub', email: 'synthetic@example.com' } as User),
            viewerUsername: signal('synthetic-viewer'),
            meetingRegistrationGeneration: vi.fn(() => 3),
            recordConfirmedMeetingRsvp,
            isMeetingRsvpCurrent,
            refreshUserMeetings,
          },
        },
        { provide: LensService, useValue: { activeLens } },
      ],
    });
    service = TestBed.inject(MeetingRsvpService);
  });

  afterEach(() => vi.useRealTimers());

  const failure = (source = service.submit$(MEETING, undefined, 'accepted', 'all')): Promise<MeetingRsvpSubmitError> =>
    firstValueFrom(source).then(
      () => {
        throw new Error('expected the submission to fail');
      },
      (error: MeetingRsvpSubmitError) => error
    );

  it('sends nothing until subscribed', () => {
    service.submit$(MEETING, undefined, 'accepted', 'all');

    expect(createMeetingRsvp).not.toHaveBeenCalled();
  });

  it('saves an all-dates answer without an occurrence, records it for the submitting subject, and emits the retained copy', async () => {
    const saved = await firstValueFrom(service.submit$(MEETING, OCCURRENCE_SECONDS, 'accepted', 'all'));

    expect(createMeetingRsvp).toHaveBeenCalledWith(MEETING.id, { response: 'accepted', scope: 'all', email: 'synthetic@example.com' });
    expect(recordConfirmedMeetingRsvp).toHaveBeenCalledWith(expect.objectContaining({ id: ACK.id }), 'synthetic-sub', 3);
    expect(saved.id).toBe('synthetic-retained');
    expect(refreshUserMeetings).toHaveBeenCalledWith(true);
  });

  it.each(['single', 'this_and_following'] as const)('sends a %s answer for the occurrence in seconds', async (scope) => {
    await firstValueFrom(service.submit$(MEETING, `${OCCURRENCE_SECONDS}000`, 'declined', scope));

    expect(createMeetingRsvp).toHaveBeenCalledWith(MEETING.id, expect.objectContaining({ scope, occurrence_id: OCCURRENCE_SECONDS }));
  });

  it('fills a mangled acknowledgement from the submitted answer and the confirmation time', async () => {
    createMeetingRsvp.mockReturnValue(of({ ...ACK, response_type: 'yes', occurrence_id: '' }));
    recordConfirmedMeetingRsvp.mockReturnValue(null);

    const saved = await firstValueFrom(service.submit$(MEETING, OCCURRENCE_SECONDS, 'maybe', 'single'));

    expect(saved).toEqual(
      expect.objectContaining({ response_type: 'maybe', occurrence_id: OCCURRENCE_SECONDS, updated_at: new Date('2026-10-10T10:00:00Z').toISOString() })
    );
  });

  it('keeps the modification time the acknowledgement carries', async () => {
    createMeetingRsvp.mockReturnValue(of({ ...ACK, modified_at: '2026-10-10T09:30:00Z' }));

    const saved = await firstValueFrom(service.submit$(MEETING, undefined, 'accepted', 'all'));

    expect(saved.updated_at).toBe('2026-10-10T09:30:00Z');
  });

  it('defers the feed refetch outside the Me lens', async () => {
    activeLens.set('project');

    await firstValueFrom(service.submit$(MEETING, undefined, 'accepted', 'all'));

    expect(refreshUserMeetings).toHaveBeenCalledWith(false);
  });

  it('completes without a value or refetch when the registration ended while the write was in flight', async () => {
    isMeetingRsvpCurrent.mockReturnValue(false);

    const emitted = await firstValueFrom(service.submit$(MEETING, undefined, 'accepted', 'all').pipe(toArray()));

    expect(emitted).toEqual([]);
    expect(refreshUserMeetings).not.toHaveBeenCalled();
  });

  it('marks the meeting as submitting until the write settles', async () => {
    const pending = new Subject<MeetingRsvp>();
    createMeetingRsvp.mockReturnValue(pending);
    const subscription = service.submit$(MEETING, undefined, 'accepted', 'all').subscribe();

    expect(service.submittingMeetingIds().has(MEETING.id)).toBe(true);
    pending.next(ACK);
    pending.complete();
    expect(service.submittingMeetingIds().has(MEETING.id)).toBe(false);
    subscription.unsubscribe();
  });

  it('fails without a request when a scoped answer has no resolvable date', async () => {
    const error = await failure(service.submit$(MEETING, undefined, 'declined', 'single'));

    expect(error).toEqual({ message: 'This meeting date could not be resolved. Please reload the meeting and try again.' });
    expect(createMeetingRsvp).not.toHaveBeenCalled();
  });

  it('explains a 404 as an invitation-only meeting', async () => {
    createMeetingRsvp.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404, error: { error: 'Not found' } })));

    expect(await failure()).toEqual({ message: 'Only invited users are allowed to RSVP to this meeting.', status: 404 });
  });

  it('passes the BFF reason through for other failures', async () => {
    createMeetingRsvp.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'Synthetic rejection' } })));

    expect(await failure()).toEqual({ message: 'Synthetic rejection', status: 403 });
    expect(refreshUserMeetings).not.toHaveBeenCalled();
  });

  it('falls back to generic copy when the failure carries no reason', async () => {
    createMeetingRsvp.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    expect(await failure()).toEqual({ message: 'Failed to update RSVP. Please try again.', status: 500 });
  });
});
