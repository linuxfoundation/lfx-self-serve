// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import {
  Meeting,
  MeetingAttachment,
  MeetingDetailsState,
  MeetingDetailsTab,
  MeetingHomeRow,
  MeetingOccurrence,
  PastMeetingAttachment,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';
import { MeetingDetailsAgendaComponent } from './meeting-details-agenda.component';
import { MeetingMaterialsDrawerComponent } from './materials-drawer/meeting-materials-drawer.component';

const MEETING = { id: 'synthetic-meeting', title: 'Synthetic sync', description: 'Roadmap review\nOpen floor' } as Meeting;
const OCCURRENCE = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const ROW: MeetingHomeRow = {
  key: 'row',
  meeting: MEETING,
  occurrence: null,
  title: MEETING.title,
  occurrenceId: null,
  startTime: '2050-01-01T09:00:00.000Z',
  durationMinutes: 30,
};
const FILE = { uid: 'file-1', type: 'file', name: 'Deck.pdf', file_name: 'Deck.pdf', created_at: '2050-01-01T00:00:00Z' } as MeetingAttachment;
const LINK = { uid: 'link-1', type: 'link', name: 'Notes', link: 'https://www.docs.example/notes', created_at: '2050-01-01T00:00:00Z' } as MeetingAttachment;
const OTHER_DATE = { ...FILE, uid: 'file-2', name: 'Other.pdf', occurrence_id: '2525245200' } as MeetingAttachment;

describe('MeetingDetailsAgendaComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsAgendaComponent>;
  let meeting: WritableSignal<Meeting>;
  let occurrence: WritableSignal<MeetingOccurrence | null>;
  let state: WritableSignal<MeetingDetailsState>;
  let organizer: WritableSignal<boolean>;
  let pastMeetingId: WritableSignal<string | null>;
  let fullAccess: WritableSignal<boolean>;
  let tab: WritableSignal<MeetingDetailsTab>;
  let getMeetingAttachments: ReturnType<typeof vi.fn>;
  let getPastMeetingAttachments: ReturnType<typeof vi.fn>;
  let getMeetingAttachmentDownloadUrl: ReturnType<typeof vi.fn>;
  let getPastMeetingAttachmentDownloadUrl: ReturnType<typeof vi.fn>;
  let edit: ReturnType<typeof vi.fn>;
  let drawerOpen: ReturnType<typeof vi.fn>;
  let dialogRef: DialogRef;
  let toastShow: ReturnType<typeof vi.fn>;

  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(MeetingDetailsAgendaComponent);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const click = async (testId: string): Promise<void> => {
    query(testId)?.querySelector('button')?.click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    meeting = signal(MEETING);
    occurrence = signal(null);
    state = signal('far');
    organizer = signal(false);
    pastMeetingId = signal(null);
    fullAccess = signal(true);
    tab = signal('agenda');
    getMeetingAttachments = vi.fn(() => of([FILE, LINK]));
    getPastMeetingAttachments = vi.fn(() => of([] as PastMeetingAttachment[]));
    getMeetingAttachmentDownloadUrl = vi.fn(() => of({ download_url: 'https://files.example/deck' }));
    getPastMeetingAttachmentDownloadUrl = vi.fn(() => of({ download_url: 'https://files.example/past' }));
    edit = vi.fn();
    drawerOpen = vi.fn();
    dialogRef = { close: vi.fn() } as unknown as DialogRef;
    toastShow = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: MeetingDetailsContext,
          useValue: {
            row: signal(ROW),
            shownRow: computed(() => {
              const shown = occurrence();
              return shown ? { ...ROW, occurrence: shown, occurrenceId: shown.occurrence_id, startTime: shown.start_time } : ROW;
            }),
            meeting,
            occurrence,
            state,
            organizer,
            pastMeetingId,
            fullAccess,
            tab,
            refreshList: vi.fn(),
          },
        },
        {
          provide: MeetingService,
          useValue: {
            getMeetingAttachments,
            getPastMeetingAttachments,
            getMeetingAttachmentDownloadUrl,
            getPastMeetingAttachmentDownloadUrl,
            attachmentChanges: signal(new Map()),
            attachmentScopeOverrides: signal(new Map()),
          },
        },
        { provide: MeetingsHomeEditService, useValue: { edit } },
        { provide: UiDrawerService, useValue: { open: drawerOpen } },
        { provide: MeetingDetailsSource, useValue: { hostRef: dialogRef } },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('shows the agenda, preferring the shown date over the series', async () => {
    await render();
    expect(query('meeting-details-agenda-text')?.textContent).toContain('Roadmap review');

    occurrence.set({ ...OCCURRENCE, description: 'Date only agenda' });
    await fixture.whenStable();
    expect(query('meeting-details-agenda-text')?.textContent).toContain('Date only agenda');
  });

  it('shows and fetches nothing without full access', async () => {
    fullAccess.set(false);
    await render();

    expect(query('meeting-details-agenda-section')).toBeNull();
    expect(query('meeting-details-materials')).toBeNull();
    expect(getMeetingAttachments).not.toHaveBeenCalled();
  });

  it('shows the empty states without edit actions for a guest', async () => {
    meeting.set({ ...MEETING, description: '' });
    getMeetingAttachments.mockReturnValue(of([]));
    await render();

    expect(query('meeting-details-agenda-empty')).not.toBeNull();
    expect(query('meeting-details-materials-empty')).not.toBeNull();
    expect(query('meeting-details-agenda-add')).toBeNull();
    expect(query('meeting-details-materials-add')).toBeNull();
  });

  it('splits files and links, and hides files of another date', async () => {
    getMeetingAttachments.mockReturnValue(of([FILE, LINK, OTHER_DATE]));
    occurrence.set(OCCURRENCE);
    await render();

    expect(getMeetingAttachments).toHaveBeenCalledWith('synthetic-meeting');
    expect(queryAll('meeting-details-materials-file')).toHaveLength(1);
    expect(query('meeting-details-materials-file')?.textContent).toContain('Deck.pdf');
    expect(query('meeting-details-materials-link')?.querySelector('.text-gray-500')?.textContent?.trim()).toBe('docs.example');
  });

  it('reads past materials from the past meeting record', async () => {
    pastMeetingId.set('synthetic-meeting-2524640400');
    state.set('ended');
    await render();

    expect(getPastMeetingAttachments).toHaveBeenCalledWith('synthetic-meeting-2524640400');
    expect(getMeetingAttachments).not.toHaveBeenCalled();
  });

  it('reads an upcoming date of a past row from its series', async () => {
    meeting.set({
      ...MEETING,
      id: 'synthetic-past-record',
      meeting_id: 'synthetic-meeting',
      scheduled_start_time: '2049-12-25T09:00:00.000Z',
    } as unknown as Meeting);
    occurrence.set(OCCURRENCE);
    await render();

    expect(getMeetingAttachments).toHaveBeenCalledWith('synthetic-meeting');
  });

  it('downloads past materials from the past meeting record', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    pastMeetingId.set('synthetic-meeting-2524640400');
    state.set('ended');
    getPastMeetingAttachments.mockReturnValue(of([FILE]));
    await render();

    await click('meeting-details-materials-download');

    expect(getPastMeetingAttachmentDownloadUrl).toHaveBeenCalledWith('synthetic-meeting-2524640400', 'file-1');
    expect(open).toHaveBeenCalledWith('https://files.example/past', '_blank', 'noopener,noreferrer');
  });

  it('offers no Open action for a link that is not a web address', async () => {
    getMeetingAttachments.mockReturnValue(of([{ ...LINK, link: 'javascript:alert(1)' }]));
    await render();

    expect(query('meeting-details-materials-link')).not.toBeNull();
    expect(query('meeting-details-materials-open')).toBeNull();
  });

  it('downloads a file in a new tab, and reports a failure', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await render();

    await click('meeting-details-materials-download');
    expect(getMeetingAttachmentDownloadUrl).toHaveBeenCalledWith('synthetic-meeting', 'file-1');
    expect(open).toHaveBeenCalledWith('https://files.example/deck', '_blank', 'noopener,noreferrer');

    getMeetingAttachmentDownloadUrl.mockReturnValue(throwError(() => new Error('down')));
    await click('meeting-details-materials-download');
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'Download Failed', description: 'Unable to download the attachment. Please try again.' })
    );
  });

  it('collapses an agenda taller than 200px behind Show more', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(320);
    await render();

    const text = query('meeting-details-agenda-text');
    expect(text?.style.maxHeight).toBe('200px');
    await click('meeting-details-agenda-more');
    expect(text?.style.maxHeight).toBe('');
    height.mockRestore();
  });

  it('measures the agenda again once its tab is shown', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(0);
    tab.set('guests');
    await render();
    expect(query('meeting-details-agenda-text')?.style.maxHeight).toBe('');

    height.mockReturnValue(320);
    tab.set('agenda');
    await fixture.whenStable();
    expect(query('meeting-details-agenda-text')?.style.maxHeight).toBe('200px');
  });

  it('collapses the agenda again when the shown date changes', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(320);
    await render();
    await click('meeting-details-agenda-more');
    expect(query('meeting-details-agenda-text')?.style.maxHeight).toBe('');

    occurrence.set(OCCURRENCE);
    await fixture.whenStable();
    expect(query('meeting-details-agenda-text')?.style.maxHeight).toBe('200px');
  });

  it('shows no Show more for a short agenda', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(120);
    await render();

    expect(query('meeting-details-agenda-more')).toBeNull();
  });

  it('lists the first five files, then reveals the rest', async () => {
    const files = Array.from({ length: 7 }, (_, index) => ({ ...FILE, uid: `file-${index}`, name: `File ${index}.pdf` }));
    getMeetingAttachments.mockReturnValue(of(files));
    await render();

    expect(queryAll('meeting-details-materials-file')).toHaveLength(5);
    expect(query('meeting-details-materials-more')?.textContent).toContain('Show 2 More');
    await click('meeting-details-materials-more');
    expect(queryAll('meeting-details-materials-file')).toHaveLength(7);
  });

  it('dates a file by its last update and marks recent changes as Updated', async () => {
    const updated = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    getMeetingAttachments.mockReturnValue(of([{ ...FILE, updated_at: updated }]));
    await render();

    expect(query('meeting-details-materials-updated')).not.toBeNull();
    expect(query('meeting-details-materials-file')?.textContent).not.toContain('Jan 1, 2050');
  });

  it('does not mark materials changed more than a week ago as Updated', async () => {
    getMeetingAttachments.mockReturnValue(of([{ ...FILE, updated_at: '2020-01-01T00:00:00Z' }]));
    await render();

    expect(query('meeting-details-materials-updated')).toBeNull();
  });

  it('says which dates each item of an upcoming series applies to', async () => {
    meeting.set({ ...MEETING, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } } as unknown as Meeting);
    occurrence.set(OCCURRENCE);
    getMeetingAttachments.mockReturnValue(of([FILE, { ...LINK, occurrence_id: OCCURRENCE.occurrence_id }]));
    await render();

    const scopes = queryAll('meeting-details-materials-scope').map((badge) => badge.textContent?.trim());
    expect(scopes).toEqual(['All occurrences', 'This occurrence']);
  });

  it('hides an empty sub-section whole', async () => {
    getMeetingAttachments.mockReturnValue(of([LINK]));
    await render();

    expect(query('meeting-details-materials-primary')).toBeNull();
    expect(query('meeting-details-materials-supporting')).not.toBeNull();
    expect(query('meeting-details-materials-empty')).toBeNull();
  });

  it('titles a link saved without a name with its URL and hides the host', async () => {
    getMeetingAttachments.mockReturnValue(of([{ ...LINK, name: '' }]));
    await render();

    const link = query('meeting-details-materials-link');
    expect(link?.textContent).toContain('https://www.docs.example/notes');
    expect(query('meeting-details-materials-host')).toBeNull();
  });

  it('lets an organizer edit the agenda in the composer, handing it the drawer to close', async () => {
    organizer.set(true);
    occurrence.set(OCCURRENCE);
    await render();

    await click('meeting-details-agenda-edit');

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({ occurrence: OCCURRENCE, occurrenceId: OCCURRENCE.occurrence_id, meeting: MEETING }),
      'agenda-resources',
      dialogRef
    );
  });

  it('opens materials in the composer, or adds the first ones there', async () => {
    organizer.set(true);
    await render();

    await click('meeting-details-materials-edit');
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ meeting: MEETING }), 'agenda-resources', dialogRef, true);
    expect(drawerOpen).not.toHaveBeenCalled();

    getMeetingAttachments.mockReturnValue(of([]));
    meeting.set({ ...MEETING, id: 'synthetic-other' });
    await fixture.whenStable();
    await click('meeting-details-materials-add');
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it('lets an organizer edit the agenda, or add one when there is none', async () => {
    organizer.set(true);
    await render();
    await click('meeting-details-agenda-edit');
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ meeting: MEETING }), 'agenda-resources', dialogRef);

    meeting.set({ ...MEETING, description: '' });
    await fixture.whenStable();
    expect(query('meeting-details-agenda-add')).not.toBeNull();
  });

  it('opens the series in the composer for the materials of an upcoming series', async () => {
    organizer.set(true);
    meeting.set({ ...MEETING, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } } as unknown as Meeting);
    occurrence.set(OCCURRENCE);
    await render();

    await click('meeting-details-materials-edit');

    expect(drawerOpen).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: OCCURRENCE.occurrence_id }), 'agenda-resources', dialogRef, true);
  });

  it('lists materials saved this session without a refetch', async () => {
    const changes = signal(new Map());
    TestBed.overrideProvider(MeetingService, {
      useValue: {
        getMeetingAttachments,
        getPastMeetingAttachments,
        getMeetingAttachmentDownloadUrl,
        getPastMeetingAttachmentDownloadUrl,
        attachmentChanges: changes,
        attachmentScopeOverrides: signal(new Map()),
      },
    });
    await render();

    changes.set(new Map([['synthetic-meeting', { added: [{ ...FILE, uid: 'file-new', name: 'Minutes.pdf' }], deletedUids: new Set(['file-1']) }]]));
    await fixture.whenStable();

    const names = queryAll('meeting-details-materials-file').map((row) => row.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Minutes.pdf');
    expect(getMeetingAttachments).toHaveBeenCalledTimes(1);
  });

  it('offers no edits on an upcoming date of a past row', async () => {
    organizer.set(true);
    meeting.set({
      ...MEETING,
      id: 'synthetic-past-record',
      meeting_id: 'synthetic-meeting',
      scheduled_start_time: '2049-12-25T09:00:00.000Z',
    } as unknown as Meeting);
    occurrence.set(OCCURRENCE);
    await render();

    expect(query('meeting-details-agenda-edit')).toBeNull();
    expect(query('meeting-details-materials-edit')).toBeNull();
  });

  it("lets an organizer manage an ended date's materials on its past record, but not the agenda", async () => {
    organizer.set(true);
    state.set('ended');
    pastMeetingId.set('synthetic-meeting-2524640400');
    getPastMeetingAttachments.mockReturnValue(of([FILE]));
    await render();

    expect(query('meeting-details-agenda-edit')).toBeNull();
    await click('meeting-details-materials-edit');

    expect(edit).not.toHaveBeenCalled();
    expect(drawerOpen).toHaveBeenCalledWith(MeetingMaterialsDrawerComponent, {
      data: expect.objectContaining({ pastMeetingId: 'synthetic-meeting-2524640400' }),
    });
  });

  it('shows saved past changes before the record catches up', async () => {
    organizer.set(true);
    state.set('ended');
    pastMeetingId.set('synthetic-meeting-2524640400');
    getPastMeetingAttachments.mockReturnValue(of([FILE]));
    await render();
    await click('meeting-details-materials-edit');

    const added = { ...FILE, uid: 'file-new', name: 'Minutes.pdf' } as unknown as PastMeetingAttachment;
    drawerOpen.mock.calls[0][1].data.onChanged({ deletedUids: ['file-1'], addedAttachments: [added] });
    await fixture.whenStable();

    const names = queryAll('meeting-details-materials-file').map((row) => row.textContent);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('Minutes.pdf');
  });

  it('keeps a save that finishes after another date is shown out of that date', async () => {
    organizer.set(true);
    state.set('ended');
    pastMeetingId.set('synthetic-meeting-2524640400');
    getPastMeetingAttachments.mockReturnValue(of([FILE]));
    await render();
    await click('meeting-details-materials-edit');

    pastMeetingId.set('synthetic-meeting-2525245200');
    await fixture.whenStable();
    drawerOpen.mock.calls[0][1].data.onChanged({ deletedUids: ['file-1'], addedAttachments: [] });
    await fixture.whenStable();

    expect(queryAll('meeting-details-materials-file')).toHaveLength(1);
  });

  it('offers a guest no edits once the meeting has ended', async () => {
    state.set('ended');
    pastMeetingId.set('synthetic-meeting-2524640400');
    getPastMeetingAttachments.mockReturnValue(of([FILE]));
    await render();

    expect(query('meeting-details-agenda-edit')).toBeNull();
    expect(query('meeting-details-materials-edit')).toBeNull();
  });
});
