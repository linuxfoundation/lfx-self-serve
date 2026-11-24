// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BatchRegistrantOperationResponse, MeetingRegistrant, MeetingSelfGuest, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { firstValueFrom, of, Subject, throwError, toArray } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingSelfInviteService } from './meeting-self-invite.service';

describe('MeetingSelfInviteService', () => {
  const MEETING_ID = 'synthetic-meeting';
  const self: MeetingSelfGuest = {
    email: 'pat.doe@acme-motors.example',
    first_name: 'Synthetic',
    last_name: 'Viewer',
    job_title: 'Engineer',
    org_name: 'Acme Motors',
    username: 'synthetic-viewer',
    avatar_url: 'https://avatars.acme-motors.example/pdoe.png',
    matchEmails: ['pat.doe@acme-motors.example', 'pat@vendor-corp.example'],
  };
  const saved = { uid: 'synthetic-reg', meeting_id: MEETING_ID, email: self.email } as MeetingRegistrant;
  const success: BatchRegistrantOperationResponse<MeetingRegistrant> = { successes: [saved], failures: [], summary: { total: 1, successful: 1, failed: 0 } };
  const otherGuest = { uid: 'synthetic-other', email: 'someone@acme-motors.example', username: 'someone-else' } as MeetingRegistrant;

  let service: MeetingSelfInviteService;
  let user: WritableSignal<User | null>;
  let getMeetingSelfGuest: ReturnType<typeof vi.fn>;
  let getMeetingRegistrants: ReturnType<typeof vi.fn>;
  let addMeetingRegistrants: ReturnType<typeof vi.fn>;
  let clearRemovedRegistration: ReturnType<typeof vi.fn>;
  let clearRemovalIfReinvited: ReturnType<typeof vi.fn>;
  let removedIds: WritableSignal<ReadonlySet<string>>;
  let removedSelfRegistrantUids: Map<string, ReadonlySet<string>>;

  /** The viewer's Remove Myself, as `MeetingService.markRegistrationRemoved` records it. */
  function markRemoved(registrantUids: string[]): void {
    removedSelfRegistrantUids.set(MEETING_ID, new Set(registrantUids));
    removedIds.set(new Set([MEETING_ID]));
  }

  beforeEach(() => {
    user = signal({ sub: 'synthetic-subject' } as User);
    getMeetingSelfGuest = vi.fn().mockReturnValue(of(self));
    getMeetingRegistrants = vi.fn().mockReturnValue(of([otherGuest]));
    addMeetingRegistrants = vi.fn().mockReturnValue(of(success));
    removedIds = signal<ReadonlySet<string>>(new Set());
    removedSelfRegistrantUids = new Map();
    clearRemovedRegistration = vi.fn((meetingId: string) => removedIds.update((ids) => new Set([...ids].filter((id) => id !== meetingId))));
    // The real mapping, so the posted body is the one the BFF would receive.
    const stripMetadata = (meetingId: string, registrant: Parameters<MeetingService['stripMetadata']>[1]) =>
      MeetingService.prototype.stripMetadata.call({}, meetingId, registrant);
    // The real re-invite check, over the same removal state the service reads.
    const removalState = { removedRegistrationIds: removedIds, removedSelfRegistrantUids, clearRemovedRegistration };
    clearRemovalIfReinvited = vi.fn((meetingId: string, selfUids: readonly string[]) =>
      MeetingService.prototype.clearRemovalIfReinvited.call(removalState, meetingId, selfUids)
    );

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingService,
          useValue: {
            getMeetingRegistrants,
            addMeetingRegistrants,
            clearRemovedRegistration,
            clearRemovalIfReinvited,
            removedRegistrationMeetingIds: removedIds,
            stripMetadata,
          },
        },
        { provide: UserService, useValue: { user, viewerUsername: signal(null), getMeetingSelfGuest } },
      ],
    });
    service = TestBed.inject(MeetingSelfInviteService);
  });

  it('does nothing until subscribed', () => {
    service.add$(MEETING_ID);

    expect(getMeetingSelfGuest).not.toHaveBeenCalled();
  });

  it('checks the complete roster, then adds the viewer as a non-host guest of every occurrence', async () => {
    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'added', registrant: saved });

    expect(getMeetingRegistrants).toHaveBeenCalledWith(MEETING_ID, false, undefined, true);
    expect(addMeetingRegistrants).toHaveBeenCalledWith(MEETING_ID, [
      {
        meeting_id: MEETING_ID,
        email: self.email,
        first_name: 'Synthetic',
        last_name: 'Viewer',
        host: false,
        job_title: 'Engineer',
        org_name: 'Acme Motors',
        username: 'synthetic-viewer',
        avatar_url: 'https://avatars.acme-motors.example/pdoe.png',
      },
    ]);
    expect(addMeetingRegistrants.mock.calls[0][1][0]).not.toHaveProperty('occurrence_id');
    expect(clearRemovedRegistration).toHaveBeenCalledWith(MEETING_ID);
  });

  it('preserves a successful empty-body fallback without reposting or inventing a UID', async () => {
    const fallback = { ...saved, uid: '' };
    addMeetingRegistrants.mockReturnValueOnce(of({ ...success, successes: [fallback] }));
    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'added', registrant: fallback });
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(1);
    expect(clearRemovedRegistration).toHaveBeenCalledWith(MEETING_ID);
  });

  it('posts nothing when the roster already lists one of the viewer emails', async () => {
    getMeetingRegistrants.mockReturnValue(of([otherGuest, { uid: 'synthetic-self', email: 'Pat@Vendor-Corp.example' } as MeetingRegistrant]));

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({
      status: 'already-listed',
      registrants: [{ uid: 'synthetic-self', email: 'Pat@Vendor-Corp.example' }],
    });
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(clearRemovedRegistration).not.toHaveBeenCalled();
  });

  it('posts nothing when the roster lists the viewer LFID under another address', async () => {
    getMeetingRegistrants.mockReturnValue(
      of([{ uid: 'synthetic-self', email: 'group-alias@acme-motors.example', username: 'Synthetic-Viewer' } as MeetingRegistrant])
    );

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({
      status: 'already-listed',
      registrants: [{ uid: 'synthetic-self', email: 'group-alias@acme-motors.example', username: 'Synthetic-Viewer' }],
    });
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('adds the viewer again when the roster still lists the registration they just removed', async () => {
    markRemoved(['synthetic-self']);
    getMeetingRegistrants.mockReturnValue(of([otherGuest, { uid: 'synthetic-self', email: self.email } as MeetingRegistrant]));

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'added', registrant: saved });
    expect(addMeetingRegistrants).toHaveBeenCalledOnce();
    expect(removedIds().has(MEETING_ID)).toBe(false);
  });

  it('treats a row under a new uid after a removal as a re-invite: posts nothing and lifts the removal', async () => {
    markRemoved(['synthetic-self']);
    getMeetingRegistrants.mockReturnValue(of([{ uid: 'synthetic-reinvite', email: self.email } as MeetingRegistrant]));

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({
      status: 'already-listed',
      registrants: [{ uid: 'synthetic-reinvite', email: self.email }],
    });
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(removedIds().has(MEETING_ID)).toBe(false);
  });

  it('reports unavailable without reading the roster when the viewer cannot be resolved', async () => {
    getMeetingSelfGuest.mockReturnValue(of(null));

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'unavailable' });
    expect(getMeetingRegistrants).not.toHaveBeenCalled();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('reports unavailable when the profile has no last name', async () => {
    getMeetingSelfGuest.mockReturnValue(of({ ...self, last_name: '' }));

    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'unavailable' });
    expect(getMeetingRegistrants).not.toHaveBeenCalled();
  });

  it('errors without posting when the roster cannot be loaded completely', async () => {
    const error = new HttpErrorResponse({ status: 502 });
    getMeetingRegistrants.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(service.add$(MEETING_ID))).rejects.toBe(error);
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(clearRemovedRegistration).not.toHaveBeenCalled();
  });

  it.each([
    [' This guest is already invited. ', 'This guest is already invited.'],
    ['   ', 'Unable to add you to this meeting. Please try again.'],
  ])('describes an HTTP 400 batch rejection with reason %j', async (message, expected) => {
    const rejection = new HttpErrorResponse({
      status: 400,
      error: { successes: [], failures: [{ input: {}, error: { message } }], summary: { total: 1, successful: 0, failed: 1 } },
    });
    addMeetingRegistrants.mockReturnValue(throwError(() => rejection));

    const error = await firstValueFrom(service.add$(MEETING_ID)).catch((caught: unknown) => caught);

    expect(error).toBe(rejection);
    expect(service.describeFailure(error)).toBe(expected);
    expect(clearRemovedRegistration).not.toHaveBeenCalled();
  });

  it('completes silently when the viewer changed in flight', async () => {
    const roster$ = new Subject<MeetingRegistrant[]>();
    getMeetingRegistrants.mockReturnValue(roster$);
    const emitted = firstValueFrom(service.add$(MEETING_ID).pipe(toArray()));

    user.set({ sub: 'synthetic-other-subject' } as User);
    roster$.next([otherGuest]);
    roster$.complete();

    await expect(emitted).resolves.toEqual([]);
    expect(clearRemovedRegistration).not.toHaveBeenCalled();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(clearRemovalIfReinvited).not.toHaveBeenCalled();
  });

  it('does not request the roster or invite after the viewer changes during profile resolution', async () => {
    const profile$ = new Subject<MeetingSelfGuest | null>();
    getMeetingSelfGuest.mockReturnValue(profile$);
    const emitted = firstValueFrom(service.add$(MEETING_ID).pipe(toArray()));

    user.set({ sub: 'synthetic-other-subject' } as User);
    profile$.next(self);
    profile$.complete();

    await expect(emitted).resolves.toEqual([]);
    expect(getMeetingRegistrants).not.toHaveBeenCalled();
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(clearRemovalIfReinvited).not.toHaveBeenCalled();
    expect(clearRemovedRegistration).not.toHaveBeenCalled();
  });

  it('keeps overlapping card attempts out throughout profile, roster and POST resolution', async () => {
    const profile$ = new Subject<MeetingSelfGuest>();
    const roster$ = new Subject<MeetingRegistrant[]>();
    const post$ = new Subject<BatchRegistrantOperationResponse<MeetingRegistrant>>();
    getMeetingSelfGuest.mockReturnValue(profile$);
    getMeetingRegistrants.mockReturnValue(roster$);
    addMeetingRegistrants.mockReturnValue(post$);
    const result = firstValueFrom(service.add$(MEETING_ID));
    expect(service.isPending(MEETING_ID)).toBe(true);
    await expect(firstValueFrom(service.add$(MEETING_ID).pipe(toArray()))).resolves.toEqual([]);
    profile$.next(self);
    await expect(firstValueFrom(service.add$(MEETING_ID).pipe(toArray()))).resolves.toEqual([]);
    roster$.next([]);
    await expect(firstValueFrom(service.add$(MEETING_ID).pipe(toArray()))).resolves.toEqual([]);
    expect(getMeetingSelfGuest).toHaveBeenCalledTimes(1);
    expect(getMeetingRegistrants).toHaveBeenCalledTimes(1);
    expect(addMeetingRegistrants).toHaveBeenCalledTimes(1);
    post$.next(success);
    await expect(result).resolves.toEqual({ status: 'added', registrant: saved });
    expect(service.isPending(MEETING_ID)).toBe(false);
  });

  it('shares the guard with drawer submissions and permits retry after a failed drawer request', async () => {
    const pending$ = new Subject<unknown>();
    const failure = new Error('Synthetic invitation rejected');
    const drawerResult = firstValueFrom(service.withPendingInvite$(MEETING_ID, () => pending$)).catch((error: unknown) => error);
    await expect(firstValueFrom(service.add$(MEETING_ID).pipe(toArray()))).resolves.toEqual([]);
    expect(getMeetingSelfGuest).not.toHaveBeenCalled();
    pending$.error(failure);
    await expect(drawerResult).resolves.toBe(failure);
    expect(service.isPending(MEETING_ID)).toBe(false);
    await expect(firstValueFrom(service.add$(MEETING_ID))).resolves.toEqual({ status: 'added', registrant: saved });
  });

  it('blocks a drawer write during a card attempt without starting the drawer request', async () => {
    const roster$ = new Subject<MeetingRegistrant[]>();
    getMeetingRegistrants.mockReturnValue(roster$);
    const card = service.add$(MEETING_ID).subscribe();
    const drawer = vi.fn(() => of(success));
    await expect(firstValueFrom(service.withPendingInvite$(MEETING_ID, drawer).pipe(toArray()))).resolves.toEqual([]);
    expect(drawer).not.toHaveBeenCalled();
    card.unsubscribe();
    expect(service.isPending(MEETING_ID)).toBe(false);
  });

  it('isolates pending attempts by meeting and viewer, including late cleanup for the old viewer', () => {
    const first = service.withPendingInvite$(MEETING_ID, () => new Subject<unknown>()).subscribe();
    expect(service.isPending('synthetic-other-meeting')).toBe(false);
    user.set({ sub: 'synthetic-other-subject' } as User);
    expect(service.isPending(MEETING_ID)).toBe(false);
    const second = service.withPendingInvite$(MEETING_ID, () => new Subject<unknown>()).subscribe();
    first.unsubscribe();
    expect(service.isPending(MEETING_ID)).toBe(true);
    second.unsubscribe();
    expect(service.isPending(MEETING_ID)).toBe(false);
  });

  it('releases pending state when constructing the request throws synchronously', async () => {
    const failure = new Error('Synthetic request failed');
    await expect(
      firstValueFrom(
        service.withPendingInvite$(MEETING_ID, () => {
          throw failure;
        })
      )
    ).rejects.toBe(failure);
    expect(service.isPending(MEETING_ID)).toBe(false);
  });

  describe('describeFailure', () => {
    it("shows the BFF's validation message", () => {
      const error = new HttpErrorResponse({ status: 400, error: { code: 'VALIDATION_ERROR', error: 'The guest could not be added.' } });

      expect(service.describeFailure(error)).toContain('The guest could not be added.');
    });

    it('falls back to generic copy for server errors and empty reasons', () => {
      const fallback = 'Unable to add you to this meeting. Please try again.';

      expect(service.describeFailure(new HttpErrorResponse({ status: 500, error: 'boom' }))).toBe(fallback);
      expect(service.describeFailure(new Error(''))).toBe(fallback);
    });
  });
});
