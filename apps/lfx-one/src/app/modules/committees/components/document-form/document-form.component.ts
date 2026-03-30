// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { CreateCommitteeDocumentType, CreateCommitteeDocumentRequest } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-document-form',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, SelectComponent, TextareaComponent],
  templateUrl: './document-form.component.html',
  styleUrl: './document-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);

  public submitting = signal<boolean>(false);

  // Config-based properties
  public readonly committeeId: string;
  /** Pre-set mode: 'link' or 'folder' — determines which form fields are shown */
  public readonly mode: CreateCommitteeDocumentType;
  /** Available folders for the folder selector (links only) */
  public readonly folderOptions: { label: string; value: string }[];

  public form: FormGroup;

  // Derived signals
  public isLink: Signal<boolean> = this.initIsLink();
  public isFolder: Signal<boolean> = this.initIsFolder();
  public submitLabel: Signal<string> = this.initSubmitLabel();

  public constructor() {
    this.committeeId = this.config.data?.committeeId;
    this.mode = this.config.data?.mode || 'link';
    this.folderOptions = this.config.data?.folders || [];

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

    this.submitting.set(true);
    const formValue = this.form.getRawValue();

    const createData: CreateCommitteeDocumentRequest = {
      type: this.mode,
      name: formValue.name,
      ...(this.isLink() && { url: formValue.url }),
      description: formValue.description || undefined,
      ...(this.isLink() && formValue.parent_uid && { parent_uid: formValue.parent_uid }),
    };

    this.committeeService.createCommitteeDocument(this.committeeId, createData).subscribe({
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
          detail: err.error?.message || `Failed to ${this.isLink() ? 'add link' : 'create folder'}`,
        });
      },
    });
  }

  private createForm(): FormGroup {
    if (this.isLink()) {
      return new FormGroup({
        url: new FormControl('', [Validators.required, this.httpUrlValidator]),
        name: new FormControl('', [Validators.required]),
        description: new FormControl(''),
        parent_uid: new FormControl<string | null>(null),
      });
    }

    // Folder form — just name + description
    return new FormGroup({
      name: new FormControl('', [Validators.required]),
      description: new FormControl(''),
    });
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

  private initSubmitLabel(): Signal<string> {
    return computed(() => (this.isLink() ? 'Add Link' : 'Create Folder'));
  }
}
