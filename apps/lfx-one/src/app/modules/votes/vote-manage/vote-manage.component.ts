// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import {
  COMMITTEE_LABEL,
  OPEN_VOTE_CONFIRMATION,
  VOTE_COMMENT_PROMPT_MAX_LENGTH,
  VOTE_LABEL,
  VOTE_QUESTION_MIN_LENGTH,
  VOTE_TOTAL_STEPS,
} from '@lfx-one/shared/constants';
import { Committee, CommitteeReference, EntityWithProject, Vote, VoteFormValue } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import {
  buildCreateVoteRequest,
  buildDraftUpdateVoteRequest,
  buildDraftVoteRequest,
  buildUpdateVoteRequest,
  mapVoteToFormValue,
  markFormControlsAsTouched,
} from '@lfx-one/shared/utils';
import { maxCodePointsValidator, trimmedMinLength, trimmedRequired, validCommitteeReference } from '@lfx-one/shared/validators';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { StepperModule } from 'primeng/stepper';
import { catchError, combineLatest, distinctUntilChanged, filter, map, Observable, of, switchMap, take, tap } from 'rxjs';

import { VoteBasicsComponent } from '../components/vote-basics/vote-basics.component';
import { VoteQuestionComponent } from '../components/vote-question/vote-question.component';
import { VoteReviewComponent } from '../components/vote-review/vote-review.component';
import { evictOnWriteAccessLoss } from '@shared/utils/evict-on-write-access-loss.util';
import { syncEntityProjectContext, syncEntityProjectContextFallback } from '@shared/utils/entity-project-context.util';
import { resolveEntityWriteSlug } from '@shared/utils/write-access.util';

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
  private readonly projectService = inject(ProjectService);
  private readonly destroyRef = inject(DestroyRef);

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
  public readonly confirmingOpenVote = signal<boolean>(false);
  public readonly loading = signal<boolean>(false);
  private readonly internalStep = signal<number>(1);
  private readonly committeeUidFromUrl = this.route.snapshot.queryParamMap.get('committee_uid');

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
  public readonly isDraftSavable: Signal<boolean> = this.initIsDraftSavable();
  private readonly voteEntityContext: Signal<EntityWithProject | null> = this.initVoteEntityContext();
  private readonly writeAccess: Signal<boolean> = this.initWriteAccess();

  public constructor() {
    this.initCommitteeContext();
    evictOnWriteAccessLoss(this.writeAccess);

    // Context-less edit links land in the VOTE's project (not the cookie-restored one);
    // preferEntityKind picks the context slot from the vote's own is_foundation (see the util's doc).
    // canonicalizeRoute then rewrites a wrong-tier URL (/project/* vs /foundation/*) to match it.
    syncEntityProjectContext(this.voteEntityContext, this.projectContextService, this.router, this.destroyRef, {
      preferEntityKind: true,
      canonicalizeRoute: true,
    });
    syncEntityProjectContextFallback(this.voteEntityContext, this.projectService, this.projectContextService, this.router, this.destroyRef, {
      entityKind: 'vote',
      freshFetch: (uid) => this.voteService.fetchVote(uid, { skipCache: true }),
      canonicalizeRoute: true,
    });
  }

  public nextStep(): void {
    const next = this.currentStep() + 1;
    if (next <= this.totalSteps && this.canNavigateToStep(next)) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: next }, queryParamsHandling: 'merge' });
      } else {
        this.internalStep.set(next);
      }
    }
  }

  public previousStep(): void {
    const previous = this.currentStep() - 1;
    if (previous >= 1) {
      if (this.isEditMode()) {
        this.router.navigate([], { queryParams: { step: previous }, queryParamsHandling: 'merge' });
      } else {
        this.internalStep.set(previous);
      }
    }
  }

  public goToStep(step: number | undefined): void {
    if (step !== undefined && step >= 1 && step <= this.totalSteps) {
      if (this.isEditMode()) {
        // In edit mode, allow navigation to any step via query params
        this.router.navigate([], { queryParams: { step }, queryParamsHandling: 'merge' });
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
    if (this.submitting()) {
      return;
    }

    if (!this.isDraftSavable()) {
      this.markDraftRequiredFieldsAsTouched();
      this.messageService.add({
        severity: 'warn',
        summary: 'Cannot save draft',
        detail: `Please enter a title and select a ${this.committeeLabel.singular.toLowerCase()} before saving this ${this.voteLabel.singular.toLowerCase()} as a draft.`,
      });
      return;
    }

    // Draft save skips the step-2 form gate, so over-length comment prompts must be caught here.
    const commentPromptsArray = this.form().get('commentPrompts') as FormArray;
    const invalidPromptGroups = commentPromptsArray.controls.filter((commentPromptGroup) => !(commentPromptGroup as FormGroup).get('prompt')?.valid);
    if (invalidPromptGroups.length > 0) {
      invalidPromptGroups.forEach((commentPromptGroup) => (commentPromptGroup as FormGroup).get('prompt')?.markAsTouched());
      this.messageService.add({
        severity: 'warn',
        summary: 'Cannot save draft',
        detail: `Comment questions cannot be blank and must be ${VOTE_COMMENT_PROMPT_MAX_LENGTH} characters or fewer before saving as a draft.`,
      });
      return;
    }

    const projectUid = this.vote()?.project_uid || this.project()?.uid;
    if (!projectUid) {
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
      const updateRequest = buildDraftUpdateVoteRequest(formValue, projectUid);
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
      const draftRequest = buildDraftVoteRequest(formValue, projectUid);
      this.voteService.createVote(draftRequest).subscribe({
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
    if (this.submitting() || this.confirmingOpenVote()) {
      return;
    }

    if (this.form().invalid) {
      this.markAllFormControlsAsTouched();
      return;
    }

    // For create mode, show confirmation dialog before opening the vote
    if (!this.isEditMode()) {
      this.confirmingOpenVote.set(true);
      this.confirmationService.confirm({
        header: OPEN_VOTE_CONFIRMATION.header,
        message: OPEN_VOTE_CONFIRMATION.message,
        acceptLabel: OPEN_VOTE_CONFIRMATION.acceptLabel,
        rejectLabel: OPEN_VOTE_CONFIRMATION.rejectLabel,
        acceptButtonStyleClass: 'p-button-info p-button-sm',
        rejectButtonStyleClass: 'p-button-text p-button-sm',
        accept: () => {
          this.confirmingOpenVote.set(false);
          this.submitVote();
        },
        reject: () => this.confirmingOpenVote.set(false),
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
      question: new FormControl('', [trimmedRequired(), trimmedMinLength(VOTE_QUESTION_MIN_LENGTH)]),
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

  /**
   * Create a new comment prompt FormGroup with default values
   * Prompt text is required (blank prompts are blocked per #1448) and bounded by VOTE_COMMENT_PROMPT_MAX_LENGTH
   */
  public createCommentPromptFormGroup(): FormGroup {
    return new FormGroup({
      prompt: new FormControl('', { nonNullable: true, validators: [trimmedRequired(), maxCodePointsValidator(VOTE_COMMENT_PROMPT_MAX_LENGTH)] }),
    });
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
    if (this.submitting()) {
      return;
    }

    const projectUid = this.vote()?.project_uid || this.project()?.uid;
    if (!projectUid) {
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
      const updateRequest = buildUpdateVoteRequest(formValue, projectUid);
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
      const createRequest = buildCreateVoteRequest(formValue, projectUid);
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
      allow_abstain: formValue.allow_abstain,
    });

    // Rebuild questions FormArray (Step 2)
    const questionsArray = form.get('questions') as FormArray;
    questionsArray.clear();

    if (formValue.questions.length > 0) {
      for (const question of formValue.questions) {
        const questionGroup = new FormGroup({
          question: new FormControl(question.question, [trimmedRequired(), trimmedMinLength(VOTE_QUESTION_MIN_LENGTH)]),
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

    // Rebuild commentPrompts FormArray (Step 2)
    const commentPromptsArray = form.get('commentPrompts') as FormArray;
    commentPromptsArray.clear();

    for (const commentPrompt of formValue.commentPrompts) {
      const commentPromptGroup = new FormGroup({
        prompt: new FormControl(commentPrompt.prompt, {
          nonNullable: true,
          validators: [trimmedRequired(), maxCodePointsValidator(VOTE_COMMENT_PROMPT_MAX_LENGTH)],
        }),
      });
      commentPromptsArray.push(commentPromptGroup);
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
      allow_abstain: new FormControl<boolean>(false, { nonNullable: true }),

      // Step 2: Vote Questions (array of questions)
      questions: new FormArray([this.createQuestionFormGroup()], [Validators.minLength(1)]),

      // Step 2: Comment Questions (array of optional comment prompts)
      commentPrompts: new FormArray([]),
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

  /** Maps the loaded vote to the {@link EntityWithProject} shape; absent enrichment fields map to null. */
  private initVoteEntityContext(): Signal<EntityWithProject | null> {
    return computed(() => {
      const vote = this.vote();
      if (!vote) {
        return null;
      }
      return {
        uid: vote.uid,
        project_uid: vote.project_uid,
        project_slug: vote.project_slug,
        project_name: vote.project_name,
        is_foundation: vote.is_foundation ?? null,
      };
    });
  }

  private initProject(): Signal<ReturnType<typeof this.projectContextService.selectedProject>> {
    return computed(() => this.projectContextService.activeContext());
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

  private initIsDraftSavable(): Signal<boolean> {
    return computed(() => {
      const title = (this.formValue()['title'] as string | undefined) ?? '';
      const committeeValid = !!this.committeeContext() || !!this.form().get('committee')?.valid;
      return title.trim().length > 0 && committeeValid;
    });
  }

  /**
   * Access predicate mirroring writerGuard's votes standard — project writer on the vote's OWN project
   * (never the boot context), or committee writer via ?committee_uid=; pending legs stay provisionally true.
   */
  private initWriteAccess(): Signal<boolean> {
    const editVoteId = this.route.snapshot.paramMap.get('id');
    const projectKey$: Observable<string | null | undefined> = editVoteId
      ? toObservable(this.vote).pipe(
          map((vote) => {
            if (!vote) {
              // Pending — in edit mode the authorization target comes from the vote itself.
              return undefined;
            }
            // Mirror writerGuard's resolution order; the active-context fallback covers a vote
            // carrying neither slug nor uid (the manage component owns that error path).
            return resolveEntityWriteSlug(vote, this.projectContextService.activeContext()?.slug ?? null);
          })
        )
      : toObservable(this.projectContextService.activeContext).pipe(map((ctx) => ctx?.slug ?? null));

    const projectAccess = toSignal(
      projectKey$.pipe(
        filter((key): key is string | null => key !== undefined),
        distinctUntilChanged(),
        switchMap((key) => {
          if (!key) {
            return of(false);
          }
          // writerGuard admits no coordinator-style role for votes — project.writer only.
          return this.projectService.getProject(key, false).pipe(
            map((project) => project?.writer === true),
            catchError(() => of(false))
          );
        })
      )
      // No initialValue: undefined doubles as the leg's pending state (see the doc above).
    );
    // Edit mode derives the uid from the loaded vote's own committee (URL only as fallback),
    // mirroring writerGuard's entity-scoped resolution. Hoisted: toObservable needs the injection
    // context, so it can't be created lazily inside the switchMap below.
    const editCommitteeUid$: Observable<string | null | undefined> = toObservable(this.vote).pipe(
      map((vote) => (vote ? (vote.committee_uid ?? this.committeeUidFromUrl) : undefined))
    );
    // Gated on the project leg resolving false: a granted project leg makes the committee fetch
    // moot, and while it's pending this leg stays pending too. undefined stays pending; null resolves immediately.
    const committeeUid$: Observable<string | null | undefined> = toObservable(projectAccess).pipe(
      filter((project): project is boolean => project !== undefined),
      distinctUntilChanged(),
      switchMap((project) => {
        if (project) {
          // Project leg granted — resolve the committee leg without firing the HTTP probe.
          return of<string | null>(null);
        }
        return editVoteId ? editCommitteeUid$ : of(this.committeeUidFromUrl);
      })
    );
    const committeeAccess = toSignal(
      committeeUid$.pipe(
        filter((uid): uid is string | null => uid !== undefined),
        distinctUntilChanged(),
        switchMap((uid) =>
          uid
            ? this.committeeService.fetchCommittee(uid).pipe(
                map((committee) => committee?.writer === true),
                catchError(() => of(false))
              )
            : of(false)
        )
      )
      // No initialValue: undefined doubles as the leg's pending state (see the doc above).
    );
    return computed(() => {
      const project = projectAccess();
      const committee = committeeAccess();
      if (project === true || committee === true) {
        return true;
      }
      if (project === undefined || committee === undefined) {
        return true; // provisional — a pending leg can still grant access
      }
      return false;
    });
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
        const questionsValid = questionsArray.controls.every((questionGroup) => {
          const qg = questionGroup as FormGroup;
          const questionValid = !!qg.get('question')?.valid;
          const responseTypeValid = !!qg.get('response_type')?.valid;
          const optionsArray = qg.get('options') as FormArray;
          // Check minimum 2 options and all options are valid via their validators
          const optionsValid = optionsArray.length >= 2 && optionsArray.controls.every((c) => c.valid);
          return questionValid && responseTypeValid && optionsValid;
        });

        // Comment prompts are optional — an empty array is valid, but any prompt present must be non-blank and respect the max length
        const commentPromptsArray = form.get('commentPrompts') as FormArray;
        const commentPromptsValid = commentPromptsArray.controls.every((commentPromptGroup) => !!(commentPromptGroup as FormGroup).get('prompt')?.valid);

        return questionsValid && commentPromptsValid;
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

  /** Touch only the fields gated by `isDraftSavable` so missing-value errors render under the right inputs. */
  private markDraftRequiredFieldsAsTouched(): void {
    this.form().get('title')?.markAsTouched();
    this.form().get('committee')?.markAsTouched();
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
