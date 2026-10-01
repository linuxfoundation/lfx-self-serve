// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import {
  createEmptyMentorshipMentorForm,
  MENTORSHIP_MENTOR_COMPLIANCE_ITEMS,
  MENTORSHIP_MENTOR_COMPLIANCE_LEAD,
  MENTORSHIP_MENTOR_EXPORT_DISCLAIMER,
  MENTORSHIP_MENTOR_INTRODUCTION_INTRO,
  MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS,
  MENTORSHIP_MENTOR_REGISTER_PROFILE_EXISTS_CONTINUE,
  MENTORSHIP_MENTOR_REGISTER_SUBTITLE,
  MENTORSHIP_MENTOR_REGISTER_TITLE,
  MENTORSHIP_MENTOR_RESUME_INTRO,
  MENTORSHIP_MENTOR_SKILLS_INTRO,
  MENTORSHIP_MENTOR_SUBMIT_SUCCESS_DETAIL,
  MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_TERMS_INTRO,
  MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_WITHDRAW_LABEL,
  MENTORSHIP_REGISTER_WARN_SUMMARY,
} from '@lfx-one/shared/constants';
import {
  MentorshipMentorOpenProgram,
  MentorshipMentorProgramRequest,
  MentorshipMentorRegisterFieldErrors,
  MentorshipMentorRegisterForm,
  MentorshipMentorRegisterSubmitFailure,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipMentorRegisterRequest, getMentorshipMentorRegisterErrors, mapMentorshipRegisterFailure } from '@lfx-one/shared/utils';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, map, of, startWith } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { ResumeSectionComponent } from '../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../components/skills-picker/skills-picker.component';
import { TermsAcknowledgementComponent } from '../../components/terms-acknowledgement/terms-acknowledgement.component';
import { MentorProgramRequestService } from '../../services/mentor-program-request.service';
import { MentorProgramsSectionComponent } from './components/mentor-programs-section/mentor-programs-section.component';

/**
 * Become a Mentor registration form. Ported from menv3 `mentor-register`.
 *
 * `mentorRegisterGuard` sends a user who already has a mentor profile to My Programs, so
 * this form only renders for someone without one (or when the check failed).
 *
 * Validation follows the enroll wizard: one parent FormGroup, error text derived in
 * `@lfx-one/shared/utils`, and errors kept hidden behind `showErrors` until the mentor
 * actually tries to submit. A complete form is sent to `POST /api/mentorship/mentor/profile`;
 * on success the mentor lands on My Programs. A failed save shows an inline banner that an
 * edit dismisses, except for profile-exists and read-only, which editing cannot fix.
 *
 * Picked programs stay on this page until the profile saves, since upstream takes a mentor's
 * request only once the profile exists. Then one request goes out per program, one at a time,
 * through `MentorProgramRequestService`, which toasts each failure by program name; the mentor
 * lands on My Programs either way. The resume file name stays local: there is no upload endpoint yet.
 */
@Component({
  selector: 'lfx-mentorship-mentor-register',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    ConfirmDialogModule,
    RichEditorComponent,
    MentorProgramsSectionComponent,
    ProfileCardComponent,
    ResumeSectionComponent,
    SkillsPickerComponent,
    TermsAcknowledgementComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './mentor-register.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorRegisterComponent {
  private readonly mentorService = inject(MentorshipMentorService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly programRequests = inject(MentorProgramRequestService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly title = MENTORSHIP_MENTOR_REGISTER_TITLE;
  protected readonly subtitle = MENTORSHIP_MENTOR_REGISTER_SUBTITLE;
  protected readonly introductionIntro = MENTORSHIP_MENTOR_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTOR_SKILLS_INTRO;
  protected readonly resumeIntro = MENTORSHIP_MENTOR_RESUME_INTRO;
  protected readonly complianceLead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly complianceItems = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
  protected readonly termsIntro = MENTORSHIP_MENTOR_TERMS_INTRO;
  protected readonly exportDisclaimer = MENTORSHIP_MENTOR_EXPORT_DISCLAIMER;
  protected readonly profileExistsContinueLabel = MENTORSHIP_MENTOR_REGISTER_PROFILE_EXISTS_CONTINUE;
  protected readonly cancelRoute = '/mentorship/admin';

  /** The card above the form: its name, email and picture go into the registration as they stand at submit. */
  private readonly profileCard = viewChild(ProfileCardComponent);

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
    resumeFileName: new FormControl('', { nonNullable: true }),
    complianceAccepted: new FormControl(false, { nonNullable: true }),
    termsAccepted: new FormControl(false, { nonNullable: true }),
  });

  /**
   * The programs picked so far, as pending rows. Starts empty — someone without a mentor profile
   * has no requests upstream — and stays local until the profile saves; see the class doc.
   */
  protected readonly requests = signal<MentorshipMentorProgramRequest[]>([]);
  protected readonly showErrors = signal(false);
  protected readonly submitting = signal(false);

  private readonly programsState = this.initPrograms();

  protected readonly programs = computed(() => this.programsState().programs);
  /** True until the first emission, so the picker shows a loading state instead of an empty list. */
  protected readonly programsLoading = computed(() => this.programsState().loading);

  private readonly formSnapshot = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /** The last failed save with the form as it stood when it arrived, so an edit can dismiss it. */
  private readonly submitFailure = signal<{ failure: MentorshipMentorRegisterSubmitFailure; formKey: string } | null>(null);
  private readonly formKey = computed(() => JSON.stringify(this.currentForm()));

  protected readonly visibleFailure = this.initVisibleFailure();
  protected readonly errors = this.initErrors();

  protected onAddProgram(program: MentorshipMentorOpenProgram): void {
    if (this.requests().some((request) => request.programId === program.id)) return;
    this.requests.update((requests) => [...requests, { id: `req_${program.id}`, programId: program.id, programName: program.name, status: 'pending' }]);
  }

  protected onWithdraw(requestId: string): void {
    // Nothing has been sent yet, so this only drops the pick; it confirms anyway so the prompt
    // matches the one the profile drawer shows before a real withdraw.
    this.confirmationService.confirm({
      header: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
      message: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: MENTORSHIP_MENTOR_WITHDRAW_LABEL,
      rejectLabel: MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.requests.update((requests) => requests.filter((request) => request.id !== requestId));
      },
    });
  }

  protected onSubmit(): void {
    if (this.submitting()) return;

    const form = this.currentForm();
    const errors = getMentorshipMentorRegisterErrors(form);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: MENTORSHIP_REGISTER_WARN_SUMMARY, detail: firstError, life: 4000 });
      return;
    }

    this.showErrors.set(false);
    this.submitFailure.set(null);
    this.submitting.set(true);

    this.mentorService
      .registerMentorProfile(buildMentorshipMentorRegisterRequest(form, this.profileCard()?.lfxProfileFields()))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.onRegistered(),
        error: (error: unknown) => this.onRegisterFailed(error),
      });
  }

  /** The profile-exists banner's button: the profile is already there, so this goes where a save would have. */
  protected onContinue(): void {
    void this.router.navigate(['/mentorship/mentor/programs']);
  }

  /**
   * The published programs a mentor can ask to join. A failed read (already logged by the service) leaves
   * the picker empty rather than blocking registration, since requesting a program is optional.
   * `loading` flips on the first emission — failure included — because either way the picker has
   * all the options it is ever going to get.
   */
  private initPrograms() {
    return toSignal(
      this.mentorService.getOpenPrograms().pipe(
        map((response) => ({ programs: response.data, loading: false })),
        catchError(() => of({ programs: [] as MentorshipMentorOpenProgram[], loading: false }))
      ),
      { initialValue: { programs: [] as MentorshipMentorOpenProgram[], loading: true } }
    );
  }

  private initVisibleFailure(): Signal<MentorshipMentorRegisterSubmitFailure | null> {
    return computed(() => {
      const stored = this.submitFailure();
      if (!stored) return null;
      const sticky = stored.failure.kind === 'profile-exists' || stored.failure.kind === 'read-only';
      return sticky || stored.formKey === this.formKey() ? stored.failure : null;
    });
  }

  private initErrors(): Signal<MentorshipMentorRegisterFieldErrors> {
    return computed(() => ({
      ...(this.visibleFailure()?.fieldErrors ?? {}),
      ...(this.showErrors() ? getMentorshipMentorRegisterErrors(this.currentForm()) : {}),
    }));
  }

  private onRegistered(): void {
    this.messageService.add({
      severity: 'success',
      summary: MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY,
      detail: MENTORSHIP_MENTOR_SUBMIT_SUCCESS_DETAIL,
      life: 4000,
    });

    // Not tied to this view's lifetime: the requests and their toasts must finish even if the
    // mentor leaves first. The service never errors, so My Programs follows whatever the outcome.
    const programs = this.requests().map((request) => ({ id: request.programId, name: request.programName }));
    this.programRequests.requestMany(programs).subscribe(() => this.navigateToPrograms());
  }

  private navigateToPrograms(): void {
    // Reset in `finally` so a redirected or cancelled navigation cannot leave Submit stuck loading.
    void this.router.navigate(['/mentorship/mentor/programs']).finally(() => this.submitting.set(false));
  }

  private onRegisterFailed(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const body = error instanceof HttpErrorResponse ? error.error : null;
    const failure = mapMentorshipRegisterFailure(status, body, MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS);

    // Keyed to the form as it stands now, not as it was sent. The fields are inert while the save is in flight,
    // but a write made in that window from code would leave a sent-form key unmatched and the failure unseen.
    this.submitFailure.set({ failure, formKey: this.formKey() });
    this.submitting.set(false);
    if (failure.kind === 'field-errors') {
      this.messageService.add({ severity: 'warn', summary: MENTORSHIP_REGISTER_WARN_SUMMARY, detail: failure.message, life: 4000 });
    }
  }

  private currentForm(): MentorshipMentorRegisterForm {
    // Read the snapshot first so `errors` recomputes as the mentor types.
    this.formSnapshot();
    return { ...createEmptyMentorshipMentorForm(), ...this.form.getRawValue() };
  }
}
