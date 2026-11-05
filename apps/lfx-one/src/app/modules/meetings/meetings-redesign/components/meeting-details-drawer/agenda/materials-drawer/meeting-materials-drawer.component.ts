// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } from '@lfx-one/shared/constants';
import {
  AttachmentScope,
  CreateLinkAttachmentRequest,
  MeetingAttachment,
  MeetingAttachmentScopeResult,
  MeetingAttachmentUploadResult,
  MeetingMaterialRow,
  MeetingMaterialsDrawerData,
  PastMeetingAttachment,
  PendingAttachment,
  PresignAttachmentResponse,
  UpdateMeetingAttachmentRequest,
} from '@lfx-one/shared/interfaces';
import {
  applyAttachmentScopeOverrides,
  applyMeetingAttachmentChanges,
  applyPastMeetingAttachmentChanges,
  filterAttachmentsForOccurrence,
  generateAcceptString,
  getAcceptedFileTypesDisplay,
  getAttachmentScope,
  getMimeTypeDisplayName,
  isFileTypeAllowed,
  isValidUrl,
  resolveFileMimeType,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChoiceboxGroupComponent } from '@shared/uikit/choicebox/choicebox-group.component';
import { UiChoiceboxComponent } from '@shared/uikit/choicebox/choicebox.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { catchError, finalize, from, map, mergeMap, Observable, of, switchMap, take, toArray } from 'rxjs';

/**
 * Manage Materials, opened over the meeting details drawer for an upcoming meeting or a past meeting record.
 * @description Ports the legacy materials drawer: files are staged and uploaded on Save after the staged deletions and
 * scope changes, while a link is created at once. On an upcoming recurring meeting each item applies to the managed
 * occurrence or to every date. Every saved change reaches the list behind the drawer at once.
 */
@Component({
  selector: 'lfx-meeting-materials-drawer',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    UiBadgeComponent,
    UiButtonComponent,
    UiChoiceboxComponent,
    UiChoiceboxGroupComponent,
    UiDrawerComponent,
    UiInputComponent,
    UiSpinnerComponent,
  ],
  templateUrl: './meeting-materials-drawer.component.html',
})
export class MeetingMaterialsDrawerComponent {
  private readonly dialogRef = inject(DialogRef);
  private readonly meetingService = inject(MeetingService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly data = inject<MeetingMaterialsDrawerData>(DIALOG_DATA);
  private readonly isPast = !!this.data.pastMeetingId;
  /** Scopes are shown on an upcoming meeting with a managed occurrence, and changeable while it can take one. */
  protected readonly showScopes = !this.isPast && !!this.data.occurrence?.occurrence_id;
  protected readonly canScope = this.showScopes && this.data.canScopeToOccurrence;

  protected readonly acceptString = generateAcceptString();
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dragging = signal(false);
  protected readonly existingAttachments = signal<(MeetingAttachment | PastMeetingAttachment)[]>([]);
  protected readonly pendingAttachments = signal<PendingAttachment[]>([]);
  protected readonly pendingDeletions = signal<ReadonlySet<string>>(new Set());
  /** Scope changes staged on existing attachments, only where they differ from the saved scope. */
  protected readonly pendingScopes = signal<ReadonlyMap<string, AttachmentScope>>(new Map());
  /** Scope of the files and links added now; the whole series unless "This occurrence" is picked. */
  protected readonly newItemScope = signal<AttachmentScope>('series');
  protected readonly newLinkTitle = signal('');
  protected readonly newLinkUrl = signal('');

  private readonly existingRows: Signal<MeetingMaterialRow[]> = this.initExistingRows();
  protected readonly fileRows: Signal<MeetingMaterialRow[]> = computed(() => this.existingRows().filter((row) => row.attachment.type === 'file'));
  protected readonly linkRows: Signal<MeetingMaterialRow[]> = computed(() => this.existingRows().filter((row) => row.attachment.type === 'link'));
  protected readonly hasPendingChanges: Signal<boolean> = computed(
    () => this.pendingAttachments().length > 0 || this.pendingDeletions().size > 0 || this.pendingScopes().size > 0
  );
  protected readonly newItemScopeText: Signal<string> = computed(() => (this.newItemScope() === 'occurrence' ? 'this occurrence only' : 'every occurrence'));
  // The agenda tab only opens valid web addresses, so nothing else is saved.
  protected readonly canAddLink: Signal<boolean> = computed(() => !!this.newLinkTitle().trim() && isValidUrl(this.newLinkUrl().trim()) && !this.saving());
  private readonly newItemOccurrence: Signal<Pick<CreateLinkAttachmentRequest, 'occurrence_id'>> = computed(() => {
    const occurrenceId = this.data.occurrence?.occurrence_id;
    return this.canScope && this.newItemScope() === 'occurrence' && occurrenceId ? { occurrence_id: occurrenceId } : {};
  });

  public constructor() {
    this.loadAttachments()
      .pipe(
        take(1),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((attachments) => this.existingAttachments.set(attachments));
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

  protected setNewItemScope(scope: string | null): void {
    if (scope === 'occurrence' || scope === 'series') this.newItemScope.set(scope);
  }

  /** Stages flipping an item between this occurrence and every date; flipping back clears the staged change. */
  protected toggleScope(row: MeetingMaterialRow): void {
    // A save has already read the staged changes, so one made now would be lost.
    if (this.saving()) return;
    const saved = getAttachmentScope(row.attachment as MeetingAttachment);
    const next: AttachmentScope = row.scope === 'series' ? 'occurrence' : 'series';
    this.pendingScopes.update((current) => {
      const updated = new Map(current);
      if (next === saved) updated.delete(row.attachment.uid);
      else updated.set(row.attachment.uid, next);
      return updated;
    });
  }

  protected addLink(): void {
    const title = this.newLinkTitle().trim();
    const url = this.newLinkUrl().trim();
    const id = this.resourceId();
    if (!title || !isValidUrl(url) || !id) return;

    this.saving.set(true);
    const scope = this.newItemOccurrence();
    const create$: Observable<MeetingAttachment | PastMeetingAttachment> = this.isPast
      ? this.meetingService.createPastMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url })
      : this.meetingService.createMeetingAttachment(id, { type: 'link', category: 'Other', name: title, link: url, ...scope });

    // Not tied to the drawer's lifetime: a close mid-request must still report what saved.
    create$.pipe(take(1)).subscribe({
      next: (attachment) => {
        this.existingAttachments.update((current) => [...current, { ...attachment, ...scope }]);
        this.newLinkTitle.set('');
        this.newLinkUrl.set('');
        this.saving.set(false);
        this.toast.show({ variant: 'success', position: 'bottom-center', message: 'Link added' });
        if (this.isPast) {
          this.data.onChanged?.({ deletedUids: [], addedAttachments: [attachment as PastMeetingAttachment] });
          return;
        }
        // Every list showing this meeting has the link now, before the query service indexes it.
        this.meetingService.recordAttachmentChanges(id, { added: [{ ...(attachment as MeetingAttachment), ...scope }] });
      },
      error: () => {
        this.saving.set(false);
        this.showError('Failed to add link. Please try again.');
      },
    });
  }

  protected save(): void {
    const id = this.resourceId();
    if (!id) return;
    const deletions = Array.from(this.pendingDeletions());
    const uploads = this.pendingAttachments();
    // Scope changes on items being deleted are moot, and one lifted from the description cannot be scoped.
    const scopeChanges = this.canScope
      ? Array.from(this.pendingScopes()).filter(
          ([uid]) => !this.pendingDeletions().has(uid) && (this.findExisting(uid) as MeetingAttachment | undefined)?.source !== 'description'
        )
      : [];
    this.saving.set(true);

    // Deletions, then scope changes, then uploads, each in parallel; a failure of one item never stops the rest.
    const delete$ = deletions.length
      ? from(deletions).pipe(
          mergeMap((uid) =>
            this.deleteAttachment(id, uid).pipe(
              map(() => ({ uid, ok: true })),
              catchError((error: unknown) => {
                console.error('Failed to delete meeting attachment:', uid, error);
                return of({ uid, ok: false });
              })
            )
          ),
          toArray()
        )
      : of([] as { uid: string; ok: boolean }[]);
    const scope$ = scopeChanges.length
      ? from(scopeChanges).pipe(
          mergeMap(([uid, scope]) => this.updateAttachmentScope(id, uid, scope)),
          toArray()
        )
      : of([] as MeetingAttachmentScopeResult[]);

    delete$
      .pipe(
        switchMap((deleteResults) => scope$.pipe(map((scopeResults) => ({ deleteResults, scopeResults })))),
        switchMap(({ deleteResults, scopeResults }) => {
          if (!uploads.length) return of({ deleteResults, scopeResults, uploadResults: [] as MeetingAttachmentUploadResult[] });
          return from(uploads).pipe(
            mergeMap((attachment) =>
              this.uploadFile(id, attachment).pipe(
                map((result): MeetingAttachmentUploadResult => ({ id: attachment.id, result })),
                catchError((error: unknown) => {
                  console.error('Failed to upload meeting attachment:', attachment.fileName, error);
                  return of<MeetingAttachmentUploadResult>({ id: attachment.id, result: null });
                })
              )
            ),
            toArray(),
            map((uploadResults) => ({ deleteResults, scopeResults, uploadResults }))
          );
        }),
        // Not tied to the drawer's lifetime: a close mid-save must still report what saved.
        take(1)
      )
      .subscribe({
        next: ({ deleteResults, scopeResults, uploadResults }) => {
          this.saving.set(false);
          const deletedUids = deleteResults.filter((result) => result.ok).map((result) => result.uid);
          this.applySavedScopes(scopeResults.filter((result) => result.ok));
          const uploaded = uploadResults.filter((result): result is MeetingAttachmentUploadResult & { result: PresignAttachmentResponse } => !!result.result);
          // Built before the staged files are cleared: the scope a file was queued with lives only on its staged entry.
          const added = uploaded.map((result) => this.toAttachment(result.result, this.findPending(result.id)?.occurrence_id));
          this.clearSaved(
            uploaded.map((result) => result.id),
            deletedUids,
            added
          );
          if (this.isPast) {
            this.data.onChanged?.({ deletedUids, addedAttachments: added as PastMeetingAttachment[] });
          } else {
            // Deletions are recorded by the service itself.
            this.meetingService.recordAttachmentChanges(id, { added: added as MeetingAttachment[] });
          }

          // A retry resends only what failed, since what saved has left the staged lists.
          const failed =
            deleteResults.some((result) => !result.ok) || scopeResults.some((result) => !result.ok) || uploadResults.some((result) => !result.result);
          if (failed) {
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

  private initExistingRows(): Signal<MeetingMaterialRow[]> {
    return computed(() => {
      const deleting = this.pendingDeletions();
      const scopes = this.pendingScopes();
      return this.existingAttachments().map((attachment) => {
        const scoped = attachment as MeetingAttachment;
        return {
          attachment,
          deleting: deleting.has(attachment.uid),
          scope: scopes.get(attachment.uid) ?? getAttachmentScope(scoped),
          scopeUnsaved: scopes.has(attachment.uid),
          canToggleScope: this.canScope && scoped.source !== 'description',
        };
      });
    });
  }

  private loadAttachments(): Observable<(MeetingAttachment | PastMeetingAttachment)[]> {
    if (this.data.pastMeetingId) {
      return this.meetingService.getPastMeetingAttachments(this.data.pastMeetingId).pipe(
        map((attachments) => applyPastMeetingAttachmentChanges(attachments, this.data.pastChanges)),
        catchError((error: unknown) => {
          console.error('Failed to load past meeting attachments:', error);
          return of([] as PastMeetingAttachment[]);
        })
      );
    }
    const meetingId = this.data.meetingId ?? '';
    // A read can lag a scope change saved this session, so this session's changes are overlaid.
    return this.meetingService
      .getMeetingAttachments(meetingId)
      .pipe(
        map((attachments) =>
          filterAttachmentsForOccurrence(
            applyAttachmentScopeOverrides(
              applyMeetingAttachmentChanges(attachments, this.meetingService.attachmentChanges().get(meetingId)),
              this.meetingService.attachmentScopeOverrides()
            ),
            this.data.occurrence?.occurrence_id
          )
        )
      );
  }

  private resourceId(): string | undefined {
    return this.data.pastMeetingId ?? this.data.meetingId;
  }

  private deleteAttachment(id: string, uid: string): Observable<void> {
    return this.isPast ? this.meetingService.deletePastMeetingAttachment(id, uid) : this.meetingService.deleteMeetingAttachment(id, uid);
  }

  private uploadFile(id: string, attachment: PendingAttachment): Observable<PresignAttachmentResponse> {
    const request = { name: attachment.fileName, file_size: attachment.fileSize, file_type: attachment.mimeType };
    if (this.isPast) return this.meetingService.uploadPastMeetingFile(id, attachment.file, request);
    // The scope the file was queued with, not whatever the picker says now.
    return this.meetingService.uploadMeetingFile(id, attachment.file, {
      ...request,
      ...(attachment.occurrence_id && { occurrence_id: attachment.occurrence_id }),
    });
  }

  /** The update replaces the attachment, so it carries the existing fields and only `occurrence_id` differs. */
  private updateAttachmentScope(meetingId: string, uid: string, scope: AttachmentScope): Observable<MeetingAttachmentScopeResult> {
    const attachment = this.findExisting(uid) as MeetingAttachment | undefined;
    const occurrenceId = this.data.occurrence?.occurrence_id;
    if (!attachment || (scope === 'occurrence' && !occurrenceId)) return of({ uid, ok: false, scope });

    const body: UpdateMeetingAttachmentRequest = {
      type: attachment.type,
      // An uncategorised attachment is indexed as "", which the update rejects.
      category: attachment.category || 'Other',
      name: attachment.name,
      ...(attachment.description && { description: attachment.description }),
      ...(attachment.type === 'link' && attachment.link && { link: attachment.link }),
      ...(scope === 'occurrence' && occurrenceId && { occurrence_id: occurrenceId }),
    };
    return this.meetingService.updateMeetingAttachment(meetingId, uid, body).pipe(
      map(() => ({ uid, ok: true, scope })),
      catchError((error: unknown) => {
        console.error('Failed to update attachment scope:', uid, error);
        return of({ uid, ok: false, scope });
      })
    );
  }

  /** Shows saved scope changes now, everywhere this meeting's materials are listed, and drops them from the staged set. */
  private applySavedScopes(saved: { uid: string; scope: AttachmentScope }[]): void {
    if (!saved.length || this.isPast) return;
    const occurrenceId = this.data.occurrence?.occurrence_id;
    const scopeByUid = new Map(saved.map((result) => [result.uid, result.scope]));
    this.meetingService.recordAttachmentScopeChanges(
      saved.map((result) => ({ uid: result.uid, occurrence_id: result.scope === 'occurrence' ? occurrenceId : undefined }))
    );
    this.existingAttachments.update((current) =>
      current.map((attachment) => {
        const scope = scopeByUid.get(attachment.uid);
        return scope ? { ...attachment, occurrence_id: scope === 'occurrence' ? occurrenceId : undefined } : attachment;
      })
    );
    this.pendingScopes.update((current) => new Map([...current].filter(([uid]) => !scopeByUid.has(uid))));
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
      accepted.push({
        id: crypto.randomUUID(),
        fileName: file.name,
        file,
        fileSize: file.size,
        mimeType: resolveFileMimeType(file.type, file.name),
        uploading: false,
        uploaded: false,
        ...this.newItemOccurrence(),
      });
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

  private clearSaved(uploadedIds: string[], deletedUids: string[], added: (MeetingAttachment | PastMeetingAttachment)[]): void {
    const uploaded = new Set(uploadedIds);
    const deleted = new Set(deletedUids);
    this.pendingAttachments.update((current) => current.filter((attachment) => !uploaded.has(attachment.id)));
    this.pendingDeletions.update((current) => new Set([...current].filter((uid) => !deleted.has(uid))));
    // A staged scope change on a deleted item would otherwise be retried against a record that no longer exists.
    this.pendingScopes.update((current) => new Map([...current].filter(([uid]) => !deleted.has(uid))));
    this.existingAttachments.update((current) => [...current.filter((attachment) => !deleted.has(attachment.uid)), ...added]);
  }

  /** A saved upload as an attachment; the write response can omit `occurrence_id`, so the queued scope wins. */
  private toAttachment(upload: PresignAttachmentResponse, occurrenceId?: string): MeetingAttachment | PastMeetingAttachment {
    const base = {
      uid: upload.uid,
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
    if (this.data.pastMeetingId) {
      return { ...base, meeting_and_occurrence_id: this.data.pastMeetingId, meeting_id: upload.meeting_id ?? '' };
    }
    return { ...base, meeting_id: upload.meeting_id ?? this.data.meetingId ?? '', occurrence_id: occurrenceId ?? upload.occurrence_id };
  }

  private findExisting(uid: string): MeetingAttachment | PastMeetingAttachment | undefined {
    return this.existingAttachments().find((attachment) => attachment.uid === uid);
  }

  private findPending(id: string): PendingAttachment | undefined {
    return this.pendingAttachments().find((attachment) => attachment.id === id);
  }

  private showError(description: string): void {
    this.toast.show({ variant: 'error', position: 'bottom-center', message: 'Error', description });
  }
}
