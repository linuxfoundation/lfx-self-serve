// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
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
  MENTORSHIP_MENTOR_REGISTER_SUBTITLE,
  MENTORSHIP_MENTOR_REGISTER_TITLE,
  MENTORSHIP_MENTOR_SKILLS_INTRO,
  MENTORSHIP_MENTOR_TERMS_INTRO,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProgramRequest, MentorshipMentorRegisterForm, MentorshipProgram } from '@lfx-one/shared/interfaces';
import { getMentorshipMentorRegisterErrors } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { map, startWith } from 'rxjs';

import { ProfileCardComponent } from '../../components/profile-card/profile-card.component';
import { SkillsPickerComponent } from '../../components/skills-picker/skills-picker.component';
import { TermsAcknowledgementComponent } from '../../components/terms-acknowledgement/terms-acknowledgement.component';
import { MentorProgramsSectionComponent } from './components/mentor-programs-section/mentor-programs-section.component';
import { MentorResumeSectionComponent } from './components/mentor-resume-section/mentor-resume-section.component';

/**
 * Become a Mentor registration form. Ported from menv3 `mentor-register`.
 *
 * This is the mentor landing page for now. Once the profiles API can say whether the
 * signed-in user already holds a mentor profile, the route keeps its path and serves the
 * mentor's own landing page instead, falling back to this form when they have none.
 *
 * Validation follows the enroll wizard: one parent FormGroup, error text derived in
 * `@lfx-one/shared/utils`, and errors kept hidden behind `showErrors` until the mentor
 * actually tries to submit. There is no registration endpoint yet, so submit stops at a
 * toast; the program requests and the resume file name are local state either way.
 */
@Component({
  selector: 'lfx-mentorship-mentor-register',
  imports: [
    ButtonComponent,
    CheckboxComponent,
    ConfirmDialogModule,
    RichEditorComponent,
    MentorProgramsSectionComponent,
    MentorResumeSectionComponent,
    ProfileCardComponent,
    SkillsPickerComponent,
    TermsAcknowledgementComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './mentor-register.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorRegisterComponent {
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  protected readonly title = MENTORSHIP_MENTOR_REGISTER_TITLE;
  protected readonly subtitle = MENTORSHIP_MENTOR_REGISTER_SUBTITLE;
  protected readonly introductionIntro = MENTORSHIP_MENTOR_INTRODUCTION_INTRO;
  protected readonly introductionPlaceholder = MENTORSHIP_MENTOR_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTOR_SKILLS_INTRO;
  protected readonly complianceLead = MENTORSHIP_MENTOR_COMPLIANCE_LEAD;
  protected readonly complianceItems = MENTORSHIP_MENTOR_COMPLIANCE_ITEMS;
  protected readonly termsIntro = MENTORSHIP_MENTOR_TERMS_INTRO;
  protected readonly exportDisclaimer = MENTORSHIP_MENTOR_EXPORT_DISCLAIMER;
  protected readonly cancelRoute = '/mentorship/admin';

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
    resumeFileName: new FormControl('', { nonNullable: true }),
    complianceAccepted: new FormControl(false, { nonNullable: true }),
    termsAccepted: new FormControl(false, { nonNullable: true }),
  });

  /**
   * The mentor's program requests. Starts empty and stays local: there is no endpoint to
   * read existing requests from yet, and standing in fake rows would show the mentor
   * requests they never made.
   */
  protected readonly requests = signal<MentorshipMentorProgramRequest[]>([]);
  protected readonly showErrors = signal(false);

  private readonly programsState = this.initPrograms();

  protected readonly programs = computed(() => this.programsState().programs);
  /** True until the first emission, so the picker shows a loading state instead of an empty list. */
  protected readonly programsLoading = computed(() => this.programsState().loading);

  private readonly formSnapshot = toSignal(this.form.valueChanges.pipe(startWith(this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly errors = computed(() => (this.showErrors() ? getMentorshipMentorRegisterErrors(this.currentForm()) : {}));

  protected onAddProgram(program: MentorshipProgram): void {
    if (this.requests().some((request) => request.programId === program.id)) return;
    this.requests.update((requests) => [...requests, { id: `req_${program.id}`, programId: program.id, programName: program.name, status: 'pending' }]);
  }

  protected onWithdraw(requestId: string): void {
    // Confirm first, as the enroll wizard does for deleting a term: an accepted request is
    // not something to drop on a stray click, and this is where the withdraw call will land.
    this.confirmationService.confirm({
      header: 'Withdraw Request',
      message: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Withdraw',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.requests.update((requests) => requests.filter((request) => request.id !== requestId));
      },
    });
  }

  protected onSubmit(): void {
    const errors = getMentorshipMentorRegisterErrors(this.currentForm());
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check your registration', detail: firstError, life: 4000 });
      return;
    }

    this.showErrors.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Registration submitted',
      detail: 'Your mentor registration was submitted and each program admin has been notified.',
      life: 5000,
    });
  }

  /**
   * `MentorshipService.getPrograms` already ends in its own `catchError` returning
   * `EMPTY_MENTORSHIP_PROGRAMS_RESPONSE`, so this stream cannot error and needs no
   * handler of its own. `loading` flips on the first emission — failure included —
   * because either way the picker has all the options it is ever going to get.
   */
  private initPrograms() {
    return toSignal(this.mentorshipService.getPrograms({ status: 'open' }).pipe(map((response) => ({ programs: response.data, loading: false }))), {
      initialValue: { programs: [] as MentorshipProgram[], loading: true },
    });
  }

  private currentForm(): MentorshipMentorRegisterForm {
    // Read the snapshot first so `errors` recomputes as the mentor types.
    this.formSnapshot();
    return { ...createEmptyMentorshipMentorForm(), ...this.form.getRawValue() };
  }
}
