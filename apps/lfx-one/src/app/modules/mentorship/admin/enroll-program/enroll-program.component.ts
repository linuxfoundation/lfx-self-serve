// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_STEP_LABELS,
  MENTORSHIP_ENROLL_STEPS_ORDER,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollForm, MentorshipEnrollStep, MentorshipPrerequisite, MentorshipProgramTerm } from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollStepErrors } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { tap } from 'rxjs';

import { EnrollDetailsStepComponent } from './components/enroll-details-step/enroll-details-step.component';
import { EnrollPrerequisitesStepComponent } from './components/enroll-prerequisites-step/enroll-prerequisites-step.component';
import { EnrollSetupStepComponent } from './components/enroll-setup-step/enroll-setup-step.component';
import { EnrollStepperComponent } from './components/enroll-stepper/enroll-stepper.component';

/**
 * Three-step program enrollment wizard. Ported from menv3 `admin-enroll-tab`
 * and structured like crowdfunding's settings form: one parent FormGroup,
 * step children that bind fields, step validation from `@lfx-one/shared/utils`.
 */
@Component({
  selector: 'lfx-mentorship-enroll-program',
  imports: [ButtonComponent, EnrollStepperComponent, EnrollDetailsStepComponent, EnrollSetupStepComponent, EnrollPrerequisitesStepComponent],
  templateUrl: './enroll-program.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollProgramComponent {
  private readonly router = inject(Router);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);

  protected readonly form = new FormGroup({
    importProgramId: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(MENTORSHIP_ENROLL_NAME_MAX)] }),
    projectId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    technologies: new FormControl<string[]>([], { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
    repositoryUrl: new FormControl('', { nonNullable: true }),
    websiteUrl: new FormControl('', { nonNullable: true }),
    ciiProjectId: new FormControl('', { nonNullable: true }),
    codeOfConductUrl: new FormControl('', { nonNullable: true }),
    logoFileName: new FormControl('', { nonNullable: true }),
    logoPreviewUrl: new FormControl('', { nonNullable: true }),
    skills: new FormControl<string[]>([], { nonNullable: true }),
    terms: new FormControl<MentorshipProgramTerm[]>(createEmptyMentorshipEnrollForm().terms, { nonNullable: true }),
    prerequisites: new FormControl<MentorshipPrerequisite[]>(createEmptyMentorshipEnrollForm().prerequisites, { nonNullable: true }),
    termsAccepted: new FormControl(false, { nonNullable: true }),
  });

  protected readonly step = signal<MentorshipEnrollStep>('details');
  protected readonly showErrors = signal(false);
  protected readonly submitting = signal(false);

  private readonly formSnapshot = toSignal(
    this.form.valueChanges.pipe(
      tap(() => {
        const name = this.form.controls.name.value;
        if (name.length > MENTORSHIP_ENROLL_NAME_MAX) {
          this.form.controls.name.setValue(name.slice(0, MENTORSHIP_ENROLL_NAME_MAX), { emitEvent: false });
        }
      })
    ),
    { initialValue: this.form.getRawValue() }
  );

  protected readonly stepErrors = computed(() => {
    if (!this.showErrors()) return {};
    return getMentorshipEnrollStepErrors(this.step(), this.toEnrollForm(this.formSnapshot()));
  });

  protected readonly backLabel = computed(() => {
    const current = this.step();
    if (current === 'setup') return `Back: ${MENTORSHIP_ENROLL_STEP_LABELS.details}`;
    if (current === 'prerequisites') return `Back: ${MENTORSHIP_ENROLL_STEP_LABELS.setup}`;
    return 'Cancel';
  });

  protected readonly nextLabel = computed(() => {
    const current = this.step();
    if (current === 'details') return `Next: ${MENTORSHIP_ENROLL_STEP_LABELS.setup}`;
    if (current === 'setup') return `Next: ${MENTORSHIP_ENROLL_STEP_LABELS.prerequisites}`;
    return 'Submit';
  });

  protected onBack(): void {
    const current = this.step();
    if (current === 'details') {
      this.onCancel();
      return;
    }
    this.showErrors.set(false);
    const index = MENTORSHIP_ENROLL_STEPS_ORDER.indexOf(current);
    this.step.set(MENTORSHIP_ENROLL_STEPS_ORDER[index - 1] ?? 'details');
  }

  protected onNext(): void {
    const current = this.step();
    const errors = getMentorshipEnrollStepErrors(current, this.toEnrollForm(this.form.getRawValue()));
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail: firstError, life: 4000 });
      return;
    }

    if (current === 'prerequisites') {
      this.submitEnrollment();
      return;
    }

    this.showErrors.set(false);
    const index = MENTORSHIP_ENROLL_STEPS_ORDER.indexOf(current);
    const next = MENTORSHIP_ENROLL_STEPS_ORDER[index + 1];
    if (next) this.step.set(next);
  }

  protected onCancel(): void {
    this.revokeLogoPreview();
    void this.router.navigate(['/mentorship/admin']);
  }

  private submitEnrollment(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.mentorshipService.enrollProgram(this.toEnrollForm(this.form.getRawValue())).subscribe({
      next: () => {
        this.submitting.set(false);
        this.revokeLogoPreview();
        this.messageService.add({
          severity: 'success',
          summary: 'Enrollment submitted',
          detail: 'Your program was submitted and is pending review.',
          life: 5000,
        });
        void this.router.navigate(['/mentorship/admin']);
      },
      error: () => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Enrollment failed',
          detail: 'Could not submit the program. Please try again.',
          life: 5000,
        });
      },
    });
  }

  private toEnrollForm(value: Partial<MentorshipEnrollForm> = this.form.getRawValue()): MentorshipEnrollForm {
    const empty = createEmptyMentorshipEnrollForm();
    return {
      ...empty,
      ...value,
      technologies: [...(value.technologies ?? [])],
      skills: [...(value.skills ?? [])],
      terms: (value.terms ?? empty.terms).map((term) => ({ ...term })),
      prerequisites: (value.prerequisites ?? empty.prerequisites).map((item) => ({ ...item })),
      termsAccepted: value.termsAccepted === true,
    };
  }

  private revokeLogoPreview(): void {
    const url = this.form.controls.logoPreviewUrl.value;
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
