// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDeleteTypeResult, MeetingHomeRow, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDeleteModalComponent } from '../components/meeting-delete-modal/meeting-delete-modal.component';
import { MeetingDeleteScopeModalComponent } from '../components/meeting-delete-scope-modal/meeting-delete-scope-modal.component';
import { MeetingsHomeDeleteService } from './meetings-home-delete.service';
import { MeetingsHomeStore } from './meetings-home.store';

const FIRST = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SECOND = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const ONE_OFF = { id: 'synthetic-meeting', title: 'Synthetic sync', organizer: true, recurrence: null } as unknown as Meeting;
const SERIES = { ...ONE_OFF, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [FIRST, SECOND] } as unknown as Meeting;

const row = (meeting: Meeting, occurrence: MeetingOccurrence | null = null): MeetingHomeRow => {
  const { occurrence_id = null, start_time = FIRST.start_time } = occurrence ?? {};
  return { key: 'row', meeting, occurrence, title: meeting.title, occurrenceId: occurrence_id, startTime: start_time, durationMinutes: 30 };
};

describe('MeetingsHomeDeleteService', () => {
  let service: MeetingsHomeDeleteService;
  let modalOpen: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let store: { removeMeeting: ReturnType<typeof vi.fn>; removeOccurrence: ReturnType<typeof vi.fn> };
  let userService: { refreshUserMeetings: ReturnType<typeof vi.fn>; refreshUserPastMeetings: ReturnType<typeof vi.fn> };
  let scopeResult: Subject<MeetingDeleteTypeResult | undefined>;
  let confirmResult: Subject<boolean | undefined>;
  let dialogClose: ReturnType<typeof vi.fn>;

  const openedWith = (component: unknown): unknown[] | undefined => modalOpen.mock.calls.find(([content]) => content === component);

  beforeEach(() => {
    TestBed.resetTestingModule();
    scopeResult = new Subject();
    confirmResult = new Subject();
    dialogClose = vi.fn();
    modalOpen = vi.fn((component: unknown) => ({ close: dialogClose, closed: component === MeetingDeleteScopeModalComponent ? scopeResult : confirmResult }));
    toastShow = vi.fn();
    store = { removeMeeting: vi.fn(), removeOccurrence: vi.fn() };
    userService = { refreshUserMeetings: vi.fn(), refreshUserPastMeetings: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        MeetingsHomeDeleteService,
        { provide: MeetingsHomeStore, useValue: store },
        { provide: UserService, useValue: userService },
        { provide: UiModalService, useValue: { open: modalOpen } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
    service = TestBed.inject(MeetingsHomeDeleteService);
  });

  it('asks to confirm a one-time meeting straight away, in an alertdialog that cannot close while busy', () => {
    service.delete(row(ONE_OFF));

    expect(openedWith(MeetingDeleteScopeModalComponent)).toBeUndefined();
    const [, config, overrides] = openedWith(MeetingDeleteModalComponent) as [
      unknown,
      { data: unknown; role: string },
      { closePredicate: (...args: unknown[]) => boolean },
    ];
    expect(config).toEqual(expect.objectContaining({ data: { row: row(ONE_OFF), occurrence: null }, role: 'alertdialog' }));
    const dialog = (busy: boolean): MeetingDeleteModalComponent => Object.assign(Object.create(MeetingDeleteModalComponent.prototype), { busy: signal(busy) });
    expect(overrides.closePredicate(undefined, {}, dialog(true))).toBe(false);
    expect(overrides.closePredicate(undefined, {}, dialog(false))).toBe(true);
  });

  it('removes a deleted meeting at once, confirms with a dark toast and reloads the feeds', () => {
    service.delete(row(ONE_OFF));
    confirmResult.next(true);

    expect(store.removeMeeting).toHaveBeenCalledWith('synthetic-meeting');
    expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting deleted' });
    expect(userService.refreshUserMeetings).toHaveBeenCalledWith();
    expect(userService.refreshUserPastMeetings).toHaveBeenCalledWith();
  });

  it('changes nothing when the confirmation is dismissed', () => {
    service.delete(row(ONE_OFF));
    confirmResult.next(undefined);

    expect(store.removeMeeting).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('closes its open dialogs when the page goes away', () => {
    service.delete(row(ONE_OFF));
    TestBed.resetTestingModule();

    expect(dialogClose).toHaveBeenCalledWith();
  });

  describe('recurring', () => {
    it("asks for the scope on the row's date, then confirms the series delete", () => {
      service.delete(row(SERIES, SECOND));

      expect(openedWith(MeetingDeleteScopeModalComponent)?.[1]).toEqual({ data: { row: row(SERIES, SECOND), occurrence: SECOND } });
      scopeResult.next({ deleteType: 'series' });

      expect((openedWith(MeetingDeleteModalComponent)?.[1] as { data: unknown }).data).toEqual({ row: row(SERIES, SECOND), occurrence: null });
    });

    it('cancels the picked date and removes only its row', () => {
      service.delete(row(SERIES, SECOND));
      scopeResult.next({ deleteType: 'occurrence', occurrenceId: FIRST.occurrence_id });

      expect((openedWith(MeetingDeleteModalComponent)?.[1] as { data: unknown }).data).toEqual({ row: row(SERIES, SECOND), occurrence: FIRST });
      confirmResult.next(true);

      expect(store.removeOccurrence).toHaveBeenCalledWith('synthetic-meeting', FIRST.occurrence_id);
      expect(store.removeMeeting).not.toHaveBeenCalled();
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting occurrence cancelled' });
    });

    it('cancels a given date without asking for the scope and reports whether it was cancelled', () => {
      const results: boolean[] = [];
      service.cancelOccurrence(row(SERIES, SECOND), SECOND, 'drawer').subscribe((cancelled) => results.push(cancelled));

      expect(openedWith(MeetingDeleteScopeModalComponent)).toBeUndefined();
      expect((openedWith(MeetingDeleteModalComponent)?.[1] as { data: unknown }).data).toEqual({
        row: row(SERIES, SECOND),
        occurrence: SECOND,
        origin: 'drawer',
      });
      confirmResult.next(true);

      expect(results).toEqual([true]);
      expect(store.removeOccurrence).toHaveBeenCalledWith('synthetic-meeting', SECOND.occurrence_id);
    });

    it('reports a dismissed cancel as not cancelled', () => {
      const results: boolean[] = [];
      service.cancelOccurrence(row(SERIES, SECOND), SECOND).subscribe((cancelled) => results.push(cancelled));
      confirmResult.next(undefined);

      expect(results).toEqual([false]);
      expect(store.removeOccurrence).not.toHaveBeenCalled();
    });

    it.each([
      ['a picked date that no longer resolves, instead of cancelling another one', SERIES, '2599999999'],
      ['that no upcoming date is left to cancel', { ...SERIES, occurrences: [] }, undefined],
    ])('reports %s', (_case, meeting, occurrenceId) => {
      service.delete(row(meeting as Meeting, occurrenceId ? SECOND : null));
      scopeResult.next({ deleteType: 'occurrence', occurrenceId });

      expect(openedWith(MeetingDeleteModalComponent)).toBeUndefined();
      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', description: 'No upcoming occurrence found to cancel.' }));
    });
  });
});
