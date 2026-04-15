// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { ImpersonationService } from '@services/impersonation.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-dialog',
  imports: [InputTextComponent, ButtonComponent],
  templateUrl: './impersonation-dialog.component.html',
})
export class ImpersonationDialogComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected targetUserForm = new FormGroup({
    targetUser: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });
  protected loading = signal(false);
  protected error = signal('');

  public submit(): void {
    const target = this.targetUserForm.controls.targetUser.value.trim();
    if (!target) return;

    this.loading.set(true);
    this.error.set('');
    this.targetUserForm.controls.targetUser.disable();

    this.impersonationService
      .startImpersonation(target)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.dialogRef.close(true);
          window.location.reload();
        },
        error: (err) => {
          this.loading.set(false);
          this.targetUserForm.controls.targetUser.enable();
          this.error.set(err.error?.error || 'Failed to start impersonation');
        },
      });
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }
}
