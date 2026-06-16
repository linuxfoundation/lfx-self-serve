// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';

import { OsspreyAssignStewardRequest, OsspreyStewardRole } from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

interface RoleOption {
  value: OsspreyStewardRole;
  label: string;
  description: string;
}

@Component({
  selector: 'lfx-ossprey-assign-steward-modal',
  imports: [DialogModule, ReactiveFormsModule, ButtonComponent, InputTextComponent],
  templateUrl: './ossprey-assign-steward-modal.component.html',
})
export class OsspreyAssignStewardModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  public readonly visible = model(false);
  public readonly packageName = input<string | null>(null);
  public readonly loading = input(false);

  public readonly confirm = output<OsspreyAssignStewardRequest>();

  protected readonly selectedRole = signal<OsspreyStewardRole>('lead');

  protected readonly roleOptions: RoleOption[] = [
    { value: 'lead', label: 'Lead steward', description: 'Primary owner — drives the security assessment and remediation.' },
    { value: 'co_steward', label: 'Co-steward', description: 'Supporting role — assists the lead but shares responsibility.' },
  ];

  protected readonly form = this.formBuilder.nonNullable.group({
    userId: ['', [Validators.required, Validators.minLength(3)]],
    moveToAssessing: false,
  });

  protected selectRole(role: OsspreyStewardRole): void {
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
