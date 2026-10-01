// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import { EMPTY_MENTORSHIP_MENTEE_PROFILE_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileResponse, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import { MenteeApplicationWithdrawService } from '@modules/mentorship/services/mentee-application-withdraw.service';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
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
 *
 * Withdrawing from Application History confirms first. The profile re-reads whenever the
 * mentee's applications change (`menteeApplicationsRevision`), so the withdrawn row shows
 * its new status.
 *
 * Saving the edit drawer shows the saved profile in place (`savedProfile`) instead of re-reading it, so the page
 * never flashes its skeleton. A genuine load (Retry, or a change to the applications) drops that override so the
 * freshly loaded data wins.
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
    ConfirmDialogModule,
  ],
  providers: [MenteeProfileEditDrawerService, ConfirmationService, MenteeApplicationWithdrawService],
  templateUrl: './mentee-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileComponent {
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly drawerService = inject(MenteeProfileEditDrawerService);
  private readonly withdrawService = inject(MenteeApplicationWithdrawService);

  protected readonly hasLoaded = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly withdrawingId = this.withdrawService.withdrawingId;

  private readonly reloadProfile = signal(0);
  /** The profile the last successful save returned. Layered over the loaded state and dropped when a load starts. */
  private readonly savedProfile = signal<MentorshipMenteeProfileUpdateResponse | null>(null);
  private readonly profileState: Signal<MentorshipMenteeProfileResponse> = this.initProfile();

  protected readonly profile = computed(() => this.savedProfile()?.profile ?? this.profileState().profile);
  protected readonly history = computed(() => this.profileState().history ?? []);

  protected onEditProfile(): void {
    this.drawerService.open(this.profile());
  }

  protected onProfileSaved(response: MentorshipMenteeProfileUpdateResponse): void {
    this.savedProfile.set(response);
  }

  protected onWithdraw(applicationId: string): void {
    this.withdrawService.confirmWithdraw(applicationId);
  }

  protected retry(): void {
    this.reloadProfile.update((value) => value + 1);
  }

  private initProfile(): Signal<MentorshipMenteeProfileResponse> {
    return toSignal(
      // A Retry here, or any change to the applications (a withdraw), reads the profile again.
      toObservable(computed(() => [this.reloadProfile(), this.menteeService.menteeApplicationsRevision()])).pipe(
        tap(() => {
          this.savedProfile.set(null);
          this.hasLoaded.set(false);
          this.loadError.set(null);
        }),
        switchMap(() =>
          this.menteeService.getMenteeProfile().pipe(
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
