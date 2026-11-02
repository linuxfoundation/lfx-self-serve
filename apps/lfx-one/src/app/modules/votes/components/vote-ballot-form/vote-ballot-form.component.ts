// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { VOTE_COMMENT_RESPONSE_MAX_LENGTH } from '@lfx-one/shared/constants';
import {
  CommentResponseFormData,
  CommentResponseInput,
  PollCommentPrompt,
  PollQuestion,
  UserChoice,
  VoteAnswerInput,
  VoteBallotSubmission,
  VoteLinkBallot,
  VoteLinkBallotState,
} from '@lfx-one/shared/interfaces';
import { buildCommentResponses, getCommentPromptsData, isRankedPollType, reconcileCommentFormControls } from '@lfx-one/shared/utils';
import { CodePointLengthPipe } from '@pipes/code-point-length.pipe';
import { CheckboxModule } from 'primeng/checkbox';

/**
 * Presentational ballot form for the login-free vote link page (#4363): questions (single choice, multiple choice,
 * ranked with drag and up/down buttons), optional comment prompts, abstain, and a pinned Submit. It holds no token and
 * makes no requests; it only turns the voter's input into a {@link VoteBallotSubmission}.
 */
@Component({
  selector: 'lfx-vote-ballot-form',
  imports: [ReactiveFormsModule, DragDropModule, CheckboxModule, ButtonComponent, RadioButtonComponent, TextareaComponent, CodePointLengthPipe],
  templateUrl: './vote-ballot-form.component.html',
})
export class VoteBallotFormComponent {
  private readonly destroyRef = inject(DestroyRef);

  // === Inputs / Outputs ===
  public readonly ballot = input.required<VoteLinkBallot>();
  /** The recipient's existing ballot; applied only on regular (non pseudo-anonymous) votes that were already voted. */
  public readonly prefill = input<VoteLinkBallotState | null>(null);
  public readonly submitting = input<boolean>(false);
  public readonly submitLabel = input<string>('Submit Vote');
  public readonly submitted = output<VoteBallotSubmission>();

  // === Forms ===
  public readonly form = new FormGroup({});
  public readonly abstainControl = new FormControl<boolean>(false, { nonNullable: true });
  // Separate from `form` so abstain's disable()/enable() never touches comments.
  public readonly commentForm = new FormGroup({});

  // === Signals ===
  // Reactive dependency for derived state: control mutations here use { emitEvent: false }.
  private readonly formVersion = signal<number>(0);
  private prefilledComments = false;
  /** Comment prompts the voter has opened (or that arrived with text); the rest stay collapsed behind "Add a comment". */
  protected readonly openedComments = signal<ReadonlySet<string>>(new Set());

  protected readonly abstain: Signal<boolean> = toSignal(this.abstainControl.valueChanges, { initialValue: this.abstainControl.value });
  protected readonly questions: Signal<PollQuestion[]> = computed(() => this.ballot().poll_questions ?? []);
  protected readonly isRankedPoll: Signal<boolean> = computed(() => isRankedPollType(this.ballot().poll_type));
  protected readonly allowAbstain: Signal<boolean> = computed(() => !!this.ballot().allow_abstain);
  protected readonly commentPrompts: Signal<PollCommentPrompt[]> = computed(() => this.ballot().poll_comment_prompts ?? []);
  protected readonly commentPromptsData: Signal<CommentResponseFormData[]> = computed(() => {
    this.formVersion();
    return getCommentPromptsData(this.commentForm, this.commentPrompts());
  });
  protected readonly commentResponseMaxLength = VOTE_COMMENT_RESPONSE_MAX_LENGTH;
  protected readonly submitDisabled: Signal<boolean> = computed(() => {
    this.formVersion();
    if (this.submitting() || !this.commentForm.valid) return true;
    return this.abstain() ? false : !this.form.valid;
  });
  /** Choice ids currently selected per question, so a card can show its selected state beyond the radio/checkbox itself. */
  protected readonly selectedByQuestion: Signal<Map<string, ReadonlySet<string>>> = computed(() => {
    this.formVersion();
    const result = new Map<string, ReadonlySet<string>>();
    for (const question of this.questions()) {
      const raw = this.form.get(question.question_id)?.value as string | string[] | null | undefined;
      const single: string[] = typeof raw === 'string' && raw ? [raw] : [];
      const picked = Array.isArray(raw) ? raw : single;
      result.set(question.question_id, new Set(picked));
    }
    return result;
  });
  /** Why Submit is disabled, or '' when it is not waiting on a choice. Abstaining needs no choice. */
  protected readonly selectionHelper: Signal<string> = computed(() => {
    this.formVersion();
    if (this.abstain() || this.form.valid) return '';
    const questions = this.questions();
    if (questions.length !== 1) return 'Answer every question to submit';
    return questions[0].type === 'multiple_choice' ? 'Select at least one answer' : 'Select one answer';
  });
  protected readonly rankedOrderByQuestion: Signal<Map<string, UserChoice[]>> = computed(() => {
    this.formVersion();
    const result = new Map<string, UserChoice[]>();
    if (!this.isRankedPoll()) return result;
    for (const question of this.questions()) {
      const raw = this.form.get(question.question_id)?.value;
      const order = Array.isArray(raw) ? (raw as string[]) : null;
      if (!order?.length) {
        result.set(question.question_id, question.choices);
        continue;
      }
      const byId = new Map(question.choices.map((choice) => [choice.choice_id, choice]));
      result.set(
        question.question_id,
        order.map((id) => byId.get(id)).filter((choice): choice is UserChoice => !!choice)
      );
    }
    return result;
  });

  public constructor() {
    // Rebuild whenever the ballot (or the prefill) changes.
    toObservable(computed(() => ({ ballot: this.ballot(), prefill: this.prefill() })))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ ballot, prefill }) => this.build(ballot, prefill));

    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.bump());
    this.commentForm.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.bump());
    this.abstainControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((isAbstaining) => {
      if (isAbstaining) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
      this.bump();
    });
  }

  protected openComment(promptId: string): void {
    this.openedComments.update((opened) => new Set(opened).add(promptId));
  }

  protected onRankedDrop(questionId: string, event: CdkDragDrop<string[]>): void {
    this.reorder(questionId, event.previousIndex, event.currentIndex);
  }

  protected moveRank(questionId: string, fromIndex: number, toIndex: number): void {
    this.reorder(questionId, fromIndex, toIndex);
  }

  protected onSubmit(): void {
    if (this.submitting()) return;
    const isAbstain = this.abstain();
    if (!isAbstain && this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.commentForm.invalid) {
      this.commentForm.markAllAsTouched();
      return;
    }

    // Comments are independent of abstain. When the voter saw their existing comments, an emptied field means "clear"
    // (PUT with []); otherwise omitting the field keeps any existing comments untouched.
    const built = buildCommentResponses(this.commentPromptsData());
    const commentResponses: CommentResponseInput[] | undefined = this.prefilledComments ? (built ?? []) : built;

    this.submitted.emit({
      abstain: isAbstain,
      userVoteContent: isAbstain ? undefined : this.buildAnswers(this.questions()),
      commentResponses,
    });
  }

  private reorder(questionId: string, fromIndex: number, toIndex: number): void {
    const control = this.form.get(questionId);
    if (!control) return;
    const current = [...((control.value as string[] | null) ?? [])];
    if (toIndex < 0 || toIndex >= current.length) return;
    moveItemInArray(current, fromIndex, toIndex);
    control.setValue(current);
    this.bump();
  }

  /** Rebuilds every control for the ballot and applies the prefill — regular votes only, never pseudo-anonymous. */
  private build(ballot: VoteLinkBallot, prefill: VoteLinkBallotState | null): void {
    const ranked = isRankedPollType(ballot.poll_type);
    const applyPrefill = !!prefill?.already_voted && ballot.pseudo_anonymity === false;

    for (const id of Object.keys(this.form.controls)) this.form.removeControl(id, { emitEvent: false });
    for (const question of ballot.poll_questions ?? []) {
      const answer = applyPrefill ? prefill?.poll_answers?.find((a) => a.question_id === question.question_id) : undefined;
      if (ranked) {
        const declared = question.choices.map((choice) => choice.choice_id);
        const answered = [...(answer?.ranked_user_choice ?? [])].sort((a, b) => (a.choice_rank ?? 0) - (b.choice_rank ?? 0)).map((choice) => choice.choice_id);
        const known = answered.filter((id) => declared.includes(id));
        const order = known.length === declared.length ? known : declared;
        this.form.addControl(question.question_id, new FormControl<string[]>(order, { nonNullable: true, validators: [Validators.required] }), {
          emitEvent: false,
        });
      } else if (question.type === 'multiple_choice') {
        const picked = (answer?.user_choice ?? []).map((choice) => choice.choice_id);
        this.form.addControl(question.question_id, new FormControl<string[]>(picked, { nonNullable: true, validators: [Validators.required] }), {
          emitEvent: false,
        });
      } else {
        const picked = answer?.user_choice?.[0]?.choice_id ?? null;
        this.form.addControl(question.question_id, new FormControl<string | null>(picked, Validators.required), { emitEvent: false });
      }
    }

    reconcileCommentFormControls(this.commentForm, ballot.poll_comment_prompts ?? []);
    for (const control of Object.values(this.commentForm.controls) as FormControl<string>[]) control.reset('', { emitEvent: false });
    this.prefilledComments = applyPrefill;
    this.openedComments.set(new Set());
    if (applyPrefill) {
      for (const response of prefill?.comment_responses ?? []) {
        this.commentForm.get(response.prompt_id)?.setValue(response.comment_text, { emitEvent: false });
        if (response.comment_text) this.openComment(response.prompt_id);
      }
    }

    this.abstainControl.setValue(applyPrefill && prefill?.abstained === true);
    this.bump();
  }

  private bump(): void {
    this.formVersion.update((v) => v + 1);
  }

  private buildAnswers(questions: PollQuestion[]): VoteAnswerInput[] {
    const ranked = this.isRankedPoll();
    return questions.map((question) => {
      const raw = this.form.get(question.question_id)?.value as string | string[] | null | undefined;
      if (ranked) {
        const order = Array.isArray(raw) ? raw : [];
        return { question_id: question.question_id, ranked_choices: order.map((choiceId, index) => ({ choice_id: choiceId, choice_rank: index + 1 })) };
      }
      if (Array.isArray(raw)) return { question_id: question.question_id, choice_ids: raw };
      return { question_id: question.question_id, choice_ids: typeof raw === 'string' && raw.length > 0 ? [raw] : [] };
    });
  }
}
