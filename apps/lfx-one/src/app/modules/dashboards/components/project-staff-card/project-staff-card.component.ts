// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { ProjectSettings, ProjectStaffRowConfig, UserInfo } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

type StaffRow = ProjectStaffRowConfig & { user: UserInfo | null | undefined };

@Component({
  selector: 'lfx-project-staff-card',
  imports: [AvatarComponent, SkeletonModule, TooltipModule],
  templateUrl: './project-staff-card.component.html',
  styleUrl: './project-staff-card.component.scss',
})
export class ProjectStaffCardComponent {
  private readonly permissionsService = inject(PermissionsService);

  public readonly projectUid = input.required<string>();
  public readonly heading = input<string>('Project Staff');

  // `loading`, `hasError`, and `loaded` are tracked separately so the template can distinguish
  // fetching, fetch failed, and fetch succeeded (including when every role is unassigned).
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly loaded = signal(false);

  protected readonly settings: Signal<ProjectSettings | null> = toSignal(
    toObservable(this.projectUid).pipe(
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

  protected readonly staff: Signal<StaffRow[]> = computed(() => {
    const s = this.settings();
    return PROJECT_STAFF_ROWS.map((row) => ({
      ...row,
      user: s?.[row.key],
    }));
  });
}
