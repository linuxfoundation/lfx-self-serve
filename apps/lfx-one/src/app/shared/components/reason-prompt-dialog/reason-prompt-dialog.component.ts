// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

export interface ReasonPromptDialogData {
  /** e.g. "Skip {{title}}" — rendered as the body's leading sentence. */
  prompt: string;
  placeholder: string;
  confirmLabel: string;
  /** Defaults to `'danger'`. */
  confirmSeverity?: 'danger' | 'primary';
}

export interface ReasonPromptDialogResult {
  reason: string;
}

/**
 * Generic "confirm with a required reason" dialog — opened via `DialogService.open()`. Backs both
 * the checklist item skip flow and the Formations queue decline flow (GH-1958), which are
 * otherwise identical modals differing only in copy.
 */
@Component({
  selector: 'lfx-reason-prompt-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './reason-prompt-dialog.component.html',
})
export class ReasonPromptDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<ReasonPromptDialogData>);

  public readonly data = this.dialogConfig.data as ReasonPromptDialogData;

  public readonly form = new FormGroup({
    reason: new FormControl<string>('', { nonNullable: true }),
  });

  private readonly reasonValue = toSignal(this.form.controls.reason.valueChanges, { initialValue: this.form.controls.reason.value });
  protected readonly canConfirm: Signal<boolean> = computed(() => !!this.reasonValue().trim());

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onConfirm(): void {
    const reason = this.form.controls.reason.value.trim();
    if (!reason) return;
    this.dialogRef.close({ reason } satisfies ReasonPromptDialogResult);
  }
}
