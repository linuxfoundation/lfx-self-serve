// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MultiSelectComponent } from '@app/shared/components/multi-select/multi-select.component';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { CreateUserPermissionRequest, PermissionLevel, PermissionScope, UserPermissionSummary } from '@lfx-pcc/shared';
import { CommitteeService } from '@services/committee.service';
import { PermissionsService } from '@services/permissions.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { map, take } from 'rxjs/operators';

@Component({
  selector: 'lfx-user-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent, RadioButtonComponent, MultiSelectComponent, TooltipModule],
  templateUrl: './user-form.component.html',
})
export class UserFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);
  private readonly committeeService = inject(CommitteeService);
  private readonly permissionsService = inject(PermissionsService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createUserFormGroup());
  public loading = signal<boolean>(false);

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public userId = computed(() => this.config.data?.user?.user?.sid || this.config.data?.user?.user?.id);
  public user = computed(() => (this.config.data?.user as UserPermissionSummary) || null);
  public project = this.projectService.project;

  // Form Options
  public committees = this.initCommittees();

  // Permission options
  public permissionScopeOptions = [
    { label: 'Project', value: 'project' as PermissionScope },
    { label: 'Committee', value: 'committee' as PermissionScope },
  ];

  public permissionLevelOptions = [
    { label: 'View', value: 'read' as PermissionLevel },
    { label: 'Manage', value: 'write' as PermissionLevel },
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

    // Prepare user data based on editing mode
    const userData = this.isEditing()
      ? {
          permission_scope: formValue.permission_scope,
          permission_level: formValue.permission_level,
          committee_ids: formValue.permission_scope === 'committee' ? formValue.committee_ids : undefined,
        }
      : ({
          first_name: formValue.first_name,
          last_name: formValue.last_name,
          email: formValue.email,
          username: formValue.username,
          project_id: project.id,
          permission_scope: formValue.permission_scope,
          permission_level: formValue.permission_level,
          committee_ids: formValue.permission_scope === 'committee' ? formValue.committee_ids : undefined,
        } as CreateUserPermissionRequest);

    const operation = this.isEditing()
      ? this.permissionsService.updateUserPermissions(project.id, this.userId()!, userData)
      : this.userService.createUserWithPermissions(userData as CreateUserPermissionRequest);

    operation.pipe(take(1)).subscribe({
      next: (result: UserPermissionSummary) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `User ${this.isEditing() ? 'updated' : 'created'} successfully`,
        });
        this.dialogRef.close(result);
      },
      error: (error: any) => {
        console.error('Error saving user:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditing() ? 'update' : 'create'} user. Please try again.`,
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
      first_name: new FormControl('', [Validators.required]),
      last_name: new FormControl('', [Validators.required]),
      email: new FormControl('', [Validators.required, Validators.email]),
      username: new FormControl(''),
      permission_scope: new FormControl('project' as PermissionScope, [Validators.required]),
      permission_level: new FormControl('read' as PermissionLevel, [Validators.required]),
      committee_ids: new FormControl([]),
    });
  }

  private initCommittees(): Signal<{ label: string; value: string }[]> {
    return toSignal(
      this.committeeService.getCommitteesByProject(this.project()?.id as string).pipe(
        take(1),
        map((committees) =>
          committees.map((committee) => ({
            label: committee.name,
            value: committee.id,
          }))
        )
      ),
      {
        initialValue: [],
      }
    );
  }

  private initializeForm(): void {
    if (this.isEditing() && this.user()) {
      const user = this.user()!;

      // Determine initial permission scope and level
      let permissionScope: PermissionScope = 'project';
      let permissionLevel: PermissionLevel = 'read';
      let committeeIds: string[] = [];

      if (user.projectPermission) {
        permissionScope = 'project';
        permissionLevel = user.projectPermission.level;
      } else if (user.committeePermissions?.length > 0) {
        permissionScope = 'committee';
        permissionLevel = user.committeePermissions[0].level;
        committeeIds = user.committeePermissions.map((cp) => cp.committee.id);
      }

      this.form().patchValue({
        first_name: user.user.first_name || '',
        last_name: user.user.last_name || '',
        email: user.user.email || '',
        username: user.user.username || '',
        permission_scope: permissionScope,
        permission_level: permissionLevel,
        committee_ids: committeeIds,
      });

      // Disable user fields when editing
      this.form().get('first_name')?.disable();
      this.form().get('last_name')?.disable();
      this.form().get('email')?.disable();
      this.form().get('username')?.disable();
    }
  }
}
