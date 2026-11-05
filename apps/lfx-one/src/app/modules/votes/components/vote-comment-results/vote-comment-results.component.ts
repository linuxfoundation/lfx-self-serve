// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { VOTE_COMMENT_ANONYMOUS_NOTICES } from '@lfx-one/shared/constants';
import { CommentResultView, PollCommentResult, VoteCommentAnonymityReason } from '@lfx-one/shared/interfaces';
import { splitIntoParagraphs } from '@lfx-one/shared/utils';

import { VoteCommentItemComponent } from '../vote-comment-item/vote-comment-item.component';

/** Independent comment-question panels. The host retains expansion choices across tab switches and resets them for another vote. */
@Component({
  selector: 'lfx-vote-comment-results',
  imports: [ButtonComponent, VoteCommentItemComponent],
  templateUrl: './vote-comment-results.component.html',
  host: { class: 'contents' },
})
export class VoteCommentResultsComponent {
  // === Inputs ===
  public readonly commentResults = input.required<PollCommentResult[]>();
  /** Adds a "View ballot" link on each response — vote managers on named votes only (#3914). */
  public readonly showBallotLinks = input<boolean>(false);
  /** Text-only responses — no author, date, abstained label or ballot link: a pseudo-anonymous vote (#3916), or a non-manager on a named vote (#4330). */
  public readonly anonymous = input<boolean>(false);
  /** Why `anonymous` applies; picks the notice above the comments. */
  public readonly anonymousReason = input<VoteCommentAnonymityReason>('pseudo_anonymous');

  // === Outputs ===
  /** The response's `vote_id` — the vote response (ballot) uid the Voters tab opens. */
  public readonly viewBallot = output<string>();

  // === Model Signals (two-way binding) ===
  /** Per-prompt expansion choices for multi-question votes; a single question is always visible. */
  public readonly expansionState = model<Map<string, boolean>>(new Map());

  // === Computed Signals ===
  protected readonly anonymousNotice: Signal<string> = computed(() => VOTE_COMMENT_ANONYMOUS_NOTICES[this.anonymousReason()]);
  protected readonly hasMultipleQuestions: Signal<boolean> = computed(() => this.commentResults().length > 1);
  protected readonly displayCommentResults: Signal<CommentResultView[]> = this.initDisplayCommentResults();
  protected readonly expandedPrompts: Signal<ReadonlySet<string>> = this.initExpandedPrompts();
  protected readonly allExpanded: Signal<boolean> = computed(
    () => this.commentResults().length > 0 && this.expandedPrompts().size === this.commentResults().length
  );

  // === Protected Methods ===
  protected togglePrompt(promptId: string): void {
    const expanded = this.expandedPrompts().has(promptId);
    this.expansionState.update((state) => new Map(state).set(promptId, !expanded));
  }

  protected setAllExpanded(expanded: boolean): void {
    this.expansionState.set(new Map(this.commentResults().map((result) => [result.prompt.prompt_id, expanded])));
  }

  // === Private Initializers ===
  /** Render every response returned by the endpoint; the existing BFF cap is unchanged. */
  private initDisplayCommentResults(): Signal<CommentResultView[]> {
    return computed(() =>
      this.commentResults().map((result) => ({
        ...result,
        responses: result.responses.map((response, position) => ({
          ...response,
          paragraphs: splitIntoParagraphs(response.comment_text),
          position,
        })),
        totalResponses: result.responses.length,
      }))
    );
  }

  private initExpandedPrompts(): Signal<ReadonlySet<string>> {
    return computed(() => {
      const results = this.commentResults();
      const state = this.expansionState();
      return new Set(results.filter((result) => results.length === 1 || state.get(result.prompt.prompt_id) === true).map((result) => result.prompt.prompt_id));
    });
  }
}
