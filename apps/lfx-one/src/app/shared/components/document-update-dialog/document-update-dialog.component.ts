// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import {
  COMMITTEE_DOCUMENT_NAME_MAX_LENGTH,
  DOCUMENT_ROOT_FOLDER_LABEL,
  DOCUMENT_ROOT_FOLDER_VALUE,
  PROJECT_DOCUMENT_NAME_MAX_LENGTH,
} from '@lfx-one/shared/constants';
import { CommitteeDocument, DocumentUpdateDialogData, ProjectDocument, UpdateDocumentRequest } from '@lfx-one/shared/interfaces';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { getHttpErrorDetail } from '@shared/utils/http-error.utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { Observable } from 'rxjs';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-document-update-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, InputTextComponent, SelectComponent],
  templateUrl: './document-update-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentUpdateDialogComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectService = inject(ProjectService);

  public readonly data: DocumentUpdateDialogData = this.config.data;
  public readonly isRename = this.data.mode === 'rename';
  public readonly nameMaxLength = this.resolveNameMaxLength();
  public readonly folderOptions = [{ label: DOCUMENT_ROOT_FOLDER_LABEL, value: DOCUMENT_ROOT_FOLDER_VALUE }, ...this.data.folders];

  public readonly form = new FormGroup({
    // The name is only edited in rename mode. A move leaves it as it is, so a current name that fails these rules must not block it.
    name: new FormControl({ value: this.data.name, disabled: !this.isRename }, [
      Validators.required,
      Validators.maxLength(this.nameMaxLength),
      (c) => (String(c.value ?? '').trim() ? null : { required: true }),
    ]),
    parent_uid: new FormControl<string>(this.data.parentUid ?? DOCUMENT_ROOT_FOLDER_VALUE),
  });

  public readonly submitting = signal<boolean>(false);
  public readonly errorMessage = signal<string | null>(null);

  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  /** Nothing to save until the value differs from what the document has now. */
  public readonly changes = this.initChanges();
  public readonly unchanged = computed(() => Object.keys(this.changes()).length === 0);
  public readonly submitLabel = this.isRename ? 'Rename' : 'Move';

  public constructor() {
    // The header X and Escape would drop the saved result before the page hears of it, so they wait until the save ends.
    lockDynamicDialogWhile(this.submitting);
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  public onSubmit(): void {
    if (this.submitting() || this.form.invalid || this.unchanged()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.send(this.changes()).subscribe({
      next: (document) => {
        this.submitting.set(false);
        this.dialogRef.close(document);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorMessage.set(getHttpErrorDetail(err, `Failed to ${this.isRename ? 'rename' : 'move'} the ${this.data.documentType}. Please try again.`));
      },
    });
  }

  private initChanges(): Signal<UpdateDocumentRequest> {
    return computed<UpdateDocumentRequest>(() => {
      const value = this.value();
      if (this.isRename) {
        const name = (value.name ?? '').trim();
        return name && name !== this.data.name ? { name } : {};
      }
      const target = value.parent_uid ?? DOCUMENT_ROOT_FOLDER_VALUE;
      const current = this.data.parentUid ?? DOCUMENT_ROOT_FOLDER_VALUE;
      return target === current ? {} : { parent_uid: target === DOCUMENT_ROOT_FOLDER_VALUE ? null : target };
    });
  }

  private send(changes: UpdateDocumentRequest): Observable<CommitteeDocument | ProjectDocument> {
    const { entityType, entityId, documentUid, documentType } = this.data;
    return entityType === 'project'
      ? this.projectService.updateProjectDocument(entityId, documentUid, documentType, changes)
      : this.committeeService.updateCommitteeDocument(entityId, documentUid, documentType, changes);
  }

  private resolveNameMaxLength(): number {
    return this.data.entityType === 'project' ? PROJECT_DOCUMENT_NAME_MAX_LENGTH : COMMITTEE_DOCUMENT_NAME_MAX_LENGTH[this.data.documentType];
  }
}
