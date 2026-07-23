// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormControlStatus, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { AcceptInviteOrganizationDialogData, AcceptInviteOrganizationDialogResult, OrganizationResolveResult } from '@lfx-one/shared/interfaces';
import { buildCommitteeOrganizationPayload } from '@lfx-one/shared/utils';
import { httpsUrlValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, take } from 'rxjs';

@Component({
  selector: 'lfx-accept-invite-organization-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, OrganizationSearchComponent],
  templateUrl: './accept-invite-organization-dialog.component.html',
})
export class AcceptInviteOrganizationDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<AcceptInviteOrganizationDialogData>);

  private readonly organizationSearch = viewChild(OrganizationSearchComponent);
  // Tracks the CDP-canonical name of the last resolved org so the valueChanges
  // handler can distinguish a CDP-confirmed name from free text (and avoid
  // clearing the pre-resolved id when the same name is re-set programmatically).
  private resolvedOrganizationName = this.config.data?.organization?.id ? (this.config.data.organization.name ?? '') : '';

  public readonly committeeName = this.config.data?.committeeName ?? 'this group';
  public readonly form = new FormGroup({
    organization: new FormControl(this.config.data?.organization?.name ?? '', [trimmedRequired()]),
    organization_url: new FormControl(this.config.data?.organization?.website ?? ''),
    organization_id: new FormControl<string | null>(this.config.data?.organization?.id ?? null),
  });

  protected readonly organizationControl = this.form.get('organization') as FormControl;
  protected readonly urlControl = this.form.get('organization_url') as FormControl;

  public readonly submitting = signal(false);

  private readonly formValue = this.initFormValue();
  private readonly urlStatus = signal<FormControlStatus>(this.urlControl.status);

  protected readonly isNewOrg = computed(() => {
    const value = this.formValue();
    return !value?.organization_id && !!value?.organization?.trim();
  });

  private readonly orgInvalid = computed(() => {
    const search = this.organizationSearch();
    if (search?.manualMode()) {
      return this.urlStatus() !== 'VALID';
    }
    const vals = this.formValue();
    const hasName = !!(vals?.organization ?? '').trim();
    const pendingSearch = search?.searchTerm() ?? '';
    if (!hasName && pendingSearch) return true;
    if (!hasName) return false;
    if (!vals?.organization_id) {
      return this.urlStatus() !== 'VALID';
    }
    return false;
  });

  protected readonly showOrgWarning = computed(() => {
    if (!this.orgInvalid()) return false;
    if (this.organizationSearch()?.manualMode()) return false;
    const vals = this.formValue();
    const hasName = !!(vals?.organization ?? '').trim();
    if (!hasName) return !!(this.organizationSearch()?.searchTerm() ?? '');
    return true;
  });

  protected readonly canConfirm = computed(() => !this.submitting() && !this.orgInvalid());

  public constructor() {
    this.organizationControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      const normalizedName = (name ?? '').trim();
      if (!normalizedName || normalizedName !== this.resolvedOrganizationName) {
        this.form.patchValue({ organization_id: null }, { emitEvent: false });
      }
    });

    this.urlControl.statusChanges.pipe(takeUntilDestroyed()).subscribe((status) => {
      this.urlStatus.set(status);
    });

    effect(() => {
      if (this.isNewOrg()) {
        this.urlControl.setValidators([trimmedRequired(), httpsUrlValidator()]);
      } else {
        this.urlControl.clearValidators();
      }
      this.urlControl.updateValueAndValidity({ emitEvent: false });
      // Manually sync after updateValueAndValidity({ emitEvent: false }) since
      // suppressing the event means statusChanges won't fire for validator changes.
      this.urlStatus.set(this.urlControl.status);
    });
  }

  public onOrgResolved(result: OrganizationResolveResult): void {
    this.resolvedOrganizationName = result.name;
    this.form.patchValue({ organization_id: result.id || null });
  }

  public onCancel(): void {
    this.dialogRef.close(null);
  }

  public onConfirm(): void {
    this.organizationControl.markAsTouched();
    if (this.isNewOrg()) {
      this.urlControl.markAsTouched();
    }
    if (!this.form.valid) {
      return;
    }

    this.submitting.set(true);
    const orgSearch = this.organizationSearch();
    const resolve$ = orgSearch ? orgSearch.resolveCurrentEntry() : null;

    const finish = (): void => {
      const raw = this.form.getRawValue();
      const organization = buildCommitteeOrganizationPayload({
        organization: raw.organization ?? '',
        organization_url: raw.organization_url ?? '',
        organization_id: raw.organization_id,
      });
      if (!organization?.name?.trim()) {
        this.submitting.set(false);
        return;
      }
      this.dialogRef.close({ organization } satisfies AcceptInviteOrganizationDialogResult);
    };

    if (resolve$) {
      resolve$.pipe(take(1)).subscribe({
        next: (result) => {
          if (result) {
            this.resolvedOrganizationName = result.name;
            this.form.patchValue({ organization_id: result.id || null, organization: result.name });
          }
          finish();
        },
        error: () => {
          this.submitting.set(false);
        },
      });
      return;
    }

    finish();
  }

  private initFormValue() {
    return toSignal(this.form.valueChanges.pipe(startWith(this.form.value)));
  }
}
