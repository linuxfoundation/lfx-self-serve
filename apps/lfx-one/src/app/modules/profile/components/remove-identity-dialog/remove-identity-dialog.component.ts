// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { IDENTITY_PROVIDER_LABELS } from '@lfx-one/shared/constants';
import { ConnectedIdentityFull, RemoveIdentityDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-remove-identity-dialog',
  imports: [ButtonComponent, CheckboxComponent, ReactiveFormsModule],
  templateUrl: './remove-identity-dialog.component.html',
})
export class RemoveIdentityDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<RemoveIdentityDialogData>);
  private readonly fb = inject(NonNullableFormBuilder);

  public readonly identity: ConnectedIdentityFull = this.config.data.identity;
  public readonly providerLabel: string = IDENTITY_PROVIDER_LABELS[this.identity.provider] ?? this.identity.provider;
  public readonly isVerified: boolean = this.identity.state === 'verified';
  public readonly form = this.fb.group({
    acknowledged: [false],
  });

  public get canConfirm(): boolean {
    if (this.isVerified) {
      return this.form.controls.acknowledged.value === true;
    }
    return true;
  }

  public onConfirm(): void {
    this.ref.close(true);
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
