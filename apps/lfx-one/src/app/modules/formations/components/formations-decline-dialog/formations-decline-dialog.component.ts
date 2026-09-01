// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-formations-decline-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent],
  templateUrl: './formations-decline-dialog.component.html',
})
export class FormationsDeclineDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);

  public readonly formationName = this.dialogConfig.data.formationName as string;

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
    this.dialogRef.close({ reason });
  }
}
