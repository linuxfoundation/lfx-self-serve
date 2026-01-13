// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, model, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectableCardComponent } from '@components/selectable-card/selectable-card.component';
import { TagComponent } from '@components/tag/tag.component';
import { PollStatus, VoteResponseStatus } from '@lfx-one/shared';
import { PollAnswer, RelativeDateInfo, UserChoice, VoteDetails } from '@lfx-one/shared/interfaces';
import { CombinedVoteStatusLabelPipe } from '@pipes/combined-vote-status-label.pipe';
import { CombinedVoteStatusSeverityPipe } from '@pipes/combined-vote-status-severity.pipe';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { DialogService } from 'primeng/dynamicdialog';

import { VoteSubmittedDialogComponent } from '../vote-submitted-dialog/vote-submitted-dialog.component';

@Component({
  selector: 'lfx-vote-details-drawer',
  imports: [
    DrawerModule,
    ConfirmDialogModule,
    TagComponent,
    ButtonComponent,
    MessageComponent,
    SelectableCardComponent,
    DatePipe,
    CombinedVoteStatusLabelPipe,
    CombinedVoteStatusSeverityPipe,
    ReactiveFormsModule,
  ],
  providers: [DialogService],
  templateUrl: './vote-details-drawer.component.html',
  styleUrl: './vote-details-drawer.component.scss',
})
export class VoteDetailsDrawerComponent {
  // === Private Injections ===
  private readonly confirmationService = inject(ConfirmationService);
  private readonly dialogService = inject(DialogService);

  // === Enum References (for template access) ===
  protected readonly PollStatus = PollStatus;

  // === Inputs ===
  public readonly vote = input<VoteDetails | null>(null);

  // === Model Signals ===
  public readonly visible = model<boolean>(false);

  // === Outputs ===
  public readonly voteSubmitted = output<{ pollId: string; answers: PollAnswer[] }>();

  // === Forms ===
  public voteForm = new FormGroup<Record<string, FormControl<string | null>>>({});
  public checkboxForms: Record<string, FormGroup<Record<string, FormControl<boolean>>>> = {};

  // === Computed Signals ===
  protected readonly voteFormSignal = this.initVoteFormSignal();
  protected readonly isReadOnly: Signal<boolean> = this.initIsReadOnly();
  protected readonly allQuestionsAnswered: Signal<boolean> = this.initAllQuestionsAnswered();
  protected readonly selectionTypeText: Signal<string> = this.initSelectionTypeText();
  protected readonly hasUserVoted: Signal<boolean> = this.initHasUserVoted();
  protected readonly showWarningMessage: Signal<boolean> = this.initShowWarningMessage();
  protected readonly showSubmittedMessage: Signal<boolean> = this.initShowSubmittedMessage();
  protected readonly relativeDateInfo: Signal<RelativeDateInfo> = this.initRelativeDateInfo();
  protected readonly userVoteChoiceText: Signal<string | null> = this.initUserVoteChoiceText();

  // === Constructor ===
  public constructor() {
    // Build form when vote changes
    effect(() => {
      const v = this.vote();
      if (v) {
        this.buildForm(v);
      }
    });
  }

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  protected onSubmitClick(): void {
    if (!this.allQuestionsAnswered()) return;

    this.confirmationService.confirm({
      header: 'Confirm Vote Submission',
      message: 'You cannot change your vote after submission. Are you sure you want to continue?',
      icon: 'fa-solid fa-triangle-exclamation text-amber-600',
      acceptLabel: 'Yes, Submit',
      rejectLabel: 'Cancel',
      accept: () => this.submitVote(),
    });
  }

  // === Private Methods ===
  private submitVote(): void {
    const v = this.vote();
    if (!v) return;

    const answers: PollAnswer[] = v.poll_questions.map((question) => {
      const userChoice: UserChoice[] = [];

      if (question.type === 'single_choice') {
        const selectedChoiceId = this.voteForm.get(question.question_id)?.value as string;
        const selectedChoice = question.choices.find((c) => c.choice_id === selectedChoiceId);
        if (selectedChoice) {
          userChoice.push(selectedChoice);
        }
      } else {
        const group = this.checkboxForms[question.question_id];
        if (group) {
          question.choices.forEach((choice) => {
            if (group.get(choice.choice_id)?.value === true) {
              userChoice.push(choice);
            }
          });
        }
      }

      return {
        prompt: question.prompt,
        question_id: question.question_id,
        type: question.type,
        user_choice: userChoice,
        ranked_user_choice: [],
      };
    });

    this.voteSubmitted.emit({
      pollId: v.poll_id,
      answers,
    });

    // Show success dialog
    this.showSuccessDialog(v.poll_name);
  }

  private showSuccessDialog(pollName: string): void {
    const ref = this.dialogService.open(VoteSubmittedDialogComponent, {
      data: { pollName },
      showHeader: false,
      dismissableMask: true,
      styleClass: 'vote-submitted-dialog',
      width: '90%',
      style: { maxWidth: '28rem' },
    });

    ref?.onClose.subscribe(() => {
      this.onClose();
    });
  }

  // === Private Initializers ===
  private initVoteFormSignal(): Signal<Partial<Record<string, string | null>> | null> {
    return toSignal(this.voteForm.valueChanges, { initialValue: null });
  }

  private initIsReadOnly(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      if (!v) return true;
      return v.poll_status !== PollStatus.ACTIVE || v.vote_status !== VoteResponseStatus.AWAITING_RESPONSE;
    });
  }

  private initAllQuestionsAnswered(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      this.voteFormSignal();
      if (!v?.poll_questions) return false;

      return v.poll_questions.every((q) => {
        if (q.type === 'single_choice') {
          const control = this.voteForm.get(q.question_id);
          return control?.value !== null && control?.value !== '';
        }
        const group = this.checkboxForms[q.question_id];
        if (!group) return false;
        return Object.values(group.controls).some((ctrl) => ctrl.value === true);
      });
    });
  }

  private initSelectionTypeText(): Signal<string> {
    return computed(() => {
      const v = this.vote();
      if (!v?.poll_questions?.length) return '';

      const types = new Set(v.poll_questions.map((q) => q.type));

      // If all questions have the same type, display that type
      if (types.size === 1) {
        const type = v.poll_questions[0].type;
        return type === 'multiple_choice' ? 'Multiple selection' : 'Single selection';
      }

      // Mixed types - don't display a single label (each question shows its type in context)
      return '';
    });
  }

  private initHasUserVoted(): Signal<boolean> {
    return computed(() => {
      const v = this.vote();
      return v?.vote_status === VoteResponseStatus.RESPONDED;
    });
  }

  private initShowWarningMessage(): Signal<boolean> {
    return computed(() => {
      const isVisible = this.visible();
      const v = this.vote();
      if (!isVisible || !v) return false;
      const isActive = v.poll_status === PollStatus.ACTIVE;
      const isAwaitingResponse = v.vote_status === VoteResponseStatus.AWAITING_RESPONSE;
      return isActive && isAwaitingResponse;
    });
  }

  private initShowSubmittedMessage(): Signal<boolean> {
    return computed(() => {
      const isVisible = this.visible();
      const v = this.vote();
      if (!isVisible || !v) return false;
      const hasVoted = v.vote_status === VoteResponseStatus.RESPONDED;
      const isNotEnded = v.poll_status !== PollStatus.ENDED;
      const hasCreationTime = !!v.vote_creation_time;
      return hasVoted && isNotEnded && hasCreationTime;
    });
  }

  private initRelativeDateInfo(): Signal<RelativeDateInfo> {
    return computed(() => {
      const v = this.vote();
      if (!v) return { text: '', color: '' };

      const endDate = new Date(v.end_time);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return { text: 'Closed', color: 'text-slate-500' };
      } else if (diffDays <= 3) {
        return { text: `${diffDays} day${diffDays !== 1 ? 's' : ''} left`, color: 'text-red-600' };
      } else if (diffDays <= 7) {
        return { text: `${diffDays} days left`, color: 'text-amber-600' };
      }
      return { text: `${diffDays} days left`, color: 'text-slate-600' };
    });
  }

  private initUserVoteChoiceText(): Signal<string | null> {
    return computed(() => {
      const v = this.vote();
      if (!v?.poll_answers?.length || !v.poll_questions?.length) return null;

      // For single-question polls, show the specific answer
      if (v.poll_questions.length === 1) {
        const firstAnswer = v.poll_answers[0];
        if (!firstAnswer?.user_choice?.length) return null;
        return firstAnswer.user_choice.map((c) => c.choice_text.toUpperCase()).join(', ');
      }

      // For multi-question polls, return null - answers are shown inline with each question
      return null;
    });
  }

  // === Private Helpers ===
  private buildForm(vote: VoteDetails): void {
    // Clear existing controls from the form (keeping the same form reference)
    // Using type assertion since removeControl expects a stricter key type
    Object.keys(this.voteForm.controls).forEach((key) => {
      (this.voteForm as FormGroup).removeControl(key);
    });
    this.checkboxForms = {};

    vote.poll_questions.forEach((question) => {
      if (question.type === 'single_choice') {
        // Single choice: FormControl with choice_id as value
        let initialValue: string | null = null;

        // If user has already voted, populate their response
        if (vote.poll_answers?.length) {
          const answer = vote.poll_answers.find((a) => a.question_id === question.question_id);
          if (answer?.user_choice?.length) {
            initialValue = answer.user_choice[0].choice_id;
          }
        }

        // Add control to existing form instead of replacing the form
        this.voteForm.addControl(question.question_id, new FormControl<string | null>(initialValue));
      } else {
        // Multiple choice: FormGroup with boolean controls for each choice
        const choiceControls: Record<string, FormControl<boolean>> = {};

        question.choices.forEach((choice) => {
          let isSelected = false;

          // If user has already voted, check if this choice was selected
          if (vote.poll_answers?.length) {
            const answer = vote.poll_answers.find((a) => a.question_id === question.question_id);
            if (answer?.user_choice?.length) {
              isSelected = answer.user_choice.some((c) => c.choice_id === choice.choice_id);
            }
          }

          choiceControls[choice.choice_id] = new FormControl<boolean>(isSelected, { nonNullable: true });
        });

        this.checkboxForms[question.question_id] = new FormGroup(choiceControls);
      }
    });

    // Disable forms if read-only
    if (this.isReadOnly()) {
      this.voteForm.disable();
      Object.values(this.checkboxForms).forEach((form) => form.disable());
    }
  }
}
