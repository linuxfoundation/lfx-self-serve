// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_CII_CHECKING,
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CII_UNAVAILABLE,
  MENTORSHIP_ENROLL_CANCEL_CONFIRM,
  MENTORSHIP_ENROLL_FORM_INCOMPLETE,
  MENTORSHIP_ENROLL_NAME_CHECKING,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_ENROLL_NAME_UNAVAILABLE,
  MENTORSHIP_ENROLL_STEP_LABELS,
  MENTORSHIP_ENROLL_STEPS_ORDER,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiLookupStatus,
  MentorshipEnrollForm,
  MentorshipEnrollStep,
  MentorshipNameLookupStatus,
  MentorshipPrerequisite,
  MentorshipProgramTerm,
} from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollStepErrors, isMentorshipTermsAccepted } from '@lfx-one/shared/utils';
import { MentorshipService } from '@services/mentorship.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { map, startWith, take, tap } from 'rxjs';

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
  imports: [
    ButtonComponent,
    ConfirmDialogModule,
    EnrollStepperComponent,
    EnrollDetailsStepComponent,
    EnrollSetupStepComponent,
    EnrollPrerequisitesStepComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './enroll-program.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollProgramComponent {
  private readonly router = inject(Router);
  private readonly mentorshipService = inject(MentorshipService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly form = new FormGroup({
    importProgramId: new FormControl('', { nonNullable: true }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(MENTORSHIP_ENROLL_NAME_MIN), Validators.maxLength(MENTORSHIP_ENROLL_NAME_MAX)],
    }),
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
  protected readonly ciiLookupStatus = signal<MentorshipCiiLookupStatus>('idle');
  protected readonly nameLookupStatus = signal<MentorshipNameLookupStatus>('idle');
  protected readonly formIncomplete = MENTORSHIP_ENROLL_FORM_INCOMPLETE;
  /** Set on teardown so a submit that lands after navigation can skip its redirect. */
  private destroyed = false;

  private readonly formSnapshot = toSignal(
    this.form.valueChanges.pipe(
      startWith(this.form.getRawValue()),
      map(() => this.form.getRawValue()),
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
    this.formSnapshot();
    return getMentorshipEnrollStepErrors(this.step(), this.toEnrollForm(this.form.getRawValue()));
  });

  protected readonly hasStepErrors = computed(() => Object.keys(this.stepErrors()).length > 0);

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

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  protected onBack(): void {
    const current = this.step();
    if (current === 'details') {
      this.onCancel();
      return;
    }
    this.showErrors.set(false);
    const index = MENTORSHIP_ENROLL_STEPS_ORDER.indexOf(current);
    this.step.set(MENTORSHIP_ENROLL_STEPS_ORDER[index - 1] ?? 'details');
    this.scrollToTop();
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

    const programName = this.form.controls.name.value.trim();
    if (current === 'details' && programName.length >= MENTORSHIP_ENROLL_NAME_MIN && this.nameLookupStatus() !== 'available') {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail: this.nameLookupMessage(this.nameLookupStatus()), life: 4000 });
      return;
    }

    const ciiId = this.form.controls.ciiProjectId.value.trim();
    if (current === 'details' && ciiId && this.ciiLookupStatus() !== 'valid') {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail: this.ciiLookupMessage(this.ciiLookupStatus()), life: 4000 });
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
    this.scrollToTop();
  }

  protected onCiiLookupStatusChange(status: MentorshipCiiLookupStatus): void {
    if (status === 'idle' && this.form.controls.ciiProjectId.value.trim()) {
      return;
    }
    this.ciiLookupStatus.set(status);
  }

  protected onNameLookupStatusChange(status: MentorshipNameLookupStatus): void {
    if (status === 'idle' && this.form.controls.name.value.trim().length >= MENTORSHIP_ENROLL_NAME_MIN) {
      return;
    }
    this.nameLookupStatus.set(status);
  }

  protected onCancel(): void {
    if (this.submitting()) return;
    this.confirmationService.confirm({
      header: 'Cancel enrollment',
      message: MENTORSHIP_ENROLL_CANCEL_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Yes, cancel',
      rejectLabel: 'Stay',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.revokeLogoPreview();
        void this.router.navigate(['/mentorship/admin']);
      },
    });
  }

  /**
   * Deliberately not torn down with the component: unsubscribing aborts the in-flight create, so
   * navigating mid-submit would leave a program created with no feedback and a retry that hits a
   * name conflict. The toast is app-level and still lands; only the redirect is skipped.
   */
  private submitEnrollment(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.mentorshipService
      .enrollProgram(this.toEnrollForm(this.form.getRawValue()))
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.revokeLogoPreview();
          this.messageService.add({
            severity: 'success',
            summary: 'Enrollment submitted',
            detail: 'Your program was submitted and is pending review.',
            life: 5000,
          });
          if (!this.destroyed) void this.router.navigate(['/mentorship/admin']);
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

  private nameLookupMessage(status: MentorshipNameLookupStatus): string {
    if (status === 'taken') return MENTORSHIP_ENROLL_NAME_TAKEN;
    if (status === 'unavailable') return MENTORSHIP_ENROLL_NAME_UNAVAILABLE;
    return MENTORSHIP_ENROLL_NAME_CHECKING;
  }

  private ciiLookupMessage(status: MentorshipCiiLookupStatus): string {
    if (status === 'invalid') return MENTORSHIP_CII_INVALID_ID;
    if (status === 'unavailable') return MENTORSHIP_CII_UNAVAILABLE;
    return MENTORSHIP_CII_CHECKING;
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
      termsAccepted: isMentorshipTermsAccepted(value.termsAccepted),
    };
  }

  private scrollToTop(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo(0, 0);
    }
  }

  private revokeLogoPreview(): void {
    const url = this.form.controls.logoPreviewUrl.value;
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
