// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { MEETING_ATTACHMENT_WRITE_CONCURRENCY, MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import { CancelOnCommitteeRemoval, CommitteeMemberRole, CommitteeMemberVotingStatus, MeetingType, MeetingVisibility } from '@lfx-one/shared/enums';
import type {
  CommitteeMember,
  Meeting,
  MeetingComposerSection,
  MeetingComposerSectionId,
  MeetingRegistrant,
  MeetingRegistrantWithState,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';

/**
 * Covers the submit pipeline's generation guard — the composer host outlives every open, so a save
 * that resolves after a close+reopen must neither emit (the host would toast and close the new open)
 * nor warn when there was nothing queued to attach.
 */
/** The real rail entry, now that `MeetingComposerSection` is derived from the constant. */
const composerSection = (id: MeetingComposerSectionId): MeetingComposerSection => MEETING_COMPOSER_SECTIONS.filter((section) => section.id === id)[0];

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
  });

  it('still reports guest failures that landed after the composer reopened', () => {
    const registrants = new Subject<unknown>();
    createMeeting.mockReturnValue(of({ id: 'meeting-1' } as Meeting));
    addMeetingRegistrants.mockReturnValue(registrants);
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    service.submit().subscribe();
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    const reopened = { toAdd: [REGISTRANT], toUpdate: [], toDelete: [] };
    service.registrantUpdates.set(reopened);

    registrants.next({ summary: { successful: 0, failed: 1 } });
    registrants.complete();

    // The guests belonged to the meeting that was already saved: staying silent would tell the
    // organizer the save was clean when a guest never made it.
    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'warn',
        summary: 'Partially saved',
        detail: 'The meeting you created saved, but 1 guest(s) did not. Your current draft is unaffected.',
      })
    );
    // The warning is about the previous open, so the queues the reopened composer is holding stay put.
    expect(service.registrantUpdates()).toBe(reopened);
  });

  it('warns about guest failures on a save the composer is still open for', () => {
    createMeeting.mockReturnValue(of({ id: 'meeting-1' } as Meeting));
    addMeetingRegistrants.mockReturnValue(of({ summary: { successful: 0, failed: 1 } }));
    service.registrantUpdates.set({ toAdd: [REGISTRANT], toUpdate: [], toDelete: [] });

    const emissions: (Meeting | null)[] = [];
    service.submit().subscribe((meeting) => emissions.push(meeting));

    // Nothing reopened, so the drawer on screen is still the one that saved: the warning points at a
    // form the organizer can act on, which is what separates this wording from the stale one.
    expect(emissions).toEqual([{ id: 'meeting-1' }]);
    expect(messageAdd).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Meeting Created',
      detail: '1 guest(s) could not be saved. You can manage them later.',
    });
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

  // A save carrying twenty documents used to open twenty simultaneous requests against the
  // gateway, because every attachment pass fanned out over whatever the organizer had queued.
  it('caps how many attachment writes are in flight at once', () => {
    deleteMeetingAttachment.mockReturnValue(new Subject<void>());
    for (let index = 0; index < MEETING_ATTACHMENT_WRITE_CONCURRENCY + 3; index += 1) {
      service.deleteAttachment(`doc-${index}`);
    }

    service.submit().subscribe();

    expect(deleteMeetingAttachment).toHaveBeenCalledTimes(MEETING_ATTACHMENT_WRITE_CONCURRENCY);
  });

  it('leaves the reopened composer\u2019s deletion queue alone when a stale pass lands', () => {
    const firstDelete = new Subject<void>();
    deleteMeetingAttachment.mockReturnValue(firstDelete);
    service.deleteAttachment('doc-1');

    service.submit().subscribe();

    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.deleteAttachment('doc-1');
    firstDelete.next();
    firstDelete.complete();

    // Same id, different open: dropping it here would silently un-queue a removal the organizer
    // just asked for on a meeting the finished pass knows nothing about.
    expect(service.pendingAttachmentDeletions()).toEqual(['doc-1']);
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
  let messageAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMeeting = vi.fn().mockReturnValue(throwError(() => new Error('not found')));
    getMeetingRegistrants = vi.fn().mockReturnValue(of([] as MeetingRegistrant[]));
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

    expect(getMeetingRegistrants).toHaveBeenCalledWith('meeting-1', false, undefined, true, undefined, true);
  });

  it('fails the guest load rather than accepting a truncated page', () => {
    // A partial page reads as "these people are not registered yet", and the organizer's next act
    // is to invite them again — duplicate invites to guests who already have one. The retry banner
    // is the honest answer, and the `catchError` below already raises it.
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(getMeetingRegistrants.mock.calls[0][3]).toBe(true);
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

  // GH-2037 split these two apart on the full-page editor, and the composer flattened them back
  // into one not-found toast: a 5xx was announced as a missing meeting, and a genuinely missing
  // one still offered a Try again that could only fail the same way.
  it('treats a request that never got through as retryable, and does not call it not found', () => {
    getMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(service.meetingLoadFailure()).toBe('retryable');
    expect(messageAdd).not.toHaveBeenCalled();

    service.retryLoadMeeting();

    expect(getMeeting).toHaveBeenCalledTimes(2);
  });

  it.each([404, 403])('treats a %i as denied, says so once, and refuses the retry', (status) => {
    getMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));

    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    expect(service.meetingLoadFailure()).toBe('denied');
    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Meeting not found or you do not have permission to access it' })
    );

    service.retryLoadMeeting();

    expect(getMeeting).toHaveBeenCalledTimes(1);
  });

  it('refuses to submit an edit form that never hydrated', () => {
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    // The form is empty because the fetch failed, not because the organizer emptied it. Saving it
    // would write those blanks over the meeting that is still there.
    expect(service.isHydrated()).toBe(false);
    expect(service.validateForSubmit()).toBe(false);
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

  // `meeting_type` carries `Validators.required` and nothing else, and the control is never disabled,
  // so the `?.value` clause below is the whole of the gate: a `?.valid` clause next to it could never
  // be false. Nothing covered that clause, and losing it would walk an organizer who cleared the type
  // past details-access into a save the validator is silently holding shut.
  it('flags details-access when the meeting type is missing', () => {
    service.form().patchValue({ meeting_type: '' });

    expect(service.isSectionValid('details-access')).toBe(false);

    service.form().patchValue({ meeting_type: 'Technical' });

    expect(service.isSectionValid('details-access')).toBe(true);
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
    expect(service.sectionNeedsAttention(composerSection('platform-features'), new Set(['platform-features']))).toBe(true);
  });

  it('does not flag an unvisited section in create mode', () => {
    service.form().get('description')?.setValue('x'.repeat(2001));

    expect(service.sectionNeedsAttention(composerSection('agenda-resources'), new Set<MeetingComposerSectionId>())).toBe(false);
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

  // The rail and the footer both read this one number, so a create-mode organizer cannot use
  // one control to step around the other. It counts required sections that already validate.
  it('stops the advance frontier at the first required section with holes in it', () => {
    // `details-access` is filled by the beforeEach; `date-schedule` is still empty.
    expect(service.sectionAdvanceLimit()).toBe(1);

    service.form().patchValue({ title: '' });

    expect(service.sectionAdvanceLimit()).toBe(0);
  });

  it('lets every section through once the required ones are clear', () => {
    service.form().patchValue({ startDate: new Date('2099-01-01'), startTime: '10:00', timezone: 'America/New_York' });

    expect(service.sectionAdvanceLimit()).toBe(MEETING_COMPOSER_SECTIONS.length);
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

/**
 * Covers the meeting type's access defaults, which belong to create mode rather than to one surface:
 * a board meeting opens private and invite-only whether the organizer used the quick dialog or walked
 * the drawer, so switching between the two mid-fill changes nothing about them.
 */
describe('MeetingComposerFormService \u2014 meeting type access defaults', () => {
  let service: MeetingComposerFormService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: MeetingService, useValue: {} },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
  });

  it('turns a board meeting private and invite-only in the drawer', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });

    service.form().get('meeting_type')?.setValue(MeetingType.BOARD);

    expect(service.form().get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
    expect(service.form().get('restricted')?.value).toBe(true);
  });

  it('applies the same default in the quick dialog', () => {
    service.initialize({ mode: 'create', variant: 'quick', projectUid: 'project-1' });

    service.form().get('meeting_type')?.setValue(MeetingType.BOARD);

    expect(service.form().get('visibility')?.value).toBe(MeetingVisibility.PRIVATE);
    expect(service.form().get('restricted')?.value).toBe(true);
  });

  it('hands the access settings back when the type moves off Board', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().get('meeting_type')?.setValue(MeetingType.BOARD);

    service.form().get('meeting_type')?.setValue(MeetingType.TECHNICAL);

    // Otherwise one mis-click on Board leaves a technical meeting silently invite-only.
    expect(service.form().get('visibility')?.value).toBe(MeetingVisibility.PUBLIC);
    expect(service.form().get('restricted')?.value).toBe(false);
  });

  it('leaves the saved access settings alone in edit mode', () => {
    service.initialize({ mode: 'edit', projectUid: 'project-1' });

    // Hydration writes `meeting_type` like any other field, so a wired subscription would fire
    // mid-patch and overwrite what the meeting was actually saved with. The type is patched last here
    // precisely so that overwrite would be visible rather than patched back over.
    service.form().patchValue({ visibility: MeetingVisibility.PUBLIC, restricted: false, meeting_type: MeetingType.BOARD });

    expect(service.form().get('visibility')?.value).toBe(MeetingVisibility.PUBLIC);
    expect(service.form().get('restricted')?.value).toBe(false);
  });
});
/**
 * Covers the reconciliation pass the Guests section runs whenever the group multi-select emits.
 *
 * All three of these are save-path regressions rather than display bugs: what the pass writes into
 * `guests()` is what `registrantUpdates()` derives the create/update/delete batches from, and a wrong
 * row here is a wrong invitation, a lost removal, or an attribution the update endpoint cannot repair
 * afterwards (`UpdateMeetingRegistrantRequest` declares no `committee_uid`).
 */
describe('MeetingComposerFormService — group reconciliation', () => {
  let service: MeetingComposerFormService;

  /** A member of `committee_uid`, with the attribution fields the "via [Group]" chip reads. */
  const member = (committeeUid: string, committeeName: string, email = 'chair@example.com'): CommitteeMember => ({
    uid: `member-${committeeUid}`,
    committee_uid: committeeUid,
    committee_name: committeeName,
    email,
    first_name: 'Ada',
    last_name: 'Lovelace',
    role: { name: CommitteeMemberRole.CHAIR },
    voting: { status: CommitteeMemberVotingStatus.VOTING_REP },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });

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
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({
              meeting_id: meetingUid,
              email: guest.email,
              committee_uid: guest.committee_uid,
            }),
            getChangedFields: (guest: MeetingRegistrantWithState) => ({ email: guest.email }),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
  });

  it('adds an uninvited group member with that group attribution', () => {
    service.syncCommitteeMembers([member('committee-board', 'Board')]);

    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({
      email: 'chair@example.com',
      state: 'new',
      type: 'committee',
      committee_uid: 'committee-board',
      committee_name: 'Board',
      committee_role: CommitteeMemberRole.CHAIR,
      committee_voting_status: CommitteeMemberVotingStatus.VOTING_REP,
    });
  });

  // GH-1463: someone who sits on two selected groups matches the existing row on the second pass, so
  // deselecting the group that first added them used to leave that group's `committee_uid` on the row.
  // The create write then hits `resolveRegistrantCommitteeUids`, which strips a UID no longer attached
  // to the meeting — the guest lands as `direct` and loses attribution outright.
  it('re-reads a matched guest attribution from the group still emitting them', () => {
    service.syncCommitteeMembers([member('committee-board', 'Board')]);
    service.syncCommitteeMembers([member('committee-tac', 'TAC')]);

    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({
      state: 'new',
      committee_uid: 'committee-tac',
      committee_name: 'TAC',
    });
    // The batch is what actually reaches the API, so assert the refresh survives `stripMetadata`.
    expect(service.registrantUpdates().toAdd).toEqual([{ meeting_id: '', email: 'chair@example.com', committee_uid: 'committee-tac' }]);
  });

  // The refresh is deliberately client-side only. A saved row's attribution is repaired in place for
  // the sake of a later re-add, but it queues no PUT — `registrantUpdates` keys on `state`, and the
  // server strips `committee_uid` from update bodies anyway so `PUT` cannot route around the create
  // path's meeting-scoped allowlist.
  it('refreshes a saved guest attribution without queueing an update for it', () => {
    service.setGuests([
      {
        uid: 'registrant-1',
        email: 'chair@example.com',
        state: 'existing',
        type: 'committee',
        committee_uid: 'committee-board',
        committee_name: 'Board',
      } as MeetingRegistrantWithState,
    ]);

    service.syncCommitteeMembers([member('committee-tac', 'TAC')]);

    expect(service.guests()[0]).toMatchObject({ state: 'existing', committee_uid: 'committee-tac', committee_name: 'TAC' });
    expect(service.registrantUpdates()).toEqual({ toAdd: [], toUpdate: [], toDelete: [] });
  });

  it('queues a guest for deletion once no selected group emits them', () => {
    service.setGuests([
      { uid: 'registrant-1', email: 'chair@example.com', state: 'existing', type: 'committee', committee_uid: 'committee-board' } as MeetingRegistrantWithState,
    ]);

    service.syncCommitteeMembers([]);

    expect(service.guests()[0]).toMatchObject({ state: 'deleted' });
    expect(service.registrantUpdates().toDelete).toEqual(['registrant-1']);
  });

  it('restores a guest a re-selected group emits again', () => {
    service.setGuests([
      { uid: 'registrant-1', email: 'chair@example.com', state: 'existing', type: 'committee', committee_uid: 'committee-board' } as MeetingRegistrantWithState,
    ]);
    service.syncCommitteeMembers([]);

    service.syncCommitteeMembers([member('committee-board', 'Board')]);

    expect(service.guests()[0]).toMatchObject({ state: 'existing' });
    expect(service.registrantUpdates().toDelete).toEqual([]);
  });

  it('keeps a hand-removed guest removed when their group emits again', () => {
    service.setGuests([
      { uid: 'registrant-1', email: 'chair@example.com', state: 'deleted', type: 'committee', committee_uid: 'committee-board' } as MeetingRegistrantWithState,
    ]);
    service.suppressGuestEmail('Chair@Example.com');

    service.syncCommitteeMembers([member('committee-board', 'Board')]);

    expect(service.guests()[0]).toMatchObject({ state: 'deleted' });
    expect(service.registrantUpdates().toDelete).toEqual(['registrant-1']);
  });

  it('leaves a directly-added guest untouched by the group pass', () => {
    service.setGuests([{ email: 'direct@example.com', state: 'new', type: 'direct' } as MeetingRegistrantWithState]);

    service.syncCommitteeMembers([]);

    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({ email: 'direct@example.com', state: 'new' });
  });
});

/**
 * Covers what the group pass and a load retry do while the saved guest list is missing.
 *
 * Both are the same hazard from opposite ends: an empty `guests()` that means "not loaded" rather
 * than "nobody invited". Reconciling against it re-invites people who are already registered, and
 * re-hydrating over it un-removes people the organizer has already taken off the list.
 */
describe('MeetingComposerFormService — group reconciliation after a failed guest load', () => {
  let service: MeetingComposerFormService;
  let getMeetingRegistrants: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMeetingRegistrants = vi.fn().mockReturnValue(throwError(() => new Error('boom')));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1', title: 'Saved meeting' } as Meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants,
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ meeting_id: meetingUid, email: guest.email }),
            getChangedFields: (guest: MeetingRegistrantWithState) => ({ email: guest.email }),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });
  });

  it('does not queue invitations for a group while the saved guests are unknown', () => {
    expect(service.guestsLoadFailed()).toBe(true);

    service.syncCommitteeMembers([
      {
        uid: 'member-1',
        committee_uid: 'committee-board',
        committee_name: 'Board',
        email: 'chair@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]);

    // Everyone in the group is already registered upstream; the fetch just didn't come back. Queueing
    // them as `new` would re-invite the whole group on save.
    expect(service.guests()).toEqual([]);
    expect(service.registrantUpdates().toAdd).toEqual([]);
  });

  it('hydrates the saved guests as already persisted once the retry succeeds', () => {
    getMeetingRegistrants.mockReturnValue(of([{ uid: 'registrant-1', email: 'chair@example.com' } as MeetingRegistrant]));

    service.retryLoadMeeting();

    expect(service.guestsLoadFailed()).toBe(false);
    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1', state: 'existing' });
    expect(service.registrantUpdates()).toEqual({ toAdd: [], toUpdate: [], toDelete: [] });
  });

  // The retry re-fetches rows the organizer may have removed in the meantime. Hydrating those as
  // `existing` drops the removal from the pending batch with nothing on screen saying so, so a
  // suppressed email comes back queued for deletion rather than silently un-removed.
  it('keeps a removal the organizer made before the retry', () => {
    service.suppressGuestEmail('Chair@Example.com');
    getMeetingRegistrants.mockReturnValue(of([{ uid: 'registrant-1', email: 'chair@example.com' } as MeetingRegistrant]));

    service.retryLoadMeeting();

    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1', state: 'deleted' });
    expect(service.registrantUpdates().toDelete).toEqual(['registrant-1']);
  });
});

/**
 * Covers the second guest fetch of an open — the one "Try again" fires. The first fetch lands on an
 * empty list, so only a retry can reach a list the organizer has already changed, or race a fetch that
 * is still in flight.
 */
describe('MeetingComposerFormService — guest load merge', () => {
  let service: MeetingComposerFormService;
  let getMeetingRegistrants: ReturnType<typeof vi.fn>;

  /** The saved row every case below reloads, so a divergence between fetches is the test's own doing. */
  const savedChair = { uid: 'registrant-1', email: 'chair@acme-motors.example', first_name: 'Ada' } as MeetingRegistrant;

  beforeEach(() => {
    getMeetingRegistrants = vi.fn().mockReturnValue(throwError(() => new Error('boom')));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1', title: 'Saved meeting' } as Meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants,
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ meeting_id: meetingUid, email: guest.email }),
            getChangedFields: (guest: MeetingRegistrantWithState) => ({ first_name: guest.first_name }),
          },
        },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    // The opening fetch fails, so the list is the organizer's to change before the retry runs.
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });
  });

  // Only group guests are suppressed on removal, so a removed *direct* guest is nothing but a local
  // row carrying `state: 'deleted'`. Reading the fetch as the authority on that row would drop the
  // deletion out of `registrantUpdates` with nothing on screen saying it had been undone.
  it('keeps a removed direct guest deleted when the retry reloads them', () => {
    service.setGuests([{ ...savedChair, state: 'deleted', originalData: { ...savedChair } }]);
    getMeetingRegistrants.mockReturnValue(of([savedChair]));

    service.retryLoadMeeting();

    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1', state: 'deleted' });
    expect(service.registrantUpdates().toDelete).toEqual(['registrant-1']);
  });

  // `toUpdate` has no producer in the composer yet, but the merge is what would silently discard the
  // organizer's typing the moment one is added, so the reconciliation is pinned now rather than later.
  it("keeps an edited guest's own values and re-bases them on what upstream now stores", () => {
    service.setGuests([{ ...savedChair, first_name: 'Adaline', state: 'modified', originalData: { ...savedChair } }]);
    // Upstream moved on underneath the edit: someone else renamed the same row between the two fetches.
    getMeetingRegistrants.mockReturnValue(of([{ ...savedChair, first_name: 'Augusta' } as MeetingRegistrant]));

    service.retryLoadMeeting();

    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1', first_name: 'Adaline', state: 'modified' });
    // Re-based, so the pending change is measured against the stored row rather than a stale snapshot.
    expect(service.guests()[0].originalData).toMatchObject({ first_name: 'Augusta' });
    expect(service.registrantUpdates().toUpdate).toEqual([{ uid: 'registrant-1', changes: { first_name: 'Adaline' } }]);
  });

  // "Try again" is a button, so two clicks can leave two fetches in flight with nothing ordering their
  // responses. The stamp is what keeps the slower, older one from landing on top of the newer answer.
  it('drops a response that a later fetch has already superseded', () => {
    const first = new Subject<MeetingRegistrant[]>();
    const second = new Subject<MeetingRegistrant[]>();
    getMeetingRegistrants.mockReturnValueOnce(first).mockReturnValueOnce(second);

    service.retryLoadMeeting();
    // `guestsLoadFailed` is cleared by the fetch above, so the second retry needs it set again to pass
    // the guard — which is exactly the state a failing first attempt leaves behind.
    service.guestsLoadFailed.set(true);
    service.retryLoadMeeting();

    second.next([savedChair]);
    second.complete();
    first.next([{ uid: 'registrant-stale', email: 'stale@acme-motors.example' } as MeetingRegistrant]);
    first.complete();

    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1' });
    // The superseded fetch completing must not report the newer one as finished, or failed, either.
    expect(service.guestsLoading()).toBe(false);
    expect(service.guestsLoadFailed()).toBe(false);
  });

  it('leaves the newest fetch running when a superseded one fails', () => {
    const inFlight = new Subject<MeetingRegistrant[]>();
    const doomed = new Subject<MeetingRegistrant[]>();
    getMeetingRegistrants.mockReturnValueOnce(doomed).mockReturnValueOnce(inFlight);

    service.retryLoadMeeting();
    service.guestsLoadFailed.set(true);
    service.retryLoadMeeting();

    doomed.error(new Error('boom'));

    // The retry banner belongs to the fetch that is still running, not to the one it replaced.
    expect(service.guestsLoadFailed()).toBe(false);
    expect(service.guestsLoading()).toBe(true);
  });
});

/**
 * Covers what an edit-mode open puts in the form: the stored meeting type, and the guest list a group
 * emission can race. Both hydrate through `initialize({ mode: 'edit' })`, so each case configures its
 * own upstream responses rather than sharing one `beforeEach`.
 */
describe('MeetingComposerFormService \u2014 edit-mode hydration', () => {
  /** Opens an edit composer over the given saved meeting, with `registrants$` standing in for the guest fetch. */
  function openEdit(meeting: Partial<Meeting>, registrants$: Observable<MeetingRegistrant[]>): MeetingComposerFormService {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn().mockReturnValue(of({ id: 'meeting-1', title: 'Saved meeting', ...meeting } as Meeting)),
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getMeetingRegistrants: vi.fn().mockReturnValue(registrants$),
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ meeting_id: meetingUid, email: guest.email }),
            getChangedFields: (guest: MeetingRegistrantWithState) => ({ email: guest.email }),
          },
        },
      ],
    });

    const service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'edit', meetingUid: 'meeting-1' });

    return service;
  }

  /** A group member carrying the attribution fields `syncCommitteeMembers` reads. */
  const boardMember = (email: string): CommitteeMember => ({
    uid: `member-${email}`,
    committee_uid: 'committee-board',
    committee_name: 'Board',
    email,
    first_name: 'Ada',
    last_name: 'Lovelace',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  });

  // `None` is what upstream stores for a meeting created before the type was required. Hydrating it
  // verbatim would show a card nobody can pick and let the save through on a type the form rejects.
  it('blanks the legacy None type so the field asks for a real one', () => {
    const service = openEdit({ meeting_type: MeetingType.NONE }, of([]));

    expect(service.form().get('meeting_type')?.value).toBe('');
    expect(service.form().get('meeting_type')?.hasError('required')).toBe(true);
    expect(service.isSectionValid('details-access')).toBe(false);
  });

  // Upstream types the field as a free-form string, so a stored value this build has no card for is
  // possible. Blanking it would silently rewrite the organizer's meeting on the next save.
  it('keeps a stored type the composer does not recognize', () => {
    const service = openEdit({ meeting_type: 'Retrospective' }, of([]));

    expect(service.form().get('meeting_type')?.value).toBe('Retrospective');
    expect(service.isSectionValid('details-access')).toBe(true);
  });

  it('folds a group member added mid-load into the saved row that arrives for them', () => {
    const registrants = new Subject<MeetingRegistrant[]>();
    const service = openEdit({}, registrants);

    // Selecting a group while the guest fetch is still open queues its members as `new`; the
    // deliberate case mismatch is what an upstream row and a committee record actually differ by.
    service.syncCommitteeMembers([boardMember('Chair@Example.com')]);
    expect(service.guests()).toHaveLength(1);

    registrants.next([{ uid: 'registrant-1', email: 'chair@example.com' } as MeetingRegistrant]);

    // One person, one row: without the dedupe the save would invite an already-registered guest again.
    expect(service.guests()).toHaveLength(1);
    expect(service.guests()[0]).toMatchObject({ uid: 'registrant-1', state: 'existing' });
    expect(service.registrantUpdates().toAdd).toEqual([]);
  });

  it('keeps a mid-load guest the fetch does not know about', () => {
    const registrants = new Subject<MeetingRegistrant[]>();
    const service = openEdit({}, registrants);

    service.syncCommitteeMembers([boardMember('newcomer@example.com')]);

    registrants.next([{ uid: 'registrant-1', email: 'chair@example.com' } as MeetingRegistrant]);

    // The dedupe must not swallow work done during the fetch, and the pending row keeps its place
    // ahead of the saved ones so the organizer can still see what they just added.
    expect(service.guests().map((guest) => guest.email)).toEqual(['newcomer@example.com', 'chair@example.com']);
    expect(service.guests()[0]).toMatchObject({ state: 'new' });
  });
});

/**
 * Covers the organizer picker's contribution to the save payload. Upstream has no owner-removal path
 * and defaults a create's owner to the creator, so what matters is not what the three controls hold
 * but whether `owner` is on the payload at all: sending it when nothing was picked would name the
 * wrong organizer, and sending it on an untouched edit would blank the `profile_picture` this form
 * never carries.
 */
describe('MeetingComposerFormService \u2014 organizer picker payload', () => {
  let service: MeetingComposerFormService;
  let createMeeting: ReturnType<typeof vi.fn>;
  let updateMeeting: ReturnType<typeof vi.fn>;

  const SAVED_OWNER = { username: 'alovelace', name: 'Ada Lovelace', email: 'ada@example.com' };

  /** The payload the save actually sent, from whichever of the two write paths ran. */
  const sentPayload = (): Record<string, unknown> => (createMeeting.mock.calls[0]?.[0] ?? updateMeeting.mock.calls[0]?.[1]) as Record<string, unknown>;

  beforeEach(() => {
    createMeeting = vi.fn().mockReturnValue(of({ id: 'meeting-1' } as Meeting));
    updateMeeting = vi.fn().mockReturnValue(of({ id: 'meeting-1' } as Meeting));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: MeetingService, useValue: { createMeeting, updateMeeting } },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
  });

  it('leaves the owner key off entirely when the picker was never touched', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });

    service.submit().subscribe();

    // Not `owner: undefined` \u2014 the key is absent, which is what lets upstream default the organizer
    // to whoever created the meeting.
    expect(sentPayload()).not.toHaveProperty('owner');
  });

  it('sends only the parts of the organizer that were filled in', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.switchToOwnerManualEntry();
    service.form().patchValue({ ownerName: '  Ada Lovelace  ', ownerEmail: 'ada@example.com' });

    service.submit().subscribe();

    expect(sentPayload()['owner']).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
  });

  it('leaves the owner key off when an edit still holds the saved organizer', () => {
    service.initialize({ mode: 'edit', projectUid: 'project-1' });
    service.meetingId.set('meeting-1');
    service.hydratedOwner.set(SAVED_OWNER);
    service.form().patchValue({ ownerUsername: SAVED_OWNER.username, ownerName: SAVED_OWNER.name, ownerEmail: SAVED_OWNER.email });

    service.submit().subscribe();

    expect(updateMeeting).toHaveBeenCalled();
    expect(sentPayload()).not.toHaveProperty('owner');
  });

  it('sends the organizer once an edit moves it off the saved one', () => {
    service.initialize({ mode: 'edit', projectUid: 'project-1' });
    service.meetingId.set('meeting-1');
    service.hydratedOwner.set(SAVED_OWNER);
    service.form().patchValue({ ownerUsername: 'ghopper', ownerName: 'Grace Hopper', ownerEmail: 'grace@example.com' });

    service.submit().subscribe();

    expect(sentPayload()['owner']).toEqual({ username: 'ghopper', name: 'Grace Hopper', email: 'grace@example.com' });
  });

  it('drops a picked LFID once the hand-typed organizer diverges from it', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.form().patchValue({ ownerUsername: SAVED_OWNER.username, ownerName: SAVED_OWNER.name, ownerEmail: SAVED_OWNER.email });

    service.switchToOwnerManualEntry();
    service.form().get('ownerEmail')?.setValue('ada@contractor.example');

    // The LFID belonged to the directory entry, so carrying it alongside a hand-typed address would
    // attribute the meeting to an account the organizer is no longer describing.
    expect(service.form().get('ownerUsername')?.value).toBeNull();

    service.submit().subscribe();

    expect(sentPayload()['owner']).toEqual({ name: SAVED_OWNER.name, email: 'ada@contractor.example' });
  });

  it('keeps the restored LFID when the picker reverts to the saved organizer', () => {
    service.initialize({ mode: 'edit', projectUid: 'project-1' });
    service.hydratedOwner.set(SAVED_OWNER);
    service.switchToOwnerManualEntry();
    service.form().patchValue({ ownerName: 'Someone Else', ownerEmail: 'else@example.com' });

    service.revertOwnerToSaved();

    // The revert writes all three controls, so leaving manual mode on would have the hand-edit guard
    // wipe the username the revert had just put back.
    expect(service.ownerManualEntry()).toBe(false);
    expect(service.form().get('ownerUsername')?.value).toBe(SAVED_OWNER.username);
    expect(service.form().get('ownerEmail')?.value).toBe(SAVED_OWNER.email);
  });

  it('discards an invalid hand-typed email on the way back to search', () => {
    service.initialize({ mode: 'create', projectUid: 'project-1' });
    service.switchToOwnerManualEntry();
    service.form().patchValue({ ownerName: 'Ada Lovelace', ownerEmail: 'not-an-address' });

    service.backToOwnerSearch();

    // Its error message only renders in manual mode, so left in place it would gate the section with
    // nothing on screen to explain why. A name-only organizer is valid upstream, so the name stays.
    expect(service.form().get('ownerEmail')?.value).toBeNull();
    expect(service.form().get('ownerName')?.value).toBe('Ada Lovelace');
  });
});

/**
 * Covers the per-meeting cancel-on-group-removal override. Upstream reads it only for a public meeting
 * with linked groups, so the composer resolves the other cases to `inherit` rather than letting a value
 * chosen under different settings ride along invisibly.
 */
describe('MeetingComposerFormService \u2014 cancel on committee removal', () => {
  let service: MeetingComposerFormService;
  let createMeeting: ReturnType<typeof vi.fn>;

  const GROUP = [{ uid: 'committee-board', allowed_voting_statuses: [] }];

  const sentOverride = (): unknown => (createMeeting.mock.calls[0][0] as Record<string, unknown>)['cancel_on_committee_removal'];

  beforeEach(() => {
    createMeeting = vi.fn().mockReturnValue(of({ id: 'meeting-1' } as Meeting));

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: MeetingService, useValue: { createMeeting } },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
  });

  it('sends the override for a public meeting with a linked group', () => {
    service.form().patchValue({ visibility: MeetingVisibility.PUBLIC, committees: GROUP, cancel_on_committee_removal: CancelOnCommitteeRemoval.CANCEL });

    service.submit().subscribe();

    expect(sentOverride()).toBe(CancelOnCommitteeRemoval.CANCEL);
  });

  it('falls back to inherit once the meeting is made private', () => {
    service.form().patchValue({ visibility: MeetingVisibility.PUBLIC, committees: GROUP, cancel_on_committee_removal: CancelOnCommitteeRemoval.KEEP });

    service.form().get('visibility')?.setValue(MeetingVisibility.PRIVATE);
    service.submit().subscribe();

    // The override has nothing to act on here, and a private meeting later reopened to the public
    // should not silently inherit a rule chosen while nobody could see it.
    expect(sentOverride()).toBe(CancelOnCommitteeRemoval.INHERIT);
  });

  it('falls back to inherit once the last group is unlinked', () => {
    service.form().patchValue({ visibility: MeetingVisibility.PUBLIC, committees: GROUP, cancel_on_committee_removal: CancelOnCommitteeRemoval.KEEP });

    service.form().get('committees')?.setValue([]);
    service.submit().subscribe();

    expect(sentOverride()).toBe(CancelOnCommitteeRemoval.INHERIT);
  });
});

/**
 * `effectiveDuration` is the only reader that knows duration lives in two controls, and the agenda
 * field's "apply the estimate" affordance gates on it, so a wrong answer there silently offers to
 * change a duration that is already correct — or refuses to offer when it isn't.
 */
describe('MeetingComposerFormService — effective duration', () => {
  let service: MeetingComposerFormService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: MeetingService, useValue: {} },
      ],
    });

    service = TestBed.inject(MeetingComposerFormService);
    service.initialize({ mode: 'create', projectUid: 'project-1' });
  });

  it('reads the chip control when it holds a preset', () => {
    service.form().get('duration')?.setValue(30);

    expect(service.effectiveDuration()).toBe(30);
  });

  it('ignores a stale custom value while a preset chip is selected', () => {
    // `setDuration` clears the companion, but a form patched from elsewhere need not have, and the
    // chip is what the user sees selected.
    service.form().patchValue({ customDuration: 125, duration: 45 });

    expect(service.effectiveDuration()).toBe(45);
  });

  it('reads the custom control once the chip control says custom', () => {
    service.setDuration(125);

    expect(service.form().get('duration')?.value).toBe('custom');
    expect(service.effectiveDuration()).toBe(125);
  });

  it('coerces the numeric input string the custom control actually holds', () => {
    service.form().patchValue({ customDuration: '125', duration: 'custom' });

    expect(service.effectiveDuration()).toBe(125);
  });

  it('returns null for the empty custom control the form starts with', () => {
    // The trap this guards: `Number('')` is 0, not `NaN`, so an emptied input would otherwise read
    // as a real zero-minute duration rather than "not answered yet".
    service.form().get('duration')?.setValue('custom');

    expect(service.effectiveDuration()).toBeNull();
  });

  it.each([
    ['zero', 0],
    ['a negative number', -30],
    ['a non-numeric string', 'soon'],
  ] as const)('returns null when the custom control holds %s', (_label, value) => {
    service.form().patchValue({ customDuration: value, duration: 'custom' });

    expect(service.effectiveDuration()).toBeNull();
  });

  it('returns null when the chip control itself is cleared', () => {
    service.form().get('duration')?.setValue(null);

    expect(service.effectiveDuration()).toBeNull();
  });
});
