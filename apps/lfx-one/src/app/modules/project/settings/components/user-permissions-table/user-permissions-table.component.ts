// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, WritableSignal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { ProjectPermissionUser } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectService } from '@services/project.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { UserFormComponent } from '../user-form/user-form.component';

@Component({
  selector: 'lfx-user-permissions-table',
  standalone: true,
  imports: [CommonModule, TableComponent, TooltipModule, CardComponent, ConfirmDialogModule, ButtonComponent, MenuComponent],
  templateUrl: './user-permissions-table.component.html',
})
export class UserPermissionsTableComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectService = inject(ProjectService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);

  // State signals
  public users = input.required<ProjectPermissionUser[]>();
  public loading = input<boolean>();
  public project = this.projectService.project;
  public isRemoving: WritableSignal<string | null> = signal(null);
  public selectedUser: WritableSignal<ProjectPermissionUser | null> = signal(null);
  public userActionMenuItems: MenuItem[] = this.initializeUserActionMenuItems();

  // Output events
  public readonly refresh = output<void>();

  // Event handlers
  protected onEditUser(user: ProjectPermissionUser): void {
    if (!user) return;

    this.dialogService
      .open(UserFormComponent, {
        header: 'Edit User Permissions',
        width: '500px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          isEditing: true,
          user: user,
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.refresh.emit();
        }
      });
  }

  protected toggleUserActionMenu(event: Event, user: ProjectPermissionUser, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.selectedUser.set(user);
    menuComponent.toggle(event);
  }

  protected onRemoveUser(user: ProjectPermissionUser): void {
    if (!user) return;

    const userName = user.username;

    this.confirmationService.confirm({
      message: `Are you sure you want to remove ${userName} from this project? This will revoke all their permissions for this project
      and cannot be undone.`,
      header: 'Remove User',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.removeUser(user);
      },
    });
  }

  private removeUser(user: ProjectPermissionUser): void {
    if (!this.project()) return;

    this.isRemoving.set(user.username);

    this.permissionsService
      .removeUserFromProject(this.project()!.uid, user.username)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.isRemoving.set(null);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'User removed successfully.',
            life: 3000,
          });

          // Emit event to parent component to refresh the data
          this.refresh.emit();
        },
        error: (error) => {
          console.error('Failed to remove user:', error);
          this.isRemoving.set(null);

          let errorMessage = 'Failed to remove user. Please try again.';

          // Provide more specific error messages based on error status
          if (error?.status === 404) {
            errorMessage = 'User not found. They may have already been removed.';
          } else if (error?.status === 403) {
            errorMessage = 'You do not have permission to remove this user.';
          } else if (error?.status === 500) {
            errorMessage = 'Server error occurred. Please try again later.';
          } else if (error?.status === 0) {
            errorMessage = 'Network error. Please check your connection and try again.';
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Remove Failed',
            detail: errorMessage,
            life: 5000,
          });
        },
      });
  }

  private initializeUserActionMenuItems(): MenuItem[] {
    return [
      {
        label: 'Edit',
        icon: 'fa-light fa-edit',
        command: () => this.onEditUser(this.selectedUser()!),
      },
      {
        separator: true,
      },
      {
        label: 'Remove',
        icon: 'fa-light fa-user-minus',
        command: () => this.onRemoveUser(this.selectedUser()!),
      },
    ];
  }
}
