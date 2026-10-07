// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { serverAuthoredMessage } from '@app/shared/utils/http-error.utils';
import { ButtonComponent } from '@components/button/button.component';
import { RouteLoadingComponent } from '@components/loading/route-loading.component';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT,
  MENTORSHIP_ADMIN_TERMS_MAX_PAGES,
  MENTORSHIP_CII_CHECKING,
  MENTORSHIP_CII_INVALID_ID,
  MENTORSHIP_CII_UNAVAILABLE,
  MENTORSHIP_ENROLL_CANCEL_CONFIRM,
  MENTORSHIP_ENROLL_EDIT_INTRO,
  MENTORSHIP_ENROLL_EDIT_LOAD_FAILED,
  MENTORSHIP_ENROLL_EDIT_LOGO_NOT_UPLOADED,
  MENTORSHIP_ENROLL_EDIT_TITLE,
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
  MENTORSHIP_ENROLL_PROJECT_REQUIRED,
  MENTORSHIP_ENROLL_RETRY_LABEL,
  MENTORSHIP_ENROLL_STEP_LABELS,
  MENTORSHIP_ENROLL_STEPS_ORDER,
  MENTORSHIP_ENROLL_SUBMIT_FAILED,
  MENTORSHIP_ENROLL_SUBMIT_SUCCESS,
  MENTORSHIP_ENROLL_TERM_DELETE_CONFLICT,
  MENTORSHIP_ENROLL_TERMS_SAVE_FAILED,
  MENTORSHIP_ENROLL_UPDATE_FAILED,
  MENTORSHIP_ENROLL_UPDATE_LABEL,
  MENTORSHIP_ENROLL_UPDATE_SUCCESS,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipCiiLookupStatus,
  MentorshipEnrollEditBaseline,
  MentorshipEnrollFieldErrors,
  MentorshipEnrollForm,
  MentorshipEnrollImport,
  MentorshipEnrollProgramRef,
  MentorshipEnrollStep,
  MentorshipEnrollSubmitFailure,
  MentorshipEnrollSubmitPhase,
  MentorshipLfProject,
  MentorshipNameLookupStatus,
  MentorshipPrerequisite,
  MentorshipProgramTerm,
  MentorshipProgramTermRow,
} from '@lfx-one/shared/interfaces';
import {
  diffMentorshipEnrollTerms,
  formFromMentorshipEnrollEdit,
  getMentorshipEnrollLogoError,
  getMentorshipEnrollStepErrors,
  isMentorshipTermsAccepted,
  toMentorshipAdminTermInput,
  toMentorshipEnrollCreateRequest,
  toMentorshipEnrollTerm,
  toMentorshipEnrollUpdateRequest,
} from '@lfx-one/shared/utils';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, concat, concatMap, defer, EMPTY, expand, forkJoin, map, Observable, of, reduce, startWith, tap, throwError, toArray } from 'rxjs';

import { EnrollDetailsStepComponent } from './components/enroll-details-step/enroll-details-step.component';
import { EnrollPrerequisitesStepComponent } from './components/enroll-prerequisites-step/enroll-prerequisites-step.component';
import { EnrollSetupStepComponent } from './components/enroll-setup-step/enroll-setup-step.component';
import { EnrollStepperComponent } from './components/enroll-stepper/enroll-stepper.component';

/**
 * Three-step program enrollment wizard. Ported from menv3 `admin-enroll-tab`
 * and structured like crowdfunding's settings form: one parent FormGroup,
 * step children that bind fields, step validation from `@lfx-one/shared/utils`.
 *
 * With `?programId=` it edits that program instead: the form is filled from the program, Import and the terms acceptance are
 * left out, the logo is optional, and Update saves the program fields, then the term changes, then a newly picked logo.
 */
@Component({
  selector: 'lfx-mentorship-enroll-program',
  imports: [
    ButtonComponent,
    ConfirmDialogModule,
    RouteLoadingComponent,
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
  private readonly route = inject(ActivatedRoute);
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

  /** What an untouched form reads as, the loaded program's answers in an edit; Cancel only asks when the answers differ from it. */
  private initialValue = JSON.stringify(this.form.getRawValue());
  /** The open terms upstream holds for the edited program. Each saved term write moves it on, so a retry repeats only what failed. */
  private savedTerms: MentorshipProgramTerm[] = [];
  /** Which kind of term write is in flight, so a failure can say what went wrong. */
  private termWrite: 'delete' | 'update' | 'create' | null = null;
  /** The logo file an edit last uploaded. The answers unlock after a failed Update, so the admin may pick another file. */
  private uploadedLogo: File | null = null;

  /** The program being edited, `''` when enrolling a new one. */
  protected readonly editProgramId = this.route.snapshot.queryParamMap.get('programId')?.trim() ?? '';
  protected readonly editing = this.editProgramId !== '';
  protected readonly title = this.editing ? MENTORSHIP_ENROLL_EDIT_TITLE : 'Enroll a Program';
  protected readonly intro = this.editing ? MENTORSHIP_ENROLL_EDIT_INTRO : 'The LFX team reviews every enrollment before it opens for applications.';
  protected readonly backToLabel = this.editing ? 'Back to Program' : 'My Programs';
  protected readonly editLoad = signal<'loading' | 'ready' | 'failed'>(this.editing ? 'loading' : 'ready');
  protected readonly editLoadFailed = MENTORSHIP_ENROLL_EDIT_LOAD_FAILED;
  /** The edited program as it was loaded; validation keeps the dates it already had valid. */
  protected readonly editBaseline = signal<MentorshipEnrollEditBaseline | undefined>(undefined);
  protected readonly closedTerms = signal<MentorshipProgramTerm[]>([]);
  protected readonly currentLogoUrl = signal('');

  protected readonly step = signal<MentorshipEnrollStep>('details');
  protected readonly showErrors = signal(false);
  protected readonly formIncompleteShown = signal(false);
  // The details step is destroyed when the admin moves on, so the wizard keeps the picked project and logo.
  protected readonly selectedProject = signal<MentorshipLfProject | null>(null);
  protected readonly logoFile = signal<File | null>(null);
  protected readonly logoFieldError = signal('');
  protected readonly nameTakenOnSave = signal(false);
  protected readonly submitPhase = signal<MentorshipEnrollSubmitPhase>('idle');
  protected readonly createdProgram = signal<MentorshipEnrollProgramRef | null>(null);
  protected readonly logoUploaded = signal(false);
  protected readonly logoUploadFailed = signal(false);
  protected readonly submitFailure = signal<MentorshipEnrollSubmitFailure | null>(null);
  protected readonly submitting = computed(() => {
    const phase = this.submitPhase();
    return phase === 'creating' || phase === 'updating' || phase === 'saving-terms' || phase === 'uploading-logo';
  });
  /** Once the program is saved, its answers can no longer change. */
  protected readonly programSaved = computed(() => this.createdProgram() !== null);
  /** The program is saved but a logo upload failed: the banner offers Retry and a replacement logo. */
  protected readonly partialSave = computed(() => this.logoUploadFailed() && this.submitPhase() !== 'done');
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
    const errors = this.stepErrorsFor(this.step());
    if (this.step() === 'details' && this.nameTakenOnSave()) return { ...errors, name: MENTORSHIP_ENROLL_NAME_TAKEN };
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
    return this.editing ? MENTORSHIP_ENROLL_UPDATE_LABEL : 'Submit';
  });

  public constructor() {
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.nameTakenOnSave.set(false));
    this.destroyRef.onDestroy(() => this.revokeLogoPreview());
    if (this.editing) this.loadProgram();
  }

  /** Route guard hook: asks before the admin leaves with unsaved answers, or after a save that is missing its logo. */
  public canLeave(): boolean | Promise<boolean> {
    if (this.submitPhase() === 'done') return true;
    // A save in flight decides which prompt is true, so the admin waits for it.
    if (this.submitting()) return false;
    if (this.editing) {
      return this.hasUnsavedAnswers() ? this.askToLeave('Discard changes', MENTORSHIP_ENROLL_CANCEL_CONFIRM, 'Yes, discard') : true;
    }
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
    const errors = this.stepErrorsFor(current);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      this.showErrors.set(true);
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail: firstError, life: 4000 });
      return;
    }

    const programName = this.form.controls.name.value.trim();
    const nameUnavailable = this.nameLookupStatus() !== 'available' || this.nameTakenOnSave();
    if (current === 'details' && programName.length >= MENTORSHIP_ENROLL_NAME_MIN && nameUnavailable) {
      this.showErrors.set(true);
      const detail = this.nameTakenOnSave() ? MENTORSHIP_ENROLL_NAME_TAKEN : this.nameLookupMessage(this.nameLookupStatus());
      this.messageService.add({ severity: 'warn', summary: 'Check this step', detail, life: 4000 });
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

  /** Navigates away and lets the route guard ask; Cancel and the back link share this. An edit goes back to its program. */
  protected onCancel(): void {
    void this.router.navigate(this.editing ? ['/mentorship/admin', this.editProgramId] : ['/mentorship/admin']);
  }

  /** Reads the edited program again after a failed load. */
  protected onRetryLoad(): void {
    this.loadProgram();
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
    const invalidStep = this.invalidSubmitStep();
    if (invalidStep || !project) {
      this.formIncompleteShown.set(true);
      this.showErrors.set(true);
      this.step.set(invalidStep ?? 'details');
      this.scrollToTop();
      return;
    }

    this.submitFailure.set(null);
    this.logoFieldError.set('');
    if (this.editing) {
      this.submitUpdate(project);
      return;
    }
    defer(() => {
      const existing = this.createdProgram();
      if (existing) return of(existing);
      this.submitPhase.set('creating');
      const request = toMentorshipEnrollCreateRequest(this.form.getRawValue(), project);
      // What is sent must stay what is shown, so the answers lock now and unlock only if the create fails.
      this.form.disable({ emitEvent: false });
      return this.mentorshipAdminService.createProgram(request).pipe(tap((program) => this.createdProgram.set(program)));
    })
      .pipe(
        concatMap((program) =>
          defer(() => {
            const logo = this.logoFile();
            if (this.logoUploaded() || !logo) return of(program);
            this.submitPhase.set('uploading-logo');
            return this.mentorshipAdminService.uploadProgramLogo(program.id, logo).pipe(tap(() => this.logoUploaded.set(true)));
          })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => this.finishSubmit(),
        error: (error: unknown) => this.failSubmit(error),
      });
  }

  /** Saves the program fields, then the term changes, then a newly picked logo. A retry runs it again; the term writes already saved are not repeated. */
  private submitUpdate(project: MentorshipLfProject): void {
    const programId = this.editProgramId;
    const request = toMentorshipEnrollUpdateRequest(this.form.getRawValue(), project);
    this.submitPhase.set('updating');
    // What is sent must stay what is shown, so the answers lock until the save ends.
    this.form.disable({ emitEvent: false });
    this.mentorshipAdminService
      .updateProgram(programId, request)
      .pipe(
        concatMap(() => {
          this.submitPhase.set('saving-terms');
          return this.saveTermChanges(programId);
        }),
        concatMap(() => {
          const logo = this.logoFile();
          if (!logo || logo === this.uploadedLogo) return of(null);
          this.submitPhase.set('uploading-logo');
          // The program already exists, so a 403 is a real refusal, not a permission grant still on its way.
          return this.mentorshipAdminService.uploadProgramLogo(programId, logo, false).pipe(tap(() => (this.uploadedLogo = logo)));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => this.finishUpdate(),
        error: (error: unknown) => this.failUpdate(error),
      });
  }

  /** Deletes first, so a program at the open-term limit has room for its new terms, then updates, then creates, one write at a time. */
  private saveTermChanges(programId: string): Observable<unknown[]> {
    const changes = diffMentorshipEnrollTerms(this.savedTerms, this.form.controls.terms.value);
    const writes = [
      ...changes.deleted.map((termId) =>
        defer(() => {
          this.termWrite = 'delete';
          return this.mentorshipAdminService.deleteTerm(programId, termId).pipe(
            tap(() => (this.savedTerms = this.savedTerms.filter((term) => term.id !== termId))),
            catchError((error: unknown) => {
              // Upstream keeps a term that has applications; put it back so the list shows what the program has.
              if (this.statusOf(error) === 409) this.restoreTerm(termId);
              return throwError(() => error);
            })
          );
        })
      ),
      ...changes.updated.map((term) =>
        defer(() => {
          this.termWrite = 'update';
          return this.mentorshipAdminService
            .updateTerm(programId, term.id, toMentorshipAdminTermInput(term))
            .pipe(tap(() => (this.savedTerms = this.savedTerms.map((saved) => (saved.id === term.id ? { ...term } : saved)))));
        })
      ),
      ...changes.created.map((term) =>
        defer(() => {
          this.termWrite = 'create';
          return this.mentorshipAdminService.createTerm(programId, toMentorshipAdminTermInput(term)).pipe(tap((row) => this.recordCreatedTerm(term, row.id)));
        })
      ),
    ];
    return concat(...writes).pipe(toArray());
  }

  /** A created term takes upstream's id in the form and in `savedTerms`, so a retry updates it rather than creating it again. */
  private recordCreatedTerm(term: MentorshipProgramTerm, id: string): void {
    const terms = this.form.controls.terms.value.map((item) => (item.id === term.id ? { ...item, id } : item));
    this.form.controls.terms.setValue(terms, { emitEvent: false });
    this.savedTerms = [...this.savedTerms, { ...term, id }];
  }

  private restoreTerm(termId: string): void {
    const saved = this.savedTerms.find((term) => term.id === termId);
    if (saved) this.form.controls.terms.setValue([...this.form.controls.terms.value, { ...saved }], { emitEvent: false });
  }

  private finishUpdate(): void {
    this.submitPhase.set('done');
    this.messageService.add({ severity: 'success', summary: 'Success', detail: MENTORSHIP_ENROLL_UPDATE_SUCCESS, life: 4000 });
    void this.router.navigate(['/mentorship/admin', this.editProgramId]);
  }

  /** Says which save failed. The answers unlock, so the admin can change them and select Update again. */
  private failUpdate(error: unknown): void {
    const phase = this.submitPhase();
    this.submitPhase.set('failed');
    this.form.enable({ emitEvent: false });
    // emitEvent was off for the term writes, so the steps read the terms again from here.
    this.form.controls.terms.setValue([...this.form.controls.terms.value]);
    const status = this.statusOf(error);
    if (phase === 'uploading-logo') {
      const fieldError = MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS[status];
      this.submitFailure.set({
        step: 'logo',
        message: fieldError ? `${MENTORSHIP_ENROLL_EDIT_LOGO_NOT_UPLOADED} ${fieldError}` : MENTORSHIP_ENROLL_EDIT_LOGO_NOT_UPLOADED,
      });
      return;
    }
    if (phase === 'saving-terms') {
      const deleteRefused = this.termWrite === 'delete' && status === 409;
      this.submitFailure.set({
        step: 'terms',
        message: deleteRefused ? MENTORSHIP_ENROLL_TERM_DELETE_CONFLICT : this.writeFailureMessage(error, MENTORSHIP_ENROLL_TERMS_SAVE_FAILED),
      });
      return;
    }
    // The BFF refuses an update whose name another program has, before it writes anything.
    if (status === 409) {
      this.showNameTaken();
      return;
    }
    this.submitFailure.set({ step: 'update', message: this.writeFailureMessage(error, MENTORSHIP_ENROLL_UPDATE_FAILED) });
  }

  /** Reads the program's details and every term, then fills the form; a failed read shows Retry and leaves the form empty. */
  private loadProgram(): void {
    this.editLoad.set('loading');
    forkJoin({ data: this.mentorshipAdminService.getEnrollTemplate(this.editProgramId), terms: this.readAllTerms(this.editProgramId) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ data, terms }) => this.applyProgram(data, terms),
        error: () => this.editLoad.set('failed'),
      });
  }

  private applyProgram(data: MentorshipEnrollImport, rows: MentorshipProgramTermRow[]): void {
    const openTerms = rows.filter((row) => row.status === 'open').map(toMentorshipEnrollTerm);
    this.form.setValue(formFromMentorshipEnrollEdit(data, openTerms));
    this.selectedProject.set(data.project);
    this.currentLogoUrl.set(data.logoUrl);
    this.closedTerms.set(rows.filter((row) => row.status === 'closed').map(toMentorshipEnrollTerm));
    this.savedTerms = openTerms.map((term) => ({ ...term }));
    this.editBaseline.set({
      terms: openTerms.map((term) => ({ ...term })),
      prerequisites: this.form.controls.prerequisites.value.map((item) => ({ ...item })),
    });
    this.initialValue = JSON.stringify(this.form.getRawValue());
    this.editLoad.set('ready');
  }

  /**
   * Every term of the program, read a page at the upstream maximum until `total` is covered, as the Terms tab reads them. The next
   * page is decided from `total`, not the page's row count, because the BFF drops terms that are neither open nor closed.
   */
  private readAllTerms(programId: string): Observable<MentorshipProgramTermRow[]> {
    const limit = MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT;
    const readPage = (offset: number) => this.mentorshipAdminService.getProgramTerms(programId, { offset, limit });
    return readPage(0).pipe(
      expand((page, index) => {
        const nextOffset = (index + 1) * limit;
        return nextOffset < page.total && index + 1 < MENTORSHIP_ADMIN_TERMS_MAX_PAGES ? readPage(nextOffset) : EMPTY;
      }),
      reduce((terms, page) => [...terms, ...page.data], [] as MentorshipProgramTermRow[])
    );
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
    this.form.enable({ emitEvent: false });
    const status = this.statusOf(error);
    if (status === 409) {
      this.showNameTaken();
      return;
    }
    this.submitFailure.set({ step: 'create', message: this.writeFailureMessage(error, MENTORSHIP_ENROLL_SUBMIT_FAILED) });
  }

  /** Another program has the name: the create or update is refused with a 409, so the admin goes back to the name field. */
  private showNameTaken(): void {
    this.nameTakenOnSave.set(true);
    this.nameLookupStatus.set('taken');
    this.showErrors.set(true);
    this.step.set('details');
    this.scrollToTop();
  }

  /** The read-only refusal while impersonating says why in the server's words; any other failure gets `fallback`. */
  private writeFailureMessage(error: unknown, fallback: string): string {
    const readOnly = error instanceof HttpErrorResponse && error.status === 403 && error.error?.code === MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE;
    return readOnly ? serverAuthoredMessage(error, fallback) : fallback;
  }

  private failLogoUpload(status: number): void {
    this.logoUploadFailed.set(true);
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

  /** A step's errors, plus a project id the picker never resolved to a project (Submit needs the project itself). */
  private stepErrorsFor(step: MentorshipEnrollStep): MentorshipEnrollFieldErrors {
    const errors = getMentorshipEnrollStepErrors(step, this.toEnrollForm(this.form.getRawValue()), this.editBaseline());
    if (step === 'details' && !errors.projectId && !this.selectedProject()) return { ...errors, projectId: MENTORSHIP_ENROLL_PROJECT_REQUIRED };
    return errors;
  }

  /** The step Submit sends the admin back to, or `undefined` when it can go ahead. */
  private invalidSubmitStep(): MentorshipEnrollStep | undefined {
    // An edit keeps the program's logo unless a new one is picked.
    if ((!this.editing && !this.logoFile()) || !this.selectedProject()) return 'details';
    // A created program's answers are locked. Before create every step is checked again: an earlier step's dates may have passed meanwhile.
    if (this.createdProgram()) return undefined;
    return MENTORSHIP_ENROLL_STEPS_ORDER.find((step) => Object.keys(this.stepErrorsFor(step)).length > 0);
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
