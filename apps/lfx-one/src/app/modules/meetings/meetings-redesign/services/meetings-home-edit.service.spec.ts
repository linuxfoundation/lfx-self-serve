// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingOccurrence, RecurringMeetingEditScopeResult } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { NEVER, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingEditScopeModalComponent } from '../components/meeting-edit-scope-modal/meeting-edit-scope-modal.component';
import { MeetingsHomeEditService } from './meetings-home-edit.service';

const FIRST = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SECOND = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const ONE_OFF = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_uid: 'synthetic-project-uid',
  project_slug: 'synthetic-project',
  password: 'synthetic-pass',
  organizer: true,
  recurrence: null,
  committees: [{ uid: 'synthetic-committee' }],
} as unknown as Meeting;
const SERIES = { ...ONE_OFF, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [FIRST, SECOND] } as unknown as Meeting;

const row = (meeting: Meeting, occurrence: MeetingOccurrence | null = null): MeetingHomeRow => ({
  key: 'row',
  meeting,
  occurrence,
  title: meeting.title,
  occurrenceId: occurrence?.occurrence_id ?? null,
  startTime: occurrence?.start_time ?? '2050-01-01T09:00:00.000Z',
  durationMinutes: 30,
});

describe('MeetingsHomeEditService', () => {
  let service: MeetingsHomeEditService;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let modalOpen: ReturnType<typeof vi.fn>;
  let composerOpen: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let scopeResult: Subject<RecurringMeetingEditScopeResult | undefined>;

  const setup = (v2Enabled: boolean, detail: Observable<Meeting>): void => {
    getMeetingDetail = vi.fn().mockReturnValue(detail);
    TestBed.configureTestingModule({
      providers: [
        MeetingsHomeEditService,
        { provide: MeetingService, useValue: { getMeetingDetail } },
        { provide: UserService, useValue: { refreshUserMeetings } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: Router, useValue: { navigate } },
        { provide: UiModalService, useValue: { open: modalOpen } },
        { provide: UiToastService, useValue: { show: toastShow } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(v2Enabled) } },
      ],
    });
    service = TestBed.inject(MeetingsHomeEditService);
  };
  const lastToast = (): { variant: string; message: string; description: string } => toastShow.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    TestBed.resetTestingModule();
    toastShow = vi.fn();
    composerOpen = vi.fn();
    navigate = vi.fn().mockResolvedValue(true);
    refreshUserMeetings = vi.fn();
    scopeResult = new Subject();
    modalOpen = vi.fn().mockReturnValue({ closed: scopeResult });
  });

  describe('permission re-check', () => {
    it('re-reads the meeting past the cache and is checking until it answers', () => {
      setup(true, NEVER);

      service.edit(row(ONE_OFF));

      expect(getMeetingDetail).toHaveBeenCalledWith('synthetic-meeting', { skipCache: true });
      expect(service.isChecking('synthetic-meeting')).toBe(true);
      service.edit(row(ONE_OFF));
      expect(getMeetingDetail).toHaveBeenCalledTimes(1);
    });

    it('stops when the fresh read says the viewer is no longer an organizer', () => {
      setup(true, of({ ...ONE_OFF, organizer: false }));

      service.edit(row(ONE_OFF));

      expect(lastToast()).toMatchObject({
        variant: 'error',
        message: 'Editing unavailable',
        description: 'You no longer have permission to edit this meeting.',
      });
      expect(composerOpen).not.toHaveBeenCalled();
      expect(service.isChecking('synthetic-meeting')).toBe(false);
    });

    it.each([
      [403, 'Editing unavailable', 'You no longer have permission to edit this meeting.'],
      [404, 'Editing unavailable', 'This meeting no longer exists.'],
      [500, 'Could not open the editor', 'We could not check your access to this meeting. Please try again.'],
    ])('reports a %s from the re-check', (status, message, description) => {
      setup(
        true,
        throwError(() => new HttpErrorResponse({ status }))
      );

      service.edit(row(ONE_OFF));

      expect(lastToast()).toMatchObject({ variant: 'error', message, description });
      expect(composerOpen).not.toHaveBeenCalled();
    });

    it('refreshes the list when the shown date was moved or cancelled', () => {
      setup(true, of({ ...SERIES, occurrences: [SECOND] }));

      service.edit(row(SERIES, FIRST));

      expect(lastToast()).toMatchObject({ variant: 'warning', message: 'Occurrence changed' });
      expect(refreshUserMeetings).toHaveBeenCalledWith();
      expect(modalOpen).not.toHaveBeenCalled();
    });
  });

  describe('with meetings v2 on', () => {
    it('opens the composer on a one-time meeting', () => {
      setup(true, of(ONE_OFF));

      service.edit(row(ONE_OFF));

      expect(modalOpen).not.toHaveBeenCalled();
      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'synthetic-project-uid' });
    });

    it('opens the series without asking when no date is left to edit', () => {
      setup(true, of({ ...SERIES, occurrences: [] }));

      service.edit(row(SERIES));

      expect(modalOpen).not.toHaveBeenCalled();
      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'synthetic-project-uid' });
    });

    it('asks the scope of a recurring edit, opening on the row date', () => {
      setup(true, of(SERIES));

      service.edit(row(SERIES, SECOND));

      expect(modalOpen).toHaveBeenCalledWith(MeetingEditScopeModalComponent, { data: { row: row(SERIES, SECOND), meeting: SERIES, occurrence: SECOND } });
    });

    it('opens the composer on the picked date', () => {
      setup(true, of(SERIES));
      service.edit(row(SERIES, SECOND));

      scopeResult.next({ scope: 'occurrence', proceed: true, occurrenceId: FIRST.occurrence_id });

      expect(composerOpen).toHaveBeenCalledWith({
        mode: 'edit',
        meetingUid: 'synthetic-meeting',
        projectUid: 'synthetic-project-uid',
        occurrenceId: FIRST.occurrence_id,
      });
    });

    it('opens the composer on the series', () => {
      setup(true, of(SERIES));
      service.edit(row(SERIES, SECOND));

      scopeResult.next({ scope: 'series', proceed: true });

      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'synthetic-meeting', projectUid: 'synthetic-project-uid' });
    });

    it('asks the scope of a recurring meeting before landing on the requested section', () => {
      setup(true, of(SERIES));
      service.edit(row(SERIES, SECOND), 'agenda-resources');

      expect(modalOpen).toHaveBeenCalledWith(MeetingEditScopeModalComponent, { data: { row: row(SERIES, SECOND), meeting: SERIES, occurrence: SECOND } });
      expect(composerOpen).not.toHaveBeenCalled();

      scopeResult.next({ scope: 'occurrence', proceed: true });

      expect(composerOpen).toHaveBeenCalledWith({
        mode: 'edit',
        meetingUid: 'synthetic-meeting',
        projectUid: 'synthetic-project-uid',
        occurrenceId: SECOND.occurrence_id,
        section: 'agenda-resources',
      });
    });

    it('lands the series editor on the requested section', () => {
      setup(true, of(SERIES));
      service.edit(row(SERIES, SECOND), 'agenda-resources');

      scopeResult.next({ scope: 'series', proceed: true });

      expect(composerOpen).toHaveBeenCalledWith({
        mode: 'edit',
        meetingUid: 'synthetic-meeting',
        projectUid: 'synthetic-project-uid',
        section: 'agenda-resources',
      });
    });

    it('lands a one-time meeting on the requested section without asking', () => {
      setup(true, of(ONE_OFF));
      service.edit(row(ONE_OFF), 'agenda-resources');

      expect(modalOpen).not.toHaveBeenCalled();
      expect(composerOpen).toHaveBeenCalledWith({
        mode: 'edit',
        meetingUid: 'synthetic-meeting',
        projectUid: 'synthetic-project-uid',
        section: 'agenda-resources',
      });
    });

    it('opens nothing when the scope dialog is cancelled', () => {
      setup(true, of(SERIES));
      service.edit(row(SERIES, SECOND));

      scopeResult.next(undefined);

      expect(composerOpen).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('with meetings v2 off', () => {
    it('opens the editor with what the fresh read says, the row filling the gaps', () => {
      // A failed project lookup leaves the slug out of the payload.
      const fresh = { ...ONE_OFF, committees: [{ uid: 'synthetic-new-committee' }] } as unknown as Meeting;
      delete fresh.project_slug;
      setup(false, of(fresh));

      service.edit(row(ONE_OFF));

      expect(navigate).toHaveBeenCalledWith(['/meetings', 'synthetic-meeting', 'edit'], {
        queryParams: { project: 'synthetic-project', committee_uid: 'synthetic-new-committee' },
      });
    });

    it('opens the pre-v2 editor for the series', () => {
      setup(false, of(ONE_OFF));

      service.edit(row(ONE_OFF));

      expect(composerOpen).not.toHaveBeenCalled();
      expect(refreshUserMeetings).toHaveBeenCalledWith(false);
      expect(navigate).toHaveBeenCalledWith(['/meetings', 'synthetic-meeting', 'edit'], {
        queryParams: { project: 'synthetic-project', committee_uid: 'synthetic-committee' },
      });
    });

    it('opens the meeting page of the picked date, where it can be rescheduled', () => {
      setup(false, of(SERIES));
      service.edit(row(SERIES, SECOND));

      scopeResult.next({ scope: 'occurrence', proceed: true, occurrenceId: FIRST.occurrence_id });

      expect(composerOpen).not.toHaveBeenCalled();
      expect(refreshUserMeetings).toHaveBeenCalledWith(false);
      expect(navigate).toHaveBeenCalledWith(['/meetings', 'synthetic-meeting'], {
        queryParams: { password: 'synthetic-pass', occurrence: String(Date.parse(FIRST.start_time)), zoom_redirect: 'false' },
      });
    });
  });
});
