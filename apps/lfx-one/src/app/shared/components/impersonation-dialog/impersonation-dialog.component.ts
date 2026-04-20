// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { PersonaType } from '@lfx-one/shared/interfaces';
import { ImpersonationService } from '@services/impersonation.service';
import { DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-impersonation-dialog',
  imports: [InputTextComponent, SelectComponent, ButtonComponent],
  templateUrl: './impersonation-dialog.component.html',
})
export class ImpersonationDialogComponent {
  private readonly impersonationService = inject(ImpersonationService);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected targetUserForm = new FormGroup({
    targetUser: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    personaContext: new FormControl<PersonaType | null>(null),
  });

  protected readonly personaOptions = [
    { label: 'Use their context', value: null },
    { label: 'Executive Director', value: 'executive-director' as PersonaType },
    { label: 'Board Member', value: 'board-member' as PersonaType },
    { label: 'Maintainer', value: 'maintainer' as PersonaType },
    { label: 'Contributor', value: 'contributor' as PersonaType },
  ];

  protected loading = signal(false);
  protected error = signal('');

  public submit(): void {
    const target = this.targetUserForm.controls.targetUser.value.trim();
    if (!target) return;

    const personaContext = this.targetUserForm.controls.personaContext.value;

    this.loading.set(true);
    this.error.set('');
    this.targetUserForm.controls.targetUser.disable();
    this.targetUserForm.controls.personaContext.disable();

    this.impersonationService
      .startImpersonation(target, personaContext)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.dialogRef.close(true);
          window.location.reload();
        },
        error: (err) => {
          this.loading.set(false);
          this.targetUserForm.controls.targetUser.enable();
          this.targetUserForm.controls.personaContext.enable();
          this.error.set(err.error?.error || 'Failed to start impersonation');
        },
      });
  }

  public cancel(): void {
    this.dialogRef.close(false);
  }
}
