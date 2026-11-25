// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ACCOUNT_WORK_HISTORY_PATH, PROFILE_GRID_LIMIT, PROFILE_INVOLVEMENT_COPY } from '@lfx-one/shared/constants';
import { ProfileInvolvementState } from '@lfx-one/shared/interfaces';
import { buildProfileInvolvement } from '@lfx-one/shared/utils';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ProfileGridComponent } from '@shared/components/profile-section/profile-grid.component';
import { ProfilePillComponent } from '@shared/components/profile-section/profile-pill.component';
import { ProfileSectionEmptyComponent } from '@shared/components/profile-section/profile-section-empty.component';
import { ProfileSectionHintComponent } from '@shared/components/profile-section/profile-section-hint.component';
import { ProfileSectionComponent } from '@shared/components/profile-section/profile-section.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { catchError, forkJoin, map, Observable, of, startWith, switchMap } from 'rxjs';

/**
 * The Profile page's Foundations & projects involvement section (#6085): the user's LFX projects, from the project
 * affiliations the hub's affiliations tab reads, as read-only pills with the role and years, current ones first. Hover or
 * focus opens a card with the role and the dates.
 */
@Component({
  selector: 'lfx-profile-involvement',
  imports: [
    NgTemplateOutlet,
    ProfileGridComponent,
    ProfilePillComponent,
    ProfileSectionComponent,
    ProfileSectionEmptyComponent,
    ProfileSectionHintComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './profile-involvement.component.html',
})
export class ProfileInvolvementComponent {
  // Private injections
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly copy = PROFILE_INVOLVEMENT_COPY;
  protected readonly manageAffiliationsPath = ACCOUNT_WORK_HISTORY_PATH;
  protected readonly skeletons = [0, 1, 2];

  // Simple WritableSignals
  protected readonly expanded = signal(false);
  private readonly reload = signal(0);

  // Complex computed/toSignal signals
  protected readonly state: Signal<ProfileInvolvementState> = this.initState();
  protected readonly items = computed(() => this.state().items);
  protected readonly shown = computed(() => (this.expanded() ? this.items() : this.items().slice(0, PROFILE_GRID_LIMIT)));

  protected retry(): void {
    this.reload.update((count) => count + 1);
  }

  // Private initializer functions
  // Browser only: the projects are the signed-in user's own, read like the hub's affiliations tab reads them.
  private initState(): Signal<ProfileInvolvementState> {
    const loading: ProfileInvolvementState = { loading: true, error: false, items: [] };
    if (!isPlatformBrowser(this.platformId)) return signal(loading);
    return toSignal(toObservable(this.reload).pipe(switchMap(() => this.readInvolvement().pipe(startWith(loading)))), { initialValue: loading });
  }

  // Private helper methods
  // A failed slug read keeps every project, as the hub does; a failed affiliations read is reported with a retry.
  private readInvolvement(): Observable<ProfileInvolvementState> {
    return forkJoin([this.userService.readCdpProjectAffiliations(), this.projectService.getProjectSlugs()]).pipe(
      map(
        ([affiliations, slugs]): ProfileInvolvementState => ({
          loading: false,
          error: false,
          items: buildProfileInvolvement(affiliations, slugs ? new Set(slugs) : null),
        })
      ),
      catchError((error: unknown) => {
        console.warn('[ProfileInvolvement] Failed to load project affiliations', error);
        return of<ProfileInvolvementState>({ loading: false, error: true, items: [] });
      })
    );
  }
}
