// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { AddUserToProjectRequest, ProjectPermissionUser, UpdateUserRoleRequest } from '@lfx-one/shared';
import { PermissionsService } from '@services/permissions.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-user-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent, RadioButtonComponent, TooltipModule, ConfirmDialogModule],
  templateUrl: './user-form.component.html',
})
export class UserFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly messageService = inject(MessageService);
  private readonly permissionsService = inject(PermissionsService);
  private readonly confirmationService = inject(ConfirmationService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Track if user confirmed manual entry after email not found
  public showManualFields = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createUserFormGroup());

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public user = computed(() => (this.config.data?.user as ProjectPermissionUser) || null);
  public project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

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

    const project = this.project();
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

    // For editing, update role only
    if (this.isEditing()) {
      this.permissionsService
        .updateUserRole(project.projectId, this.user()!.username, {
          role: formValue.role,
        } as UpdateUserRoleRequest)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'User updated successfully',
            });
            this.dialogRef.close(true);
          },
          error: (error: HttpErrorResponse) => {
            console.error('Error updating user:', error);
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: error.error?.message || 'Failed to update user. Please try again.',
            });
            this.submitting.set(false);
          },
        });
      return;
    }

    // For adding: if manual fields not shown yet, try to lookup user by email first
    if (!this.showManualFields()) {
      // Try to add user with just email (backend will resolve to username)
      this.permissionsService
        .addUserToProject(project.projectId, {
          username: formValue.email, // Pass email as username, backend will resolve
          role: formValue.role,
        } as AddUserToProjectRequest)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'User added successfully',
            });
            this.dialogRef.close(true);
          },
          error: (error: HttpErrorResponse) => {
            console.error('Error adding user:', error);

            // Check if it's a 404 error for user not found
            if (error.status === 404 && error.error?.code === 'NOT_FOUND') {
              this.handleUserNotFound(formValue);
            } else {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: error.error?.message || 'Failed to add user. Please try again.',
              });
              this.submitting.set(false);
            }
          },
        });
    } else {
      // Manual fields are shown, submit with all data
      this.addUserWithManualData(formValue);
    }
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  // Private methods
  private handleUserNotFound(formValue: any): void {
    const emailValue = formValue.email;

    // Show confirmation dialog
    const message =
      `No user found with email address "${emailValue}". ` +
      `The system could not locate this user in the directory.\n\n` +
      `Would you like to add them to this project anyway? You will need to manually enter their details.`;

    this.confirmationService.confirm({
      header: 'User Not Found',
      message,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Yes, Continue',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        // User confirmed - show manual entry fields and enable required validation
        this.showManualFields.set(true);
        this.submitting.set(false);

        // Add validators to name and username fields
        this.form().get('name')?.setValidators([Validators.required]);
        this.form().get('username')?.setValidators([Validators.required]);
        this.form().get('name')?.updateValueAndValidity();
        this.form().get('username')?.updateValueAndValidity();

        // Close the confirmation dialog
        this.confirmationService.close();
      },
      reject: () => {
        // User cancelled - reset submitting state
        this.submitting.set(false);

        // Close the confirmation dialog
        this.confirmationService.close();
      },
    });
  }

  private addUserWithManualData(formValue: any): void {
    const project = this.project();
    if (!project) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project information is required.',
      });
      this.submitting.set(false);
      return;
    }

    // Create user data with manually entered information
    const userData: any = {
      name: formValue.name,
      email: formValue.email,
      username: formValue.username,
      role: formValue.role,
    };

    // Only include avatar if it's not empty
    if (formValue.avatar) {
      userData.avatar = formValue.avatar;
    }

    // Since the user doesn't exist in the system, we need to send the full user data
    // The backend should handle this case by accepting UserInfo objects
    this.permissionsService
      .addUserToProject(project.projectId, userData as any)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'User added successfully with manual information',
          });
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => {
          console.error('Error adding user with manual data:', error);
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.error?.message || 'Failed to add user. Please try again.',
          });
          this.submitting.set(false);
        },
      });
  }

  private createUserFormGroup(): FormGroup {
    return new FormGroup({
      email: new FormControl('', [Validators.required, Validators.email]),
      name: new FormControl(''),
      username: new FormControl(''),
      avatar: new FormControl(''),
      role: new FormControl('view', [Validators.required]),
    });
  }

  private initializeForm(): void {
    if (this.isEditing() && this.user()) {
      const user = this.user()!;

      // Show all fields when editing
      this.showManualFields.set(true);

      this.form().patchValue({
        name: user.name,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role: user.role,
      });

      // Disable username, name, email, and avatar fields when editing (user info is immutable)
      this.form().get('username')?.disable();
      this.form().get('name')?.disable();
      this.form().get('email')?.disable();
      this.form().get('avatar')?.disable();
    }
  }
}
