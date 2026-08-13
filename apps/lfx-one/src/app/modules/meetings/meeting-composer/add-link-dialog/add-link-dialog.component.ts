// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import type { MeetingLinkDialogResult } from '@lfx-one/shared/interfaces';
import { httpsUrlValidator } from '@lfx-one/shared/validators';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Add-link entry for the composer's Agenda & Resources section (LFXV2-3239).
 * @description Opened through `DialogService` so the overlay outlives the section, which the composer's
 * `@switch` destroys on every section change.
 */
@Component({
  selector: 'lfx-add-link-dialog',
  imports: [ButtonComponent, InputTextComponent],
  templateUrl: './add-link-dialog.component.html',
})
export class AddLinkDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly form = new FormGroup({
    title: new FormControl('', [Validators.required]),
    url: new FormControl('', [Validators.required, httpsUrlValidator()]),
  });

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close({
      title: (this.form.value.title ?? '').trim(),
      url: (this.form.value.url ?? '').trim(),
    } satisfies MeetingLinkDialogResult);
  }
}
