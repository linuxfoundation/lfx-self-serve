// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { ApplicationHistoryComponent } from './components/application-history/application-history.component';
import { MenteeProfileDetailsComponent } from './components/mentee-profile-details/mentee-profile-details.component';
import { MenteeProfileEditDrawerComponent } from './components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from './components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.service';

/**
 * Mentee Profile child of the mentee shell — mounts at `mentee/profile` inside
 * `MenteePageComponent`'s `<router-outlet>`.
 *
 * Composes three sections: the shared `lfx-mentorship-profile-card` (LFX identity
 * summary — name, emails, linked accounts), the mentee's own profile details (About Me,
 * Skills, Areas to Improve, Additional Notes, Resume), and Application History
 * (`applications` with `role = mentee`).
 *
 * The profile-card owns its own fetch, so this page only loads the mentorship-side
 * fields. On failure it degrades to the empty response and surfaces a retry so a
 * transient BFF error never leaves the mentee stranded on a spinner. The shell owns
 * the page H1 and the tab bar, so nothing here renders either.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile',
  imports: [
    ProfileCardComponent,
    MenteeProfileDetailsComponent,
    ApplicationHistoryComponent,
    MenteeProfileEditDrawerComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
  ],
  providers: [MenteeProfileEditDrawerService],
  templateUrl: './mentee-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly drawerService = inject(MenteeProfileEditDrawerService);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly reloadProfile = signal(0);
  private readonly profileState: Signal<MentorshipMenteeProfileResponse> = this.initProfile();

  protected readonly profile = computed(() => this.profileState().profile);
  protected readonly history = computed(() => this.profileState().history ?? []);

  protected onEditProfile(): void {
    this.drawerService.open(this.profile());
  }

  protected retry(): void {
    this.reloadProfile.update((value) => value + 1);
  }

  private initProfile(): Signal<MentorshipMenteeProfileResponse> {
    return toSignal(
      toObservable(this.reloadProfile).pipe(
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.mentorshipService.getMenteeProfile().pipe(
            map((response) => {
              this.hasLoaded.set(true);
              if (!Array.isArray(response.history)) {
                console.warn('[MenteeProfile] GET /api/mentorship/mentee/profile omitted history; rendering an empty application list');
              }
              return response;
            }),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, 'We could not load your mentee profile. Please retry.'));
              return of(EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE);
            })
          )
        )
      ),
      { initialValue: EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE }
    );
  }
}
