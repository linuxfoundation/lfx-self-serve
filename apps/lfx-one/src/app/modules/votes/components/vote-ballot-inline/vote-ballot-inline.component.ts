// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, input, output, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { INVITATION_NOT_FOUND } from '@lfx-one/shared/constants';
import { PollQuestion, Vote, VoteAnswerInput } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { CheckboxModule } from 'primeng/checkbox';
import { finalize } from 'rxjs';

@Component({
  selector: 'lfx-vote-ballot-inline',
  imports: [ReactiveFormsModule, CheckboxModule, ButtonComponent, RadioButtonComponent],
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
    const userVoteContent = isAbstain || !question ? undefined : this.buildAnswers(question);

    this.submitting.set(true);

    this.voteService
      .submitMyResponse(vote.uid, { abstain: isAbstain, userVoteContent })
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
      if (this.abstain()) return false;
      if (!this.question()) return true;
      return !this.form.valid;
    });
  }

  private setupFormReactions(): void {
    toObservable(this.question)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.rebuildForm(q));

    this.form.statusChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.formVersion.update((v) => v + 1));

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
}
