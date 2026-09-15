// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, signal, ViewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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
  public readonly resolveError = signal(false);

  public readonly form = this.fb.group({
    organization: ['', [Validators.required]],
    organizationId: [''],
    domain: [''],
    role: ['', [Validators.required]],
    startMonth: [''],
    startYear: [''],
    endMonth: [''],
    endYear: [''],
    currentlyWorkHere: [false],
  });

  /** Loaded organization name + id, for edit mode only — lets onSubmit() tell an untouched
   *  legacy row (no organizationId, org unchanged) from a genuine new/changed selection that
   *  still needs resolving. Legacy rows have no domain data to resolve against, so they must
   *  stay editable (role/dates) without forcing a resolve attempt. */
  private readonly loadedOrganization: { name: string; organizationId: string } | null =
    this.data.mode === 'edit' && this.data.experience
      ? { name: this.data.experience.organization, organizationId: this.data.experience.organizationId || '' }
      : null;

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
    this.resolveError.set(false);
    this.form.patchValue({ organizationId: result.id ?? '' });
  }

  public onSubmit(): void {
    const formValue = this.form.getRawValue();

    if (formValue.organizationId) {
      this.ref.close(formValue);
      return;
    }

    // Untouched legacy row: never had a resolved id and the org name hasn't changed since load.
    // There's no domain data to resolve a legacy row against, so let role/dates edits through
    // without forcing a resolve attempt that can only fail.
    const isUntouchedLegacyOrg =
      !!this.loadedOrganization && !this.loadedOrganization.organizationId && formValue.organization === this.loadedOrganization.name;
    if (isUntouchedLegacyOrg) {
      this.ref.close(formValue);
      return;
    }

    if (!formValue.organization || !this.orgSearch) {
      this.resolveError.set(true);
      return;
    }

    // No resolved ID yet for a genuinely new or changed org — resolve via org-search before
    // closing. Covers manual "create new org" entries and search entries typed but never
    // selected from the dropdown (the ticket's original unresolved-organizationId cause).
    this.submitting.set(true);
    this.resolveError.set(false);
    this.orgSearch
      .resolveCurrentEntry()
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          // resolveCurrentEntry() swallows its own errors into a null result — treat a
          // missing id the same as the (unreachable) error branch: keep the dialog open
          // rather than closing with an unresolved organizationId (the ticket's 400 cause).
          if (!result?.id) {
            this.resolveError.set(true);
            return;
          }
          this.ref.close({ ...formValue, organizationId: result.id });
        },
        error: () => {
          this.submitting.set(false);
          this.resolveError.set(true);
        },
      });
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
