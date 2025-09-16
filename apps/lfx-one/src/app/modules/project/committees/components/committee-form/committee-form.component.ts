// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_CATEGORIES } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map } from 'rxjs';

@Component({
  selector: 'lfx-committee-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SelectComponent, InputTextComponent, TextareaComponent, ToggleComponent],
  templateUrl: './committee-form.component.html',
})
export class CommitteeFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly committeeService = inject(CommitteeService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createCommitteeFormGroup());
  public loading = signal<boolean>(false);

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public committeeId = computed(() => this.config.data?.committeeId);
  public committee = computed(() => this.config.data?.committee);

  // Committee category options
  public categoryOptions = COMMITTEE_CATEGORIES;

  // Parent committee options
  public parentCommitteeOptions: Signal<{ label: string; value: string | null }[]> = this.initializeParentCommitteeOptions();

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  // Form submission handler
  protected onSubmit(): void {
    this.markAllFieldsAsTouched();

    if (this.form().valid) {
      const isEditingMode = this.isEditing();
      const rawFormValue = {
        ...this.form().value,
        calendar: {
          public: this.form().value.public || false,
        },
        display_name: this.form().value.display_name || this.form().value.name,
        website: this.form().value.website || null,
        public: true,
      };
      const formValue = this.cleanFormData(rawFormValue);
      const committeeId = this.committeeId();

      this.submitting.set(true);

      if (isEditingMode && committeeId) {
        // Update existing committee
        this.committeeService.updateCommittee(committeeId, formValue).subscribe({
          next: () => {
            this.submitting.set(false);
            this.onSuccess();
          },
          error: (error) => {
            this.submitting.set(false);
            this.onError('Failed to update committee:', error);
          },
        });
      } else {
        // Create new committee
        this.committeeService.createCommittee(formValue).subscribe({
          next: () => {
            this.submitting.set(false);
            this.onSuccess();
          },
          error: (error) => {
            this.submitting.set(false);
            this.onError('Failed to create committee:', error);
          },
        });
      }
    } else {
      this.markAllFieldsAsTouched();
    }
  }

  // Cancel handler
  protected onCancel(): void {
    if (this.config.data?.onCancel) {
      this.config.data.onCancel();
    } else {
      this.dialogRef.close();
    }
  }

  private initializeForm(): void {
    const committee = this.committee();
    const projectId = this.config.data?.projectId || this.projectService.project()?.uid;

    if (committee) {
      // Populate form with existing committee data
      this.form.set(this.createCommitteeFormGroup(committee));
    } else {
      // Create empty form and set project_uid if available
      const form = this.createCommitteeFormGroup();
      if (projectId) {
        form.patchValue({ project_uid: projectId });
      }
      this.form.set(form);
    }
  }

  // Helper method to mark all fields as touched for validation display
  private markAllFieldsAsTouched(): void {
    const form = this.form();
    Object.keys(form.controls).forEach((key) => {
      const control = form.get(key);
      control?.markAsTouched();
    });
  }

  // Helper method to clean form data - convert empty strings to null
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

  // Success handler
  private onSuccess(): void {
    const isEditing = this.isEditing();
    const action = isEditing ? 'updated' : 'created';

    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail: `Committee ${action} successfully`,
      life: 3000,
    });

    if (this.config.data?.onSubmit) {
      this.config.data.onSubmit();
    } else {
      this.dialogRef.close();
    }

    // Refresh the committees list by navigating
    this.refreshCommittees();
  }

  // Error handler
  private onError(message: string, error: any): void {
    console.error(message, error);

    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: message.replace(':', ''),
      life: 5000,
    });
  }

  // Refresh committees list
  private refreshCommittees(): void {
    const project = this.projectService.project();
    if (project) {
      this.router.navigate(['/project', project.slug], { skipLocationChange: true }).then(() => {
        this.router.navigate(['/project', project.slug, 'committees']);
      });
    }
  }

  private initializeParentCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    const projectId = this.config.data?.projectId || this.projectService.project()?.uid;
    if (!projectId) {
      return signal([{ label: 'No Parent Committee', value: null }]);
    }

    return toSignal(
      this.committeeService.getCommitteesByProject(projectId).pipe(
        map((committees: Committee[]) => {
          // Filter to only top-level committees (no parent_uid)
          const topLevelCommittees = committees.filter((committee) => !committee.parent_uid);

          // If editing, exclude the current committee
          const currentCommitteeId = this.committee()?.id;
          const availableCommittees = currentCommitteeId ? topLevelCommittees.filter((committee) => committee.uid !== currentCommitteeId) : topLevelCommittees;

          // Transform to dropdown options
          const options = availableCommittees.map((committee) => ({
            label: committee.name,
            value: committee.uid,
          }));

          // Add "No Parent Committee" option at the beginning
          return [{ label: 'No Parent Committee', value: null }, ...options];
        })
      ),
      { initialValue: [{ label: 'No Parent Committee', value: null }] }
    );
  }

  private createCommitteeFormGroup(committee?: any): FormGroup {
    return new FormGroup({
      name: new FormControl(committee?.name || '', [Validators.required]),
      category: new FormControl(committee?.category || '', [Validators.required]),
      description: new FormControl(committee?.description || ''),
      parent_uid: new FormControl(committee?.parent_uid || null),
      business_email_required: new FormControl(committee?.business_email_required || false),
      enable_voting: new FormControl(committee?.enable_voting || false),
      is_audit_enabled: new FormControl(committee?.is_audit_enabled || false),
      public: new FormControl(committee?.public || false),
      display_name: new FormControl(committee?.display_name || ''),
      sso_group_enabled: new FormControl(committee?.sso_group_enabled || false),
      sso_group_name: new FormControl(committee?.sso_group_name || ''),
      website: new FormControl(committee?.website || '', [Validators.pattern(/^https?:\/\/.+\..+/)]),
      project_uid: new FormControl(committee?.project_uid || ''),
      joinable: new FormControl(committee?.joinable || false),
    });
  }
}
