// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ProjectSettings, UserInfo } from '@lfx-one/shared/interfaces';
import { PermissionsService } from '@services/permissions.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

interface StaffRow {
  key: 'executive_director' | 'program_manager' | 'opportunity_owner';
  label: string;
  icon: string;
  user: UserInfo | null | undefined;
}

@Component({
  selector: 'lfx-project-staff-card',
  imports: [AvatarComponent, SkeletonModule],
  templateUrl: './project-staff-card.component.html',
  styleUrl: './project-staff-card.component.scss',
})
export class ProjectStaffCardComponent {
  private readonly permissionsService = inject(PermissionsService);

  public readonly projectUid = input.required<string>();

  // `loading` and `hasError` are tracked separately from `settings` so the template can tell the
  // three states apart: still fetching, fetch failed, fetch succeeded with no staff assigned.
  // Bundling them into `null`-means-both (previous approach) hid genuine fetch failures behind the
  // "No staff assigned" empty state.
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);

  protected readonly settings: Signal<ProjectSettings | null> = toSignal(
    toObservable(this.projectUid).pipe(
      filter((uid): uid is string => !!uid),
      tap(() => {
        this.loading.set(true);
        this.hasError.set(false);
      }),
      switchMap((uid) =>
        this.permissionsService.getProjectSettings(uid).pipe(
          tap(() => this.loading.set(false)),
          catchError(() => {
            this.loading.set(false);
            this.hasError.set(true);
            return of(null);
          })
        )
      )
    ),
    { initialValue: null }
  );

  protected readonly staff: Signal<StaffRow[]> = computed(() => {
    const s = this.settings();
    return [
      { key: 'executive_director', label: 'Executive Director', icon: 'fa-light fa-user-tie', user: s?.executive_director },
      { key: 'program_manager', label: 'Program Manager', icon: 'fa-light fa-user-gear', user: s?.program_manager },
      { key: 'opportunity_owner', label: 'Opportunity Owner', icon: 'fa-light fa-user-chart', user: s?.opportunity_owner },
    ];
  });

  protected readonly hasAnyStaff = computed(() => this.staff().some((row) => !!row.user));
}
