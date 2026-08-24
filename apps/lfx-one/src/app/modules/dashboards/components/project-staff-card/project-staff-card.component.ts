// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { EDITABLE_STAFF_ROLES, PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { EditableStaffRole, ProjectSettings, ProjectStaffRow, StaffEditDialogData } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, filter, map, merge, of, Subject, switchMap, take, tap } from 'rxjs';

import { StaffEditDialogComponent } from './staff-edit-dialog/staff-edit-dialog.component';

@Component({
  selector: 'lfx-project-staff-card',
  imports: [AvatarComponent, SkeletonModule, TooltipModule],
  templateUrl: './project-staff-card.component.html',
  styleUrl: './project-staff-card.component.scss',
})
export class ProjectStaffCardComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogService = inject(DialogService);

  public readonly projectUid = input.required<string>();
  public readonly heading = input<string>('Project Staff');

  // `loading`, `hasError`, and `loaded` are tracked separately so the template can distinguish
  // fetching, fetch failed, and fetch succeeded (including when every role is unassigned).
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly loaded = signal(false);

  /** Writer permission on the active context — gates the per-row edit affordance (mirrors quicklinks). */
  protected readonly canWrite = computed(() => this.projectContextService.canWrite());

  // Manual re-fetch trigger. A Subject (not BehaviorSubject) so nothing emits at subscription
  // time, when the required `projectUid` input is not yet readable (NG0950).
  private readonly refresh$ = new Subject<void>();

  protected readonly settings: Signal<ProjectSettings | null> = this.initSettings();
  protected readonly staff: Signal<ProjectStaffRow[]> = this.initStaff();

  protected openStaffEditor(row: ProjectStaffRow): void {
    if (!row.editable) {
      return;
    }

    const data: StaffEditDialogData = {
      projectUid: this.projectUid(),
      // Safe cast — `editable` is derived from EDITABLE_STAFF_ROLES, exactly the EditableStaffRole keys.
      role: row.key as EditableStaffRole,
      roleLabel: row.label,
      currentUser: row.user ?? null,
    };

    const ref: DynamicDialogRef | null = this.dialogService.open(StaffEditDialogComponent, {
      header: `Edit ${row.label}`,
      width: '500px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    });

    ref?.onClose.pipe(take(1)).subscribe((saved) => {
      if (saved) {
        this.refreshSettings();
      }
    });
  }

  private refreshSettings(): void {
    const uid = this.projectUid();
    if (uid) {
      this.permissionsService.invalidateProjectSettings(uid);
    }
    this.refresh$.next();
  }

  private initSettings(): Signal<ProjectSettings | null> {
    return toSignal(
      merge(
        toObservable(this.projectUid),
        // Post-save refresh re-reads the current uid; refreshSettings() invalidates the
        // shareReplay settings cache first so this never replays the pre-save document.
        this.refresh$.pipe(map(() => this.projectUid()))
      ).pipe(
        filter((uid): uid is string => !!uid),
        tap(() => {
          this.loading.set(true);
          this.hasError.set(false);
          this.loaded.set(false);
        }),
        switchMap((uid) =>
          this.permissionsService.getProjectSettings(uid).pipe(
            tap(() => {
              this.loading.set(false);
              this.loaded.set(true);
            }),
            catchError(() => {
              this.loading.set(false);
              this.hasError.set(true);
              this.loaded.set(false);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initStaff(): Signal<ProjectStaffRow[]> {
    return computed(() => {
      const s = this.settings();
      return PROJECT_STAFF_ROWS.map((row) => ({
        ...row,
        user: s?.[row.key],
        editable: (EDITABLE_STAFF_ROLES as readonly string[]).includes(row.key),
      }));
    });
  }
}
