// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import { MeetingAttachment, PendingAttachment } from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, from, mergeMap, of, skip, switchMap, take, tap, toArray } from 'rxjs';

@Component({
  selector: 'lfx-meeting-materials-drawer',
  imports: [DrawerModule, FileUploadComponent, ButtonComponent],
  templateUrl: './meeting-materials-drawer.component.html',
  styleUrl: './meeting-materials-drawer.component.scss',
})
export class MeetingMaterialsDrawerComponent {
  // === Services ===
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly meetingId = input.required<string>();
  public visible = model<boolean>(false);
  public readonly materialsChanged = output<void>();

  // === Constants ===
  public readonly acceptString = generateAcceptString();
  public readonly MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

  // === Writable Signals ===
  public loading = signal(false);
  public saving = signal(false);
  public existingAttachments = signal<MeetingAttachment[]>([]);
  public pendingAttachments = signal<PendingAttachment[]>([]);
  public pendingDeletions = signal<Set<string>>(new Set());
  public newLinkTitle = signal('');
  public newLinkUrl = signal('');

  // === Computed Signals ===
  public readonly fileAttachments = computed(() => this.existingAttachments().filter((a) => a.type === 'file'));
  public readonly linkAttachments = computed(() => this.existingAttachments().filter((a) => a.type === 'link'));

  // Lazy load attachments when drawer opens
  private readonly attachments$ = toObservable(this.visible).pipe(
    skip(1),
    switchMap((isVisible) => {
      if (!isVisible) {
        return of([]);
      }
      this.loading.set(true);
      return this.meetingService.getMeetingAttachments(this.meetingId()).pipe(
        tap(() => this.loading.set(false)),
        catchError(() => {
          this.loading.set(false);
          return of([] as MeetingAttachment[]);
        })
      );
    }),
    tap((attachments) => {
      this.existingAttachments.set(attachments);
      this.pendingAttachments.set([]);
      this.pendingDeletions.set(new Set());
      this.newLinkTitle.set('');
      this.newLinkUrl.set('');
    })
  );

  public constructor() {
    this.attachments$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  // === Public Methods ===
  public onFileSelect(event: any): void {
    let files: File[] = [];
    if (event.files && Array.isArray(event.files)) {
      files = event.files;
    } else if (event.currentFiles && Array.isArray(event.currentFiles)) {
      files = event.currentFiles;
    } else {
      return;
    }

    if (!files || files.length === 0) return;

    const newAttachments = Array.from(files)
      .map((file) => {
        const validationError = this.validateFile(file);
        if (validationError) {
          this.messageService.add({
            severity: 'error',
            summary: 'File Upload Error',
            detail: validationError,
            life: 5000,
          });
          return null;
        }

        const pendingAttachment: PendingAttachment = {
          id: crypto.randomUUID(),
          fileName: file.name,
          file: file,
          fileSize: file.size,
          mimeType: file.type,
          uploading: false,
          uploaded: false,
        };

        return pendingAttachment;
      })
      .filter(Boolean) as PendingAttachment[];

    this.pendingAttachments.update((current) => [...current, ...newAttachments]);
  }

  public removePendingAttachment(id: string): void {
    this.pendingAttachments.update((current) => current.filter((f) => f.id !== id));
  }

  public markForDeletion(uid: string): void {
    this.pendingDeletions.update((current) => {
      const next = new Set(current);
      next.add(uid);
      return next;
    });
  }

  public undoDelete(uid: string): void {
    this.pendingDeletions.update((current) => {
      const next = new Set(current);
      next.delete(uid);
      return next;
    });
  }

  public addLink(): void {
    const title = this.newLinkTitle().trim();
    const url = this.newLinkUrl().trim();
    if (!title || !url) return;

    this.saving.set(true);
    this.meetingService
      .createMeetingAttachment(this.meetingId(), { type: 'link', category: 'Other', name: title, link: url })
      .pipe(take(1))
      .subscribe({
        next: (attachment) => {
          this.existingAttachments.update((current) => [...current, attachment]);
          this.newLinkTitle.set('');
          this.newLinkUrl.set('');
          this.saving.set(false);
          this.messageService.add({ severity: 'success', summary: 'Link Added', detail: `"${title}" has been added.` });
          this.materialsChanged.emit();
        },
        error: () => {
          this.saving.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to add link. Please try again.' });
        },
      });
  }

  public onSave(): void {
    this.saving.set(true);
    const meetingId = this.meetingId();
    const deletions = Array.from(this.pendingDeletions());
    const uploads = this.pendingAttachments().filter((a) => !a.uploading && !a.uploadError && !a.uploaded && a.file);

    // Delete first (parallel), then upload (parallel)
    const delete$ =
      deletions.length > 0
        ? from(deletions).pipe(
            mergeMap((uid) => this.meetingService.deleteMeetingAttachment(meetingId, uid).pipe(catchError(() => of(null)))),
            toArray()
          )
        : of([]);

    delete$
      .pipe(
        switchMap(() => {
          if (uploads.length === 0) return of([]);
          return from(uploads).pipe(
            mergeMap((attachment) =>
              this.meetingService
                .uploadMeetingFile(meetingId, attachment.file, {
                  name: attachment.fileName,
                  file_size: attachment.fileSize,
                  file_type: attachment.mimeType,
                })
                .pipe(catchError(() => of(null)))
            ),
            toArray()
          );
        }),
        take(1)
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.messageService.add({ severity: 'success', summary: 'Materials Updated', detail: 'Meeting materials have been saved.' });
          this.materialsChanged.emit();
          this.visible.set(false);
        },
        error: () => {
          this.saving.set(false);
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save materials. Please try again.' });
        },
      });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Helpers ===
  private validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`;
    }

    if (!isFileTypeAllowed(file.type, file.name, ALLOWED_FILE_TYPES)) {
      const fileTypeDisplay = getMimeTypeDisplayName(file.type, file.name);
      const allowedTypes = getAcceptedFileTypesDisplay();
      return `File type "${fileTypeDisplay}" is not supported. Allowed types: ${allowedTypes}.`;
    }

    const currentFiles = this.pendingAttachments();
    const isDuplicate = currentFiles.some((attachment) => attachment.fileName === file.name && !attachment.uploadError);

    if (isDuplicate) {
      return `A file named "${file.name}" has already been selected for upload.`;
    }

    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `Invalid filename "${file.name}". Filename cannot contain path traversal characters or start with a dot.`;
    }

    return null;
  }
}
