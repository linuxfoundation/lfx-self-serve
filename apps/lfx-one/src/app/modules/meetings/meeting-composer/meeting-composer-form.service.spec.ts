// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { Meeting, MeetingRegistrant, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';

/**
 * Covers the submit pipeline's generation guard — the composer host outlives every open, so a save
 * that resolves after a close+reopen must neither emit (the host would toast and close the new open)
 * nor warn when there was nothing queued to attach.
 */
describe('MeetingComposerFormService — submit generation guard', () => {
  let service: MeetingComposerFormService;
  let createMeeting: ReturnType<typeof vi.fn>;
  let addMeetingRegistrants: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const REGISTRANT = { meeting_id: '', email: 'guest@example.com', first_name: 'Guest', last_name: 'One' };

  beforeEach(() => {
    createMeeting = vi.fn();
    addMeetingRegistrants = vi.fn().mockReturnValue(of({ summary: { successful: 1, failed: 0 } }));
    messageAdd = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            createMeeting,
            updateMeeting: vi.fn(),
            addMeetingRegistrants,
            updateMeetingRegistrants: vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 0 } })),
            deleteMeetingRegistrants: vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 0 } })),
            createMeetingAttachment: vi.fn(),
            deleteMeetingAttachment: vi.fn(),
            uploadMeetingFile: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().patchValue({ title: 'Composer meeting', meeting_type: 'Technical' });
  });

  it('does not emit when the composer reopened while the save was in flight', () => {
    const created = new Subject<Meeting>();
    createMeeting.mockReturnValue(created);
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    const emissions: (Meeting | null)[] = [];
    service.submit().subscribe((meeting) => emissions.push(meeting));

    service.initialize({ mode: 'create', projectUid: 'project-1' });
    created.next({ id: 'meeting-1' } as Meeting);
    created.complete();

    expect(emissions).toEqual([]);
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Partially saved' }));
  });

  it('does not emit when the composer reopened while the dependent work was in flight', () => {
    const registrants = new Subject<unknown>();
    createMeeting.mockReturnValue(of({ id: 'meeting-1' } as Meeting));
    addMeetingRegistrants.mockReturnValue(registrants);
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    const emissions: (Meeting | null)[] = [];
    service.submit().subscribe((meeting) => emissions.push(meeting));

    // The save itself already landed, so this exercises the guard after the dependent work — not the
    // one before it.
    expect(addMeetingRegistrants).toHaveBeenCalled();

    service.initialize({ mode: 'create', projectUid: 'project-1' });
    registrants.next({ summary: { successful: 0, failed: 1 } });
    registrants.complete();

    expect(emissions).toEqual([]);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('stays silent about partial saves when nothing was queued to attach', () => {
    const created = new Subject<Meeting>();
    createMeeting.mockReturnValue(created);

    service.submit().subscribe();

    service.initialize({ mode: 'create', projectUid: 'project-1' });
    created.next({ id: 'meeting-1' } as Meeting);
    created.complete();

    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('does not count already-saved links as pending attachment work', () => {
    const links = service.form().get('important_links') as FormArray;
    links.push(
      new FormGroup({
        title: new FormControl('Charter'),
        url: new FormControl('https://example.com'),
        uid: new FormControl('link-1'),
      })
    );

    const created = new Subject<Meeting>();
    createMeeting.mockReturnValue(created);

    service.submit().subscribe();

    service.initialize({ mode: 'create', projectUid: 'project-1' });
    created.next({ id: 'meeting-1' } as Meeting);
    created.complete();

    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('emits the saved meeting so the composer closes when the create response carries no id', () => {
    createMeeting.mockReturnValue(of({} as Meeting));
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    const emissions: (Meeting | null)[] = [];
    service.submit().subscribe((meeting) => emissions.push(meeting));

    expect(emissions).toHaveLength(1);
    expect(addMeetingRegistrants).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Partially saved' }));
  });

  it('stamps guests queued before the meeting existed with the created meeting id', () => {
    createMeeting.mockReturnValue(of({ id: 'meeting-1' } as Meeting));
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    service.submit().subscribe();

    expect(addMeetingRegistrants).toHaveBeenCalledWith('meeting-1', [expect.objectContaining({ meeting_id: 'meeting-1' })]);
  });
});

/**
 * Covers the guest list the Guests section renders from. It lives here rather than in the section
 * because the composer host destroys the section on every section change.
 */
describe('MeetingComposerFormService — guest list', () => {
  let service: MeetingComposerFormService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ meeting_id: meetingUid, email: guest.email }),
            getChangedFields: (guest: MeetingRegistrantWithState) => ({ email: guest.email }),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
  });

  it('derives the pending registrant changes from the guest list', () => {
    service.setGuests([
      { email: 'new@example.com', state: 'new' } as MeetingRegistrantWithState,
      { uid: 'guest-2', email: 'gone@example.com', state: 'deleted' } as MeetingRegistrantWithState,
      { uid: 'guest-3', email: 'kept@example.com', state: 'existing' } as MeetingRegistrantWithState,
    ]);

    expect(service.registrantUpdates()).toEqual({
      toAdd: [{ meeting_id: '', email: 'new@example.com' }],
      toUpdate: [],
      toDelete: ['guest-2'],
    });
  });

  it('clears the guest list on reopen', () => {
    service.setGuests([{ email: 'new@example.com', state: 'new' } as MeetingRegistrantWithState]);

    service.initialize({ mode: 'create', projectUid: 'project-1' });

    expect(service.guests()).toEqual([]);
    expect(service.registrantUpdates()).toEqual({ toAdd: [], toUpdate: [], toDelete: [] });
  });
});

/**
 * Covers the retry behind the edit-mode load-failure state. `meetingId` is also set by a successful
 * create, so an unguarded retry would hydrate a create form from the meeting it just saved.
 */
describe('MeetingComposerFormService — load retry', () => {
  let service: MeetingComposerFormService;
  let getMeeting: ReturnType<typeof vi.fn>;
  let getMeetingRegistrants: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMeeting = vi.fn().mockReturnValue(throwError(() => new Error('not found')));
    getMeetingRegistrants = vi.fn().mockReturnValue(of([] as MeetingRegistrant[]));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants,
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
  });

  it('re-fetches the meeting after a failed edit-mode load', () => {
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(service.meetingLoadFailed()).toBe(true);
    expect(getMeeting).toHaveBeenCalledTimes(1);

    service.retryLoadMeeting();

    expect(getMeeting).toHaveBeenCalledTimes(2);
  });

  it('leaves a guest list that loaded fine alone on retry', () => {
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });
    expect(getMeetingRegistrants).toHaveBeenCalledTimes(1);

    service.retryLoadMeeting();

    expect(getMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  it('re-fetches the guests too when their own request failed', () => {
    getMeetingRegistrants.mockReturnValueOnce(throwError(() => new Error('boom')));
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(service.guestsLoadFailed()).toBe(true);

    service.retryLoadMeeting();

    expect(getMeetingRegistrants).toHaveBeenCalledTimes(2);
  });

  it('does not re-fetch in create mode, where meetingId comes from the save', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.meetingId.set('meeting-1');

    service.retryLoadMeeting();

    expect(getMeeting).not.toHaveBeenCalled();
  });
});
