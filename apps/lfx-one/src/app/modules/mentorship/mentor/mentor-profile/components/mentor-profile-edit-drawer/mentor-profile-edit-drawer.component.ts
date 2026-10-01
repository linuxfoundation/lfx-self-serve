// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  MENTORSHIP_MENTOR_INTRODUCTION_INTRO,
  MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTOR_RESUME_INTRO,
  MENTORSHIP_MENTOR_SKILLS_INTRO,
} from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram, MentorshipMentorProfileDetails, MentorshipMentorRequestsState } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { catchError, filter, finalize, map, of, startWith, switchMap } from 'rxjs';

import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorProgramRequestService } from '../../../../services/mentor-program-request.service';
import { MentorRequestWithdrawService } from '../../../../services/mentor-request-withdraw.service';
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MentorProgramsSectionComponent } from '../../../mentor-register/components/mentor-programs-section/mentor-programs-section.component';
import { MentorProfileEditDrawerService } from './mentor-profile-edit-drawer.service';

/**
 * Right-side mentor profile edit drawer, opened from the "Edit Mentor Profile" button
 * on the standalone mentor profile page. Mirrors the Become a Mentor registration form
 * sections — program details, introduction, skills, and resume — in a drawer layout.
 *
 * Program requests are live: picking a program sends the request at once, and Withdraw (shown only
 * on pending rows) confirms and withdraws at once. Both leave the toasts to their services and the
 * refresh to `MentorshipMentorService`, whose revision signal makes the list re-read after a write.
 * Save still fires the coming-soon toast until the profile update endpoint is wired; it persists
 * none of the profile fields.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile-edit-drawer',
  imports: [
    ConfirmDialogModule,
    DrawerModule,
    ButtonComponent,
    RichEditorComponent,
    MentorProgramsSectionComponent,
    SkillsPickerComponent,
    ResumeSectionComponent,
  ],
  providers: [ConfirmationService, MentorRequestWithdrawService],
  templateUrl: './mentor-profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileEditDrawerComponent {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly programRequests = inject(MentorProgramRequestService);
  private readonly withdrawService = inject(MentorRequestWithdrawService);
  private readonly comingSoon = inject(MentorshipComingSoonService);
  protected readonly drawer = inject(MentorProfileEditDrawerService);

  protected readonly title = MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL;
  protected readonly saveLabel = MENTORSHIP_MENTOR_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTOR_PROFILE_CANCEL_LABEL;
  protected readonly introductionIntro = MENTORSHIP_MENTOR_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTOR_SKILLS_INTRO;
  protected readonly resumeIntro = MENTORSHIP_MENTOR_RESUME_INTRO;

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
    resumeFileName: new FormControl('', { nonNullable: true }),
  });

  /** True while a picked program's request is in flight; the picker is disabled meanwhile. */
  protected readonly requesting = signal(false);
  protected readonly withdrawingId = this.withdrawService.withdrawingId;

  private readonly programsState = this.initPrograms();
  private readonly requestsState = this.initRequests();
  protected readonly programs = computed(() => this.programsState().programs);
  protected readonly requests = computed(() => this.requestsState().requests);
  protected readonly invitedProgramIds = computed(() => this.requestsState().invitedProgramIds);
  protected readonly requestsFailed = computed(() => this.requestsState().failed);
  protected readonly loading = computed(() => this.programsState().loading || this.requestsState().loading);

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => this.seedForm(profile));
  }

  protected onAddProgram(program: MentorshipMentorOpenProgram): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    // Not tied to the drawer's lifetime: the request and its toast finish even if the drawer closes first.
    this.programRequests
      .request(program)
      .pipe(finalize(() => this.requesting.set(false)))
      .subscribe();
  }

  protected onWithdraw(requestId: string): void {
    this.withdrawService.confirmWithdraw(requestId);
  }

  /** Dropping the cache bumps the revision, so the request list reads again. */
  protected onRetryRequests(): void {
    this.mentorService.clearMentorCaches();
  }

  protected onSave(): void {
    this.comingSoon.notify(MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL);
    this.drawer.close();
  }

  protected onCancel(): void {
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  /**
   * Load the programs taking mentor requests when the drawer opens. switchMap cancels a prior
   * open's in-flight request so a slow earlier load can't overwrite a later one. A failed read
   * (already logged by the service) leaves the picker empty.
   */
  private initPrograms() {
    const empty = { programs: [] as MentorshipMentorOpenProgram[], loading: true };

    return toSignal(
      toObservable(this.drawer.context).pipe(
        filter(Boolean),
        switchMap(() =>
          this.mentorService.getOpenPrograms().pipe(
            map((response) => ({ programs: response.data, loading: false })),
            catchError(() => of({ programs: [] as MentorshipMentorOpenProgram[], loading: false })),
            startWith(empty)
          )
        )
      ),
      { initialValue: empty }
    );
  }

  /**
   * Load the mentor's requests when the drawer opens, and again whenever a request or withdraw
   * bumps `mentorRequestsRevision`. Only an open shows the loading state, so a refresh after a
   * write keeps the current rows until the new ones arrive. A failed read (already logged by the
   * service) is recorded as failed rather than as an empty list, so the section shows a Retry and keeps
   * the picker disabled instead of offering programs that are already requested.
   */
  private initRequests() {
    const empty: MentorshipMentorRequestsState = { requests: [], invitedProgramIds: [], loading: true, failed: false };
    const failed: MentorshipMentorRequestsState = { requests: [], invitedProgramIds: [], loading: false, failed: true };
    const revision$ = toObservable(this.mentorService.mentorRequestsRevision);

    return toSignal(
      toObservable(this.drawer.context).pipe(
        filter(Boolean),
        switchMap(() =>
          revision$.pipe(
            switchMap(() =>
              this.mentorService.getMentorRequests().pipe(
                map(
                  (response): MentorshipMentorRequestsState => ({
                    requests: response.data,
                    invitedProgramIds: response.invitedProgramIds,
                    loading: false,
                    failed: false,
                  })
                ),
                catchError(() => of(failed))
              )
            ),
            startWith(empty)
          )
        )
      ),
      { initialValue: empty }
    );
  }

  private seedForm(profile: MentorshipMentorProfileDetails): void {
    this.form.patchValue({
      introduction: profile.aboutMe ?? '',
      skills: profile.skills ?? [],
      resumeFileName: profile.resumeFileName ?? '',
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }
}
