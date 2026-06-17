// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { AkritesAssignStewardRequest, AkritesRoleOption, AkritesStewardRole } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

@Component({
  selector: 'lfx-akrites-assign-steward-modal',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './akrites-assign-steward-modal.component.html',
})
export class AkritesAssignStewardModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<AkritesAssignStewardRequest>();

  protected readonly selectedRole = signal<AkritesStewardRole>('lead');

  protected readonly roleOptions: AkritesRoleOption[] = [
    { value: 'lead', label: 'Lead steward', description: 'Primary owner — drives the security assessment and remediation.' },
    { value: 'co_steward', label: 'Co-steward', description: 'Supporting role — assists the lead but shares responsibility.' },
  ];

  protected readonly form = this.formBuilder.nonNullable.group({
    userId: ['', [Validators.required, Validators.minLength(3)]],
    moveToAssessing: false,
  });

  protected selectRole(role: AkritesStewardRole): void {
    this.selectedRole.set(role);
  }

  protected onCancel(): void {
    this.visible.set(false);
  }

  protected onConfirm(): void {
    if (this.form.invalid) return;
    const { userId, moveToAssessing } = this.form.getRawValue();
    this.confirm.emit({
      userId: userId.trim(),
      role: this.selectedRole(),
      moveToAssessing: moveToAssessing || undefined,
    });
  }

  protected onShow(): void {
    this.selectedRole.set('lead');
    this.form.reset({ userId: '', moveToAssessing: false });
  }
}
