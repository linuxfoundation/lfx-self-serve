// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import { MaterialsChangedEvent, MeetingAttachment, PastMeetingAttachment, PendingAttachment, PresignAttachmentResponse } from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, from, map, mergeMap, of, skip, switchMap, take, tap, toArray } from 'rxjs';

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

  /** ID of a scheduled meeting. Leave undefined when using pastMeetingId for past-meeting mode. */
  public readonly meetingId = input<string>();
  /** Composite meeting_and_occurrence_id of a past meeting. When set, all API calls target the past meeting attachments endpoint. */
  public readonly pastMeetingId = input<string>();
  public visible = model<boolean>(false);
  /** Emits deleted UIDs and newly created attachments so callers can apply optimistic UI updates without waiting for NATS propagation to the query service. */
  public readonly materialsChanged = output<MaterialsChangedEvent>();

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
  private readonly isPastMode = computed(() => !!this.pastMeetingId());

  // Lazy load attachments when drawer opens
  private readonly attachments$ = toObservable(this.visible).pipe(
    skip(1),
    switchMap((isVisible) => {
      if (!isVisible) {
        return of([]);
      }
      this.loading.set(true);
      const id = this.isPastMode() ? this.pastMeetingId() : this.meetingId();
      if (!id) {
        this.loading.set(false);
        return of([] as MeetingAttachment[]);
      }
      const load$ = this.isPastMode()
        ? this.meetingService.getPastMeetingAttachments(id).pipe(
            tap(() => this.loading.set(false)),
            catchError(() => {
              this.loading.set(false);
              return of([] as MeetingAttachment[]);
            })
          )
        : this.meetingService.getMeetingAttachments(id).pipe(
            tap(() => this.loading.set(false)),
            catchError(() => {
              this.loading.set(false);
              return of([] as MeetingAttachment[]);
            })
          );
      return load$;
    }),
    tap((attachments) => {
      this.existingAttachments.set(attachments as MeetingAttachment[]);
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
    const isPast = this.isPastMode();
    const id = isPast ? this.pastMeetingId() : this.meetingId();
    if (!id) {
      this.saving.set(false);
      return;
    }
    const create$ = isPast
      ? this.meetingService.createPastMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url })
      : this.meetingService.createMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url });

    create$.pipe(take(1)).subscribe({
      next: (attachment) => {
        this.existingAttachments.update((current) => [...current, attachment as MeetingAttachment]);
        this.newLinkTitle.set('');
        this.newLinkUrl.set('');
        this.saving.set(false);
        this.messageService.add({ severity: 'success', summary: 'Link Added', detail: `"${title}" has been added.` });
        const addedAttachments: PastMeetingAttachment[] = isPast ? [attachment as PastMeetingAttachment] : [];
        this.materialsChanged.emit({ deletedUids: [], addedAttachments });
      },
      error: () => {
        this.saving.set(false);
        this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to add link. Please try again.' });
      },
    });
  }

  public onSave(): void {
    this.saving.set(true);
    const isPast = this.isPastMode();
    const id = isPast ? this.pastMeetingId() : this.meetingId();
    if (!id) {
      this.saving.set(false);
      return;
    }
    const deletions = Array.from(this.pendingDeletions());
    const uploads = this.pendingAttachments().filter((a) => !a.uploading && !a.uploadError && !a.uploaded && a.file);

    // Delete first (parallel), then upload (parallel).
    // Each delete returns {uid, ok} so we can identify which succeeded
    // and emit them for optimistic removal on the parent, independent of
    // NATS propagation delay to the query service.
    const delete$ =
      deletions.length > 0
        ? from(deletions).pipe(
            mergeMap((uid) =>
              (isPast ? this.meetingService.deletePastMeetingAttachment(id, uid) : this.meetingService.deleteMeetingAttachment(id, uid)).pipe(
                map(() => ({ uid, ok: true as const })),
                catchError(() => of({ uid, ok: false as const }))
              )
            ),
            toArray()
          )
        : of([] as { uid: string; ok: boolean }[]);

    delete$
      .pipe(
        switchMap((deleteResults) => {
          if (uploads.length === 0) return of({ deleteResults, uploadResults: [] as (object | null)[] });
          return from(uploads).pipe(
            mergeMap((attachment) =>
              (isPast
                ? this.meetingService.uploadPastMeetingFile(id, attachment.file, {
                    name: attachment.fileName,
                    file_size: attachment.fileSize,
                    file_type: attachment.mimeType,
                  })
                : this.meetingService.uploadMeetingFile(id, attachment.file, {
                    name: attachment.fileName,
                    file_size: attachment.fileSize,
                    file_type: attachment.mimeType,
                  })
              ).pipe(catchError(() => of(null)))
            ),
            toArray(),
            map((uploadResults) => ({ deleteResults, uploadResults }))
          );
        }),
        take(1)
      )
      .subscribe({
        next: ({ deleteResults, uploadResults }) => {
          this.saving.set(false);
          const successfullyDeletedUids = deleteResults.filter((r) => r.ok).map((r) => r.uid);
          const hasPartialFailure = deleteResults.some((r) => !r.ok) || uploadResults.some((r) => r === null);
          const addedAttachments: PastMeetingAttachment[] = isPast
            ? uploadResults
                .filter((r): r is PresignAttachmentResponse => r !== null)
                .map((r) => ({
                  uid: r.uid,
                  meeting_and_occurrence_id: id!,
                  meeting_id: r.meeting_id ?? '',
                  type: r.type,
                  name: r.name,
                  category: r.category,
                  file_name: r.file_name,
                  file_size: r.file_size,
                  file_upload_status: r.file_upload_status,
                  file_content_type: r.file_content_type,
                  created_at: r.created_at,
                  created_by: r.created_by,
                }))
            : [];
          this.materialsChanged.emit({ deletedUids: successfullyDeletedUids, addedAttachments });
          if (hasPartialFailure) {
            this.messageService.add({ severity: 'warn', summary: 'Partial Update', detail: 'Some changes could not be saved. Please try again.' });
          } else {
            this.messageService.add({ severity: 'success', summary: 'Materials Updated', detail: 'Meeting materials have been saved.' });
            this.visible.set(false);
          }
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
