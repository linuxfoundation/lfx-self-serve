// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } from '@lfx-one/shared/constants';
import {
  MeetingAttachmentUploadResult,
  MeetingMaterialRow,
  MeetingMaterialsDrawerData,
  PastMeetingAttachment,
  PendingAttachment,
  PresignAttachmentResponse,
} from '@lfx-one/shared/interfaces';
import {
  applyPastMeetingAttachmentChanges,
  generateAcceptString,
  getAcceptedFileTypesDisplay,
  getMimeTypeDisplayName,
  isFileTypeAllowed,
  isValidUrl,
  resolveFileMimeType,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, finalize, from, map, mergeMap, of, switchMap, take, toArray } from 'rxjs';

/**
 * Manage Materials for a past meeting record, opened over the meeting details drawer.
 * @description Ports the past mode of the legacy materials drawer: files are staged and uploaded on Save after the staged
 * deletions, while a link is created at once. Every saved change is reported through `onChanged`.
 */
@Component({
  selector: 'lfx-meeting-materials-drawer',
  imports: [NgTemplateOutlet, UiButtonComponent, UiDrawerComponent, UiInputComponent, UiSpinnerComponent],
  templateUrl: './meeting-materials-drawer.component.html',
})
export class MeetingMaterialsDrawerComponent {
  private readonly data = inject<MeetingMaterialsDrawerData>(DIALOG_DATA);
  private readonly dialogRef = inject(DialogRef);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly acceptString = generateAcceptString();
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dragging = signal(false);
  protected readonly existingAttachments = signal<PastMeetingAttachment[]>([]);
  protected readonly pendingAttachments = signal<PendingAttachment[]>([]);
  protected readonly pendingDeletions = signal<ReadonlySet<string>>(new Set());
  protected readonly newLinkTitle = signal('');
  protected readonly newLinkUrl = signal('');

  private readonly existingRows: Signal<MeetingMaterialRow[]> = computed(() =>
    this.existingAttachments().map((attachment) => ({ attachment, deleting: this.pendingDeletions().has(attachment.uid) }))
  );
  protected readonly fileRows: Signal<MeetingMaterialRow[]> = computed(() => this.existingRows().filter((row) => row.attachment.type === 'file'));
  protected readonly linkRows: Signal<MeetingMaterialRow[]> = computed(() => this.existingRows().filter((row) => row.attachment.type === 'link'));
  protected readonly hasPendingChanges: Signal<boolean> = computed(() => this.pendingAttachments().length > 0 || this.pendingDeletions().size > 0);
  // The agenda tab only opens valid web addresses, so nothing else is saved.
  protected readonly canAddLink: Signal<boolean> = computed(() => !!this.newLinkTitle().trim() && isValidUrl(this.newLinkUrl().trim()) && !this.saving());

  public constructor() {
    this.meetingService
      .getPastMeetingAttachments(this.data.pastMeetingId)
      .pipe(
        take(1),
        catchError((error: unknown) => {
          console.error('Failed to load past meeting attachments:', error);
          return of([] as PastMeetingAttachment[]);
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((attachments) => this.existingAttachments.set(applyPastMeetingAttachmentChanges(attachments, this.data.pastChanges)));
  }

  protected onFilesPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
    // Lets the same file be picked again after it is removed.
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.saving()) return;
    this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected removePendingAttachment(id: string): void {
    this.pendingAttachments.update((current) => current.filter((attachment) => attachment.id !== id));
  }

  protected markForDeletion(uid: string): void {
    this.pendingDeletions.update((current) => new Set(current).add(uid));
  }

  protected undoDelete(uid: string): void {
    this.pendingDeletions.update((current) => {
      const next = new Set(current);
      next.delete(uid);
      return next;
    });
  }

  protected addLink(): void {
    const title = this.newLinkTitle().trim();
    const url = this.newLinkUrl().trim();
    if (!title || !isValidUrl(url)) return;

    this.saving.set(true);
    this.meetingService
      .createPastMeetingAttachment(this.data.pastMeetingId, { type: 'link', category: 'Other', name: title, link: url })
      // Not tied to the drawer's lifetime: a close mid-request must still report what saved.
      .pipe(take(1))
      .subscribe({
        next: (attachment) => {
          this.existingAttachments.update((current) => [...current, attachment]);
          this.newLinkTitle.set('');
          this.newLinkUrl.set('');
          this.saving.set(false);
          this.toast.show({ variant: 'success', position: 'bottom-center', message: 'Link added' });
          this.data.onChanged({ deletedUids: [], addedAttachments: [attachment] });
        },
        error: () => {
          this.saving.set(false);
          this.showError('Failed to add link. Please try again.');
        },
      });
  }

  protected save(): void {
    const id = this.data.pastMeetingId;
    const deletions = Array.from(this.pendingDeletions());
    const uploads = this.pendingAttachments();
    this.saving.set(true);

    // Deletions first, then uploads, each in parallel; a failure of one item never stops the rest.
    const delete$ = deletions.length
      ? from(deletions).pipe(
          mergeMap((uid) =>
            this.meetingService.deletePastMeetingAttachment(id, uid).pipe(
              map(() => ({ uid, ok: true })),
              catchError((error: unknown) => {
                console.error('Failed to delete past meeting attachment:', uid, error);
                return of({ uid, ok: false });
              })
            )
          ),
          toArray()
        )
      : of([] as { uid: string; ok: boolean }[]);

    delete$
      .pipe(
        switchMap((deleteResults) => {
          if (!uploads.length) return of({ deleteResults, uploadResults: [] as MeetingAttachmentUploadResult[] });
          return from(uploads).pipe(
            mergeMap((attachment) =>
              this.meetingService
                .uploadPastMeetingFile(id, attachment.file, { name: attachment.fileName, file_size: attachment.fileSize, file_type: attachment.mimeType })
                .pipe(
                  map((result): MeetingAttachmentUploadResult => ({ id: attachment.id, result })),
                  catchError((error: unknown) => {
                    console.error('Failed to upload past meeting attachment:', attachment.fileName, error);
                    return of<MeetingAttachmentUploadResult>({ id: attachment.id, result: null });
                  })
                )
            ),
            toArray(),
            map((uploadResults) => ({ deleteResults, uploadResults }))
          );
        }),
        // Not tied to the drawer's lifetime: a close mid-save must still report what saved.
        take(1)
      )
      .subscribe({
        next: ({ deleteResults, uploadResults }) => {
          this.saving.set(false);
          const deletedUids = deleteResults.filter((result) => result.ok).map((result) => result.uid);
          const uploaded = uploadResults.filter((result): result is MeetingAttachmentUploadResult & { result: PresignAttachmentResponse } => !!result.result);
          const addedAttachments = uploaded.map((result) => this.toPastAttachment(result.result));
          this.clearSaved(
            uploaded.map((result) => result.id),
            deletedUids,
            addedAttachments
          );
          this.data.onChanged({ deletedUids, addedAttachments });

          // A retry resends only what failed, since what saved has left the staged lists.
          if (deleteResults.some((result) => !result.ok) || uploadResults.some((result) => !result.result)) {
            this.toast.show({
              variant: 'warning',
              position: 'bottom-center',
              message: 'Partial Update',
              description: 'Some changes could not be saved. Please try again.',
            });
            return;
          }
          this.toast.show({ variant: 'success', position: 'bottom-center', message: 'Materials saved' });
          this.dialogRef.close();
        },
        error: () => {
          this.saving.set(false);
          this.showError('Failed to save materials. Please try again.');
        },
      });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private addFiles(files: File[]): void {
    const accepted: PendingAttachment[] = [];
    for (const file of files) {
      const error = this.validateFile(file, accepted);
      if (error) {
        this.toast.show({ variant: 'error', position: 'bottom-center', message: 'File Upload Error', description: error });
        continue;
      }
      // A blank browser type is filled from the extension, which the upload requires.
      const mimeType = resolveFileMimeType(file.type, file.name);
      accepted.push({ id: crypto.randomUUID(), fileName: file.name, file, fileSize: file.size, mimeType, uploading: false, uploaded: false });
    }
    if (accepted.length) this.pendingAttachments.update((current) => [...current, ...accepted]);
  }

  /** The legacy drawer's checks and copy, in its order. */
  private validateFile(file: File, accepted: PendingAttachment[]): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`;
    }
    if (!isFileTypeAllowed(file.type, file.name, ALLOWED_FILE_TYPES)) {
      return `File type "${getMimeTypeDisplayName(file.type, file.name)}" is not supported. Allowed types: ${getAcceptedFileTypesDisplay()}.`;
    }
    if ([...this.pendingAttachments(), ...accepted].some((attachment) => attachment.fileName === file.name && !attachment.uploadError)) {
      return `A file named "${file.name}" has already been selected for upload.`;
    }
    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `Invalid filename "${file.name}". Filename cannot contain path traversal characters or start with a dot.`;
    }
    return null;
  }

  private clearSaved(uploadedIds: string[], deletedUids: string[], added: PastMeetingAttachment[]): void {
    const uploaded = new Set(uploadedIds);
    const deleted = new Set(deletedUids);
    this.pendingAttachments.update((current) => current.filter((attachment) => !uploaded.has(attachment.id)));
    this.pendingDeletions.update((current) => new Set([...current].filter((uid) => !deleted.has(uid))));
    this.existingAttachments.update((current) => [...current.filter((attachment) => !deleted.has(attachment.uid)), ...added]);
  }

  private toPastAttachment(upload: PresignAttachmentResponse): PastMeetingAttachment {
    return {
      uid: upload.uid,
      meeting_and_occurrence_id: this.data.pastMeetingId,
      meeting_id: upload.meeting_id ?? '',
      type: upload.type,
      name: upload.name,
      category: upload.category,
      file_name: upload.file_name,
      file_size: upload.file_size,
      file_upload_status: upload.file_upload_status,
      file_content_type: upload.file_content_type,
      created_at: upload.created_at,
      created_by: upload.created_by,
    };
  }

  private showError(description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Error', description });
  }
}
