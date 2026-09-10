// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import type { ComposerLinkRow, MeetingAttachment, MeetingLinkDialogResult, PendingAttachment } from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { AddLinkDialogComponent } from '../add-link-dialog/add-link-dialog.component';
import { ComposerAgendaFieldComponent } from '../composer-agenda-field.component';
import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Agenda & Resources section of the meeting composer (GH-1458).
 * @description Attachments and links are read straight off the form controls rather than mirrored into
 * local signals: the host's `@switch` destroys this component on every section change, so any local
 * copy of the queue would be lost.
 */
@Component({
  selector: 'lfx-composer-agenda-resources',
  imports: [NgClass, ButtonComponent, FileUploadComponent, FileSizePipe, ComposerAgendaFieldComponent],
  templateUrl: './composer-agenda-resources.component.html',
})
export class ComposerAgendaResourcesComponent {
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();

  protected readonly maxFileSizeBytes = MAX_FILE_SIZE_BYTES;
  protected readonly acceptString = generateAcceptString();
  protected readonly acceptedTypesDisplay = getAcceptedFileTypesDisplay();

  protected readonly pendingAttachments: Signal<PendingAttachment[]> = computed(() => {
    this.formService.revision();
    return (this.form().get('attachments')?.value as PendingAttachment[] | null) ?? [];
  });
  protected readonly savedFileAttachments: Signal<MeetingAttachment[]> = computed(() =>
    this.formService.attachments().filter((attachment) => attachment.type === 'file')
  );
  protected readonly pendingDeletionSet: Signal<Set<string>> = computed(() => new Set(this.formService.pendingAttachmentDeletions()));
  // FormArray mutates `controls` in place, so a copy is what makes the recompute a real signal change.
  private readonly linkControls: Signal<FormGroup[]> = computed(() => {
    this.formService.revision();
    return [...this.linksArray().controls] as FormGroup[];
  });
  /**
   * The links as plain rows, projected once per change instead of read per binding.
   * @description Templates may only read signals, computed values and pipes — never
   * `FormGroup.get()` (`docs/reviews/frontend-checklist.md` section 4). Each row was four lookups a
   * pass: the track key, the title and its tooltip, the url and its tooltip, and the remove button's
   * accessible name. The index stands in as the track key on the impossible case of a link with no
   * id, since both producers assign one.
   */
  protected readonly linkRows: Signal<ComposerLinkRow[]> = computed(() =>
    this.linkControls().map((control, index) => ({
      id: (control.get('id')?.value as string | null) ?? String(index),
      title: (control.get('title')?.value as string | null) ?? '',
      url: (control.get('url')?.value as string | null) ?? '',
    }))
  );

  protected onFileSelect(event: { files?: File[]; currentFiles?: File[] }): void {
    const files = event.files ?? event.currentFiles ?? [];
    if (files.length === 0) {
      return;
    }

    const accepted = files.reduce<PendingAttachment[]>((kept, file) => {
      const error = this.validateFile(file, [...this.pendingAttachments(), ...kept]);

      if (error) {
        this.messageService.add({ severity: 'error', summary: 'File not added', detail: error, life: 5000 });
        return kept;
      }

      kept.push({
        id: crypto.randomUUID(),
        fileName: file.name,
        file,
        fileSize: file.size,
        mimeType: file.type,
        uploading: false,
        uploaded: false,
      });

      return kept;
    }, []);

    if (accepted.length > 0) {
      this.form()
        .get('attachments')
        ?.setValue([...this.pendingAttachments(), ...accepted]);
    }
  }

  protected onRemoveAttachment(id: string): void {
    this.form()
      .get('attachments')
      ?.setValue(this.pendingAttachments().filter((attachment) => attachment.id !== id));
  }

  protected onAddLink(): void {
    const dialogRef = this.dialogService.open(AddLinkDialogComponent, {
      header: 'Add link',
      width: 'min(520px, 94vw)',
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingLinkDialogResult | undefined) => {
      if (result) {
        this.appendLink(result);
      }
    });
  }

  protected onRemoveLink(index: number): void {
    const uid = this.linksArray().at(index)?.get('uid')?.value as string | null;

    // The link already exists upstream, so removing the row has to be reported as a deletion on save.
    if (uid) {
      this.formService.deleteLinkAttachment(uid);
    }

    this.linksArray().removeAt(index);
  }

  private appendLink(link: MeetingLinkDialogResult): void {
    this.linksArray().push(
      new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl(link.title),
        url: new FormControl(link.url),
        uid: new FormControl<string | null>(null),
      })
    );
  }

  private linksArray(): FormArray {
    return this.form().get('important_links') as FormArray;
  }

  private validateFile(file: File, queued: PendingAttachment[]): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `"${file.name}" is larger than ${MAX_FILE_SIZE_MB}MB.`;
    }

    if (!isFileTypeAllowed(file.type, file.name, ALLOWED_FILE_TYPES)) {
      return `"${getMimeTypeDisplayName(file.type, file.name)}" files aren't supported. Allowed: ${this.acceptedTypesDisplay}.`;
    }

    if (queued.some((attachment) => attachment.fileName === file.name && !attachment.uploadError)) {
      return `"${file.name}" has already been added.`;
    }

    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `"${file.name}" is not a valid filename.`;
    }

    return null;
  }
}
