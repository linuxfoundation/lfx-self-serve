// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { PollStatus, VoteVoterStatus } from '@lfx-one/shared/enums';
import { PollCommentPrompt, Vote, VoteBallotDialogData, VoteBallotQuestionView, VoteVoterRowView } from '@lfx-one/shared/interfaces';
import { buildVoteBallotQuestions, normalizePollStatus } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Read-only view of one invited voter's current ballot (#3914), opened from the vote detail page's Voters tab. Next and
 * previous step through the ballots in the order the table showed them; voters with no ballot are not in the list.
 */
@Component({
  selector: 'lfx-vote-ballot-dialog',
  imports: [DatePipe, ButtonComponent],
  templateUrl: './vote-ballot-dialog.component.html',
})
export class VoteBallotDialogComponent {
  // === Services ===
  private readonly config = inject<DynamicDialogConfig<VoteBallotDialogData>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);

  // === Dialog Data ===
  protected readonly vote: Vote = this.config.data!.vote;
  protected readonly ballots: VoteVoterRowView[] = this.config.data!.ballots;
  protected readonly commentPrompts: PollCommentPrompt[] = this.vote.poll_comment_prompts ?? [];
  protected readonly isActive: boolean = normalizePollStatus(this.vote.status) === PollStatus.ACTIVE;

  // === Writable Signals ===
  protected readonly index = signal<number>(this.clampIndex(this.config.data!.index));

  // === Computed Signals ===
  protected readonly current: Signal<VoteVoterRowView | null> = computed(() => this.ballots[this.index()] ?? null);
  protected readonly isAbstained: Signal<boolean> = computed(() => this.current()?.status === VoteVoterStatus.ABSTAINED);
  protected readonly questions: Signal<VoteBallotQuestionView[]> = computed(() => {
    const current = this.current();
    return current ? buildVoteBallotQuestions(this.vote, current.voter) : [];
  });
  /** The current voter's comment per prompt id; a prompt without one reads "No comment." */
  protected readonly commentsByPrompt: Signal<Map<string, string>> = computed(
    () =>
      new Map(
        (this.current()?.voter.comment_responses ?? [])
          .filter((response) => !!response.comment_text?.trim())
          .map((response) => [response.prompt_id, response.comment_text])
      )
  );
  protected readonly hasPrevious: Signal<boolean> = computed(() => this.index() > 0);
  protected readonly hasNext: Signal<boolean> = computed(() => this.index() < this.ballots.length - 1);

  // === Protected Methods ===
  protected previous(): void {
    if (this.hasPrevious()) this.index.update((index) => index - 1);
  }

  protected next(): void {
    if (this.hasNext()) this.index.update((index) => index + 1);
  }

  protected close(): void {
    this.ref.close();
  }

  // === Private Helpers ===
  private clampIndex(index: number): number {
    return Math.min(Math.max(index, 0), Math.max(this.ballots.length - 1, 0));
  }
}
