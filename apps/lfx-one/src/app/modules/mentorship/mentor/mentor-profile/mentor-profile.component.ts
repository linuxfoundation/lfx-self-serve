// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTOR_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMentoringHistoryEntry, MentorshipMentorProfileResponse, MentorshipMentorProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { catchError, EMPTY, map, of, Subject, switchMap, tap } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MentorProfileEditDrawerComponent } from './components/mentor-profile-edit-drawer/mentor-profile-edit-drawer.component';
import { MentorProfileEditDrawerService } from './components/mentor-profile-edit-drawer/mentor-profile-edit-drawer.service';
import { MentorProfileDetailsComponent } from './components/mentor-profile-details/mentor-profile-details.component';
import { MentoringHistoryComponent } from './components/mentoring-history/mentoring-history.component';

/**
 * Mentor Profile child of the mentor shell — mounts at `mentor/profile` inside
 * `MentorPageComponent`'s `<router-outlet>`.
 *
 * Composes three sections: the shared `lfx-mentorship-profile-card` (LFX identity
 * summary — name, emails, linked accounts), the mentor's own profile details (About Me,
 * Skills), and a read-only Mentoring History.
 *
 * The profile-card owns its own fetch, so this page only loads the mentorship-side
 * fields. On failure it degrades to the empty response and surfaces a retry so a
 * transient BFF error never leaves the mentor stranded on a spinner. The shell owns
 * the page H1 and the tab bar, so nothing here renders either.
 *
 * Saving the edit drawer shows the saved profile in place (`savedProfile`) instead of re-reading it, so the page
 * never flashes its loading state. The edit cannot change the history, which keeps the loaded rows. A Retry drops
 * that override so the freshly loaded data wins.
 *
 * Accepting an invitation in the drawer can add a membership to the history, so the page re-reads the profile
 * quietly and takes only its history (`refreshedHistory`): no loading state, and the profile shown, and any
 * unsaved drawer edits, stay as they are. A failed re-read keeps the rows already shown. A Retry drops it too.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile',
  imports: [
    ProfileCardComponent,
    MentorProfileDetailsComponent,
    MentoringHistoryComponent,
    MentorProfileEditDrawerComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
  ],
  providers: [MentorProfileEditDrawerService],
  templateUrl: './mentor-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileComponent {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly drawerService = inject(MentorProfileEditDrawerService);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);

  private readonly reloadProfile = signal(0);
  private readonly savedProfile = signal<MentorshipMentorProfileUpdateResponse | null>(null);
  private readonly refreshedHistory = signal<MentorshipMentoringHistoryEntry[] | null>(null);
  private readonly historyRefresh$ = new Subject<void>();
  private readonly profileState: Signal<MentorshipMentorProfileResponse> = this.initProfile();

  protected readonly profile = computed(() => this.savedProfile()?.profile ?? this.profileState().profile);
  protected readonly history = computed(() => this.refreshedHistory() ?? this.profileState().history);

  public constructor() {
    this.historyRefresh$
      .pipe(
        switchMap(() =>
          this.mentorService.getMentorProfile().pipe(
            map((response) => response.history),
            catchError((error: HttpErrorResponse) => {
              console.error('[MentorProfileComponent] history refresh failed', error);
              return EMPTY;
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((history) => this.refreshedHistory.set(history));
  }

  protected onEditProfile(): void {
    this.drawerService.open(this.profile());
  }

  protected onProfileSaved(response: MentorshipMentorProfileUpdateResponse): void {
    this.savedProfile.set(response);
  }

  protected onInvitationAccepted(): void {
    this.historyRefresh$.next();
  }

  protected retry(): void {
    this.reloadProfile.update((value) => value + 1);
  }

  private initProfile(): Signal<MentorshipMentorProfileResponse> {
    return toSignal(
      toObservable(this.reloadProfile).pipe(
        tap(() => {
          this.savedProfile.set(null);
          this.refreshedHistory.set(null);
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.mentorService.getMentorProfile().pipe(
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
