// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER,
  MENTORSHIP_MENTEE_EXPORT_DISCLAIMER,
  MENTORSHIP_MENTEE_INTRODUCTION_INTRO,
  MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTEE_REGISTER_PROFILE_EXISTS_CONTINUE,
  MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX,
  MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX,
  MENTORSHIP_MENTEE_REGISTER_TITLE,
  MENTORSHIP_MENTEE_RESUME_COMING_SOON_SUMMARY,
  MENTORSHIP_MENTEE_RESUME_INTRO,
  MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL,
  MENTORSHIP_MENTEE_SKILLS_INTRO,
  MENTORSHIP_MENTEE_SKILLS_WANT_LABEL,
  MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL,
  MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_CREATED_STATE,
  MENTORSHIP_MENTEE_TERMS_INTRO,
  MENTORSHIP_MENTOR_COMPLIANCE_ITEMS,
  MENTORSHIP_MENTOR_COMPLIANCE_LEAD,
  MENTORSHIP_REGISTER_WARN_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeRegisterFieldErrors, MentorshipMenteeRegisterForm, MentorshipMenteeRegisterSubmitFailure } from '@lfx-one/shared/interfaces';
import {
  buildMentorshipMenteeRegisterRequest,
  createEmptyMentorshipMenteeForm,
  getMentorshipMenteeRegisterErrors,
  mapMentorshipMenteeRegisterFailure,
  mentorshipMenteeApplyIds,
} from '@lfx-one/shared/utils';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { MessageService } from 'primeng/api';
import { startWith } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { ResumeSectionComponent } from '../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../components/skills-picker/skills-picker.component';
import { TermsAcknowledgementComponent } from '../../components/terms-acknowledgement/terms-acknowledgement.component';
import { MenteeDemographicsSectionComponent } from './components/mentee-demographics-section/mentee-demographics-section.component';
import { MenteeEligibilitySectionComponent } from './components/mentee-eligibility-section/mentee-eligibility-section.component';

/**
 * Become a Mentee registration form. Mirrors `MentorRegisterComponent`'s shape: one flat
 * FormGroup, error text derived in `@lfx-one/shared/utils`, and errors kept hidden behind
 * `showErrors` until the mentee actually tries to submit. A complete form is sent to
 * `POST /api/mentorship/mentee/profile`; on success the mentee lands on the apply page they came
 * from, or on the mentee overview.
 *
 * A failed save is stored with the form snapshot as it stands when the failure arrives. Server field errors and the
 * non-sticky banners are derived from that pair (shown only while the form still matches it), so any
 * edit dismisses them and an identical `valueChanges` re-emit does not. The profile-exists and
 * read-only banners stay until the next submit, since editing the form cannot fix either.
 */
@Component({
  selector: 'lfx-mentorship-mentee-register',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    RichEditorComponent,
    TextareaComponent,
    MenteeDemographicsSectionComponent,
    MenteeEligibilitySectionComponent,
    ProfileCardComponent,
    ResumeSectionComponent,
    SkillsPickerComponent,
    TermsAcknowledgementComponent,
  ],
  templateUrl: './mentee-register.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeRegisterComponent {
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly menteeService = inject(MentorshipMenteeService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly title = MENTORSHIP_MENTEE_REGISTER_TITLE;
  protected readonly subtitlePrefix = MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX;
  protected readonly subtitleSuffix = MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX;
  protected readonly introductionIntro = MENTORSHIP_MENTEE_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTEE_SKILLS_INTRO;
  protected readonly skillsHaveLabel = MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL;
  protected readonly skillsWantLabel = MENTORSHIP_MENTEE_SKILLS_WANT_LABEL;
  protected readonly resumeIntro = MENTORSHIP_MENTEE_RESUME_INTRO;
  protected readonly resumeComingSoonSummary = MENTORSHIP_MENTEE_RESUME_COMING_SOON_SUMMARY;
  protected readonly additionalNotesLabel = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL;
  protected readonly additionalNotesPlaceholder = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER;
  protected readonly additionalNotesMax = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX;
  protected readonly exportDisclaimer = MENTORSHIP_MENTEE_EXPORT_DISCLAIMER;
  protected readonly complianceLead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly complianceItems = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
  protected readonly termsIntro = MENTORSHIP_MENTEE_TERMS_INTRO;
  protected readonly profileExistsContinueLabel = MENTORSHIP_MENTEE_REGISTER_PROFILE_EXISTS_CONTINUE;
  protected readonly cancelRoute = '/mentorship/admin';

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skillsHave: new FormControl<string[]>([], { nonNullable: true }),
    skillsWant: new FormControl<string[]>([], { nonNullable: true }),
    additionalNotes: new FormControl('', { nonNullable: true }),
    resumeFileName: new FormControl('', { nonNullable: true }),
    ageConsent: new FormControl(false, { nonNullable: true }),
    age: new FormControl('', { nonNullable: true }),
    raceEthnicityConsent: new FormControl(false, { nonNullable: true }),
    raceEthnicity: new FormControl('', { nonNullable: true }),
    genderConsent: new FormControl(false, { nonNullable: true }),
    gender: new FormControl('', { nonNullable: true }),
    incomeConsent: new FormControl(false, { nonNullable: true }),
    income: new FormControl('', { nonNullable: true }),
    educationConsent: new FormControl(false, { nonNullable: true }),
    education: new FormControl('', { nonNullable: true }),
    ageEligible: new FormControl(false, { nonNullable: true }),
    workAuthorized: new FormControl(false, { nonNullable: true }),
    noDuplicateProfile: new FormControl(false, { nonNullable: true }),
    complianceAccepted: new FormControl(false, { nonNullable: true }),
    termsAccepted: new FormControl(false, { nonNullable: true }),
  });

  protected readonly showErrors = signal(false);
  protected readonly submitting = signal(false);

  private readonly formSnapshot = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  /** The last failed save with the form as it stood when it arrived, so an edit can dismiss it. */
  private readonly submitFailure = signal<{ failure: MentorshipMenteeRegisterSubmitFailure; formKey: string } | null>(null);
  private readonly formKey = computed(() => JSON.stringify(this.currentForm()));

  protected readonly visibleFailure = this.initVisibleFailure();
  protected readonly errors = this.initErrors();

  protected onSubmit(): void {
    if (this.submitting()) return;

    const form = this.currentForm();
    const errors = getMentorshipMenteeRegisterErrors(form);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: MENTORSHIP_REGISTER_WARN_SUMMARY, detail: firstError, life: 4000 });
      return;
    }

    this.showErrors.set(false);
    this.submitFailure.set(null);
    this.submitting.set(true);

    this.menteeService
      .registerMenteeProfile(buildMentorshipMenteeRegisterRequest(form))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.onRegistered(),
        error: (error: unknown) => this.onRegisterFailed(error),
      });
  }

  /** The profile-exists banner's button: the profile is already there, so this goes where a save would have. */
  protected onContinue(): void {
    void this.navigateAfterRegister(false);
  }

  private initVisibleFailure(): Signal<MentorshipMenteeRegisterSubmitFailure | null> {
    return computed(() => {
      const stored = this.submitFailure();
      if (!stored) return null;
      const sticky = stored.failure.kind === 'profile-exists' || stored.failure.kind === 'read-only';
      return sticky || stored.formKey === this.formKey() ? stored.failure : null;
    });
  }

  private initErrors(): Signal<MentorshipMenteeRegisterFieldErrors> {
    return computed(() => ({
      ...(this.visibleFailure()?.fieldErrors ?? {}),
      ...(this.showErrors() ? getMentorshipMenteeRegisterErrors(this.currentForm()) : {}),
    }));
  }

  private onRegistered(): void {
    this.messageService.add({
      severity: 'success',
      summary: MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY,
      detail: MENTORSHIP_MENTEE_SUBMIT_SUCCESS_DETAIL,
      life: 4000,
    });

    // Reset in `finally` so a redirected or cancelled navigation cannot leave Submit stuck loading.
    void this.navigateAfterRegister(true).finally(() => this.submitting.set(false));
  }

  private onRegisterFailed(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const body = error instanceof HttpErrorResponse ? error.error : null;
    const failure = mapMentorshipMenteeRegisterFailure(status, body);

    // Keyed to the form as it stands now, not as it was sent: the form stays editable while the save is
    // in flight, and a failure keyed to the sent form would never match and would vanish unseen.
    this.submitFailure.set({ failure, formKey: this.formKey() });
    this.submitting.set(false);
    if (failure.kind === 'field-errors') {
      this.messageService.add({ severity: 'warn', summary: MENTORSHIP_REGISTER_WARN_SUMMARY, detail: failure.message, life: 4000 });
    }
  }

  /**
   * When the mentee arrived from an apply link, send them back to that same program and term. A
   * fresh save also sets the router state that lets the apply guard allow this one navigation
   * before its profile check is guaranteed to see the new profile. Otherwise land on the overview.
   */
  private navigateAfterRegister(justSaved: boolean): Promise<boolean> {
    const applyIds = mentorshipMenteeApplyIds(this.route.snapshot.queryParamMap);
    if (!applyIds) {
      return this.router.navigate(['/mentorship/mentee/overview']);
    }

    if (justSaved) {
      return this.router.navigate(['/mentorship/mentee/apply'], { queryParams: applyIds, state: { [MENTORSHIP_MENTEE_PROFILE_CREATED_STATE]: true } });
    }
    return this.router.navigate(['/mentorship/mentee/apply'], { queryParams: applyIds });
  }

  private currentForm(): MentorshipMenteeRegisterForm {
    // Read the snapshot first so `errors` recomputes as the mentee types.
    this.formSnapshot();
    return { ...createEmptyMentorshipMenteeForm(), ...this.form.getRawValue() };
  }
}
