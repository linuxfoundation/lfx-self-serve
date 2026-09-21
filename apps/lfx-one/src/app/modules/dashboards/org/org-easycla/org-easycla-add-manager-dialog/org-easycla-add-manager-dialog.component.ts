// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ORG_CLA_MANAGERS_COPY } from '@lfx-one/shared/constants';
import type { OrgClaManagerAddField, OrgClaManagerAddRequest } from '@lfx-one/shared/interfaces';
import { validateOrgClaManagerAdd } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

export function orgClaAddManagerDialogConfig(): DynamicDialogConfig {
  return {
    header: ORG_CLA_MANAGERS_COPY.addDialogTitle,
    modal: true,
    width: '32rem',
    // The Aura dialog preset caps nothing, so a fixed width alone runs off a 360–390px phone,
    // taking the form's right edge and the Cancel control with it.
    style: { maxWidth: '90vw' },
  };
}

@Component({
  selector: 'lfx-org-easycla-add-manager-dialog',
  imports: [ButtonComponent, InputTextComponent, ReactiveFormsModule],
  templateUrl: './org-easycla-add-manager-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaAddManagerDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  protected readonly dialogConfig = inject(DynamicDialogConfig);

  protected readonly copy = ORG_CLA_MANAGERS_COPY;

  protected readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [OrgEasyclaAddManagerDialogComponent.fieldValidator('firstName')] }),
    lastName: new FormControl('', { nonNullable: true, validators: [OrgEasyclaAddManagerDialogComponent.fieldValidator('lastName')] }),
    email: new FormControl('', { nonNullable: true, validators: [OrgEasyclaAddManagerDialogComponent.fieldValidator('email')] }),
  });

  private readonly errors = toSignal(this.form.events.pipe(map(() => this.readErrors())), { initialValue: this.readErrors() });

  protected readonly firstNameError = computed(() => this.errors().firstName);
  protected readonly lastNameError = computed(() => this.errors().lastName);
  protected readonly emailError = computed(() => this.errors().email);

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const { firstName, lastName, email } = this.form.getRawValue();
    const request: OrgClaManagerAddRequest = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
    };
    this.dialogRef.close(request);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  // Static so the form-field initializers above can call it before an instance exists.
  private static fieldValidator(field: OrgClaManagerAddField): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const message = validateOrgClaManagerAdd({ [field]: (control.value as string) ?? '' })[field];
      return message ? { invalid: message } : null;
    };
  }

  private readErrors(): Record<OrgClaManagerAddField, string | undefined> {
    const errorFor = (field: OrgClaManagerAddField): string | undefined => {
      const control = this.form.controls[field];
      return control.touched && control.invalid ? (control.errors?.['invalid'] as string) : undefined;
    };

    return { firstName: errorFor('firstName'), lastName: errorFor('lastName'), email: errorFor('email') };
  }
}
