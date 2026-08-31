// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
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
import { Committee, CommitteeReference, EntityWithProject, ProjectContext, Vote, VoteFormValue } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import {
  buildCreateVoteRequest,
  buildDraftUpdateVoteRequest,
  buildDraftVoteRequest,
  buildUpdateVoteRequest,
  computeIsFoundation,
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
import { catchError, combineLatest, distinctUntilChanged, filter, map, merge, Observable, of, switchMap, take, tap } from 'rxjs';

import { VoteBasicsComponent } from '../components/vote-basics/vote-basics.component';
import { VoteQuestionComponent } from '../components/vote-question/vote-question.component';
import { VoteReviewComponent } from '../components/vote-review/vote-review.component';
import { evictOnWriteAccessLoss } from '@shared/utils/evict-on-write-access-loss.util';
import { applyEntityProjectContext, syncEntityProjectContext } from '@shared/utils/entity-project-context.util';
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
  private readonly contextFallbackRetried = new Set<string>();
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
  public readonly voteEntityContext: Signal<EntityWithProject | null> = this.initVoteEntityContext();
  private readonly writeAccess: Signal<boolean> = this.initWriteAccess();

  public constructor() {
    this.initCommitteeContext();
    evictOnWriteAccessLoss(this.writeAccess);

    // Derive the project context from the loaded vote so a context-less edit link
    // (/project/votes/:id/edit) lands in the vote's project, not the cookie-restored
    // last-visited project. The fallback covers BFF project-enrichment failure.
    // preferEntityKind: a foundation-owned vote can be edited under a /project/* URL, so the
    // vote's own is_foundation (not the route prefix) picks the slot and re-points the route
    // lens kind. Opt-in — the other syncEntityProjectContext callers keep URL-prefix
    // behavior (see the util's doc).
    syncEntityProjectContext(this.voteEntityContext, this.projectContextService, this.router, this.destroyRef, { preferEntityKind: true });
    this.initVoteContextFallback();
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

  /**
   * Maps the loaded vote to the {@link EntityWithProject} shape consumed by
   * syncEntityProjectContext — pre-enrichment payloads can lack the project fields
   * entirely, so absent values map to null there.
   */
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
   * Access predicate driving evictOnWriteAccessLoss. The default predicate (canWrite) is
   * project-writer-only, but writerGuard also admits votes editors via writer on the
   * ?committee_uid= committee. The committee leg uses the side-effect-free fetchCommittee
   * (the guard's getCommittee tap is for its own deny/allow flow) and the URL snapshot —
   * the param survives step navigations via merge.
   *
   * Two properties keep this from evicting guard-admitted users on transient false:
   *
   * 1. In edit mode the project leg keys off the VOTE's own project (slug, falling back to
   *    uid — the BFF getProject route sniffs UUIDs), the same target writerGuard authorized
   *    against. Keying off activeContext instead would evaluate the stale cookie-restored boot
   *    context, and its false could win the race against syncEntityProjectContext's correction
   *    (a cached boot project resolves faster than the vote fetch that triggers the switch).
   *    Create mode has no vote, so the guard-checked active context (?project=) is the key.
   * 2. Each leg is pending (undefined) until its first resolution, and the predicate stays
   *    provisionally true while any applicable leg is pending — writerGuard already authorized
   *    this navigation, so an unresolved leg is not an access-lost signal. Eviction fires only
   *    once every applicable leg has re-checked false; an error or non-writer response still
   *    resolves false there.
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
    const committeeAccess = toSignal(
      this.committeeUidFromUrl
        ? this.committeeService.fetchCommittee(this.committeeUidFromUrl).pipe(
            map((committee) => committee?.writer === true),
            catchError(() => of(false))
          )
        : of(false)
      // No initialValue: undefined doubles as the leg's pending state. Without a committee_uid
      // param the synchronous of(false) resolves the leg immediately, so it never counts as pending.
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

  /**
   * Fallback context sync for when the BFF project enrichment failed (the detail payload has
   * `project_uid` but no `project_slug`): resolve the project by uid and set context from it.
   * `getProject(uid, false)` — `current: false` so the fetch doesn't clobber
   * ProjectService's shared `project` state — already resolves to null on failure, so a failed
   * fallback leaves the (stale) context untouched rather than erroring the page.
   *
   * Runs whenever the payload lacks `project_slug`, even when the uid already matches the active
   * context: the lookup is also what corrects the lens *kind* via `computeIsFoundation` — e.g.
   * `/project/votes/:id/edit?project=<foundation>` seeds the foundation into the project slot
   * under the route's declared `project` kind, and only the resolved project record reveals the
   * mismatch. As in syncEntityProjectContext, NavigationEnd re-applies the correction: query-param
   * step navigations re-assert the route's declared kind via syncLensFromRoute without re-running
   * guards. The re-apply hits the shareReplay-cached getProject, so it costs no extra request.
   *
   * When the uid lookup resolves null — the project GET is relation-gated, so an organizer without
   * a direct viewer relation gets nothing back — the vote detail is re-fetched fresh: its BFF
   * enrichment is query-service backed and not relation-gated, so a fresh payload can carry the
   * `project_slug` the first one lacked. Only if that also comes back unenriched is the context
   * left alone (it self-corrects on the next navigation).
   */
  private initVoteContextFallback(): void {
    const unresolvedEntity$ = toObservable(this.voteEntityContext).pipe(distinctUntilChanged((a, b) => a?.uid === b?.uid && a?.project_uid === b?.project_uid));
    const navigationReapply$ = this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.voteEntityContext())
    );
    merge(unresolvedEntity$, navigationReapply$)
      .pipe(
        filter((entity): entity is EntityWithProject => !!entity?.project_uid && !entity.project_slug),
        switchMap((entity) =>
          this.projectService.getProject(entity.project_uid, false).pipe(
            switchMap((project) => {
              if (!project) {
                return this.resolveContextFromFreshVote(entity);
              }
              const context: ProjectContext = { uid: project.uid, name: project.name, slug: project.slug };
              return of({ context, isFoundation: computeIsFoundation(project) });
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((resolved) => {
        if (!resolved) {
          return;
        }
        // Mirror syncEntityProjectContext: only write ?project= to the URL when already present.
        const syncUrl = 'project' in this.router.parseUrl(this.router.url).queryParams;
        applyEntityProjectContext(this.projectContextService, resolved.context, resolved.isFoundation, syncUrl);
      });
  }

  // Last resort for initVoteContextFallback: the ungated detail enrichment can supply the
  // project the relation-gated lookup withheld. Emits null when it can't, leaving context untouched.
  private resolveContextFromFreshVote(entity: EntityWithProject): Observable<{ context: ProjectContext; isFoundation: boolean } | null> {
    if (this.contextFallbackRetried.has(entity.uid)) {
      return of(null);
    }
    this.contextFallbackRetried.add(entity.uid);
    // VoteService keeps no detail cache — a fresh fetchVote IS the uncached re-fetch
    // (meeting-manage's getMeetingDetail equivalent needs skipCache; this doesn't).
    return this.voteService.fetchVote(entity.uid).pipe(
      map((vote) => {
        if (!vote?.project_slug) {
          console.warn(`Unable to resolve project context for vote ${entity.uid}: detail payload carries no project_slug`);
          return null;
        }
        const context: ProjectContext = {
          uid: vote.project_uid,
          name: vote.project_name || vote.project_slug,
          slug: vote.project_slug,
        };
        return { context, isFoundation: vote.is_foundation === true };
      }),
      catchError((error) => {
        // Transient failures (network, 5xx) shouldn't burn the retry — release the uid so a later
        // NavigationEnd re-apply can attempt the fresh fetch again.
        this.contextFallbackRetried.delete(entity.uid);
        console.warn(`Unable to resolve project context for vote ${entity.uid}:`, error);
        return of(null);
      })
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
