// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject, Signal, signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { UserPermissions } from '@lfx-pcc/shared/interfaces';
import { CommitteeNamesPipe } from '@pipes/committee-names.pipe';
import { PermissionsService } from '@services/permissions.service';
import { ProjectService } from '@services/project.service';
import { TooltipModule } from 'primeng/tooltip';
import { of, tap } from 'rxjs';

@Component({
  selector: 'lfx-user-permissions-table',
  standalone: true,
  imports: [CommonModule, TableComponent, TooltipModule, CommitteeNamesPipe, CardComponent],
  templateUrl: './user-permissions-table.component.html',
})
export class UserPermissionsTableComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectService = inject(ProjectService);

  // State signals
  public userPermissions: Signal<UserPermissions[]>;
  public loading: WritableSignal<boolean> = signal(false);
  public project = this.projectService.project;

  public constructor() {
    // Initialize userPermissions signal from service
    this.userPermissions = toSignal(
      this.project()?.id ? this.permissionsService.getProjectPermissions(this.project()?.id as string).pipe(tap(() => this.loading.set(false))) : of([]),
      {
        initialValue: [],
      }
    );
  }

  // Event handlers
  protected onEditUser(user: UserPermissions): void {
    console.info(user);
    // this.editUser.emit(user);
  }

  protected onRemoveUser(user: UserPermissions): void {
    console.info(user);
    // this.removeUser.emit(user);
  }
}
