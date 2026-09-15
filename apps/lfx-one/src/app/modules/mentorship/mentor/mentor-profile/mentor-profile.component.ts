// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileResponse } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MentorProfileDetailsComponent } from './components/mentor-profile-details/mentor-profile-details.component';
import { MentoringHistoryComponent } from './components/mentoring-history/mentoring-history.component';

/**
 * Mentor Profile child of the mentor shell — mounts at `mentor/profile` inside
 * `MentorPageComponent`'s `<router-outlet>`.
 *
 * Composes three sections: the shared `lfx-mentorship-profile-card` (LFX identity
 * summary — name, emails, linked accounts), the mentor's own profile details (About Me,
 * Skills, Resume), and a read-only Mentoring History.
 *
 * The profile-card owns its own fetch, so this page only loads the mentorship-side
 * fields. On failure it degrades to the empty response and surfaces a retry so a
 * transient BFF error never leaves the mentor stranded on a spinner. The shell owns
 * the page H1 and the tab bar, so nothing here renders either.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile',
  imports: [ProfileCardComponent, MentorProfileDetailsComponent, MentoringHistoryComponent, EmptyStateComponent, RouteLoadingComponent],
  templateUrl: './mentor-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly comingSoon = inject(MentorshipComingSoonService);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly reloadProfile = signal(0);
  private readonly profileState: Signal<MentorshipMentorProfileResponse> = this.initProfile();

  protected readonly profile = computed(() => this.profileState().profile);
  protected readonly history = computed(() => this.profileState().history);

  protected onEditProfile(): void {
    this.comingSoon.notify('Edit Mentor Profile');
  }

  protected retry(): void {
    this.reloadProfile.update((value) => value + 1);
  }

  private initProfile(): Signal<MentorshipMentorProfileResponse> {
    return toSignal(
      toObservable(this.reloadProfile).pipe(
        tap(() => {
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.mentorshipService.getMentorProfile().pipe(
            map((response) => {
              this.hasLoaded.set(true);
              return response;
            }),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, 'We could not load your mentor profile. Please retry.'));
              return of(EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE);
            })
          )
        )
      ),
      { initialValue: EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE }
    );
  }
}
