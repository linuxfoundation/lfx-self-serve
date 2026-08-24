// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, ElementRef, Signal, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SAVED_VIEW_NAME_MAX_LENGTH } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { InputTextModule } from 'primeng/inputtext';

/**
 * Save-view dialog (LFXV2-3002 Block 3, PCC port): name input with a live counter, case-insensitive
 * duplicate validation, autofocus, and Enter-to-save. Closes with the trimmed name, or undefined on cancel.
 */
@Component({
  selector: 'lfx-save-view-dialog',
  imports: [FormsModule, InputTextModule, ButtonComponent],
  templateUrl: './save-view-dialog.component.html',
})
export class SaveViewDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig: DynamicDialogConfig<{ existingNames: string[] }> = inject(DynamicDialogConfig);

  protected readonly viewName = signal('');
  protected readonly maxLength = SAVED_VIEW_NAME_MAX_LENGTH;
  private readonly existingNames: string[] = this.dialogConfig.data?.existingNames ?? [];

  private readonly viewNameInput = viewChild<ElementRef<HTMLInputElement>>('viewNameInput');

  protected readonly trimmedName = computed(() => this.viewName().trim());
  protected readonly isDuplicateName: Signal<boolean> = this.initIsDuplicateName();
  protected readonly isValid: Signal<boolean> = this.initIsValid();

  public constructor() {
    afterNextRender(() => this.viewNameInput()?.nativeElement.focus());
  }

  protected onSave(): void {
    if (!this.isValid()) return;
    this.dialogRef.close(this.trimmedName());
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  private initIsDuplicateName(): Signal<boolean> {
    return computed(() => {
      const trimmed = this.trimmedName();
      if (!trimmed) return false;
      return this.existingNames.some((name) => name.toLowerCase() === trimmed.toLowerCase());
    });
  }

  private initIsValid(): Signal<boolean> {
    return computed(() => !!this.trimmedName() && !this.isDuplicateName());
  }
}
