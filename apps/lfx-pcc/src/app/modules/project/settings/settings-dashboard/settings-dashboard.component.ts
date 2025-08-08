// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { UserPermissionSummary } from '@lfx-pcc/shared';
import { PermissionsService } from '@services/permissions.service';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of } from 'rxjs';
import { switchMap, take, tap } from 'rxjs/operators';

import { PermissionsMatrixComponent } from '../components/permissions-matrix/permissions-matrix.component';
import { UserFormComponent } from '../components/user-form/user-form.component';
import { UserPermissionsTableComponent } from '../components/user-permissions-table/user-permissions-table.component';

@Component({
  selector: 'lfx-settings-dashboard',
  imports: [CardComponent, PermissionsMatrixComponent, UserPermissionsTableComponent, MenuComponent],
  templateUrl: './settings-dashboard.component.html',
  styleUrl: './settings-dashboard.component.scss',
})
export class SettingsDashboardComponent {
  private readonly projectService = inject(ProjectService);
  private readonly dialogService = inject(DialogService);
  private readonly permissionsService = inject(PermissionsService);

  public users: Signal<UserPermissionSummary[]>;
  public loading: WritableSignal<boolean> = signal(true);
  public refresh: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  public project = this.projectService.project;
  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Add User',
      icon: 'fa-light fa-user-plus text-sm',
      command: () => this.onAddUser(),
    },
  ];

  public constructor() {
    // Initialize userPermissions signal from service
    this.users = toSignal(
      this.project()?.uid
        ? this.refresh.pipe(
            tap(() => this.loading.set(true)),
            switchMap(() => this.permissionsService.getProjectPermissions(this.project()?.uid as string).pipe(tap(() => this.loading.set(false))))
          )
        : of([]),
      {
        initialValue: [],
      }
    );
  }

  public refreshUsers(): void {
    this.refresh.next();
  }

  private onAddUser(): void {
    this.dialogService
      .open(UserFormComponent, {
        header: 'Add User',
        width: '500px',
        modal: true,
        closable: true,
        dismissableMask: true,
      })
      .onClose.pipe(take(1))
      .subscribe((user) => {
        if (user) {
          this.refreshUsers();
        }
      });
  }
}
