// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingAttachment, MeetingMaterialsDrawerData, MeetingOccurrence, PastMeetingAttachment, PresignAttachmentResponse } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingMaterialsDrawerComponent } from './meeting-materials-drawer.component';

const PAST_ID = 'synthetic-meeting-2524640400';
const FILE = { uid: 'file-1', type: 'file', name: 'Deck.pdf', meeting_and_occurrence_id: PAST_ID, created_at: '2050-01-01T00:00:00Z' } as PastMeetingAttachment;
const LINK = { uid: 'link-1', type: 'link', name: 'Notes', link: 'https://docs.example/notes', created_at: '2050-01-01T00:00:00Z' } as PastMeetingAttachment;
const UPLOADED = { uid: 'file-new', type: 'file', name: 'Minutes.pdf', created_at: '2050-01-02T00:00:00Z' } as PresignAttachmentResponse;

const OCCURRENCE = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SERIES_FILE = {
  uid: 'series-1',
  meeting_id: 'synthetic-meeting',
  type: 'file',
  name: 'Charter.pdf',
  created_at: '2050-01-01T00:00:00Z',
} as MeetingAttachment;
const DATE_FILE = { ...SERIES_FILE, uid: 'date-1', name: 'Agenda.pdf', occurrence_id: OCCURRENCE.occurrence_id } as MeetingAttachment;
const OTHER_DATE_FILE = { ...SERIES_FILE, uid: 'other-1', name: 'Other.pdf', occurrence_id: '2525245200' } as MeetingAttachment;
const DESCRIPTION_LINK = { ...SERIES_FILE, uid: 'desc-1', type: 'link', name: 'Doc', link: 'https://docs.example', source: 'description' } as MeetingAttachment;

describe('MeetingMaterialsDrawerComponent', () => {
  let fixture: ComponentFixture<MeetingMaterialsDrawerComponent>;
  let getPastMeetingAttachments: ReturnType<typeof vi.fn>;
  let createPastMeetingAttachment: ReturnType<typeof vi.fn>;
  let deletePastMeetingAttachment: ReturnType<typeof vi.fn>;
  let uploadPastMeetingFile: ReturnType<typeof vi.fn>;
  let onChanged: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let toastShow: ReturnType<typeof vi.fn>;
  let upcoming: Record<string, ReturnType<typeof vi.fn>>;

  const render = async (): Promise<void> => {
    fixture = TestBed.createComponent(MeetingMaterialsDrawerComponent);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const queryAll = (testId: string): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testId}"]`));
  const click = async (element: HTMLElement | null): Promise<void> => {
    (element?.querySelector('button') ?? element)?.click();
    await fixture.whenStable();
  };
  const pick = async (...files: File[]): Promise<void> => {
    const input = query('meeting-materials-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  };
  const type = async (testId: string, value: string): Promise<void> => {
    const input = query(testId)?.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  };
  const pdf = (name: string, size = 1024): File => {
    const file = new File(['x'], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };
  const lastToast = (): { variant: string; message: string; description: string } => toastShow.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    getPastMeetingAttachments = vi.fn(() => of([FILE, LINK]));
    createPastMeetingAttachment = vi.fn(() => of({ ...LINK, uid: 'link-new', name: 'Repo', link: 'https://repo.example' }));
    deletePastMeetingAttachment = vi.fn(() => of(undefined));
    uploadPastMeetingFile = vi.fn(() => of(UPLOADED));
    onChanged = vi.fn();
    close = vi.fn();
    toastShow = vi.fn();
    upcoming = {
      getMeetingAttachments: vi.fn(() => of([SERIES_FILE, DATE_FILE, OTHER_DATE_FILE, DESCRIPTION_LINK])),
      createMeetingAttachment: vi.fn(() => of({ ...SERIES_FILE, uid: 'link-new', type: 'link', name: 'Repo', link: 'https://repo.example' })),
      deleteMeetingAttachment: vi.fn(() => of(undefined)),
      updateMeetingAttachment: vi.fn(() => of(undefined)),
      uploadMeetingFile: vi.fn(() => of(UPLOADED)),
      recordAttachmentChanges: vi.fn(),
      recordAttachmentScopeChanges: vi.fn(),
    };
    const data: MeetingMaterialsDrawerData = {
      pastMeetingId: PAST_ID,
      occurrence: null,
      canScopeToOccurrence: false,
      onChanged: onChanged as MeetingMaterialsDrawerData['onChanged'],
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { close } },
        {
          provide: MeetingService,
          useValue: {
            getPastMeetingAttachments,
            createPastMeetingAttachment,
            deletePastMeetingAttachment,
            uploadPastMeetingFile,
            ...upcoming,
            attachmentChanges: () => new Map(),
            attachmentScopeOverrides: () => new Map(),
          },
        },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it("lists the past record's files and links", async () => {
    await render();

    expect(getPastMeetingAttachments).toHaveBeenCalledWith(PAST_ID);
    expect(query('meeting-materials-existing-files')?.textContent).toContain('Deck.pdf');
    expect(query('meeting-materials-existing-links')?.textContent).toContain('https://docs.example/notes');
    expect(query('meeting-materials-save')).toBeNull();
  });

  it('rejects a file that is too large, of an unsupported type, picked twice or with an unsafe name', async () => {
    await render();

    await pick(pdf('Huge.pdf', 101 * 1024 * 1024));
    expect(lastToast()).toEqual(expect.objectContaining({ message: 'File Upload Error', description: 'File "Huge.pdf" is too large. Maximum size is 100MB.' }));

    await pick(new File(['x'], 'tool.exe', { type: 'application/x-msdownload' }));
    expect(lastToast().description).toContain('is not supported. Allowed types:');

    await pick(pdf('Agenda.pdf'));
    await pick(pdf('Agenda.pdf'));
    expect(lastToast().description).toBe('A file named "Agenda.pdf" has already been selected for upload.');

    await pick(pdf('..secret.pdf'));
    expect(lastToast().description).toBe('Invalid filename "..secret.pdf". Filename cannot contain path traversal characters or start with a dot.');
    expect(queryAll('meeting-materials-pending-item')).toHaveLength(1);
  });

  it('adds a link at once with a trimmed title and URL', async () => {
    await render();

    await type('meeting-materials-link-title', '  Repo ');
    await type('meeting-materials-link-url', ' https://repo.example ');
    await click(query('meeting-materials-link-add'));

    expect(createPastMeetingAttachment).toHaveBeenCalledWith(PAST_ID, { type: 'link', category: 'Other', name: 'Repo', link: 'https://repo.example' });
    expect(toastShow).toHaveBeenCalledWith({ variant: 'success', position: 'bottom-center', message: 'Link added' });
    expect(onChanged).toHaveBeenCalledWith({ deletedUids: [], addedAttachments: [expect.objectContaining({ uid: 'link-new' })] });
  });

  it('reports a link that could not be added', async () => {
    createPastMeetingAttachment.mockReturnValue(throwError(() => new Error('down')));
    await render();

    await type('meeting-materials-link-title', 'Repo');
    await type('meeting-materials-link-url', 'https://repo.example');
    await click(query('meeting-materials-link-add'));

    expect(lastToast()).toEqual(expect.objectContaining({ variant: 'error', message: 'Error', description: 'Failed to add link. Please try again.' }));
  });

  it('deletes, then uploads, on Save and closes', async () => {
    await render();
    await click(query('meeting-materials-delete'));
    await pick(pdf('Minutes.pdf'));

    await click(query('meeting-materials-save'));

    expect(deletePastMeetingAttachment).toHaveBeenCalledWith(PAST_ID, 'file-1');
    expect(uploadPastMeetingFile).toHaveBeenCalledWith(PAST_ID, expect.any(File), { name: 'Minutes.pdf', file_size: 1024, file_type: 'application/pdf' });
    expect(onChanged).toHaveBeenCalledWith({
      deletedUids: ['file-1'],
      addedAttachments: [expect.objectContaining({ uid: 'file-new', meeting_and_occurrence_id: PAST_ID })],
    });
    expect(toastShow).toHaveBeenCalledWith({ variant: 'success', position: 'bottom-center', message: 'Materials saved' });
    expect(close).toHaveBeenCalled();
  });

  it('still reports what saved when the drawer closes mid-save', async () => {
    const upload = new Subject<PresignAttachmentResponse>();
    uploadPastMeetingFile.mockReturnValue(upload);
    await render();
    await pick(pdf('Minutes.pdf'));
    await click(query('meeting-materials-save'));

    fixture.destroy();
    upload.next(UPLOADED);
    upload.complete();

    expect(onChanged).toHaveBeenCalledWith({ deletedUids: [], addedAttachments: [expect.objectContaining({ uid: 'file-new' })] });
  });

  it('undoes a staged delete on the same button, so focus stays on it', async () => {
    await render();
    const button = query('meeting-materials-delete');
    await click(button);
    expect(query('meeting-materials-undo')).toBe(button);
    expect(button?.querySelector('button')?.getAttribute('aria-label')).toBe('Undo delete Deck.pdf');

    await click(query('meeting-materials-undo'));
    expect(query('meeting-materials-save')).toBeNull();
  });

  it('fills a blank browser type from the extension before uploading', async () => {
    await render();
    const notes = new File(['x'], 'notes.md', { type: '' });
    Object.defineProperty(notes, 'size', { value: 10 });
    await pick(notes);
    await click(query('meeting-materials-save'));

    expect(uploadPastMeetingFile).toHaveBeenCalledWith(PAST_ID, expect.any(File), expect.objectContaining({ file_type: 'text/markdown' }));
  });

  it('lists the changes already saved this session on reopen', async () => {
    const added = { ...LINK, uid: 'link-saved', name: 'Saved' };
    TestBed.overrideProvider(DIALOG_DATA, {
      useValue: { pastMeetingId: PAST_ID, pastChanges: { deletedUids: ['file-1'], addedAttachments: [added] }, onChanged },
    });
    await render();

    const names = queryAll('meeting-materials-existing-item').map((row) => row.textContent);
    expect(names.some((name) => name?.includes('Deck.pdf'))).toBe(false);
    expect(names.some((name) => name?.includes('Saved'))).toBe(true);
  });

  it('locks the link fields while a link is being added', async () => {
    createPastMeetingAttachment.mockReturnValue(new Subject());
    await render();
    await type('meeting-materials-link-title', 'Repo');
    await type('meeting-materials-link-url', 'https://repo.example');
    await click(query('meeting-materials-link-add'));

    expect((query('meeting-materials-link-title')?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect((query('meeting-materials-link-url')?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('adds no link that is not a web address', async () => {
    await render();

    await type('meeting-materials-link-title', 'Repo');
    await type('meeting-materials-link-url', 'javascript:alert(1)');
    await click(query('meeting-materials-link-add'));

    expect(createPastMeetingAttachment).not.toHaveBeenCalled();
  });

  it('locks staged changes while saving', async () => {
    uploadPastMeetingFile.mockReturnValue(new Subject<PresignAttachmentResponse>());
    await render();
    await click(query('meeting-materials-delete'));
    await pick(pdf('Minutes.pdf'));
    await click(query('meeting-materials-save'));

    expect(query('meeting-materials-undo')?.querySelector('button')?.disabled).toBe(true);
    expect(query('meeting-materials-pending-remove')?.querySelector('button')?.disabled).toBe(true);
    const drop = new Event('drop') as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [pdf('Late.pdf')] } });
    query('meeting-materials-dropzone')?.dispatchEvent(drop);
    await fixture.whenStable();
    expect(queryAll('meeting-materials-pending-item')).toHaveLength(1);
  });

  it('stays open on a partial failure and keeps only what failed', async () => {
    uploadPastMeetingFile.mockReturnValue(throwError(() => new Error('down')));
    await render();
    await click(query('meeting-materials-delete'));
    await pick(pdf('Minutes.pdf'));

    await click(query('meeting-materials-save'));

    expect(lastToast()).toEqual(
      expect.objectContaining({ variant: 'warning', message: 'Partial Update', description: 'Some changes could not be saved. Please try again.' })
    );
    expect(close).not.toHaveBeenCalled();
    expect(queryAll('meeting-materials-pending-item')).toHaveLength(1);
    expect(query('meeting-materials-existing-files')).toBeNull();
  });
  describe('on an upcoming recurring meeting', () => {
    const renderUpcoming = async (canScopeToOccurrence = true): Promise<void> => {
      const data: MeetingMaterialsDrawerData = {
        meetingId: 'synthetic-meeting',
        occurrence: OCCURRENCE,
        canScopeToOccurrence,
      };
      TestBed.overrideProvider(DIALOG_DATA, { useValue: data });
      await render();
    };
    const rowFor = (name: string): HTMLElement | undefined => queryAll('meeting-materials-existing-item').find((row) => row.textContent?.includes(name));

    it('lists the series and the shown date, each with its scope', async () => {
      await renderUpcoming();

      expect(upcoming['getMeetingAttachments']).toHaveBeenCalledWith('synthetic-meeting');
      expect(rowFor('Other.pdf')).toBeUndefined();
      expect(rowFor('Charter.pdf')?.textContent).toContain('All occurrences');
      expect(rowFor('Agenda.pdf')?.textContent).toContain('This occurrence');
    });

    it('uploads a file with the scope it was queued with', async () => {
      await renderUpcoming();
      const occurrenceTile = query('meeting-materials-scope-occurrence')?.querySelector('input') as HTMLInputElement;
      occurrenceTile.click();
      await fixture.whenStable();
      expect(query('meeting-materials-scope')?.textContent).toContain('apply to this occurrence only');

      await pick(pdf('Minutes.pdf'));
      await click(query('meeting-materials-save'));

      expect(upcoming['uploadMeetingFile']).toHaveBeenCalledWith('synthetic-meeting', expect.any(File), {
        name: 'Minutes.pdf',
        file_size: 1024,
        file_type: 'application/pdf',
        occurrence_id: OCCURRENCE.occurrence_id,
      });
      expect(upcoming['recordAttachmentChanges']).toHaveBeenCalledWith('synthetic-meeting', {
        added: [expect.objectContaining({ uid: 'file-new', occurrence_id: OCCURRENCE.occurrence_id })],
      });
    });

    it('saves a staged scope change and shares it with every list', async () => {
      await renderUpcoming();
      await click(rowFor('Charter.pdf')?.querySelector('[data-testid="meeting-materials-scope-toggle"]') as HTMLElement);
      expect(rowFor('Charter.pdf')?.textContent).toContain('Unsaved');

      await click(query('meeting-materials-save'));

      expect(upcoming['updateMeetingAttachment']).toHaveBeenCalledWith('synthetic-meeting', 'series-1', {
        type: 'file',
        category: 'Other',
        name: 'Charter.pdf',
        occurrence_id: OCCURRENCE.occurrence_id,
      });
      expect(upcoming['recordAttachmentScopeChanges']).toHaveBeenCalledWith([{ uid: 'series-1', occurrence_id: OCCURRENCE.occurrence_id }]);
      expect(close).toHaveBeenCalled();
    });

    it('keeps a scope change that failed to save staged for a retry', async () => {
      (upcoming['updateMeetingAttachment'] as ReturnType<typeof vi.fn>).mockReturnValueOnce(throwError(() => new Error('down')));
      await renderUpcoming();
      await click(rowFor('Charter.pdf')?.querySelector('[data-testid="meeting-materials-scope-toggle"]') as HTMLElement);

      await click(query('meeting-materials-save'));

      expect(upcoming['recordAttachmentScopeChanges']).not.toHaveBeenCalled();
      expect(rowFor('Charter.pdf')?.textContent).toContain('Unsaved');
      expect(close).not.toHaveBeenCalled();
    });

    it('deletes from the series and drops a scope change staged on the deleted item', async () => {
      await renderUpcoming();
      await click(rowFor('Charter.pdf')?.querySelector('[data-testid="meeting-materials-scope-toggle"]') as HTMLElement);
      await click(rowFor('Charter.pdf')?.querySelector('[data-testid="meeting-materials-delete"]') as HTMLElement);

      await click(query('meeting-materials-save'));

      expect(upcoming['deleteMeetingAttachment']).toHaveBeenCalledWith('synthetic-meeting', 'series-1');
      expect(upcoming['updateMeetingAttachment']).not.toHaveBeenCalled();
      expect(upcoming['recordAttachmentChanges']).toHaveBeenCalledWith('synthetic-meeting', { added: [] });
      expect(onChanged).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    });

    it('offers no scope change for a link lifted from the description', async () => {
      await renderUpcoming();

      expect(rowFor('Doc')?.querySelector('[data-testid="meeting-materials-scope-toggle"]')).toBeNull();
      expect(rowFor('Charter.pdf')?.querySelector('[data-testid="meeting-materials-scope-toggle"]')).not.toBeNull();
    });

    it('shows scopes but offers no changes once the date cannot take one', async () => {
      await renderUpcoming(false);

      expect(query('meeting-materials-scope-picker')).toBeNull();
      expect(query('meeting-materials-scope-toggle')).toBeNull();
      expect(rowFor('Charter.pdf')?.textContent).toContain('All occurrences');
    });

    it('records a new link for every list showing the meeting', async () => {
      await renderUpcoming();
      await type('meeting-materials-link-title', 'Repo');
      await type('meeting-materials-link-url', 'https://repo.example');
      await click(query('meeting-materials-link-add'));

      expect(upcoming['createMeetingAttachment']).toHaveBeenCalledWith('synthetic-meeting', {
        type: 'link',
        category: 'Other',
        name: 'Repo',
        link: 'https://repo.example',
      });
      expect(upcoming['recordAttachmentChanges']).toHaveBeenCalledWith('synthetic-meeting', { added: [expect.objectContaining({ uid: 'link-new' })] });
      expect(onChanged).not.toHaveBeenCalled();
    });
  });
});
