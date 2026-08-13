// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import type { ManualGuestDialogData, ManualGuestDialogResult } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { RegistrantFormComponent } from '../../components/registrant-form/registrant-form.component';

/**
 * Manual guest entry for the composer's Guests section (LFXV2-3238).
 * @description Opened through `DialogService` rather than an inline `<p-dialog>`, so the overlay lives
 * outside the section that the composer's `@switch` destroys on every section change.
 */
@Component({
  selector: 'lfx-manual-guest-dialog',
  imports: [ButtonComponent, RegistrantFormComponent],
  templateUrl: './manual-guest-dialog.component.html',
})
export class ManualGuestDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);

  protected readonly form = this.meetingService.createRegistrantFormGroup();

  public constructor() {
    const { prefill } = (this.dialogConfig.data ?? {}) as ManualGuestDialogData;

    if (!prefill) {
      return;
    }

    // The pick came from search with a field the add payload requires missing, so surface which one.
    this.form.patchValue(prefill);
    this.form.markAllAsTouched();
    this.form.markAsDirty();
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }

  protected onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      this.form.markAsDirty();
      return;
    }

    this.dialogRef.close({ guest: this.form.value } satisfies ManualGuestDialogResult);
  }
}
