// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import type { PendingAttachment } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerAgendaResourcesComponent } from './composer-agenda-resources.component';

/**
 * A FileList-shaped stand-in: jsdom has no `DataTransfer`, so a real `FileList` cannot be built here.
 * Indexed entries, `length`, `item` and an iterator — and deliberately no array methods — which is
 * what PrimeNG hands over in `files` for both the picker and a drop.
 */
const fileListLike = (...files: File[]): FileList => {
  const list: Record<number, File> & { length: number; item: (index: number) => File | null; [Symbol.iterator]: () => Iterator<File> } = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: () => files[Symbol.iterator](),
  };
  files.forEach((file, index) => (list[index] = file));
  return list as unknown as FileList;
};

/**
 * Covers the attachment gate and the link-removal bookkeeping. Both are enforced only here: a rejected
 * file has no validator behind it, and a saved link that is removed without being reported as a deletion
 * simply reappears on the next open.
 */
describe('ComposerAgendaResourcesComponent', () => {
  let fixture: ComponentFixture<ComposerAgendaResourcesComponent>;
  let component: ComposerAgendaResourcesComponent;
  let formService: MeetingComposerFormService;
  let messageService: { add: ReturnType<typeof vi.fn> };

  const attachments = () => (formService.form().get('attachments')?.value ?? []) as PendingAttachment[];
  const linksArray = () => formService.form().get('important_links') as FormArray;
  const rejectionDetail = (): string => messageService.add.mock.calls[0][0].detail;

  /** A PDF of a given name, sized without allocating the bytes — the cap is 100MB. */
  const pdf = (name: string, size = 1024): File => {
    const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };

  const linkRow = (uid: string | null): FormGroup =>
    new FormGroup({
      id: new FormControl(crypto.randomUUID()),
      title: new FormControl('Charter'),
      url: new FormControl('https://example.test/charter'),
      uid: new FormControl<string | null>(uid),
    });

  beforeEach(async () => {
    messageService = { add: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: messageService },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
      ],
    });
    TestBed.overrideComponent(ComposerAgendaResourcesComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerAgendaResourcesComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  describe('queueing files', () => {
    it('queues an allowed file with the fields the upload pass needs', () => {
      component['onFileSelect']({ files: [pdf('charter.pdf', 2048)] });

      expect(attachments()).toEqual([
        expect.objectContaining({ fileName: 'charter.pdf', fileSize: 2048, mimeType: 'application/pdf', uploading: false, uploaded: false }),
      ]);
      expect(messageService.add).not.toHaveBeenCalled();
    });

    it('gives each queued file its own id', () => {
      component['onFileSelect']({ files: [pdf('one.pdf'), pdf('two.pdf')] });

      const [first, second] = attachments();

      expect(first.id).toBeTruthy();
      expect(second.id).not.toBe(first.id);
    });

    it('appends to the existing queue rather than replacing it', () => {
      component['onFileSelect']({ files: [pdf('first.pdf')] });

      component['onFileSelect']({ files: [pdf('second.pdf')] });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['first.pdf', 'second.pdf']);
    });

    it('accepts the file picker\'s own "currentFiles" shape', () => {
      component['onFileSelect']({ currentFiles: [pdf('charter.pdf')] });

      expect(attachments()).toHaveLength(1);
    });

    it('does nothing on an empty selection', () => {
      component['onFileSelect']({ files: [] });

      expect(attachments()).toEqual([]);
      expect(messageService.add).not.toHaveBeenCalled();
    });
  });

  describe('queueing a native FileList selection', () => {
    it('queues a picked file when PrimeNG passes the FileList itself', () => {
      const picked = pdf('charter.pdf', 2048);
      const files = fileListLike(picked);
      expect(Array.isArray(files)).toBe(false);

      component['onFileSelect']({ files, currentFiles: [picked] });

      expect(attachments()).toEqual([
        expect.objectContaining({ fileName: 'charter.pdf', file: picked, fileSize: 2048, mimeType: 'application/pdf', uploading: false, uploaded: false }),
      ]);
      expect(messageService.add).not.toHaveBeenCalled();
    });

    it('queues every dropped file in order, each with its own id', () => {
      const dropped = [pdf('one.pdf'), pdf('two.pdf'), pdf('three.pdf')];

      component['onFileSelect']({ files: fileListLike(...dropped), currentFiles: dropped });

      const queued = attachments();
      expect(queued.map((attachment) => attachment.file)).toEqual(dropped);
      expect(new Set(queued.map((attachment) => attachment.id)).size).toBe(3);
    });

    it('stores the extension-derived MIME type when the browser reports none', () => {
      const blank = new File(['%PDF-1.4'], 'agenda.pdf', { type: '' });
      const generic = new File(['# notes'], 'notes.md', { type: 'application/octet-stream' });

      component['onFileSelect']({ files: fileListLike(blank, generic) });

      expect(attachments().map((attachment) => attachment.mimeType)).toEqual(['application/pdf', 'text/markdown']);
    });

    it('treats an empty FileList as a no-op even when currentFiles still holds older picks', () => {
      component['onFileSelect']({ files: fileListLike(), currentFiles: [pdf('older.pdf')] });

      expect(attachments()).toEqual([]);
      expect(messageService.add).not.toHaveBeenCalled();
    });

    it('queues only the new batch when currentFiles carries the earlier ones', () => {
      const first = pdf('first.pdf');
      const second = pdf('second.pdf');
      component['onFileSelect']({ files: fileListLike(first), currentFiles: [first] });

      component['onFileSelect']({ files: fileListLike(second), currentFiles: [first, second] });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['first.pdf', 'second.pdf']);
      expect(messageService.add).not.toHaveBeenCalled();
    });

    it('does not bring a removed file back on a later selection, but lets it be picked again', () => {
      const removed = pdf('removed.pdf');
      const kept = pdf('kept.pdf');
      component['onFileSelect']({ files: fileListLike(removed, kept), currentFiles: [removed, kept] });
      component['onRemoveAttachment'](attachments()[0].id);

      const later = pdf('later.pdf');
      component['onFileSelect']({ files: fileListLike(later), currentFiles: [removed, kept, later] });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['kept.pdf', 'later.pdf']);

      component['onFileSelect']({ files: fileListLike(removed), currentFiles: [removed, kept, later, removed] });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['kept.pdf', 'later.pdf', 'removed.pdf']);
    });

    it('rejects the invalid files in a FileList and keeps the rest', () => {
      const executable = new File(['MZ'], 'installer.exe', { type: 'application/x-msdownload' });

      component['onFileSelect']({ files: fileListLike(pdf('good.pdf'), pdf('huge.pdf', MAX_FILE_SIZE_BYTES + 1), executable) });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['good.pdf']);
      expect(messageService.add).toHaveBeenCalledTimes(2);
    });

    it('keeps the queue when the section is destroyed and recreated', async () => {
      component['onFileSelect']({ files: fileListLike(pdf('charter.pdf')) });
      fixture.destroy();

      const remounted = TestBed.createComponent(ComposerAgendaResourcesComponent);
      remounted.componentRef.setInput('form', formService.form());
      await remounted.whenStable();

      expect(remounted.componentInstance['pendingAttachments']().map((attachment) => attachment.fileName)).toEqual(['charter.pdf']);
    });
  });

  describe('rejecting files', () => {
    it('rejects a file over the size cap and names the limit', () => {
      component['onFileSelect']({ files: [pdf('huge.pdf', MAX_FILE_SIZE_BYTES + 1)] });

      expect(attachments()).toEqual([]);
      expect(rejectionDetail()).toBe(`"huge.pdf" is larger than ${MAX_FILE_SIZE_MB}MB.`);
    });

    it('accepts a file sitting exactly on the cap', () => {
      component['onFileSelect']({ files: [pdf('exact.pdf', MAX_FILE_SIZE_BYTES)] });

      expect(attachments()).toHaveLength(1);
    });

    it('rejects a disallowed file type and lists what is allowed', () => {
      const executable = new File(['MZ'], 'installer.exe', { type: 'application/x-msdownload' });

      component['onFileSelect']({ files: [executable] });

      expect(attachments()).toEqual([]);
      expect(rejectionDetail()).toContain("files aren't supported");
    });

    it('rejects a filename already queued in an earlier selection', () => {
      component['onFileSelect']({ files: [pdf('charter.pdf')] });

      component['onFileSelect']({ files: [pdf('charter.pdf')] });

      expect(attachments()).toHaveLength(1);
      expect(rejectionDetail()).toBe('"charter.pdf" has already been added.');
    });

    it('rejects a filename repeated within one selection', () => {
      // The duplicate check reads the accumulator as well as the committed queue, so the second copy
      // has to be caught before either one is written.
      component['onFileSelect']({ files: [pdf('charter.pdf'), pdf('charter.pdf')] });

      expect(attachments()).toHaveLength(1);
      expect(rejectionDetail()).toBe('"charter.pdf" has already been added.');
    });

    it('lets a failed upload be retried under the same name', () => {
      const failed: PendingAttachment = {
        id: 'a1',
        fileName: 'charter.pdf',
        file: pdf('charter.pdf'),
        fileSize: 10,
        mimeType: 'application/pdf',
        uploading: false,
        uploaded: false,
        uploadError: 'boom',
      };
      formService.form().get('attachments')?.setValue([failed]);

      component['onFileSelect']({ files: [pdf('charter.pdf')] });

      expect(attachments()).toHaveLength(2);
      expect(messageService.add).not.toHaveBeenCalled();
    });

    it('rejects a traversal filename', () => {
      component['onFileSelect']({ files: [pdf('../../etc/passwd.pdf')] });

      expect(attachments()).toEqual([]);
      expect(rejectionDetail()).toContain('is not a valid filename');
    });

    it('rejects a dot-prefixed filename', () => {
      component['onFileSelect']({ files: [pdf('.hidden.pdf')] });

      expect(attachments()).toEqual([]);
      expect(rejectionDetail()).toContain('is not a valid filename');
    });

    it('keeps the good files from a mixed selection', () => {
      component['onFileSelect']({ files: [pdf('good.pdf'), pdf('huge.pdf', MAX_FILE_SIZE_BYTES + 1), pdf('also-good.pdf')] });

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['good.pdf', 'also-good.pdf']);
      expect(messageService.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('removing resources', () => {
    it('drops only the queued file that was removed', () => {
      component['onFileSelect']({ files: [pdf('first.pdf'), pdf('second.pdf')] });
      const [first] = attachments();

      component['onRemoveAttachment'](first.id);

      expect(attachments().map((attachment) => attachment.fileName)).toEqual(['second.pdf']);
    });

    it('reports a saved link as a deletion when its row is removed', () => {
      linksArray().push(linkRow('link-uid-1'));

      component['onRemoveLink'](0);

      expect(formService.pendingAttachmentDeletions()).toEqual(['link-uid-1']);
      expect(linksArray().length).toBe(0);
    });

    it('removes an unsaved link row without reporting a deletion', () => {
      linksArray().push(linkRow(null));

      component['onRemoveLink'](0);

      // The link never reached upstream, so there is nothing there to delete.
      expect(formService.pendingAttachmentDeletions()).toEqual([]);
      expect(linksArray().length).toBe(0);
    });

    it('removes the row at the given index, not the last one', () => {
      linksArray().push(linkRow('first-uid'));
      linksArray().push(linkRow('second-uid'));

      component['onRemoveLink'](0);

      expect(formService.pendingAttachmentDeletions()).toEqual(['first-uid']);
      expect((linksArray().at(0) as FormGroup).get('uid')?.value).toBe('second-uid');
    });
  });
});

/**
 * Renders the real Agenda & resources template, so the wrapper's `(onSelect)` binding and the pending
 * list are exercised the way the drawer uses them, rather than through the handler alone.
 */
describe('ComposerAgendaResourcesComponent (template)', () => {
  let fixture: ComponentFixture<ComposerAgendaResourcesComponent>;
  let formService: MeetingComposerFormService;

  const pdf = (name: string): File => new File(['%PDF-1.4'], name, { type: 'application/pdf' });

  const mount = async (): Promise<ComponentFixture<ComposerAgendaResourcesComponent>> => {
    const mounted = TestBed.createComponent(ComposerAgendaResourcesComponent);
    mounted.componentRef.setInput('form', formService.form());
    mounted.detectChanges();
    await mounted.whenStable();
    return mounted;
  };

  const pendingNames = (mounted: ComponentFixture<ComposerAgendaResourcesComponent>): string[] => {
    const list: HTMLElement | null = mounted.nativeElement.querySelector('[data-testid="composer-agenda-pending-attachments"]');
    return Array.from(list?.querySelectorAll('span.truncate') ?? []).map((span) => span.textContent?.trim() ?? '');
  };

  const select = async (mounted: ComponentFixture<ComposerAgendaResourcesComponent>, ...files: File[]): Promise<void> => {
    const upload = mounted.debugElement.query(By.directive(FileUploadComponent)).componentInstance as FileUploadComponent;
    upload.onSelect.emit({ originalEvent: new Event('change'), files: fileListLike(...files), currentFiles: files });
    mounted.detectChanges();
    await mounted.whenStable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        // PrimeNG's file upload injects HttpClient for its built-in upload mode, which this form never uses.
        provideHttpClient(),
        provideHttpClientTesting(),
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
      ],
    });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = await mount();
  });

  it('lists the files the upload control emits', async () => {
    expect(fixture.nativeElement.querySelector('[data-testid="composer-agenda-pending-attachments"]')).toBeNull();

    await select(fixture, pdf('charter.pdf'), pdf('minutes.pdf'));

    expect(pendingNames(fixture)).toEqual(['charter.pdf', 'minutes.pdf']);
  });

  it('drops a row when its remove button is clicked', async () => {
    await select(fixture, pdf('charter.pdf'), pdf('minutes.pdf'));
    const [first] = formService.form().get('attachments')?.value as PendingAttachment[];

    (fixture.nativeElement.querySelector(`[data-testid="composer-agenda-remove-attachment-${first.id}"]`) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(pendingNames(fixture)).toEqual(['minutes.pdf']);
  });

  it('still lists the queued files after the section is recreated', async () => {
    await select(fixture, pdf('charter.pdf'));
    fixture.destroy();

    const remounted = await mount();

    expect(pendingNames(remounted)).toEqual(['charter.pdf']);
  });
});
