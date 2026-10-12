// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MEETING_ATTACHMENT_CATEGORIES } from '@lfx-one/shared/constants';
import { MeetingAttachment, PresignAttachmentResponse } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingMaterialsDrawerComponent } from './meeting-materials-drawer.component';

const created = (overrides: Partial<MeetingAttachment> = {}): MeetingAttachment => ({
  uid: 'att-1',
  meeting_id: 'meeting-1',
  type: 'link',
  name: 'Charter',
  link: 'https://github.example/charter',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const presigned = (uid: string): PresignAttachmentResponse =>
  ({
    uid,
    meeting_id: 'meeting-1',
    type: 'file',
    name: `${uid}.pdf`,
    file_name: `${uid}.pdf`,
    file_size: 1,
    file_upload_status: 'completed',
    file_content_type: 'application/pdf',
    created_at: '2026-01-01T00:00:00Z',
  }) as PresignAttachmentResponse;

/** E3-05 (#3254): every attachment category is reachable from the drawer, for links and files. */
describe('MeetingMaterialsDrawerComponent categories', () => {
  let fixture: ComponentFixture<MeetingMaterialsDrawerComponent>;
  let component: MeetingMaterialsDrawerComponent;
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    meetingService = {
      getMeetingAttachments: vi.fn(() => of([])),
      getPastMeetingAttachments: vi.fn(() => of([])),
      createMeetingAttachment: vi.fn(() => of(created())),
      createPastMeetingAttachment: vi.fn(() => of(created())),
      uploadMeetingFile: vi.fn((_id: string, file: File) => of(presigned(file.name))),
      uploadPastMeetingFile: vi.fn((_id: string, file: File) => of(presigned(file.name))),
      deleteMeetingAttachment: vi.fn(() => of(undefined)),
      deletePastMeetingAttachment: vi.fn(() => of(undefined)),
    };
    await TestBed.configureTestingModule({
      imports: [MeetingMaterialsDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeetingService, useValue: meetingService },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingMaterialsDrawerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('meetingId', 'meeting-1');
    fixture.detectChanges();
  });

  const addFile = (name: string): string => {
    component.onFileSelect({ files: [new File(['x'], name, { type: 'application/pdf' })] });
    return component.pendingAttachments().at(-1)!.id;
  };

  it('offers all four categories, defaulting to Other', () => {
    expect(component.categoryOptions.map((option) => option.value)).toEqual([...MEETING_ATTACHMENT_CATEGORIES]);
    expect(MEETING_ATTACHMENT_CATEGORIES).toEqual(['Meeting Minutes', 'Notes', 'Presentation', 'Other']);
    expect(component.categoryForm.controls['link'].value).toBe('Other');
  });

  it.each([...MEETING_ATTACHMENT_CATEGORIES])('creates a link with the chosen category (%s), then resets it', (category) => {
    component.newLinkTitle.set('Charter');
    component.newLinkUrl.set('https://github.example/charter');
    component.categoryForm.controls['link'].setValue(category);

    component.addLink();

    expect(meetingService['createMeetingAttachment']).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ type: 'link', category }));
    expect(component.categoryForm.controls['link'].value).toBe('Other');
  });

  it('uploads each file with its own category', () => {
    const minutes = addFile('minutes.pdf');
    const slides = addFile('slides.pdf');
    component.categoryForm.controls[component.fileCategoryKey(minutes)].setValue('Meeting Minutes');
    component.categoryForm.controls[component.fileCategoryKey(slides)].setValue('Presentation');

    component.onSave();

    expect(meetingService['uploadMeetingFile']).toHaveBeenCalledWith(
      'meeting-1',
      expect.any(File),
      expect.objectContaining({ name: 'minutes.pdf', category: 'Meeting Minutes' })
    );
    expect(meetingService['uploadMeetingFile']).toHaveBeenCalledWith(
      'meeting-1',
      expect.any(File),
      expect.objectContaining({ name: 'slides.pdf', category: 'Presentation' })
    );
  });

  it("uploads a file left alone as Other, and drops a removed file's category control", () => {
    const kept = addFile('notes.pdf');
    const removed = addFile('draft.pdf');
    component.removePendingAttachment(removed);

    expect(component.categoryForm.contains(component.fileCategoryKey(removed))).toBe(false);

    component.onSave();

    expect(meetingService['uploadMeetingFile']).toHaveBeenCalledTimes(1);
    expect(meetingService['uploadMeetingFile']).toHaveBeenCalledWith(
      'meeting-1',
      expect.any(File),
      expect.objectContaining({ name: 'notes.pdf', category: 'Other' })
    );
    expect(component.categoryForm.contains(component.fileCategoryKey(kept))).toBe(true);
  });

  // The template's own wiring: each select bound to its control, and every category shown back.
  it('renders a category select per pending file and shows existing categories', async () => {
    meetingService['getMeetingAttachments'].mockReturnValue(
      of([
        created({ uid: 'f1', type: 'file', name: 'Minutes', file_name: 'minutes.pdf', category: 'Meeting Minutes' }),
        created({ uid: 'l1', category: 'Presentation' }),
      ])
    );
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const body = document.body;
    expect(body.querySelector('[data-testid="existing-file-category-f1"]')?.textContent?.trim()).toBe('Meeting Minutes');
    expect(body.querySelector('[data-testid="existing-link-category-l1"]')?.textContent?.trim()).toBe('Presentation');
    expect(body.querySelector('[data-testid="new-link-category-select"]')).not.toBeNull();

    const id = addFile('agenda.pdf');
    fixture.detectChanges();

    expect(body.querySelector(`[data-testid="pending-category-${id}"]`)).not.toBeNull();
  });

  // drawer-pattern.md § Dialog semantics: a named modal dialog, focus moved in on open and handed back on close.
  it('opens as a named dialog, focuses its title, and hands focus back on close', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(component.titleId);
    expect(document.activeElement?.id).toBe(component.titleId);

    component.visible.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  // Closing the drawer mid-save tears down the file controls; the chosen categories must survive it.
  it("keeps each file's category when the drawer closes while the save is still running", () => {
    const pendingDelete = new Subject<void>();
    meetingService['deleteMeetingAttachment'].mockReturnValue(pendingDelete);
    component.existingAttachments.set([created({ uid: 'old', type: 'file', name: 'Old' })]);
    component.markForDeletion('old');
    const notes = addFile('notes.pdf');
    component.categoryForm.controls[component.fileCategoryKey(notes)].setValue('Notes');

    component.onSave();
    component.visible.set(true);
    component.visible.set(false);
    fixture.detectChanges();
    pendingDelete.next();
    pendingDelete.complete();

    expect(meetingService['uploadMeetingFile']).toHaveBeenCalledWith(
      'meeting-1',
      expect.any(File),
      expect.objectContaining({ name: 'notes.pdf', category: 'Notes' })
    );
  });

  it('sends the category to the past-meeting endpoints too', () => {
    fixture.componentRef.setInput('meetingId', undefined);
    fixture.componentRef.setInput('pastMeetingId', 'meeting-1-1700000000000');
    component.newLinkTitle.set('Notes');
    component.newLinkUrl.set('https://docs.vendor-corp.example/notes');
    component.categoryForm.controls['link'].setValue('Notes');

    component.addLink();

    expect(meetingService['createPastMeetingAttachment']).toHaveBeenCalledWith('meeting-1-1700000000000', expect.objectContaining({ category: 'Notes' }));
  });
});
