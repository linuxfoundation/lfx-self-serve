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
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import {
  CreateCommitteeDocumentRequest,
  CreateCommitteeDocumentType,
  CreateProjectDocumentRequest,
  CreateProjectDocumentType,
  DocumentFormEntityType,
  DocumentFormMode,
} from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { Observable } from 'rxjs';
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
  public selectedFile = signal<File | null>(null);
  public fileError = signal<string | null>(null);

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
    this.dialogRef.close();
  }

  public onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();

    if (this.isFile()) {
      const file = this.selectedFile();
      if (!file) {
        this.fileError.set('Please select a file to upload.');
        return;
      }

      const metadata = {
        name: formValue.name,
        description: formValue.description || undefined,
        folder_uid: formValue.parent_uid || undefined,
      };

      this.submitting.set(true);
      const upload$: Observable<unknown> =
        this.entityType === 'project'
          ? this.projectService.uploadProjectDocument(this.entityId, file, metadata)
          : this.committeeService.uploadCommitteeDocument(this.entityId, file, metadata);

      upload$.subscribe({
        next: () => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'File uploaded successfully',
          });
          this.dialogRef.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.submitting.set(false);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: this.extractErrorMessage(err, 'Failed to upload file'),
          });
        },
      });
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

    const file = files[0];
    const error = this.validateFile(file);
    if (error) {
      this.fileError.set(error);
      this.selectedFile.set(null);
      return;
    }

    this.fileError.set(null);
    this.selectedFile.set(file);

    // Auto-fill the Name field from the file basename (sans extension) if empty
    const nameControl = this.form.get('name');
    if (nameControl && !nameControl.value) {
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      nameControl.setValue(baseName);
    }
  }

  public clearSelectedFile(): void {
    this.selectedFile.set(null);
    this.fileError.set(null);
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
      return new FormGroup({
        name: new FormControl('', [Validators.required]),
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
      if (this.isFile()) return 'Upload File';
      if (this.isLink()) return 'Add Link';
      return 'Create Folder';
    });
  }

  private initDescriptionPlaceholder(): Signal<string> {
    return computed(() => {
      if (this.isFile()) return 'Brief description of this document';
      if (this.isLink()) return 'Brief description';
      return 'Brief description of what this folder contains';
    });
  }
}
