// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { COMMITTEE_LABEL, OPEN_VOTE_CONFIRMATION, VOTE_LABEL, VOTE_TOTAL_STEPS } from '@lfx-one/shared/constants';
import { Committee, CommitteeReference, Vote, VoteFormValue } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { buildCreateVoteRequest, buildUpdateVoteRequest, mapVoteToFormValue, markFormControlsAsTouched } from '@lfx-one/shared/utils';
import { trimmedMinLength, trimmedRequired, validCommitteeReference } from '@lfx-one/shared/validators';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { catchError, combineLatest, distinctUntilChanged, filter, map, of, switchMap, take, tap } from 'rxjs';

import { VoteBasicsComponent } from '../components/vote-basics/vote-basics.component';
import { VoteQuestionComponent } from '../components/vote-question/vote-question.component';
import { VoteReviewComponent } from '../components/vote-review/vote-review.component';

@Component({
  selector: 'lfx-vote-manage',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    ButtonComponent,
    MessageComponent,
    ConfirmDialogModule,
    StepperModule,
    VoteBasicsComponent,
    VoteQuestionComponent,
    VoteReviewComponent,
  ],
  templateUrl: './vote-manage.component.html',
  styleUrl: './vote-manage.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoteManageComponent {
  // Private injections
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly voteService = inject(VoteService);
  private readonly committeeService = inject(CommitteeService);

  // Committee context — when navigated from a committee tab with ?committee_uid=
  public readonly committeeContext = signal<Committee | null>(null);

  // Protected constants
  public readonly totalSteps = VOTE_TOTAL_STEPS;
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly voteLabel = VOTE_LABEL;

  // Form
  public readonly form = signal<FormGroup>(this.createFormGroup());

  // Simple WritableSignals
  public readonly mode = signal<'create' | 'edit'>('create');
  public readonly voteId = signal<string | null>(null);
  public readonly submitting = signal<boolean>(false);
  public readonly loading = signal<boolean>(false);
  private readonly internalStep = signal<number>(1);

  // Complex computed/toSignal signals
  public readonly isEditMode: Signal<boolean> = this.initIsEditMode();
  public readonly vote: Signal<Vote | null> = this.initVote();
  public readonly project: Signal<ReturnType<typeof this.projectContextService.selectedProject>> = this.initProject();
  public readonly formValue: Signal<Record<string, unknown>> = this.initFormValue();
  public readonly canGoPrevious: Signal<boolean> = this.initCanGoPrevious();
  public readonly canGoNext: Signal<boolean> = this.initCanGoNext();
  public readonly isFirstStep: Signal<boolean> = this.initIsFirstStep();
  public readonly isLastStep: Signal<boolean> = this.initIsLastStep();
  public currentStep: Signal<number> = this.initCurrentStep();

  constructor() {
    this.initCommitteeContext();
  }

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: next } });
      } else {
        this.internalStep.set(next);
      }
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: previous } });
      } else {
        this.internalStep.set(previous);
      }
    }
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && step >= 1 && step <= this.totalSteps) {
      if (this.isEditMode()) {
        // In edit mode, allow navigation to any step via query params
        this.router.navigate([], { queryParams: { step } });
      } else {
        // In create mode, allow backwards navigation freely
        // For forward navigation, validate that we can navigate to that step
        if (step <= this.currentStep() || this.canNavigateToStep(step)) {
          this.internalStep.set(step);
        }
      }
    }
  }

  public onCancel(): void {
    this.navigateBack();
  }

  public onSaveAsDraft(): void {
    if (this.form().invalid) {
      this.markAllFormControlsAsTouched();
      return;
    }

    const project = this.project();
    if (!project?.uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No project selected',
      });
      return;
    }

    this.submitting.set(true);

    const formValue = this.form().getRawValue() as VoteFormValue;

    if (this.isEditMode() && this.voteId()) {
      const updateRequest = buildUpdateVoteRequest(formValue, project.uid);
      this.voteService.updateVote(this.voteId()!, updateRequest).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `${this.voteLabel.singular} updated successfully`,
          });
          this.submitting.set(false);
          this.navigateBack();
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to update ${this.voteLabel.singular.toLowerCase()}: ${error.message || 'Unknown error'}`,
          });
          this.submitting.set(false);
        },
      });
    } else {
      const createRequest = buildCreateVoteRequest(formValue, project.uid);
      this.voteService.createVote(createRequest).subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `${this.voteLabel.singular} saved as draft`,
          });
          this.submitting.set(false);
          this.navigateBack();
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to save ${this.voteLabel.singular.toLowerCase()} as draft: ${error.message || 'Unknown error'}`,
          });
          this.submitting.set(false);
        },
      });
    }
  }

  public onSubmit(): void {
    if (this.form().invalid) {
      this.markAllFormControlsAsTouched();
      return;
    }

    // For create mode, show confirmation dialog before opening the vote
    if (!this.isEditMode()) {
      this.confirmationService.confirm({
        header: OPEN_VOTE_CONFIRMATION.header,
        message: OPEN_VOTE_CONFIRMATION.message,
        acceptLabel: OPEN_VOTE_CONFIRMATION.acceptLabel,
        rejectLabel: OPEN_VOTE_CONFIRMATION.rejectLabel,
        acceptButtonStyleClass: 'p-button-info p-button-sm',
        rejectButtonStyleClass: 'p-button-text p-button-sm',
        accept: () => this.submitVote(),
      });
    } else {
      this.submitVote();
    }
  }

  public isCurrentStepValid(): boolean {
    return this.isStepValid(this.currentStep());
  }

  /**
   * Create a new question FormGroup with default values
   * Uses trimmedRequired and trimmedMinLength validators to ensure whitespace-only values are rejected
   */
  public createQuestionFormGroup(): FormGroup {
    return new FormGroup({
      question: new FormControl('', [trimmedRequired(), trimmedMinLength(10)]),
      response_type: new FormControl<'single' | 'multiple'>('single', [Validators.required]),
      options: new FormArray([this.createOptionControl(), this.createOptionControl()], [Validators.minLength(2)]),
    });
  }

  /**
   * Create a new option FormControl with trimmed validation
   */
  public createOptionControl(): FormControl<string> {
    return new FormControl('', { validators: [trimmedRequired()], nonNullable: true });
  }

  // Private methods

  /** Navigates back to the committee votes tab or the main votes page. */
  private navigateBack(): void {
    const ctx = this.committeeContext();
    if (ctx) {
      this.router.navigate(['/groups', ctx.uid], { queryParams: { tab: 'votes' } });
    } else {
      this.router.navigate(['/votes']);
    }
  }

  private submitVote(): void {
    const project = this.project();
    if (!project?.uid) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'No project selected',
      });
      return;
    }

    this.submitting.set(true);

    const formValue = this.form().getRawValue() as VoteFormValue;

    if (this.isEditMode() && this.voteId()) {
      const updateRequest = buildUpdateVoteRequest(formValue, project.uid);
      // Update the vote first, then enable it to open immediately
      this.voteService.updateVote(this.voteId()!, updateRequest).subscribe({
        next: () => {
          this.voteService.enableVote(this.voteId()!).subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: 'Success',
                detail: `${this.voteLabel.singular} opened successfully`,
              });
              this.submitting.set(false);
              this.navigateBack();
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: `${this.voteLabel.singular} updated but failed to enable: ${error.message || 'Unknown error'}`,
              });
              this.submitting.set(false);
              this.navigateBack();
            },
          });
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to update ${this.voteLabel.singular.toLowerCase()}: ${error.message || 'Unknown error'}`,
          });
          this.submitting.set(false);
        },
      });
    } else {
      const createRequest = buildCreateVoteRequest(formValue, project.uid);
      // Create the vote first, then enable it to open immediately
      this.voteService.createVote(createRequest).subscribe({
        next: (createdVote) => {
          // After creating, enable the vote to open it
          this.voteService.enableVote(createdVote.uid).subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: 'Success',
                detail: `${this.voteLabel.singular} opened successfully`,
              });
              this.submitting.set(false);
              this.navigateBack();
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: `${this.voteLabel.singular} created but failed to enable: ${error.message || 'Unknown error'}`,
              });
              this.submitting.set(false);
              this.navigateBack();
            },
          });
        },
        error: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: `Failed to create ${this.voteLabel.singular.toLowerCase()}: ${error.message || 'Unknown error'}`,
          });
          this.submitting.set(false);
        },
      });
    }
  }

  /**
   * Patches the form with data from a fetched Vote entity.
   * Rebuilds the questions FormArray to match the vote's poll_questions.
   */
  private patchFormWithVote(vote: Vote): void {
    const formValue = mapVoteToFormValue(vote);
    const form = this.form();

    // Patch scalar fields (Step 1)
    form.patchValue({
      title: formValue.title,
      description: formValue.description,
      committee: formValue.committee,
      eligible_participants: formValue.eligible_participants,
      close_date: formValue.close_date,
    });

    // Rebuild questions FormArray (Step 2)
    const questionsArray = form.get('questions') as FormArray;
    questionsArray.clear();

    if (formValue.questions.length > 0) {
      for (const question of formValue.questions) {
        const questionGroup = new FormGroup({
          question: new FormControl(question.question, [trimmedRequired(), trimmedMinLength(10)]),
          response_type: new FormControl<'single' | 'multiple'>(question.response_type, [Validators.required]),
          options: new FormArray(
            question.options.map((option) => new FormControl(option, { validators: [trimmedRequired()], nonNullable: true })),
            [Validators.minLength(2)]
          ),
        });
        questionsArray.push(questionGroup);
      }
    } else {
      // Ensure at least one empty question group exists
      questionsArray.push(this.createQuestionFormGroup());
    }
  }

  // Private initializer functions
  private createFormGroup(): FormGroup {
    return new FormGroup({
      // Step 1: Vote Basics
      title: new FormControl('', [trimmedRequired(), trimmedMinLength(3), Validators.maxLength(200)]),
      description: new FormControl(''),
      committee: new FormControl<CommitteeReference | null>(null, [Validators.required, validCommitteeReference()]),
      eligible_participants: new FormControl('', [Validators.required]),
      close_date: new FormControl<Date | null>(null, [Validators.required]),

      // Step 2: Vote Questions (array of questions)
      questions: new FormArray([this.createQuestionFormGroup()], [Validators.minLength(1)]),
    });
  }

  private initIsEditMode(): Signal<boolean> {
    return computed(() => this.mode() === 'edit');
  }

  private initVote(): Signal<Vote | null> {
    return toSignal(
      this.route.paramMap.pipe(
        switchMap((params) => {
          const voteId = params.get('id');
          if (voteId) {
            this.mode.set('edit');
            this.voteId.set(voteId);
            this.loading.set(true);
            return this.voteService.getVote(voteId).pipe(
              tap((vote) => {
                this.loading.set(false);
                this.patchFormWithVote(vote);
              }),
              catchError(() => {
                this.loading.set(false);
                this.messageService.add({
                  severity: 'error',
                  summary: 'Error',
                  detail: 'Failed to load vote details',
                });
                this.navigateBack();
                return of(null);
              })
            );
          }
          this.mode.set('create');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }

  private initProject(): Signal<ReturnType<typeof this.projectContextService.selectedProject>> {
    return computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  }

  private initFormValue(): Signal<Record<string, unknown>> {
    const form = this.form();
    return toSignal(form.valueChanges.pipe(map(() => form.getRawValue())), { initialValue: form.getRawValue() });
  }

  private initCanGoPrevious(): Signal<boolean> {
    return computed(() => this.currentStep() > 1);
  }

  private initCanGoNext(): Signal<boolean> {
    return computed(() => {
      // Access formValue to trigger reactivity on form changes
      this.formValue();
      return this.currentStep() < this.totalSteps && this.canNavigateToStep(this.currentStep() + 1);
    });
  }

  private initIsFirstStep(): Signal<boolean> {
    return computed(() => this.currentStep() === 1);
  }

  private initIsLastStep(): Signal<boolean> {
    return computed(() => this.currentStep() === this.totalSteps);
  }

  private initCurrentStep(): Signal<number> {
    // Derive mode directly from route params to avoid race condition with initVote()
    // We check for 'id' param presence to determine mode, rather than relying on mode signal
    return toSignal(
      combineLatest([this.route.paramMap, this.route.queryParamMap, toObservable(this.internalStep)]).pipe(
        map(([params, queryParams, internalStep]) => {
          // Determine mode directly from route params (presence of 'id' means edit mode)
          const isEditMode = !!params.get('id');

          if (isEditMode) {
            // In edit mode, use query parameters for step navigation
            const stepParam = queryParams.get('step');
            if (stepParam) {
              const step = parseInt(stepParam, 10);
              if (step >= 1 && step <= this.totalSteps) {
                return step;
              }
            }
            return 1;
          }
          // In create mode, use internal step signal
          return internalStep;
        }),
        distinctUntilChanged()
      ),
      { initialValue: 1 }
    );
  }

  private canNavigateToStep(step: number): boolean {
    // Allow navigation to previous steps or current step
    if (step <= this.currentStep()) {
      return true;
    }

    // For forward navigation, validate all previous steps
    for (let i = 1; i < step; i++) {
      if (!this.isStepValid(i)) {
        return false;
      }
    }
    return true;
  }

  private isStepValid(step: number): boolean {
    const form = this.form();

    switch (step) {
      case 1: {
        // Use form validators for all Step 1 fields
        // Validators: title (trimmedRequired, trimmedMinLength(3), maxLength(200))
        //             committee (required, validCommitteeReference)
        //             eligible_participants (required)
        //             close_date (required)
        const titleValid = !!form.get('title')?.valid;
        // Committee is valid if locked via group context, or if the form control passes validation
        const committeeValid = !!this.committeeContext() || !!form.get('committee')?.valid;
        const eligibleParticipantsValid = !!form.get('eligible_participants')?.valid;
        const closeDateValid = !!form.get('close_date')?.valid;
        return titleValid && committeeValid && eligibleParticipantsValid && closeDateValid;
      }
      case 2: {
        const questionsArray = form.get('questions') as FormArray;
        if (questionsArray.length === 0) {
          return false;
        }
        // Use form validators for all Step 2 fields
        // Question validators: trimmedRequired, trimmedMinLength(10)
        // Response type validators: required
        // Options validators: trimmedRequired (via createOptionControl)
        return questionsArray.controls.every((questionGroup) => {
          const qg = questionGroup as FormGroup;
          const questionValid = !!qg.get('question')?.valid;
          const responseTypeValid = !!qg.get('response_type')?.valid;
          const optionsArray = qg.get('options') as FormArray;
          // Check minimum 2 options and all options are valid via their validators
          const optionsValid = optionsArray.length >= 2 && optionsArray.controls.every((c) => c.valid);
          return questionValid && responseTypeValid && optionsValid;
        });
      }
      case 3:
        return true; // Review step is always valid if we got here
      default:
        return false;
    }
  }

  private markAllFormControlsAsTouched(): void {
    markFormControlsAsTouched(this.form());
  }

  /** Reads committee_uid from queryParams and pre-populates the committee field (locked). */
  private initCommitteeContext(): void {
    this.route.queryParamMap
      .pipe(
        take(1),
        map((params) => params.get('committee_uid')),
        filter((uid): uid is string => !!uid && !this.route.snapshot.paramMap.has('id')),
        switchMap((uid) => this.committeeService.getCommittee(uid)),
        catchError(() => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load group context.' });
          return of(null);
        })
      )
      .subscribe((committee) => {
        if (!committee) return;
        this.committeeContext.set(committee);
        const ref: CommitteeReference = { uid: committee.uid, name: committee.name };
        const committeeControl = this.form().get('committee');
        committeeControl?.setValue(ref);
        committeeControl?.disable();
      });
  }
}
