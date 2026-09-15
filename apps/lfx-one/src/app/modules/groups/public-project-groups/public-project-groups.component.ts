// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { Component, computed, inject, makeStateKey, PLATFORM_ID, Signal, TransferState } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BEHAVIORAL_CLASS_CONFIG, JOIN_MODE_LABELS } from '@lfx-one/shared/constants';
import type { GroupBehavioralClass, PublicGroupDirectoryPageState, PublicGroupDirectoryVm } from '@lfx-one/shared/interfaces';
import { TagComponent } from '@components/tag/tag.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { HeaderComponent } from '@components/header/header.component';
import { GroupService } from '@services/group.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-public-project-groups',
  imports: [RouterLink, TagComponent, EmptyStateComponent, HeaderComponent, SkeletonModule],
  templateUrl: './public-project-groups.component.html',
})
export class PublicProjectGroupsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly groupService = inject(GroupService);
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  // Persists the SSR-resolved directory so the client's first paint matches the server DOM instead
  // of tearing it down at hydration (GH-2081). Same pattern as `PublicProfilePageComponent`.
  private readonly stateKey = makeStateKey<PublicGroupDirectoryPageState>('publicProjectGroupsState');

  // Single source of truth for the async page state; loading/error/directory derive from it.
  private readonly state: Signal<PublicGroupDirectoryPageState> = this.initDirectory();

  protected readonly loading = computed(() => this.state().loading);
  protected readonly fetchError = computed(() => this.state().error);

  protected readonly groupsVm: Signal<PublicGroupDirectoryVm[]> = computed(() =>
    (this.state().directory?.groups ?? []).map((g) => ({
      ...g,
      classConfig: BEHAVIORAL_CLASS_CONFIG[g.behavioral_class as GroupBehavioralClass] ?? BEHAVIORAL_CLASS_CONFIG['other'],
      joinLabel: g.join_mode ? JOIN_MODE_LABELS[g.join_mode] : undefined,
    }))
  );

  protected readonly total: Signal<number> = computed(() => this.state().directory?.total ?? 0);
  protected readonly projectName: Signal<string> = computed(() => this.state().directory?.groups[0]?.context?.project_name ?? '');
  protected readonly foundationName: Signal<string> = computed(() => this.state().directory?.groups[0]?.context?.foundation_name ?? '');

  private initDirectory(): Signal<PublicGroupDirectoryPageState> {
    const initial: PublicGroupDirectoryPageState = { loading: true, error: false, directory: null };
    // Seed the client's first paint from the SSR-serialized state (matches the server's resolved
    // branch, no skeleton flash). Null on the server and on client navigations with no prior SSR state.
    const transferred = this.transferState.get(this.stateKey, null);
    // Consume the SSR state exactly once so a later re-creation of this component (e.g. a different
    // `/projects/:projectSlug/groups`) can't paint the previous project's directory under the new URL.
    if (isPlatformBrowser(this.platformId) && transferred) {
      this.transferState.remove(this.stateKey);
    }
    return toSignal(
      this.route.paramMap.pipe(
        map((params) => params.get('projectSlug') ?? ''),
        distinctUntilChanged(),
        switchMap((slug, index) =>
          this.groupService.getPublicProjectGroups(slug).pipe(
            map((directory): PublicGroupDirectoryPageState => ({ loading: false, error: false, directory })),
            catchError(() => of<PublicGroupDirectoryPageState>({ loading: false, error: true, directory: null })),
            // During SSR, persist each resolved (non-loading) state so the client can hydrate to the
            // same branch. Angular defers serialization until this tracked HTTP call settles.
            tap((state) => {
              if (isPlatformServer(this.platformId) && !state.loading) {
                this.transferState.set(this.stateKey, state);
              }
            }),
            // Seed the first client emission from the SSR state to avoid a loading flash and a
            // hydration mismatch; every later fetch (and each client-side navigation) re-enters loading.
            startWith(index === 0 && transferred ? transferred : initial)
          )
        )
      ),
      { initialValue: transferred ?? initial }
    );
  }
}
