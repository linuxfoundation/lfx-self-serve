// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  createEmptyMentorshipMenteeForm,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER,
  MENTORSHIP_MENTEE_EXPORT_DISCLAIMER,
  MENTORSHIP_MENTEE_INTRODUCTION_INTRO,
  MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX,
  MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX,
  MENTORSHIP_MENTEE_REGISTER_TITLE,
  MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL,
  MENTORSHIP_MENTEE_SKILLS_INTRO,
  MENTORSHIP_MENTEE_SKILLS_WANT_LABEL,
  MENTORSHIP_MENTEE_TERMS_INTRO,
  MENTORSHIP_MENTOR_COMPLIANCE_ITEMS,
  MENTORSHIP_MENTOR_COMPLIANCE_LEAD,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeRegisterForm } from '@lfx-one/shared/interfaces';
import { getMentorshipMenteeRegisterErrors } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { startWith } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { SkillsPickerComponent } from '../../components/skills-picker/skills-picker.component';
import { TermsAcknowledgementComponent } from '../../components/terms-acknowledgement/terms-acknowledgement.component';
import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';
import { MenteeDemographicsSectionComponent } from './components/mentee-demographics-section/mentee-demographics-section.component';
import { MenteeEligibilitySectionComponent } from './components/mentee-eligibility-section/mentee-eligibility-section.component';
import { MenteeResumeSectionComponent } from './components/mentee-resume-section/mentee-resume-section.component';

/**
 * Become a Mentee registration form. Mirrors `MentorRegisterComponent`'s shape: one flat
 * FormGroup, error text derived in `@lfx-one/shared/utils`, and errors kept hidden behind
 * `showErrors` until the mentee actually tries to submit. There is no registration endpoint
 * yet, so a complete form stops at the module's coming-soon toast rather than claiming it
 * was submitted.
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
    MenteeResumeSectionComponent,
    ProfileCardComponent,
    SkillsPickerComponent,
    TermsAcknowledgementComponent,
  ],
  templateUrl: './mentee-register.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeRegisterComponent {
  private readonly messageService = inject(MessageService);
  private readonly comingSoon = inject(MentorshipComingSoonService);

  protected readonly title = MENTORSHIP_MENTEE_REGISTER_TITLE;
  protected readonly subtitlePrefix = MENTORSHIP_MENTEE_REGISTER_SUBTITLE_PREFIX;
  protected readonly subtitleSuffix = MENTORSHIP_MENTEE_REGISTER_SUBTITLE_SUFFIX;
  protected readonly introductionIntro = MENTORSHIP_MENTEE_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTEE_SKILLS_INTRO;
  protected readonly skillsHaveLabel = MENTORSHIP_MENTEE_SKILLS_HAVE_LABEL;
  protected readonly skillsWantLabel = MENTORSHIP_MENTEE_SKILLS_WANT_LABEL;
  protected readonly additionalNotesLabel = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL;
  protected readonly additionalNotesPlaceholder = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_PLACEHOLDER;
  protected readonly additionalNotesMax = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX;
  protected readonly exportDisclaimer = MENTORSHIP_MENTEE_EXPORT_DISCLAIMER;
  protected readonly complianceLead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly complianceItems = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
  protected readonly termsIntro = MENTORSHIP_MENTEE_TERMS_INTRO;
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

  private readonly formSnapshot = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly errors = computed(() => (this.showErrors() ? getMentorshipMenteeRegisterErrors(this.currentForm()) : {}));

  protected onSubmit(): void {
    const errors = getMentorshipMenteeRegisterErrors(this.currentForm());
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check your registration', detail: firstError, life: 4000 });
      return;
    }

    this.showErrors.set(false);
    // Nothing is persisted yet, so this cannot claim the registration was submitted. The
    // module's coming-soon toast is what every other stubbed mentorship write says.
    this.comingSoon.notify('Submit mentee registration');
  }

  private currentForm(): MentorshipMenteeRegisterForm {
    // Read the snapshot first so `errors` recomputes as the mentee types.
    this.formSnapshot();
    return { ...createEmptyMentorshipMenteeForm(), ...this.form.getRawValue() };
  }
}
