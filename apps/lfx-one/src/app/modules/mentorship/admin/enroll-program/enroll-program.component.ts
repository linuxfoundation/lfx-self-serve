// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_CII_CHECKING,
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CII_UNAVAILABLE,
  MENTORSHIP_ENROLL_CANCEL_CONFIRM,
  MENTORSHIP_ENROLL_FORM_INCOMPLETE,
  MENTORSHIP_ENROLL_LEAVE_LOGO_MISSING_CONFIRM,
  MENTORSHIP_ENROLL_LOGO_ACCEPT,
  MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS,
  MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED,
  MENTORSHIP_ENROLL_NAME_CHECKING,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_ENROLL_NAME_MIN,
  MENTORSHIP_ENROLL_NAME_TAKEN,
  MENTORSHIP_ENROLL_NAME_UNAVAILABLE,
  MENTORSHIP_ENROLL_RETRY_LABEL,
  MENTORSHIP_ENROLL_STEP_LABELS,
  MENTORSHIP_ENROLL_STEPS_ORDER,
  MENTORSHIP_ENROLL_SUBMIT_FAILED,
  MENTORSHIP_ENROLL_SUBMIT_SUCCESS,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiLookupStatus,
  MentorshipEnrollForm,
  MentorshipEnrollProgramRef,
  MentorshipEnrollStep,
  MentorshipEnrollSubmitFailure,
  MentorshipEnrollSubmitPhase,
  MentorshipLfProject,
  MentorshipNameLookupStatus,
  MentorshipPrerequisite,
  MentorshipProgramTerm,
} from '@lfx-one/shared/interfaces';
import { getMentorshipEnrollLogoError, getMentorshipEnrollStepErrors, isMentorshipTermsAccepted, toMentorshipEnrollCreateRequest } from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { concatMap, defer, map, of, startWith, tap } from 'rxjs';

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
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly mentorshipAdminService = inject(MentorshipAdminService);
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

  /** What an untouched form reads as; Cancel only asks when the answers differ from it. */
  private readonly initialValue = JSON.stringify(this.form.getRawValue());

  protected readonly step = signal<MentorshipEnrollStep>('details');
  protected readonly showErrors = signal(false);
  protected readonly formIncompleteShown = signal(false);
  // The details step is destroyed when the admin moves on, so the wizard keeps the picked project and logo.
  protected readonly selectedProject = signal<MentorshipLfProject | null>(null);
  protected readonly logoFile = signal<File | null>(null);
  protected readonly logoFieldError = signal('');
  protected readonly nameTakenOnCreate = signal(false);
  protected readonly submitPhase = signal<MentorshipEnrollSubmitPhase>('idle');
  protected readonly createdProgram = signal<MentorshipEnrollProgramRef | null>(null);
  protected readonly logoUploaded = signal(false);
  protected readonly submitFailure = signal<MentorshipEnrollSubmitFailure | null>(null);
  protected readonly submitting = computed(() => this.submitPhase() === 'creating' || this.submitPhase() === 'uploading-logo');
  /** The program exists but its logo is not up: the banner offers Retry and a replacement logo. */
  protected readonly partialSave = computed(() => this.createdProgram() !== null && this.submitPhase() !== 'done');
  protected readonly logoAccept = MENTORSHIP_ENROLL_LOGO_ACCEPT;
  protected readonly retryLabel = MENTORSHIP_ENROLL_RETRY_LABEL;
  protected readonly logoNotUploaded = MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED;
  protected readonly ciiLookupStatus = signal<MentorshipCiiLookupStatus>('idle');
  protected readonly nameLookupStatus = signal<MentorshipNameLookupStatus>('idle');
  protected readonly formIncomplete = MENTORSHIP_ENROLL_FORM_INCOMPLETE;

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
    const errors = getMentorshipEnrollStepErrors(this.step(), this.toEnrollForm(this.form.getRawValue()));
    if (this.step() === 'details' && this.nameTakenOnCreate()) return { ...errors, name: MENTORSHIP_ENROLL_NAME_TAKEN };
    return errors;
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
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.nameTakenOnCreate.set(false));
    this.destroyRef.onDestroy(() => this.revokeLogoPreview());
  }

  /** Route guard hook: asks before the admin leaves with unsaved answers, or after a save that is missing its logo. */
  public canLeave(): boolean | Promise<boolean> {
    if (this.submitPhase() === 'done') return true;
    if (this.createdProgram() && !this.logoUploaded()) {
      return this.askToLeave('Logo missing', MENTORSHIP_ENROLL_LEAVE_LOGO_MISSING_CONFIRM, 'Leave');
    }
    if (!this.hasUnsavedAnswers()) return true;
    return this.askToLeave('Cancel enrollment', MENTORSHIP_ENROLL_CANCEL_CONFIRM, 'Yes, cancel');
  }

  protected onBack(): void {
    this.formIncompleteShown.set(false);
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
    this.formIncompleteShown.set(false);
    const current = this.step();
    const errors = getMentorshipEnrollStepErrors(current, this.toEnrollForm(this.form.getRawValue()));
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail: firstError, life: 4000 });
      return;
    }

    const programName = this.form.controls.name.value.trim();
    const nameUnavailable = this.nameLookupStatus() !== 'available' || this.nameTakenOnCreate();
    if (current === 'details' && programName.length >= MENTORSHIP_ENROLL_NAME_MIN && nameUnavailable) {
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

  /** Navigates away and lets the route guard ask; Cancel and the "My Programs" link share this. */
  protected onCancel(): void {
    void this.router.navigate(['/mentorship/admin']);
  }

  /** Picks a replacement logo from the partial-save banner; the next Retry uploads it. */
  protected onReplaceLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fileError = getMentorshipEnrollLogoError(file);
    if (fileError) {
      this.logoFieldError.set(fileError);
      input.value = '';
      return;
    }
    this.logoFieldError.set('');
    this.logoFile.set(file);
    this.logoUploaded.set(false);
  }

  /** Create, then upload the logo. A retry skips whichever step already succeeded. */
  protected submitEnrollment(): void {
    if (this.submitting()) return;
    const project = this.selectedProject();
    if (!this.logoFile() || !project) {
      this.formIncompleteShown.set(true);
      this.showErrors.set(true);
      this.step.set('details');
      this.scrollToTop();
      return;
    }

    this.submitFailure.set(null);
    this.logoFieldError.set('');
    defer(() => {
      const existing = this.createdProgram();
      if (existing) return of(existing);
      this.submitPhase.set('creating');
      return this.mentorshipAdminService.createProgram(toMentorshipEnrollCreateRequest(this.form.getRawValue(), project)).pipe(
        tap((program) => {
          this.createdProgram.set(program);
          // What was saved must stay what is shown.
          this.form.disable({ emitEvent: false });
        })
      );
    })
      .pipe(
        concatMap((program) =>
          defer(() => {
            const logo = this.logoFile();
            if (this.logoUploaded() || !logo) return of(program);
            this.submitPhase.set('uploading-logo');
            return this.mentorshipAdminService.uploadProgramLogo(program.id, logo).pipe(tap(() => this.logoUploaded.set(true)));
          })
        )
      )
      .subscribe({
        next: () => this.finishSubmit(),
        error: (error: unknown) => this.failSubmit(error),
      });
  }

  private finishSubmit(): void {
    this.submitPhase.set('done');
    this.messageService.add({ severity: 'success', summary: 'Success', detail: MENTORSHIP_ENROLL_SUBMIT_SUCCESS, life: 4000 });
    void this.router.navigate(['/mentorship/admin']);
  }

  private failSubmit(error: unknown): void {
    this.submitPhase.set('failed');
    if (this.createdProgram()) {
      this.failLogoUpload(this.statusOf(error));
      return;
    }
    this.failCreate(error);
  }

  private failCreate(error: unknown): void {
    const status = this.statusOf(error);
    if (status === 409) {
      this.nameTakenOnCreate.set(true);
      this.nameLookupStatus.set('taken');
      this.showErrors.set(true);
      this.step.set('details');
      this.scrollToTop();
      return;
    }
    const readOnly = error instanceof HttpErrorResponse && status === 403 && error.error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE;
    const message = readOnly ? serverAuthoredMessage(error, MENTORSHIP_ENROLL_SUBMIT_FAILED) : MENTORSHIP_ENROLL_SUBMIT_FAILED;
    this.submitFailure.set({ step: 'create', message });
  }

  private failLogoUpload(status: number): void {
    this.logoFieldError.set(MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS[status] ?? '');
    this.submitFailure.set({ step: 'logo', message: MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED });
  }

  private askToLeave(header: string, message: string, acceptLabel: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.confirmationService.confirm({
        header,
        message,
        icon: 'fa-light fa-triangle-exclamation',
        acceptLabel,
        rejectLabel: 'Stay',
        acceptButtonStyleClass: 'p-button-sm p-button-danger',
        rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private statusOf(error: unknown): number {
    return error instanceof HttpErrorResponse ? error.status : 0;
  }

  private hasUnsavedAnswers(): boolean {
    return !!this.logoFile() || JSON.stringify(this.form.getRawValue()) !== this.initialValue;
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
