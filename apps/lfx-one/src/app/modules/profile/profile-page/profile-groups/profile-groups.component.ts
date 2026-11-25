// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { outputFromObservable, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { PROFILE_GROUP_GRID_LIMIT, PROFILE_GROUP_LINK_STATE, PROFILE_GROUPS_COPY, PROFILE_GROUPS_PATH } from '@lfx-one/shared/constants';
import { ProfileGroupsState } from '@lfx-one/shared/interfaces';
import { buildProfileGroups } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProfileGridComponent } from '@shared/components/profile-section/profile-grid.component';
import { ProfileSectionEmptyComponent } from '@shared/components/profile-section/profile-section-empty.component';
import { ProfileSectionHintComponent } from '@shared/components/profile-section/profile-section-hint.component';
import { ProfileSectionComponent } from '@shared/components/profile-section/profile-section.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiHoverCardDirective } from '@shared/uikit/hover-card/hover-card.directive';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { catchError, distinctUntilChanged, map, Observable, of, startWith, switchMap } from 'rxjs';

/**
 * The Profile page's Group participation section (#6086): the user's seats on boards, committees and working groups, as cards
 * that open the group, six before "View all (N)". Hover or focus opens a card with the type, the user's role, the description
 * and the member count.
 */
@Component({
  selector: 'lfx-profile-groups',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    ProfileGridComponent,
    ProfileSectionComponent,
    ProfileSectionEmptyComponent,
    ProfileSectionHintComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiHoverCardDirective,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './profile-groups.component.html',
})
export class ProfileGroupsComponent {
  // Private injections
  private readonly committeeService = inject(CommitteeService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly copy = PROFILE_GROUPS_COPY;
  protected readonly findGroupsPath = PROFILE_GROUPS_PATH;
  protected readonly limit = PROFILE_GROUP_GRID_LIMIT;
  protected readonly linkState = PROFILE_GROUP_LINK_STATE;
  protected readonly skeletons = [0, 1, 2];

  // Simple WritableSignals
  protected readonly expanded = signal(false);
  private readonly reload = signal(0);

  // Complex computed/toSignal signals
  protected readonly state: Signal<ProfileGroupsState> = this.initState();
  protected readonly items = computed(() => this.state().items);
  protected readonly shown = computed(() => (this.expanded() ? this.items() : this.items().slice(0, this.limit)));

  /** Whether the section has nothing to show once loaded: null while it loads or after a failed read. */
  public readonly emptyChange = outputFromObservable(
    toObservable(this.state).pipe(
      map((state) => (state.loading || state.error ? null : state.items.length === 0)),
      distinctUntilChanged()
    )
  );

  protected retry(): void {
    this.reload.update((count) => count + 1);
  }

  // Private initializer functions
  // Browser only: the groups are the signed-in user's own.
  private initState(): Signal<ProfileGroupsState> {
    const loading: ProfileGroupsState = { loading: true, error: false, items: [] };
    if (!isPlatformBrowser(this.platformId)) return signal(loading);
    return toSignal(toObservable(this.reload).pipe(switchMap(() => this.readGroups().pipe(startWith(loading)))), { initialValue: loading });
  }

  // Private helper methods
  private readGroups(): Observable<ProfileGroupsState> {
    return this.committeeService.getMyCommitteesOrError().pipe(
      map((committees): ProfileGroupsState => ({ loading: false, error: false, items: buildProfileGroups(committees) })),
      catchError((error: unknown) => {
        console.warn('[ProfileGroups] Failed to load groups', error);
        return of<ProfileGroupsState>({ loading: false, error: true, items: [] });
      })
    );
  }
}
