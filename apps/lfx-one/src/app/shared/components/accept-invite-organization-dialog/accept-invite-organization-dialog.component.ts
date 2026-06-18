// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { AcceptInviteOrganizationDialogData, AcceptInviteOrganizationDialogResult, OrganizationResolveResult } from '@lfx-one/shared/interfaces';
import { buildCommitteeOrganizationPayload } from '@lfx-one/shared/utils';
import { trimmedRequired } from '@lfx-one/shared/validators';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

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
  private resolvedOrganizationName = '';

  public readonly committeeName = this.config.data?.committeeName ?? 'this group';
  public readonly form = new FormGroup({
    organization: new FormControl(this.config.data?.organization?.name ?? '', [trimmedRequired()]),
    organization_url: new FormControl(this.config.data?.organization?.website ?? ''),
    organization_id: new FormControl<string | null>(this.config.data?.organization?.id ?? null),
  });

  protected readonly organizationControl = this.form.get('organization') as FormControl;

  public readonly submitting = signal(false);

  public constructor() {
    this.organizationControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      const normalizedName = (name ?? '').trim();
      if (!normalizedName || normalizedName !== this.resolvedOrganizationName) {
        this.form.patchValue({ organization_id: null }, { emitEvent: false });
      }
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
}
