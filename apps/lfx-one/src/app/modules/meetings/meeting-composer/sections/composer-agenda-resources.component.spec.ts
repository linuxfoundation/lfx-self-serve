// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
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
