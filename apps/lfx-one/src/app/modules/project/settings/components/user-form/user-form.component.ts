// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { AddUserToProjectRequest, ProjectPermissionUser, UpdateUserRoleRequest } from '@lfx-one/shared';
import { PermissionsService } from '@services/permissions.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-user-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent, RadioButtonComponent, TooltipModule],
  templateUrl: './user-form.component.html',
})
export class UserFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly permissionsService = inject(PermissionsService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createUserFormGroup());

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public user = computed(() => (this.config.data?.user as ProjectPermissionUser) || null);
  public project = this.projectService.project;

  // Permission options - simplified to only View/Manage
  public permissionLevelOptions = [
    { label: 'View', value: 'view' },
    { label: 'Manage', value: 'manage' },
  ];

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  // Public methods
  public onSubmit(): void {
    // Mark all form controls as touched and dirty to show validation errors
    Object.keys(this.form().controls).forEach((key) => {
      const control = this.form().get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form().invalid) {
      return;
    }

    const project = this.projectService.project();
    if (!project) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project information is required to manage user permissions.',
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.form().value;

    const operation = this.isEditing()
      ? this.permissionsService.updateUserRole(project.uid, this.user()!.username, {
          role: formValue.role,
        } as UpdateUserRoleRequest)
      : this.permissionsService.addUserToProject(project.uid, {
          username: formValue.username,
          role: formValue.role,
        } as AddUserToProjectRequest);

    operation.pipe(take(1)).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `User ${this.isEditing() ? 'updated' : 'added'} successfully`,
        });
        this.dialogRef.close(true);
      },
      error: (error: any) => {
        console.error('Error saving user:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditing() ? 'update' : 'add'} user. Please try again.`,
        });
        this.submitting.set(false);
      },
    });
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  // Private methods
  private createUserFormGroup(): FormGroup {
    return new FormGroup({
      username: new FormControl('', [Validators.required]),
      role: new FormControl('view', [Validators.required]),
    });
  }

  private initializeForm(): void {
    if (this.isEditing() && this.user()) {
      const user = this.user()!;

      this.form().patchValue({
        username: user.username,
        role: user.role,
      });

      // Disable username field when editing
      this.form().get('username')?.disable();
    }
  }
}
