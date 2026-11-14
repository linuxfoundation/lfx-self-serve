// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal, WritableSignal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { PROJECT_PERMISSION_ROLE_COLOR, PROJECT_PERMISSION_ROLE_OPTIONS } from '@lfx-one/shared/constants';
import { FilterPillOption, ProjectPermissionRole, ProjectPermissionUser } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TablePageEvent } from 'primeng/table';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { UserFormComponent } from '../user-form/user-form.component';

@Component({
  selector: 'lfx-user-permissions-table',
  imports: [TableComponent, TooltipModule, CardComponent, ConfirmDialogModule, ButtonComponent, MenuComponent, FilterPillsComponent],
  templateUrl: './user-permissions-table.component.html',
})
export class UserPermissionsTableComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly projectContextService = inject(ProjectContextService);

  // State signals
  public users = input.required<ProjectPermissionUser[]>();
  public loading = input<boolean>();
  public canWrite = input<boolean>(false);
  // Each pill shows how many users hold the role; a role nobody holds keeps its plain label
  public readonly roleFilterOptions: Signal<FilterPillOption[]> = this.initRoleFilterOptions();

  // A null selection means "all roles"
  public readonly selectedRole: WritableSignal<ProjectPermissionRole | null> = signal(null);
  // Offset of the first row on the current page, kept here so a filter change can reset it
  public readonly first: WritableSignal<number> = signal(0);
  public isRemoving: WritableSignal<string | null> = signal(null);
  public selectedUser: WritableSignal<ProjectPermissionUser | null> = signal(null);

  // Complex computed/toSignal signals
  public readonly filteredUsers: Signal<ProjectPermissionUser[]> = this.initFilteredUsers();
  public project = computed(() => this.projectContextService.activeContext());
  public userActionMenuItems: MenuItem[] = this.initializeUserActionMenuItems();

  // Output events
  public readonly refresh = output<void>();

  // Event handlers
  protected onRoleFilterToggle(role: string): void {
    this.selectedRole.update((current) => (current === role ? null : (role as ProjectPermissionRole)));
    // A new filter can shrink the result set below the current page's offset, so start from the first page
    this.first.set(0);
  }

  protected onPageChange(event: TablePageEvent): void {
    this.first.set(event.first);
  }

  protected onEditUser(user: ProjectPermissionUser): void {
    if (!user) return;

    (
      this.dialogService.open(UserFormComponent, {
        header: 'Edit User Permissions',
        width: '500px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          isEditing: true,
          user: user,
        },
      }) as DynamicDialogRef
    ).onClose
      .pipe(take(1))
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

  protected getUserInitials(name: string): string {
    if (!name) return '?';

    const parts = name.trim().split(' ');
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }

    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  private removeUser(user: ProjectPermissionUser): void {
    if (!this.project()) return;

    const removeIdentifier = user.username || user.email;
    this.isRemoving.set(removeIdentifier);

    this.permissionsService
      .removeUserFromProject(this.project()!.uid, removeIdentifier, user.duplicateIdentifiers)
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

  private initFilteredUsers(): Signal<ProjectPermissionUser[]> {
    return computed(() => {
      const role = this.selectedRole();
      return role ? this.users().filter((user) => user.role === role) : this.users();
    });
  }

  private initRoleFilterOptions(): Signal<FilterPillOption[]> {
    return computed(() => {
      const users = this.users();
      return PROJECT_PERMISSION_ROLE_OPTIONS.map((option) => {
        const count = users.filter((user) => user.role === option.value).length;
        return {
          id: option.value,
          label: count > 0 ? `${option.label} (${count})` : option.label,
          color: PROJECT_PERMISSION_ROLE_COLOR[option.value],
        };
      });
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
