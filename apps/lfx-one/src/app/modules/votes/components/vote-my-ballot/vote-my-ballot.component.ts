// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MyVoteBallot, PollCommentPrompt, Vote, VoteBallotChoiceView, VoteBallotQuestionView } from '@lfx-one/shared/interfaces';
import { buildVoteBallotQuestions } from '@lfx-one/shared/utils';

/**
 * Read-only view of the viewer's own current ballot on the vote page (#4331).
 * @description Shows only what the caller's own `my-ballot` read returned, so on a pseudo-anonymous vote a voter still
 * sees just their own choices. My Votes also provides read-only review; submitted ballots cannot be changed through this app.
 */
@Component({
  selector: 'lfx-vote-my-ballot',
  templateUrl: './vote-my-ballot.component.html',
})
export class VoteMyBallotComponent {
  // === Inputs ===
  public readonly vote = input.required<Vote>();
  public readonly ballot = input.required<MyVoteBallot>();

  // === Computed Signals ===
  protected readonly questions: Signal<VoteBallotQuestionView[]> = computed(() => buildVoteBallotQuestions(this.vote(), this.ballot()));
  protected readonly selectedChoicesByQuestion: Signal<Record<string, VoteBallotChoiceView[]>> = this.initSelectedChoicesByQuestion();
  protected readonly commentPrompts: Signal<PollCommentPrompt[]> = computed(() => this.vote().poll_comment_prompts ?? []);
  protected readonly commentsByPrompt: Signal<Record<string, string | null>> = this.initCommentsByPrompt();

  // === Private Initializers ===
  private initSelectedChoicesByQuestion(): Signal<Record<string, VoteBallotChoiceView[]>> {
    return computed(() => Object.fromEntries(this.questions().map((question) => [question.questionId, question.choices.filter((choice) => choice.selected)])));
  }

  /** Mirrors the manager ballot dialog: a blank comment reads as no comment. */
  private initCommentsByPrompt(): Signal<Record<string, string | null>> {
    return computed(() => {
      const comments = new Map(
        this.ballot()
          .comment_responses.filter((response) => !!response.comment_text?.trim())
          .map((response) => [response.prompt_id, response.comment_text])
      );
      return Object.fromEntries(this.commentPrompts().map((prompt) => [prompt.prompt_id, comments.get(prompt.prompt_id) ?? null]));
    });
  }
}
