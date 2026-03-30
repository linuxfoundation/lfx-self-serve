// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal, ViewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { MONTH_OPTIONS, YEAR_OPTIONS } from '@lfx-one/shared/constants';
import { OrganizationResolveResult, WorkExperienceFormDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { OrganizationSearchComponent } from '../../../../shared/components/organization-search/organization-search.component';

@Component({
  selector: 'lfx-work-experience-form-dialog',
  imports: [ReactiveFormsModule, ButtonComponent, CheckboxComponent, InputTextComponent, SelectComponent, OrganizationSearchComponent],
  templateUrl: './work-experience-form-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkExperienceFormDialogComponent {
  @ViewChild(OrganizationSearchComponent) public orgSearch?: OrganizationSearchComponent;

  private readonly fb = inject(NonNullableFormBuilder);
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly data: WorkExperienceFormDialogData = this.config.data;

  public readonly monthOptions = MONTH_OPTIONS;
  public readonly yearOptions = YEAR_OPTIONS;

  public readonly submitting = signal(false);

  public readonly form = this.fb.group({
    organization: [''],
    organizationId: [''],
    domain: [''],
    role: [''],
    startMonth: [''],
    startYear: [''],
    endMonth: [''],
    endYear: [''],
    currentlyWorkHere: [false],
  });

  public constructor() {
    if (this.data.mode === 'edit' && this.data.experience) {
      const exp = this.data.experience;
      const startParts = exp.startDate.split(' ');
      const startMonth = this.monthOptions.find((m) => m.label.startsWith(startParts[0]))?.value || '';
      const startYear = startParts[1] || '';

      let endMonth = '';
      let endYear = '';
      const isCurrently = !exp.endDate;

      if (exp.endDate) {
        const endParts = exp.endDate.split(' ');
        endMonth = this.monthOptions.find((m) => m.label.startsWith(endParts[0]))?.value || '';
        endYear = endParts[1] || '';
      }

      this.form.patchValue({
        organization: exp.organization,
        organizationId: exp.organizationId || '',
        role: exp.role || '',
        startMonth,
        startYear,
        endMonth,
        endYear,
        currentlyWorkHere: isCurrently,
      });
    }
  }

  public onOrganizationResolved(result: OrganizationResolveResult): void {
    this.form.patchValue({ organizationId: result.id });
  }

  public onSubmit(): void {
    const formValue = this.form.getRawValue();

    // If no resolved ID and in manual mode, resolve via org-search first
    if (!formValue.organizationId && formValue.organization && this.orgSearch?.manualMode()) {
      this.submitting.set(true);
      this.orgSearch
        .resolveCurrentEntry()
        .pipe(take(1))
        .subscribe({
          next: (result) => {
            this.submitting.set(false);
            this.ref.close({ ...formValue, organizationId: result?.id || '' });
          },
          error: () => {
            this.submitting.set(false);
            this.ref.close(formValue);
          },
        });
      return;
    }

    this.ref.close(formValue);
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
