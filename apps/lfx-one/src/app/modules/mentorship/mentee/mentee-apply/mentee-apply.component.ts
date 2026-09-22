// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, model, signal, Signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_MENTEE_APPLY_CANCEL_LABEL,
  MENTORSHIP_MENTEE_APPLY_CONFIRMATION_COUNT,
  MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_TITLE,
  MENTORSHIP_MENTEE_APPLY_MISSING_SUBTITLE,
  MENTORSHIP_MENTEE_APPLY_MISSING_TITLE,
  MENTORSHIP_MENTEE_APPLY_PROFILE_SUBTITLE,
  MENTORSHIP_MENTEE_APPLY_PROFILE_TITLE,
  MENTORSHIP_MENTEE_APPLY_REMAINING_LABEL,
  MENTORSHIP_MENTEE_APPLY_SUBMIT_LABEL,
  MENTORSHIP_MENTEE_APPLY_TITLE_PREFIX,
  MENTORSHIP_MENTEE_PROFILE_CREATED_STATE,
  MENTORSHIP_MENTEE_SHELL_TITLE,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeApplyTarget, MentorshipMenteeProfileResponse } from '@lfx-one/shared/interfaces';
import { mentorshipMenteeApplyIds } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { catchError, combineLatest, forkJoin, map, of, switchMap } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MenteeProfileDetailsComponent } from '../mentee-profile/components/mentee-profile-details/mentee-profile-details.component';
import { MenteeProfileEditDrawerComponent } from '../mentee-profile/components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from '../mentee-profile/components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.service';
import { MenteeApplyDemographicsComponent } from './components/mentee-apply-demographics/mentee-apply-demographics.component';
import { MenteeBeforeYouApplyComponent } from './components/mentee-before-you-apply/mentee-before-you-apply.component';
import { MenteeDemographicsEditDrawerComponent } from './components/mentee-demographics-edit-drawer/mentee-demographics-edit-drawer.component';

/**
 * Mentee apply review. Opened from the mentorship site with `programId` and
 * `programTermId`. Lives outside the mentee shell so it can own its own header.
 */
@Component({
  selector: 'lfx-mentorship-mentee-apply',
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    RouteLoadingComponent,
    ProfileCardComponent,
    MenteeProfileDetailsComponent,
    MenteeProfileEditDrawerComponent,
    MenteeApplyDemographicsComponent,
    MenteeBeforeYouApplyComponent,
    MenteeDemographicsEditDrawerComponent,
  ],
  providers: [MenteeProfileEditDrawerService],
  templateUrl: './mentee-apply.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeApplyComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly profileDrawer = inject(MenteeProfileEditDrawerService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly demographicsDrawer = viewChild(MenteeDemographicsEditDrawerComponent);
  private readonly beforeYouApply = viewChild(MenteeBeforeYouApplyComponent);

  protected readonly backLabel = MENTORSHIP_MENTEE_SHELL_TITLE;
  protected readonly titlePrefix = MENTORSHIP_MENTEE_APPLY_TITLE_PREFIX;
  protected readonly profileTitle = MENTORSHIP_MENTEE_APPLY_PROFILE_TITLE;
  protected readonly profileSubtitle = MENTORSHIP_MENTEE_APPLY_PROFILE_SUBTITLE;
  protected readonly missingTitle = MENTORSHIP_MENTEE_APPLY_MISSING_TITLE;
  protected readonly missingSubtitle = MENTORSHIP_MENTEE_APPLY_MISSING_SUBTITLE;
  protected readonly loadErrorTitle = MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_TITLE;
  protected readonly remainingLabel = MENTORSHIP_MENTEE_APPLY_REMAINING_LABEL;
  protected readonly submitLabel = MENTORSHIP_MENTEE_APPLY_SUBMIT_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTEE_APPLY_CANCEL_LABEL;
  protected readonly cancelRoute = '/mentorship/mentee/overview';

  protected readonly hasLoaded = signal(false);
  protected readonly missingParams = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly demographicsOpen = model(false);

  private readonly reload = signal(0);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly applyIds = computed(() => mentorshipMenteeApplyIds(this.queryParamMap()));
  private readonly pageState: Signal<{ target: MentorshipMenteeApplyTarget; profile: MentorshipMenteeProfileResponse } | null> = this.initPage();

  protected readonly page = computed(() => this.pageState());
  protected readonly profileCreated = computed(() => history.state?.[MENTORSHIP_MENTEE_PROFILE_CREATED_STATE] ?? false);
  protected readonly remaining = computed(() => this.beforeYouApply()?.remaining() ?? MENTORSHIP_MENTEE_APPLY_CONFIRMATION_COUNT);

  protected onEditProfile(): void {
    const profile = this.page()?.profile.profile;
    if (!profile) return;
    this.profileDrawer.open(profile);
  }

  protected onEditDemographics(): void {
    this.demographicsDrawer()?.seed(this.page()?.profile.demographics);
    this.demographicsOpen.set(true);
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  /** There is no applications POST yet, so a complete set of checks only reports that submit is not available. */
  protected onSubmit(): void {
    if (this.remaining() > 0 && !this.profileCreated()) return;
    this.comingSoon.notify(this.submitLabel);
  }

  private initPage(): Signal<{ target: MentorshipMenteeApplyTarget; profile: MentorshipMenteeProfileResponse } | null> {
    return toSignal(
      combineLatest([toObservable(this.reload), toObservable(this.applyIds)]).pipe(
        switchMap(([, ids]) => {
          if (!ids) {
            this.hasLoaded.set(true);
            this.missingParams.set(true);
            this.loadError.set(null);
            return of(null);
          }

          this.hasLoaded.set(false);
          this.missingParams.set(false);
          this.loadError.set(null);
          return forkJoin({
            target: this.mentorshipService.getMenteeApplyTarget(ids.programId, ids.programTermId),
            profile: this.mentorshipService.getMenteeProfile(),
          }).pipe(
            map((result) => {
              this.hasLoaded.set(true);
              return result;
            }),
            catchError((error: HttpErrorResponse) => {
              this.hasLoaded.set(true);
              this.loadError.set(serverAuthoredMessage(error, MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_FALLBACK));
              return of(null);
            })
          );
        })
      ),
      { initialValue: null }
    );
  }
}
