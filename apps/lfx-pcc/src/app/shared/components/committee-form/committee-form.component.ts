// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { SelectComponent } from '@app/shared/components/select/select.component';
import { InputTextComponent } from '@app/shared/components/input-text/input-text.component';
import { TextareaComponent } from '@app/shared/components/textarea/textarea.component';
import { ToggleComponent } from '@app/shared/components/toggle/toggle.component';
import { CommitteeService } from '@app/shared/services/committee.service';
import { ProjectService } from '@app/shared/services/project.service';
import { COMMITTEE_CATEGORIES } from '@lfx-pcc/shared/constants';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-committee-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, SelectComponent, InputTextComponent, TextareaComponent, ToggleComponent],
  templateUrl: './committee-form.component.html',
  styleUrl: './committee-form.component.scss',
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

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  // Form submission handler
  protected handleSubmit(): void {
    this.markAllFieldsAsTouched();

    if (this.form().valid) {
      const isEditingMode = this.isEditing();
      const formValue = this.form().value;
      const committeeId = this.committeeId();

      this.submitting.set(true);

      if (isEditingMode && committeeId) {
        // Update existing committee
        this.committeeService.updateCommittee(committeeId, formValue).subscribe({
          next: () => {
            this.submitting.set(false);
            this.handleSuccess();
          },
          error: (error) => {
            this.submitting.set(false);
            this.handleError('Failed to update committee:', error);
          },
        });
      } else {
        // Create new committee
        this.committeeService.createCommittee(formValue).subscribe({
          next: () => {
            this.submitting.set(false);
            this.handleSuccess();
          },
          error: (error) => {
            this.submitting.set(false);
            this.handleError('Failed to create committee:', error);
          },
        });
      }
    } else {
      this.markAllFieldsAsTouched();
    }
  }

  // Cancel handler
  protected handleCancel(): void {
    if (this.config.data?.onCancel) {
      this.config.data.onCancel();
    } else {
      this.dialogRef.close();
    }
  }

  private initializeForm(): void {
    const committee = this.committee();
    const projectId = this.config.data?.projectId || this.projectService.project()?.id;

    if (committee) {
      // Populate form with existing committee data
      this.form.set(this.createCommitteeFormGroup(committee));
    } else {
      // Create empty form and set project_id if available
      const form = this.createCommitteeFormGroup();
      if (projectId) {
        form.patchValue({ project_id: projectId });
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

  // Success handler
  private handleSuccess(): void {
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
  private handleError(message: string, error: any): void {
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

  private createCommitteeFormGroup(committee?: any): FormGroup {
    return new FormGroup({
      name: new FormControl(committee?.name || '', [Validators.required]),
      category: new FormControl(committee?.category || '', [Validators.required]),
      description: new FormControl(committee?.description || ''),
      business_email_required: new FormControl(committee?.business_email_required || false),
      enable_voting: new FormControl(committee?.enable_voting || false),
      is_audit_enabled: new FormControl(committee?.is_audit_enabled || false),
      public_enabled: new FormControl(committee?.public_enabled || false),
      public_name: new FormControl(committee?.public_name || ''),
      sso_group_enabled: new FormControl(committee?.sso_group_enabled || false),
      sso_group_name: new FormControl(committee?.sso_group_name || ''),
      committee_website: new FormControl(committee?.committee_website || '', [Validators.pattern(/^https?:\/\/.+\..+/)]),
      project_id: new FormControl(committee?.project_id || ''),
    });
  }
}
