// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { ProjectPermissionUser } from '@lfx-one/shared';
import { PermissionsService } from '@services/permissions.service';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, catchError, merge, of, switchMap, take, tap } from 'rxjs';

import { PermissionsMatrixComponent } from '../components/permissions-matrix/permissions-matrix.component';
import { UserFormComponent } from '../components/user-form/user-form.component';
import { UserPermissionsTableComponent } from '../components/user-permissions-table/user-permissions-table.component';

@Component({
  selector: 'lfx-settings-dashboard',
  imports: [CardComponent, PermissionsMatrixComponent, UserPermissionsTableComponent, MenuComponent],
  templateUrl: './settings-dashboard.component.html',
})
export class SettingsDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly permissionsService = inject(PermissionsService);
  private readonly dialogService = inject(DialogService);

  public users: Signal<ProjectPermissionUser[]>;
  public loading: WritableSignal<boolean> = signal(true);
  public refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  public project = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Add User',
      icon: 'fa-light fa-user-plus text-sm',
      command: () => this.onAddUser(),
    },
  ];

  public constructor() {
    // Initialize users signal with reactive project context
    this.users = this.initializeUsers();
  }

  public refreshUsers(): void {
    this.refresh$.next();
  }

  private initializeUsers(): Signal<ProjectPermissionUser[]> {
    // Convert project signal to observable to react to project changes
    const project$ = toObservable(this.project);

    return toSignal(
      merge(
        project$, // Triggers on project context changes
        this.refresh$ // Triggers on manual refresh
      ).pipe(
        tap(() => this.loading.set(true)),
        switchMap(() => {
          const project = this.project();
          if (!project?.uid) {
            this.loading.set(false);
            return of([]);
          }

          return this.permissionsService.getProjectPermissions(project.uid).pipe(
            catchError((error) => {
              console.error('Failed to load permissions:', error);
              this.loading.set(false);
              return of([]);
            }),
            tap(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: [] }
    );
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
