// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import type { Meeting, MeetingComposerSection, MeetingComposerSectionId, MeetingRegistrant, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
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

  /**
   * Closing without reopening deliberately leaves the generation alone, so the save runs to completion.
   * @description Reviewer feedback asked for the token to be invalidated on every close as well, not just
   * on reopen. Doing that would break the create path: `announceCreatedMeeting` in the host is the only
   * route back to a meeting now that creating no longer navigates, and it only fires on an emission. A
   * close that bumped the generation would swallow the emission for a meeting that genuinely was created,
   * and — because the guests were in fact attached — would replace the "Meeting created" toast with the
   * "guests and resources were not attached" warning. The state writes the guard exists to prevent
   * (`meetingId.set`, `reportDependentResults`) are harmless here, because they are all reset by the next
   * `initialize()`. These two cases pin that down so a future change to it has to be deliberate.
   */
  it('emits and attaches guests when the composer closed without reopening', () => {
    const created = new Subject<Meeting>();
    createMeeting.mockReturnValue(created);
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    const emissions: (Meeting | null)[] = [];
    service.submit().subscribe((meeting) => emissions.push(meeting));

    // No `initialize()` — a close on its own touches nothing the submit pipeline reads.
    created.next({ id: 'meeting-1' } as Meeting);
    created.complete();

    expect(emissions).toEqual([{ id: 'meeting-1' }]);
    expect(addMeetingRegistrants).toHaveBeenCalledWith('meeting-1', [expect.objectContaining({ meeting_id: 'meeting-1' })]);
    expect(messageAdd).not.toHaveBeenCalledWith(expect.objectContaining({ summary: 'Partially saved' }));
  });

  it('clears the submitting flag when the composer closed without reopening', () => {
    const created = new Subject<Meeting>();
    createMeeting.mockReturnValue(created);

    service.submit().subscribe();
    expect(service.submitting()).toBe(true);

    created.next({ id: 'meeting-1' } as Meeting);
    created.complete();

    // The reopen cases leave this to the next `initialize()`; a plain close has no next `initialize()`,
    // so the flag has to be cleared here or the reopened composer would start with Save disabled.
    expect(service.submitting()).toBe(false);
  });
});

/**
 * Covers the attachment-deletion queue across a save.
 * @description `processAttachmentOperations` snapshots the queue up front, so what survives the pass is
 * not simply "the queue, cleared": the ids that failed have to stay, and anything the organizer removed
 * while the requests were in flight has to stay too — clearing wholesale would drop it with no trace,
 * and clearing nothing would retry a delete upstream has already applied.
 */
describe('MeetingComposerFormService — attachment deletion queue', () => {
  let service: MeetingComposerFormService;
  let deleteMeetingAttachment: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    deleteMeetingAttachment = vi.fn().mockReturnValue(of(undefined));
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
            createMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1' } as Meeting)),
            updateMeeting: vi.fn(),
            addMeetingRegistrants: vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 0 } })),
            updateMeetingRegistrants: vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 0 } })),
            deleteMeetingRegistrants: vi.fn().mockReturnValue(of({ summary: { successful: 0, failed: 0 } })),
            createMeetingAttachment: vi.fn(),
            deleteMeetingAttachment,
            uploadMeetingFile: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().patchValue({ title: 'Composer meeting', meeting_type: 'Technical' });
  });

  it('keeps the ids whose delete failed and drops the ones that succeeded', () => {
    deleteMeetingAttachment.mockImplementation((_meetingId: string, attachmentId: string) =>
      attachmentId === 'doc-2' ? throwError(() => new Error('upstream refused')) : of(undefined)
    );
    service.deleteAttachment('doc-1');
    service.deleteAttachment('doc-2');

    service.submit().subscribe();

    expect(service.pendingAttachmentDeletions()).toEqual(['doc-2']);
    // Counted as a resource failure, so the organizer is told the meeting saved but the removal didn't.
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('1 resource(s)') }));
  });

  it('keeps a deletion queued after the pass snapshotted the queue', () => {
    const firstDelete = new Subject<void>();
    deleteMeetingAttachment.mockReturnValue(firstDelete);
    service.deleteAttachment('doc-1');

    service.submit().subscribe();

    // Queued while the request is in flight, so it is not in the snapshot the pass is working from.
    service.deleteAttachment('doc-2');
    firstDelete.next();
    firstDelete.complete();

    expect(service.pendingAttachmentDeletions()).toEqual(['doc-2']);
    expect(deleteMeetingAttachment).toHaveBeenCalledTimes(1);
  });

  it('reports nothing when every queued deletion succeeded', () => {
    service.deleteAttachment('doc-1');
    service.deleteAttachment('doc-2');

    service.submit().subscribe();

    expect(service.pendingAttachmentDeletions()).toEqual([]);
    expect(messageAdd).not.toHaveBeenCalled();
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

  // GH-1463: the "via [Group]" chip needs `committee_*` metadata, which the registrant listing only
  // returns behind `include_committee`. Dropping that flag would silently restore the missing chip.
  it('asks for committee enrichment when loading the guest list', () => {
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(getMeetingRegistrants).toHaveBeenCalledWith('meeting-1', false, undefined, false, undefined, true);
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

  it('clears the failure and hydrates the form when the retry succeeds', () => {
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });
    expect(service.meetingLoadFailed()).toBe(true);

    getMeeting.mockReturnValue(of({ id: 'meeting-1', title: 'Retried meeting' } as Meeting));
    service.retryLoadMeeting();

    expect(service.meetingLoadFailed()).toBe(false);
    expect(service.meeting()?.title).toBe('Retried meeting');
    expect(service.form().get('title')?.value).toBe('Retried meeting');
  });

  it('ignores a retry while a load is still in flight', () => {
    // A pending fetch leaves `loading` true, which is the state a second click on Try again would hit.
    getMeeting.mockReturnValue(new Subject<Meeting>());
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });
    expect(service.loading()).toBe(true);

    service.retryLoadMeeting();

    expect(getMeeting).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch an edit-mode open that never had a meeting uid', () => {
    service.initialize({ mode: 'edit' });

    service.retryLoadMeeting();

    expect(getMeeting).not.toHaveBeenCalled();
  });

  // GH-1464: `aiPrompt` is a scratch field the save payload never carries, but it lives in the group
  // `validateForSubmit()` reads. A validator on it would block the meeting from saving over a value
  // the meeting doesn't even have, with no error UI anywhere to explain the dead button.
  it('does not let an over-long AI goal block the meeting save', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().patchValue({
      title: 'Composer meeting',
      meeting_type: 'Technical',
      // Create mode seeds no schedule (GH-1454), so a submittable form has to state one here.
      startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      startTime: '10:00 AM',
      timezone: 'UTC',
    });
    expect(service.validateForSubmit()).toBe(true);

    service.form().get('aiPrompt')?.setValue('x'.repeat(5000));

    expect(service.validateForSubmit()).toBe(true);
  });

  it('does not re-fetch in create mode, where meetingId comes from the save', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.meetingId.set('meeting-1');

    service.retryLoadMeeting();

    expect(getMeeting).not.toHaveBeenCalled();
  });
});

/**
 * Covers the save gate the composer footer and the rail both read. Save is gated on whole-form
 * validity, so every control that carries a validator has to be reachable from some section's
 * `isSectionValid` — otherwise the organizer gets a dead Save button and nothing pointing at the
 * cause. These assert the sections that own the easy-to-miss controls.
 */
describe('MeetingComposerFormService — save gate', () => {
  let service: MeetingComposerFormService;
  // Read through a closure rather than baked into the provider: `effectiveProjectUid` reads
  // `activeContextUid()` as a plain call, and `initialize()` writes `contextProjectUid`, which is what
  // actually invalidates the computed — so changing this and reopening is enough.
  let ambientProjectUid: string | null = null;

  beforeEach(() => {
    ambientProjectUid = null;

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => ambientProjectUid } },
        { provide: MeetingService, useValue: {} },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().patchValue({ title: 'Composer meeting', meeting_type: 'Technical' });
  });

  // The API, PCC and Zoom all accept early-join values outside [10, 60], and edit mode patches
  // whatever is stored verbatim — so this is a real state, not a typing-only one.
  it('flags date-schedule when the early-join value falls outside the allowed range', () => {
    service.form().get('early_join_time_minutes')?.setValue(90);

    expect(service.form().valid).toBe(false);
    expect(service.isSectionValid('date-schedule')).toBe(false);
  });

  it('flags agenda-resources when the agenda exceeds the cap', () => {
    service.form().get('description')?.setValue('x'.repeat(2001));

    expect(service.form().valid).toBe(false);
    expect(service.isSectionValid('agenda-resources')).toBe(false);
  });

  it('never flags guests, the one section that owns no validated control', () => {
    expect(service.isSectionValid('guests')).toBe(true);
  });

  // `platform-features` is not a required section, but its reminder controls carry validators and are
  // enabled in edit mode. Skipping optional sections is what previously left Save disabled silently.
  it('flags an optional section whose control is invalid', () => {
    service.form().get('reminderHours')?.enable();
    service.form().get('reminderHours')?.setValue(999);

    expect(service.form().valid).toBe(false);
    expect(service.isSectionValid('platform-features')).toBe(false);
    expect(
      service.sectionNeedsAttention(
        { id: 'platform-features', label: 'Platform & Features', required: false } as MeetingComposerSection,
        new Set(['platform-features'])
      )
    ).toBe(true);
  });

  it('does not flag an unvisited section in create mode', () => {
    service.form().get('description')?.setValue('x'.repeat(2001));

    expect(
      service.sectionNeedsAttention(
        { id: 'agenda-resources', label: 'Agenda & Resources', required: false } as MeetingComposerSection,
        new Set<MeetingComposerSectionId>()
      )
    ).toBe(false);
  });

  it('routes an off-scale stored duration to Custom rather than leaving the chips unselected', () => {
    service.setDuration(37);

    expect(service.form().get('duration')?.value).toBe('custom');
    expect(service.form().get('customDuration')?.value).toBe(37);
    // Marked so the range error shows, instead of silently deadening submit.
    expect(service.form().get('customDuration')?.touched).toBe(true);
  });

  it('clears the custom control when the duration is back on the chip scale', () => {
    service.setDuration(37);

    service.setDuration(30);

    expect(service.form().get('duration')?.value).toBe(30);
    expect(service.form().get('customDuration')?.value).toBeNull();
  });

  it('resolves the effective project from the open context before the ambient one', () => {
    ambientProjectUid = 'ambient-project';
    service.initialize({ mode: 'create', projectUid: 'project-1' });

    expect(service.effectiveProjectUid()).toBe('project-1');
  });

  it('falls back to the ambient context when the open carried no project', () => {
    ambientProjectUid = 'ambient-project';
    service.initialize({ mode: 'create' });

    expect(service.effectiveProjectUid()).toBe('ambient-project');
  });
});
