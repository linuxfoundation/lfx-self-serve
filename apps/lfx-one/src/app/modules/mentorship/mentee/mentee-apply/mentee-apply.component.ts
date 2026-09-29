// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, PLATFORM_ID, signal, Signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS,
  MENTORSHIP_MENTEE_APPLY_BLOCKED_STATES,
  MENTORSHIP_MENTEE_APPLY_CANCEL_LABEL,
  MENTORSHIP_MENTEE_APPLY_CONFIRMATION_COUNT,
  MENTORSHIP_MENTEE_APPLY_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY,
  MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_FALLBACK,
  MENTORSHIP_MENTEE_APPLY_LOAD_ERROR_TITLE,
  MENTORSHIP_MENTEE_APPLY_MISSING_SUBTITLE,
  MENTORSHIP_MENTEE_APPLY_MISSING_TITLE,
  MENTORSHIP_MENTEE_APPLY_PROFILE_SUBTITLE,
  MENTORSHIP_MENTEE_APPLY_PROFILE_TITLE,
  MENTORSHIP_MENTEE_APPLY_REMAINING_LABEL,
  MENTORSHIP_MENTEE_APPLY_SUBMIT_LABEL,
  MENTORSHIP_MENTEE_APPLY_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_APPLY_TITLE_PREFIX,
  MENTORSHIP_MENTEE_APPLY_TOAST_LIFE,
  MENTORSHIP_MENTEE_PROFILE_CREATED_STATE,
  MENTORSHIP_MENTEE_SHELL_TITLE,
} from '@lfx-one/shared/constants';
import {
  MentorshipMenteeApplyBlockedReason,
  MentorshipMenteeApplyBlockedState,
  MentorshipMenteeApplyTarget,
  MentorshipMenteeProfileResponse,
  MentorshipMenteeProfileUpdateResponse,
} from '@lfx-one/shared/interfaces';
import { mentorshipMenteeApplyIds } from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, finalize, forkJoin, map, Observable, of, switchMap, throwError } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { MenteeProfileDetailsComponent } from '../mentee-profile/components/mentee-profile-details/mentee-profile-details.component';
import { MenteeProfileEditDrawerComponent } from '../mentee-profile/components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.component';
import { MenteeProfileEditDrawerService } from '../mentee-profile/components/mentee-profile-edit-drawer/mentee-profile-edit-drawer.service';
import { MenteeApplyDemographicsComponent } from './components/mentee-apply-demographics/mentee-apply-demographics.component';
import { MenteeBeforeYouApplyComponent } from './components/mentee-before-you-apply/mentee-before-you-apply.component';
import { MenteeDemographicsEditDrawerComponent } from './components/mentee-demographics-edit-drawer/mentee-demographics-edit-drawer.component';

/**
 * Mentee apply review. Opened from the mentorship site with `programId` and
 * `programTermId`. Lives outside the mentee shell so it can own its own header.
 *
 * Saving either edit drawer shows the saved profile and demographics in place (`savedProfile`) instead of
 * reloading, so the page keeps its target and never flashes its skeleton. A genuine load (Retry, or a change
 * to the program) drops that override so the freshly loaded data wins.
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
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly messageService = inject(MessageService);
  private readonly profileDrawer = inject(MenteeProfileEditDrawerService);
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
  protected readonly blockedReason = signal<MentorshipMenteeApplyBlockedReason | null>(null);
  protected readonly submitting = signal(false);
  protected readonly demographicsOpen = signal(false);
  protected readonly profileCreated = signal(this.readProfileCreated());

  private readonly reload = signal(0);
  /** What the last successful save returned. Layered over the loaded profile and dropped when a load starts. */
  private readonly savedProfile = signal<MentorshipMenteeProfileUpdateResponse | null>(null);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly applyIds = computed(() => mentorshipMenteeApplyIds(this.queryParamMap()));
  private readonly pageState: Signal<{ target: MentorshipMenteeApplyTarget; profile: MentorshipMenteeProfileResponse } | null> = this.initPage();

  protected readonly page = computed(() => {
    const state = this.pageState();
    const saved = this.savedProfile();
    if (!state || !saved) return state;
    // A response without demographics means none are stored, so the summary clears rather than keeping stale answers.
    return { ...state, profile: { ...state.profile, profile: saved.profile, demographics: saved.demographics } };
  });
  protected readonly blocked: Signal<MentorshipMenteeApplyBlockedState | null> = computed(() => {
    const reason = this.blockedReason();
    return reason ? MENTORSHIP_MENTEE_APPLY_BLOCKED_STATES[reason] : null;
  });
  /** Project and term, dropping the project (and its separator) when the program has none. */
  protected readonly subtitle = computed(() => {
    const target = this.pageState()?.target;
    return target ? [target.projectName, target.termName].filter(Boolean).join(' · ') : '';
  });
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

  protected onProfileSaved(response: MentorshipMenteeProfileUpdateResponse): void {
    this.savedProfile.set(response);
  }

  protected retry(): void {
    this.reload.update((value) => value + 1);
  }

  /**
   * Files the application once the checks are complete (or the mentee has just registered). A success
   * toasts and goes to the Overview, which re-reads the applications. A status in
   * `MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS` swaps the form for its blocked state: 422 is
   * closed, 409 is already applied, and 400, 403 and 404 are not found. The impersonation guard's 403
   * and any unmapped status toast instead and keep the form so the mentee can try again.
   */
  protected onSubmit(): void {
    const ids = this.applyIds();
    if (!ids || this.submitting() || (this.remaining() > 0 && !this.profileCreated())) return;

    this.submitting.set(true);
    this.menteeService
      .applyToMenteeTerm(ids)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY,
            detail: MENTORSHIP_MENTEE_APPLY_SUCCESS_DETAIL,
            life: MENTORSHIP_MENTEE_APPLY_TOAST_LIFE,
          });
          void this.router.navigate([this.cancelRoute]);
        },
        error: (err: HttpErrorResponse) => this.showSubmitError(err),
      });
  }

  /**
   * Router `state` from the register redirect (#1509), read once at construction — see `menteeApplyGuard`'s equivalent check.
   * Single-use: cleared from history immediately after read so a later reload or back/forward navigation doesn't replay it.
   * SSR has neither a navigation nor a browser `history`, so it falls back to `false`. The flag only skips the client-side
   * checklist: upstream does not look at the mentee profile when an application is filed, and nothing server-side re-checks it.
   *
   * Always reads and clears against `location.getState()` (the entry actually on top of history right now), never
   * `router.getCurrentNavigation()` — that navigation is still in flight during construction, so `router.url` has not
   * been committed to the current history entry yet, and replacing "the previous URL" with a cleared flag would leave
   * this entry able to replay it. Cloning the current state and deleting only this key (rather than passing `{}`)
   * preserves Angular's own `navigationId` and any other state already on the entry, matching the existing
   * profile-card cleanup pattern.
   */
  private readProfileCreated(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const state = this.location.getState() as Record<string, unknown> | null;
    const { [MENTORSHIP_MENTEE_PROFILE_CREATED_STATE]: profileCreated, ...rest } = state ?? {};
    const created = profileCreated === true;
    if (created) {
      this.location.replaceState(this.location.path(), '', rest);
    }
    return created;
  }

  private initPage(): Signal<{ target: MentorshipMenteeApplyTarget; profile: MentorshipMenteeProfileResponse } | null> {
    return toSignal(
      combineLatest([toObservable(this.reload), toObservable(this.applyIds)]).pipe(
        switchMap(([, ids]) => {
          this.savedProfile.set(null);
          this.blockedReason.set(null);
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
            target: this.loadApplyTarget(ids.programId, ids.programTermId),
            profile: this.menteeService.getMenteeProfile(),
          }).pipe(
            map(({ target, profile }) => {
              this.hasLoaded.set(true);
              if (typeof target === 'string') {
                this.blockedReason.set(target);
                return null;
              }
              if (!target.acceptingApplications) {
                this.blockedReason.set('closed');
                return null;
              }
              return { target, profile };
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

  /** The apply target, or the blocked reason when upstream says the term cannot be applied to (see `MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS`). */
  private loadApplyTarget(programId: string, programTermId: string): Observable<MentorshipMenteeApplyTarget | MentorshipMenteeApplyBlockedReason> {
    return this.menteeService.getMenteeApplyTarget(programId, programTermId).pipe(
      catchError((error: HttpErrorResponse) => {
        const reason = MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS[error.status];
        return reason ? of(reason) : throwError(() => error);
      })
    );
  }

  private showSubmitError(err: HttpErrorResponse): void {
    const code = (err.error as { code?: string } | null | undefined)?.code;
    const reason = MENTORSHIP_MENTEE_APPLY_BLOCKED_REASON_BY_STATUS[err.status];

    if (reason && !(err.status === 403 && code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE)) {
      // An application already exists upstream, so the cached list is missing it.
      if (reason === 'already-applied') this.menteeService.clearMenteeCaches();
      this.blockedReason.set(reason);
      return;
    }

    this.messageService.add({
      severity: 'error',
      summary: MENTORSHIP_MENTEE_APPLY_ERROR_SUMMARY,
      detail: serverAuthoredMessage(err, MENTORSHIP_MENTEE_APPLY_ERROR_FALLBACK),
      life: MENTORSHIP_MENTEE_APPLY_TOAST_LIFE,
    });
  }
}
