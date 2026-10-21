// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, model, output, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import {
  AttachmentScope,
  MaterialsChangedEvent,
  MeetingAttachment,
  MeetingOccurrence,
  PastMeetingAttachment,
  PendingAttachment,
  PresignAttachmentResponse,
  UpdateMeetingAttachmentRequest,
} from '@lfx-one/shared/interfaces';
import {
  filterAttachmentsForOccurrence,
  generateAcceptString,
  getAcceptedFileTypesDisplay,
  getAttachmentScope,
  getMimeTypeDisplayName,
  isFileTypeAllowed,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, from, map, mergeMap, Observable, of, skip, switchMap, take, tap, toArray } from 'rxjs';

import { AttachmentScopeBadgeComponent } from '../attachment-scope-badge/attachment-scope-badge.component';

/** Outcome of one staged upload, keyed by the pending attachment's id; `result` is null when the upload failed. */
interface UploadResult {
  id: string;
  result: PresignAttachmentResponse | null;
}

@Component({
  selector: 'lfx-meeting-materials-drawer',
  imports: [DatePipe, DrawerModule, FileUploadComponent, ButtonComponent, AttachmentScopeBadgeComponent],
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
  /**
   * The occurrence being managed. Set by the parent for an upcoming recurring meeting, where each attachment is for
   * one occurrence or the whole series: it decides what is listed and shows the scope labels. Null otherwise.
   */
  public readonly occurrence = input<MeetingOccurrence | null>(null);
  /**
   * Whether attachments can be scoped to {@link occurrence} (upcoming and not cancelled). When false the labels
   * still show, but the picker and the per-item switch are withheld because the service would reject the scope.
   */
  public readonly canScopeToOccurrence = input<boolean>(false);
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
  /** Scope applied to the files and links added in this session. Defaults to the whole series, which is what an attachment was before scoping existed. */
  public newItemScope = signal<AttachmentScope>('series');
  /** Scope changes staged on existing attachments, keyed by uid; applied on save like deletions. Only holds entries that differ from the saved scope. */
  public pendingScopes = signal<Map<string, AttachmentScope>>(new Map());

  // === Computed Signals ===
  private readonly isPastMode = computed(() => !!this.pastMeetingId());
  /** True when attachments carry a scope worth showing: an upcoming recurring meeting with the managed occurrence known. */
  public readonly showScopes = computed(() => !this.isPastMode() && !!this.occurrence()?.occurrence_id);
  /**
   * Name shared by this drawer's two scope radios. Native radios group by name across the whole document and the
   * meetings list renders a drawer per card (several per recurring meeting), so it is unique per meeting and occurrence.
   */
  public readonly scopeRadioName = computed(() => `materials-scope-${this.meetingId() ?? ''}-${this.occurrence()?.occurrence_id ?? ''}`);
  /** True when this drawer can offer "this occurrence" vs "all occurrences". */
  public readonly canScope = computed(() => this.showScopes() && this.canScopeToOccurrence());
  /**
   * What is listed for management: series-wide attachments plus the ones for the managed occurrence.
   * Attachments scoped to other dates are not this occurrence's to manage, so they stay out of view.
   */
  private readonly listedAttachments = computed(() =>
    this.isPastMode() ? this.existingAttachments() : filterAttachmentsForOccurrence(this.existingAttachments(), this.occurrence()?.occurrence_id)
  );
  public readonly fileAttachments = computed(() => this.listedAttachments().filter((a) => a.type === 'file'));
  public readonly linkAttachments = computed(() => this.listedAttachments().filter((a) => a.type === 'link'));
  /** What each listed attachment's scope will be once staged changes are saved, keyed by uid. */
  public readonly effectiveScopes = computed(() => {
    const pending = this.pendingScopes();
    return new Map(this.listedAttachments().map((attachment) => [attachment.uid, pending.get(attachment.uid) ?? getAttachmentScope(attachment)] as const));
  });
  public readonly hasPendingChanges = computed(() => this.pendingAttachments().length > 0 || this.pendingDeletions().size > 0 || this.pendingScopes().size > 0);
  /** Occurrence fields for a new attachment: its scope when "this occurrence" is chosen, otherwise nothing so it applies to all. */
  private readonly newItemOccurrence = computed(() => {
    const occurrenceId = this.occurrence()?.occurrence_id;
    return this.canScope() && this.newItemScope() === 'occurrence' && occurrenceId ? { occurrence_id: occurrenceId } : {};
  });

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
      this.pendingScopes.set(new Map());
      this.newItemScope.set('series');
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
          ...this.newItemOccurrence(),
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

  public setNewItemScope(scope: AttachmentScope): void {
    this.newItemScope.set(scope);
  }

  /** The scope an existing attachment will have once staged changes are saved. */
  public effectiveScope(attachment: MeetingAttachment): AttachmentScope {
    return this.pendingScopes().get(attachment.uid) ?? getAttachmentScope(attachment);
  }

  /** Stages flipping an existing attachment between this occurrence and all occurrences; flipping back clears the staged change. */
  public toggleScope(attachment: MeetingAttachment): void {
    // A save has already read the staged changes, so one made now would be overwritten or never sent.
    if (this.saving()) return;
    const saved = getAttachmentScope(attachment);
    const next: AttachmentScope = this.effectiveScope(attachment) === 'series' ? 'occurrence' : 'series';
    this.pendingScopes.update((current) => {
      const updated = new Map(current);
      if (next === saved) {
        updated.delete(attachment.uid);
      } else {
        updated.set(attachment.uid, next);
      }
      return updated;
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
    const create$: Observable<MeetingAttachment | PastMeetingAttachment> = isPast
      ? this.meetingService.createPastMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url })
      : this.meetingService.createMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url, ...this.newItemOccurrence() });

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

    // Scope changes on attachments that are also being deleted are moot, and one created from the meeting
    // description cannot be scoped, so both are skipped.
    const scopeChanges = this.canScope()
      ? Array.from(this.pendingScopes()).filter(
          ([uid]) => !this.pendingDeletions().has(uid) && this.existingAttachments().find((a) => a.uid === uid)?.source !== 'description'
        )
      : [];
    const scope$ =
      scopeChanges.length > 0
        ? from(scopeChanges).pipe(
            mergeMap(([uid, scope]) => this.updateAttachmentScope(id, uid, scope)),
            toArray()
          )
        : of([] as { uid: string; ok: boolean; scope: AttachmentScope }[]);

    delete$
      .pipe(
        switchMap((deleteResults) => scope$.pipe(map((scopeResults) => ({ deleteResults, scopeResults })))),
        switchMap(({ deleteResults, scopeResults }) => {
          if (uploads.length === 0) return of({ deleteResults, scopeResults, uploadResults: [] as UploadResult[] });
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
                    // The scope the file was queued with, not whatever the picker says now.
                    ...(attachment.occurrence_id && { occurrence_id: attachment.occurrence_id }),
                  })
              ).pipe(
                map((result): UploadResult => ({ id: attachment.id, result })),
                catchError(() => of<UploadResult>({ id: attachment.id, result: null }))
              )
            ),
            toArray(),
            map((uploadResults) => ({ deleteResults, scopeResults, uploadResults }))
          );
        }),
        take(1)
      )
      .subscribe({
        next: ({ deleteResults, scopeResults, uploadResults }) => {
          this.saving.set(false);
          const successfullyDeletedUids = deleteResults.filter((r) => r.ok).map((r) => r.uid);
          this.applySavedScopes(scopeResults.filter((r) => r.ok));
          this.clearSavedUploadsAndDeletions(uploadResults, successfullyDeletedUids, isPast ? undefined : id);
          const hasPartialFailure = deleteResults.some((r) => !r.ok) || scopeResults.some((r) => !r.ok) || uploadResults.some((r) => r.result === null);
          const addedAttachments: PastMeetingAttachment[] = isPast
            ? uploadResults
                .map((r) => r.result)
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
  /**
   * Saves a staged scope change. The update replaces the attachment, so the body carries its existing fields
   * and only `occurrence_id` differs: set to scope it to the managed occurrence, omitted to apply to all.
   */
  private updateAttachmentScope(meetingId: string, uid: string, scope: AttachmentScope): Observable<{ uid: string; ok: boolean; scope: AttachmentScope }> {
    const attachment = this.existingAttachments().find((a) => a.uid === uid);
    const occurrenceId = this.occurrence()?.occurrence_id;
    if (!attachment || (scope === 'occurrence' && !occurrenceId)) {
      return of({ uid, ok: false, scope });
    }

    const body: UpdateMeetingAttachmentRequest = {
      type: attachment.type,
      // The index stores an uncategorised attachment as "", which the update rejects, so fall back on empty as well as missing.
      category: attachment.category || 'Other',
      name: attachment.name,
      ...(attachment.description && { description: attachment.description }),
      ...(attachment.type === 'link' && attachment.link && { link: attachment.link }),
      ...(scope === 'occurrence' && occurrenceId && { occurrence_id: occurrenceId }),
    };

    return this.meetingService.updateMeetingAttachment(meetingId, uid, body).pipe(
      map(() => ({ uid, ok: true, scope })),
      catchError((error: unknown) => {
        console.error('Failed to update attachment scope', { uid, error });
        return of({ uid, ok: false, scope });
      })
    );
  }

  /**
   * Drops what a save already did from the staged state, so a retry after a partial failure resends only what failed:
   * an upload that went through would otherwise be uploaded again as a duplicate, and a delete that went through
   * would be refused as not found on every retry.
   */
  private clearSavedUploadsAndDeletions(uploadResults: UploadResult[], deletedUids: string[], meetingId?: string): void {
    const uploaded = uploadResults.filter((r): r is UploadResult & { result: PresignAttachmentResponse } => r.result !== null);
    if (uploaded.length > 0) {
      const uploadedIds = new Set(uploaded.map((r) => r.id));
      this.pendingAttachments.update((current) => current.filter((a) => !uploadedIds.has(a.id)));
      // A live meeting's drawer does not reload after a save, so list what saved or it would be in neither list until reopened.
      // (A past meeting's list is refreshed by its parent.)
      if (meetingId) {
        this.existingAttachments.update((current) => [...current, ...uploaded.map((r) => this.toMeetingAttachment(r.result, meetingId))]);
      }
    }
    if (deletedUids.length > 0) {
      this.existingAttachments.update((current) => current.filter((a) => !deletedUids.includes(a.uid)));
      this.pendingDeletions.update((current) => new Set([...current].filter((uid) => !deletedUids.includes(uid))));
      // A staged scope change on a deleted attachment would otherwise be retried against a record that no longer exists.
      this.pendingScopes.update((current) => new Map([...current].filter(([uid]) => !deletedUids.includes(uid))));
    }
  }

  private toMeetingAttachment(upload: PresignAttachmentResponse, meetingId: string): MeetingAttachment {
    return {
      uid: upload.uid,
      meeting_id: upload.meeting_id ?? meetingId,
      type: upload.type,
      name: upload.name,
      category: upload.category,
      file_name: upload.file_name,
      file_size: upload.file_size,
      file_upload_status: upload.file_upload_status,
      file_content_type: upload.file_content_type,
      created_at: upload.created_at,
      created_by: upload.created_by,
      occurrence_id: upload.occurrence_id,
    };
  }

  /** Reflects scope changes that saved, so the list shows them now and a retry after a partial failure does not resend them. */
  private applySavedScopes(saved: { uid: string; scope: AttachmentScope }[]): void {
    if (saved.length === 0) return;
    const occurrenceId = this.occurrence()?.occurrence_id;
    const scopeByUid = new Map(saved.map((r) => [r.uid, r.scope]));
    this.existingAttachments.update((current) =>
      current.map((a) => {
        const scope = scopeByUid.get(a.uid);
        if (!scope) return a;
        return { ...a, occurrence_id: scope === 'occurrence' ? occurrenceId : undefined };
      })
    );
    this.pendingScopes.update((current) => {
      const updated = new Map(current);
      saved.forEach((r) => updated.delete(r.uid));
      return updated;
    });
  }

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
