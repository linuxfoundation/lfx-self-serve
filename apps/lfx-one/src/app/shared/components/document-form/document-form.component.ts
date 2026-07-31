// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { ALLOWED_FILE_TYPES, DOCUMENT_UPLOAD_CONCURRENCY, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import {
  CreateCommitteeDocumentRequest,
  CreateCommitteeDocumentType,
  CreateProjectDocumentRequest,
  CreateProjectDocumentType,
  DocumentFormEntityType,
  DocumentFormMode,
  PendingDocumentFile,
} from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { catchError, from, map, mergeMap, Observable, of, tap, toArray } from 'rxjs';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-document-form',
  imports: [ReactiveFormsModule, ButtonComponent, FileUploadComponent, InputTextComponent, SelectComponent, TextareaComponent],
  templateUrl: './document-form.component.html',
  styleUrl: './document-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);

  // === Constants ===
  public readonly acceptString = generateAcceptString();
  public readonly MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;

  // === Writable Signals ===
  public submitting = signal<boolean>(false);
  /**
   * Each pending file carries its own `nameForm` directly (rather than a side Map keyed by id)
   * so the template can bind `item.nameForm` — a plain property read — instead of calling a
   * component method per change-detection pass (see `docs/reviews/frontend-checklist.md`'s "no
   * template functions" rule). `PendingDocumentFile` itself stays in `@lfx-one/shared`, which has
   * no Angular Forms dependency, so the FormGroup is only ever attached here, not on that type.
   */
  public pendingFiles = signal<(PendingDocumentFile & { nameForm: FormGroup })[]>([]);
  public fileError = signal<string | null>(null);
  /** Set once at least one file in this dialog session has uploaded successfully — drives the Cancel/Done label and close-on-cancel behavior. */
  public anyUploadSucceeded = signal<boolean>(false);

  // Config-based properties
  /** Resource type this dialog targets — drives service dispatch + uniqueness scope copy. */
  public readonly entityType: DocumentFormEntityType;
  /** UID of the committee or project the document belongs to. */
  public readonly entityId: string;
  /** Pre-set mode: 'link', 'folder', or 'file' — determines which form fields are shown */
  public readonly mode: DocumentFormMode;
  /** Available folders for the folder selector (links + files) */
  public readonly folderOptions: { label: string; value: string }[];
  /** Default parent folder UID — used to pre-select the folder when opening from inside a folder view */
  public readonly defaultParentUid: string | null;

  public form: FormGroup;

  // Derived signals
  public isLink: Signal<boolean> = this.initIsLink();
  public isFolder: Signal<boolean> = this.initIsFolder();
  public isFile: Signal<boolean> = this.initIsFile();
  public submitLabel: Signal<string> = this.initSubmitLabel();
  public cancelLabel: Signal<string> = this.initCancelLabel();
  public descriptionPlaceholder: Signal<string> = this.initDescriptionPlaceholder();

  public constructor() {
    // Backwards-compat: older callers pass `committeeId`. New callers pass `entityType` + `entityId`.
    const data = this.config.data ?? {};
    this.entityType = (data.entityType as DocumentFormEntityType) ?? 'committee';
    this.entityId = (data.entityId as string) ?? (data.committeeId as string);
    this.mode = data.mode || 'link';
    this.folderOptions = data.folders || [];
    this.defaultParentUid = data.defaultParentUid ?? null;

    this.form = this.createForm();
  }

  public onCancel(): void {
    this.dialogRef.close(this.anyUploadSucceeded() || undefined);
  }

  public onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();

    if (this.isFile()) {
      const itemsToUpload = this.pendingFiles().filter((item) => item.status === 'pending' || item.status === 'error');
      if (itemsToUpload.length === 0) {
        this.fileError.set('Please select at least one file to upload.');
        return;
      }
      if (itemsToUpload.some((item) => item.nameForm.invalid)) {
        itemsToUpload.forEach((item) => item.nameForm.markAllAsTouched());
        this.fileError.set('Every file needs a name before uploading.');
        return;
      }

      this.fileError.set(null);
      this.uploadPendingFiles(itemsToUpload, formValue.description || undefined, formValue.parent_uid || undefined);
      return;
    }

    this.submitting.set(true);

    const createType = this.mode as CreateCommitteeDocumentType & CreateProjectDocumentType;
    const createDataBase = {
      type: createType,
      name: formValue.name,
      ...(this.isLink() && { url: formValue.url }),
      description: formValue.description || undefined,
      ...(this.isLink() && formValue.parent_uid && { parent_uid: formValue.parent_uid }),
    };

    const create$: Observable<unknown> =
      this.entityType === 'project'
        ? this.projectService.createProjectDocument(this.entityId, createDataBase as CreateProjectDocumentRequest)
        : this.committeeService.createCommitteeDocument(this.entityId, createDataBase as CreateCommitteeDocumentRequest);

    create$.subscribe({
      next: () => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: this.isLink() ? 'Link added successfully' : 'Folder created successfully',
        });
        this.dialogRef.close(true);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: this.extractErrorMessage(err, `Failed to ${this.isLink() ? 'add link' : 'create folder'}`),
        });
      },
    });
  }

  public onFileSelect(event: any): void {
    let files: File[] = [];
    if (event.files && Array.isArray(event.files)) {
      files = event.files;
    } else if (event.currentFiles && Array.isArray(event.currentFiles)) {
      files = event.currentFiles;
    }
    if (files.length === 0) return;

    const existingNames = new Set(this.pendingFiles().map((item) => item.file.name));
    const newItems: (PendingDocumentFile & { nameForm: FormGroup })[] = [];

    files.forEach((file) => {
      const error = this.validateFile(file);
      if (error) {
        this.messageService.add({ severity: 'error', summary: 'File Upload Error', detail: error, life: 5000 });
        return;
      }
      if (existingNames.has(file.name)) {
        this.messageService.add({
          severity: 'error',
          summary: 'File Upload Error',
          detail: `A file named "${file.name}" is already in the list.`,
          life: 5000,
        });
        return;
      }

      existingNames.add(file.name);
      // Pre-fill from the basename (sans extension); user can edit inline before submit.
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const nameForm = new FormGroup({ name: new FormControl(baseName, [Validators.required, Validators.maxLength(500)]) });
      newItems.push({ id: crypto.randomUUID(), file, status: 'pending', nameForm });
    });

    if (newItems.length === 0) return;

    this.fileError.set(null);
    this.pendingFiles.update((items) => [...items, ...newItems]);
  }

  public removePendingFile(id: string): void {
    this.pendingFiles.update((items) => items.filter((item) => item.id !== id));
  }

  /**
   * Pulls a human-friendly message out of an HttpErrorResponse for display in a toast.
   *
   * Order of preference:
   * 1. `err.error.error` — what `BaseApiError.toResponse()` writes on the BFF side (the
   *    upstream microservice error verbatim, e.g. "document with the same name already exists").
   * 2. `err.error.message` — alternate shape some endpoints use.
   * 3. The provided fallback.
   *
   * 409 conflicts get rewritten to a friendlier message because every document write
   * enforces unique-name-per-{committee|project} at the upstream layer.
   */
  private extractErrorMessage(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 409) {
      const scope = this.entityType === 'project' ? 'project' : 'committee';
      return `A document with this name already exists in this ${scope}. Please pick a different name.`;
    }
    return err.error?.error || err.error?.message || fallback;
  }

  private createForm(): FormGroup {
    if (this.isLink()) {
      return new FormGroup({
        url: new FormControl('', [Validators.required, this.httpUrlValidator]),
        name: new FormControl('', [Validators.required]),
        description: new FormControl(''),
        parent_uid: new FormControl<string | null>(this.defaultParentUid),
      });
    }

    if (this.isFile()) {
      // No `name` control — per-file display name lives on each PendingDocumentFile instead.
      return new FormGroup({
        description: new FormControl(''),
        parent_uid: new FormControl<string | null>(this.defaultParentUid),
      });
    }

    // Folder form — name only. Upstream Goa types (ProjectFolder / CommitteeFolder) have
    // no description field, so collecting one would just be silently dropped at the BFF.
    return new FormGroup({
      name: new FormControl('', [Validators.required]),
    });
  }

  /**
   * Uploads every given pending file in parallel, capped at `DOCUMENT_UPLOAD_CONCURRENCY`
   * concurrent requests — each upload's body is buffered fully in memory server-side, so
   * unbounded concurrency would compound memory pressure on the BFF for large batches. Each
   * call is individually `catchError`'d so one failure doesn't abort the others — successes
   * are never rolled back on partial failure. Per-file status is applied via `tap` the moment
   * each request settles, not just aggregated at the end, so the template reflects live
   * per-file state; `toArray()` is used only for the final batch-level toast/close decision.
   */
  private uploadPendingFiles(items: (PendingDocumentFile & { nameForm: FormGroup })[], description: string | undefined, folderUid: string | undefined): void {
    this.submitting.set(true);
    const uploadingIds = new Set(items.map((item) => item.id));
    items.forEach((item) => item.nameForm.disable());
    this.pendingFiles.update((current) =>
      current.map((item) => (uploadingIds.has(item.id) ? { ...item, status: 'uploading' as const, errorMessage: undefined } : item))
    );

    from(items)
      .pipe(
        mergeMap((item) => {
          const name = ((item.nameForm.get('name')?.value as string | null) ?? '').trim();
          const metadata = { name, description, folder_uid: folderUid };
          const upload$: Observable<unknown> =
            this.entityType === 'project'
              ? this.projectService.uploadProjectDocument(this.entityId, item.file, metadata)
              : this.committeeService.uploadCommitteeDocument(this.entityId, item.file, metadata);

          return upload$.pipe(
            map(() => ({ id: item.id, ok: true as const })),
            catchError((err: HttpErrorResponse) =>
              of({ id: item.id, ok: false as const, message: this.extractErrorMessage(err, `Failed to upload "${name}"`) })
            ),
            tap((result) => this.applyUploadResult(item, result))
          );
        }, DOCUMENT_UPLOAD_CONCURRENCY),
        toArray()
      )
      .subscribe((results) => {
        this.submitting.set(false);

        const successCount = results.filter((result) => result.ok).length;
        const failureCount = results.length - successCount;
        if (successCount > 0) {
          this.anyUploadSucceeded.set(true);
        }

        if (failureCount === 0) {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: successCount === 1 ? 'File uploaded successfully' : `${successCount} files uploaded successfully`,
          });
          this.dialogRef.close(true);
        } else if (successCount > 0) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Partial Upload',
            detail: `${successCount} of ${successCount + failureCount} files uploaded. Fix the errors below and try again.`,
          });
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: failureCount === 1 ? 'Failed to upload file. Please try again.' : 'Failed to upload files. Please try again.',
          });
        }
      });
  }

  /** Applies one file's settled upload result to `pendingFiles` immediately — success removes the row, failure marks it for retry. */
  private applyUploadResult(
    target: PendingDocumentFile & { nameForm: FormGroup },
    result: { id: string; ok: true } | { id: string; ok: false; message: string }
  ): void {
    if (result.ok) {
      this.pendingFiles.update((current) => current.filter((item) => item.id !== result.id));
      return;
    }
    target.nameForm.enable();
    this.pendingFiles.update((current) =>
      current.map((item) => (item.id === result.id ? { ...item, status: 'error' as const, errorMessage: result.message } : item))
    );
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
    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `Invalid filename "${file.name}".`;
    }
    return null;
  }

  /** Validates that the value is a well-formed http or https URL. */
  private readonly httpUrlValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string;
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? null : { invalidUrl: true };
    } catch {
      return { invalidUrl: true };
    }
  };

  // ── Private Initializers ─────────────────────────────────────────────────

  private initIsLink(): Signal<boolean> {
    return computed(() => this.mode === 'link');
  }

  private initIsFolder(): Signal<boolean> {
    return computed(() => this.mode === 'folder');
  }

  private initIsFile(): Signal<boolean> {
    return computed(() => this.mode === 'file');
  }

  private initSubmitLabel(): Signal<string> {
    return computed(() => {
      if (this.isFile()) {
        const count = this.pendingFiles().length;
        if (count === 0) return 'Upload Files';
        return count === 1 ? 'Upload 1 File' : `Upload ${count} Files`;
      }
      if (this.isLink()) return 'Add Link';
      return 'Create Folder';
    });
  }

  private initCancelLabel(): Signal<string> {
    return computed(() => (this.isFile() && this.anyUploadSucceeded() ? 'Done' : 'Cancel'));
  }

  private initDescriptionPlaceholder(): Signal<string> {
    return computed(() => {
      if (this.isFile()) return 'Brief description of this document';
      if (this.isLink()) return 'Brief description';
      return 'Brief description of what this folder contains';
    });
  }
}
