// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ORG_CLA_IDENTIFY_MANAGER_COPY } from '@lfx-one/shared/constants';
import type { OrgClaDesigneeNominationRequest, OrgClaDesigneeNominationValidation } from '@lfx-one/shared/interfaces';
import { validateOrgClaDesigneeNomination } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

type IdentifyManagerField = keyof OrgClaDesigneeNominationValidation;

/** What the dialog closes with. The detail page adds the signing project and sends it. */
export type OrgEasyclaIdentifyManagerResult = Omit<OrgClaDesigneeNominationRequest, 'projectSfid'>;

export function orgClaIdentifyManagerDialogConfig(): DynamicDialogConfig {
  return {
    header: ORG_CLA_IDENTIFY_MANAGER_COPY.title,
    modal: true,
    width: '32rem',
    style: { maxWidth: '90vw' },
  };
}

/**
 * No on the manager question (#2780): name the person who should become the initial CLA Manager.
 * Corporate Console's Contact Company Admin branch is deliberately absent.
 */
@Component({
  selector: 'lfx-org-easycla-identify-manager-dialog',
  imports: [ButtonComponent, InputTextComponent, ReactiveFormsModule],
  templateUrl: './org-easycla-identify-manager-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaIdentifyManagerDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly copy = ORG_CLA_IDENTIFY_MANAGER_COPY;

  protected readonly form = new FormGroup({
    fullName: new FormControl('', { nonNullable: true, validators: [OrgEasyclaIdentifyManagerDialogComponent.fieldValidator('fullName')] }),
    email: new FormControl('', { nonNullable: true, validators: [OrgEasyclaIdentifyManagerDialogComponent.fieldValidator('email')] }),
  });

  private readonly errors = toSignal(this.form.events.pipe(map(() => this.readErrors())), { initialValue: this.readErrors() });

  protected readonly fullNameError = computed(() => this.errors().fullName);
  protected readonly emailError = computed(() => this.errors().email);

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const { fullName, email } = this.form.getRawValue();
    const result: OrgEasyclaIdentifyManagerResult = { fullName: fullName.trim(), email: email.trim() };
    this.dialogRef.close(result);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  // Static so the form-field initializers above can call it before an instance exists.
  private static fieldValidator(field: IdentifyManagerField): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const message = validateOrgClaDesigneeNomination({ [field]: (control.value as string) ?? '' })[field];
      return message ? { invalid: message } : null;
    };
  }

  private readErrors(): Record<IdentifyManagerField, string | undefined> {
    const errorFor = (field: IdentifyManagerField): string | undefined => {
      const control = this.form.controls[field];
      return control.touched && control.invalid ? (control.errors?.['invalid'] as string) : undefined;
    };

    return { fullName: errorFor('fullName'), email: errorFor('email') };
  }
}
