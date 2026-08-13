// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG, JOIN_MODE_LABELS } from '@lfx-one/shared/constants';
import type { GroupBehavioralClass, PublicGroupDirectoryVm } from '@lfx-one/shared/interfaces';
import { TagComponent } from '@components/tag/tag.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HeaderComponent } from '@components/header/header.component';
import { GroupService } from '@services/group.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-public-project-groups',
  imports: [RouterLink, TagComponent, EmptyStateComponent, HeaderComponent, SkeletonModule],
  templateUrl: './public-project-groups.component.html',
})
export class PublicProjectGroupsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly groupService = inject(GroupService);

  protected readonly loading = signal(true);
  protected readonly fetchError = signal(false);

  private readonly directoryData = toSignal(
    this.route.paramMap.pipe(
      map((params) => params.get('projectSlug') ?? ''),
      switchMap((slug) => {
        this.loading.set(true);
        this.fetchError.set(false);
        return this.groupService.getPublicProjectGroups(slug).pipe(
          map((response) => {
            this.loading.set(false);
            return response;
          }),
          catchError(() => {
            this.loading.set(false);
            this.fetchError.set(true);
            return of(null);
          })
        );
      })
    )
  );

  protected readonly groupsVm: Signal<PublicGroupDirectoryVm[]> = computed(() =>
    (this.directoryData()?.groups ?? []).map((g) => ({
      ...g,
      classConfig: BEHAVIORAL_CLASS_CONFIG[g.behavioral_class as GroupBehavioralClass] ?? BEHAVIORAL_CLASS_CONFIG['other'],
      joinLabel: g.join_mode ? JOIN_MODE_LABELS[g.join_mode] : undefined,
    }))
  );

  protected readonly total: Signal<number> = computed(() => this.directoryData()?.total ?? 0);
  protected readonly projectName: Signal<string> = computed(() => this.directoryData()?.groups[0]?.context?.project_name ?? '');
  protected readonly foundationName: Signal<string> = computed(() => this.directoryData()?.groups[0]?.context?.foundation_name ?? '');
}
