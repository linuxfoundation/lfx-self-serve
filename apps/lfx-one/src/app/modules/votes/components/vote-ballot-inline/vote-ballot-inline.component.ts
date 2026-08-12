// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { INVITATION_NOT_FOUND, VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '@lfx-one/shared/constants';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { CommentResponseFormData, CommentResponseInput, PollCommentPrompt, PollQuestion, Vote, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { CodePointLengthPipe } from '@pipes/code-point-length.pipe';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-vote-ballot-inline',
  imports: [ReactiveFormsModule, CheckboxModule, ButtonComponent, RadioButtonComponent, TextareaComponent, CodePointLengthPipe],
  templateUrl: './vote-ballot-inline.component.html',
  styleUrl: './vote-ballot-inline.component.scss',
})
export class VoteBallotInlineComponent {
  // === Injections ===
  private readonly voteService = inject(VoteService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs / Outputs ===
  public readonly vote = input.required<Vote>();
  public readonly voteSubmitted = output<string>();
  public readonly cancelled = output<void>();

  // === Forms ===
  public readonly form = new FormGroup({});
  public readonly abstainControl = new FormControl<boolean>(false, { nonNullable: true });
  // Kept separate from `form` so abstain's disable()/enable() toggling of answer controls never touches comments.
  public readonly commentForm = new FormGroup({});

  // === Writable Signals ===
  protected readonly submitting = signal(false);
  // Reactive dependency for submitDisabled — rebuildForm uses { emitEvent: false }, so statusChanges is silent.
  private readonly formVersion = signal(0);

  // === Computed / Derived Signals ===
  protected readonly question = computed(() => this.vote().poll_questions?.[0] ?? null);
  protected readonly isMultipleChoice = computed(() => this.question()?.type === 'multiple_choice');
  protected readonly allowAbstain = computed(() => !!this.vote().allow_abstain);
  protected readonly abstain: Signal<boolean> = toSignal(this.abstainControl.valueChanges, { initialValue: this.abstainControl.value });
  protected readonly submitDisabled: Signal<boolean> = this.initSubmitDisabled();
  protected readonly commentResponseMaxLength = VOTE_COMMENT_RESPONSE_MAX_LENGTH;
  protected readonly commentPrompts: Signal<PollCommentPrompt[]> = computed(() => this.vote().poll_comment_prompts ?? []);
  protected readonly commentPromptsData: Signal<CommentResponseFormData[]> = this.initCommentPromptsData();

  public constructor() {
    this.setupFormReactions();
  }

  // === Protected Methods ===
  protected onSubmit(): void {
    const vote = this.vote();
    if (this.submitting()) return;

    const isAbstain = this.abstain();
    const question = this.question();
    if (!isAbstain && (!question || this.form.invalid)) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.commentForm.invalid) {
      this.commentForm.markAllAsTouched();
      return;
    }
    const userVoteContent = isAbstain || !question ? undefined : this.buildAnswers(question);
    // Comments are independent of abstain — a voter can abstain and still leave a comment.
    const commentResponses = this.buildCommentResponses();

    this.submitting.set(true);

    this.voteService
      .submitMyResponse(vote.uid, { abstain: isAbstain, userVoteContent, commentResponses })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Vote submitted',
            detail: `Your ${isAbstain ? 'abstention' : 'ballot'} has been recorded.`,
            life: 3000,
          });
          this.voteSubmitted.emit(vote.uid);
        },
        error: (err: unknown) => {
          const isInvitationMissing = err instanceof Error && !(err instanceof HttpErrorResponse) && err.message === INVITATION_NOT_FOUND;
          this.messageService.add({
            severity: 'error',
            summary: isInvitationMissing ? 'Unable to find your invitation' : 'Unable to submit vote',
            detail: isInvitationMissing
              ? 'We could not find your vote invitation for this ballot. Please refresh and try again.'
              : 'Something went wrong submitting your ballot. Please try again.',
            life: 5000,
          });
        },
      });
  }

  // === Private Initializers ===
  private initSubmitDisabled(): Signal<boolean> {
    return computed(() => {
      this.formVersion(); // re-evaluate when controls are added/removed/disabled via { emitEvent: false }
      if (this.submitting()) return true;
      if (!this.commentForm.valid) return true;
      if (this.abstain()) return false;
      if (!this.question()) return true;
      return !this.form.valid;
    });
  }

  private initCommentPromptsData(): Signal<CommentResponseFormData[]> {
    return computed(() => {
      this.formVersion(); // re-evaluate when comment controls are added/removed
      return this.commentPrompts().map((prompt) => ({
        prompt,
        control: this.commentForm.get(prompt.prompt_id) as FormControl<string>,
      }));
    });
  }

  private setupFormReactions(): void {
    toObservable(this.question)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.rebuildForm(q));

    toObservable(this.commentPrompts)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((prompts) => this.rebuildCommentForm(prompts));

    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formVersion.update((v) => v + 1));

    this.commentForm.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formVersion.update((v) => v + 1));

    this.abstainControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((isAbstaining) => {
      if (isAbstaining) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
      this.formVersion.update((v) => v + 1);
    });
  }

  // === Private Helpers ===
  private rebuildForm(question: PollQuestion | null): void {
    for (const id of Object.keys(this.form.controls)) {
      if (!question || id !== question.question_id) {
        this.form.removeControl(id, { emitEvent: false });
      }
    }
    if (!question || this.form.contains(question.question_id)) {
      this.formVersion.update((v) => v + 1);
      return;
    }
    if (question.type === 'multiple_choice') {
      this.form.addControl(question.question_id, new FormControl<string[]>([], { nonNullable: true, validators: [Validators.required] }), {
        emitEvent: false,
      });
    } else {
      this.form.addControl(question.question_id, new FormControl<string | null>(null, Validators.required), { emitEvent: false });
    }
    this.formVersion.update((v) => v + 1);
  }

  private buildAnswers(question: PollQuestion): VoteAnswerInput[] {
    const raw = this.form.get(question.question_id)?.value as string | string[] | null;
    let choiceIds: string[];
    if (Array.isArray(raw)) {
      choiceIds = raw;
    } else {
      choiceIds = raw ? [raw] : [];
    }
    return [{ question_id: question.question_id, choice_ids: choiceIds }];
  }

  private rebuildCommentForm(prompts: PollCommentPrompt[]): void {
    const desiredIds = new Set(prompts.map((p) => p.prompt_id));
    for (const existingId of Object.keys(this.commentForm.controls)) {
      if (!desiredIds.has(existingId)) this.commentForm.removeControl(existingId, { emitEvent: false });
    }
    for (const prompt of prompts) {
      if (this.commentForm.contains(prompt.prompt_id)) continue;
      this.commentForm.addControl(
        prompt.prompt_id,
        new FormControl('', { nonNullable: true, validators: [maxCodePointsValidator(VOTE_COMMENT_RESPONSE_MAX_LENGTH)] }),
        { emitEvent: false }
      );
    }
    this.formVersion.update((v) => v + 1);
  }

  private buildCommentResponses(): CommentResponseInput[] | undefined {
    const responses = this.commentPromptsData()
      .map((data) => ({ prompt_id: data.prompt.prompt_id, comment_text: (data.control.value ?? '').trim() }))
      .filter((response) => response.comment_text.length > 0);
    return responses.length > 0 ? responses : undefined;
  }
}
