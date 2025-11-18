// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { filter, of, switchMap, take } from 'rxjs';

import { CommitteeFormComponent } from '../components/committee-form/committee-form.component';

@Component({
  selector: 'lfx-committee-manage',
  standalone: true,
  imports: [CommonModule, RouterLink, CommitteeFormComponent],
  templateUrl: './committee-manage.component.html',
  styleUrl: './committee-manage.component.scss',
})
export class CommitteeManageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly committeeService = inject(CommitteeService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);

  // Mode and state signals
  public mode = signal<'create' | 'edit'>('create');
  public committeeId = signal<string | null>(null);
  public isEditMode = computed(() => this.mode() === 'edit');

  // Initialize committee data
  public committee = this.initializeCommittee();

  // Form state
  public form: FormGroup = this.createCommitteeFormGroup();
  public submitting = signal<boolean>(false);

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly committeeLabelPlural = COMMITTEE_LABEL.plural;

  public constructor() {
    // Populate form when editing
    toObservable(this.committee)
      .pipe(
        filter((committee): committee is Committee => committee !== null && this.isEditMode()),
        take(1)
      )
      .subscribe((committee) => {
        this.populateFormWithCommitteeData(committee);
      });
  }

  public onCancel(): void {
    this.router.navigate(['/groups']);
  }

  public onSubmit(): void {
    // Mark all form controls as touched to show validation errors
    Object.keys(this.form.controls).forEach((key) => {
      const control = this.form.get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form.invalid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Please fill in all required fields correctly',
      });
      return;
    }

    this.submitting.set(true);

    const formValue = {
      ...this.form.value,
      calendar: {
        public: this.form.value.public || false,
      },
      display_name: this.form.value.display_name || this.form.value.name,
      website: this.form.value.website || null,
      project_uid: this.projectContextService.getProjectId() || this.projectContextService.getFoundationId() || null,
    };

    const committeeData = this.cleanFormData(formValue);

    if (this.isEditMode() && this.committeeId()) {
      // Update existing committee
      this.committeeService.updateCommittee(this.committeeId()!, committeeData).subscribe({
        next: () => this.handleCommitteeSuccess('updated'),
        error: (error) => this.handleCommitteeError(error, 'update'),
      });
    } else {
      // Create new committee
      this.committeeService.createCommittee(committeeData).subscribe({
        next: () => this.handleCommitteeSuccess('created'),
        error: (error) => this.handleCommitteeError(error, 'create'),
      });
    }
  }

  // Private methods
  private initializeCommittee() {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const committeeId = params.get('id');
          if (committeeId) {
            this.mode.set('edit');
            this.committeeId.set(committeeId);
            return this.committeeService.getCommittee(committeeId);
          }

          this.mode.set('create');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private populateFormWithCommitteeData(committee: Committee): void {
    this.form.patchValue({
      name: committee.name,
      category: committee.category,
      description: committee.description,
      parent_uid: committee.parent_uid,
      business_email_required: committee.business_email_required,
      enable_voting: committee.enable_voting,
      is_audit_enabled: committee.is_audit_enabled,
      public: committee.public,
      display_name: committee.display_name,
      sso_group_enabled: committee.sso_group_enabled,
      sso_group_name: committee.sso_group_name,
      website: committee.website,
      joinable: false, // Not returned from API, default to false
    });
  }

  private createCommitteeFormGroup(): FormGroup {
    return new FormGroup({
      name: new FormControl('', [Validators.required]),
      category: new FormControl('', [Validators.required]),
      description: new FormControl(''),
      parent_uid: new FormControl(null),
      business_email_required: new FormControl(false),
      enable_voting: new FormControl(false),
      is_audit_enabled: new FormControl(false),
      public: new FormControl(false),
      display_name: new FormControl(''),
      sso_group_enabled: new FormControl(false),
      sso_group_name: new FormControl(''),
      website: new FormControl('', [Validators.pattern(/^https?:\/\/.+\..+/)]),
      joinable: new FormControl(false),
    });
  }

  private cleanFormData(formData: any): any {
    const cleaned: any = {};

    Object.keys(formData).forEach((key) => {
      const value = formData[key];
      // Convert empty strings to null for optional string fields
      if (typeof value === 'string' && value.trim() === '') {
        cleaned[key] = null;
      } else {
        cleaned[key] = value;
      }
    });

    return cleaned;
  }

  private handleCommitteeSuccess(action: 'created' | 'updated'): void {
    this.submitting.set(false);

    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: `${this.committeeLabel} ${action} successfully`,
    });

    this.router.navigate(['/groups']);
  }

  private handleCommitteeError(error: any, operation: 'create' | 'update'): void {
    console.error(`Error ${operation} committee:`, error);
    this.submitting.set(false);

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: `Failed to ${operation} ${this.committeeLabel.toLowerCase()}. Please try again.`,
    });
  }
}
