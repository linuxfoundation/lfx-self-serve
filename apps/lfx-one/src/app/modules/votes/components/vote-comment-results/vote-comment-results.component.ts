// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, output, Signal } from '@angular/core';
import { VOTE_COMMENT_ANONYMOUS_NOTICES, VOTE_COMMENT_RESULTS_PAGE_SIZE, VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS } from '@lfx-one/shared/constants';
import { CommentResultPageView, PollCommentResult, VoteCommentAnonymityReason } from '@lfx-one/shared/interfaces';
import { splitIntoParagraphs } from '@lfx-one/shared/utils';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';

import { VoteCommentItemComponent } from '../vote-comment-item/vote-comment-item.component';

/** Paginated comment-results list, one block per prompt. Page state is a model so the host can keep it when this component is destroyed and recreated (e.g. a drawer swapping in its loading skeleton on reopen). */
@Component({
  selector: 'lfx-vote-comment-results',
  imports: [PaginatorModule, VoteCommentItemComponent],
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

  // === Constants ===
  protected readonly commentRowsPerPageOptions = VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS;

  // === Model Signals (two-way binding) ===
  /** Per-prompt paginator state ({ first, rows }), keyed by prompt_id. */
  public readonly pageState = model<Map<string, PaginatorState>>(new Map());

  // === Computed Signals ===
  protected readonly anonymousNotice: Signal<string> = computed(() => VOTE_COMMENT_ANONYMOUS_NOTICES[this.anonymousReason()]);
  protected readonly paginatedCommentResults: Signal<CommentResultPageView[]> = this.initPaginatedCommentResults();

  // === Protected Methods ===
  protected onCommentPageChange(promptId: string, event: PaginatorState): void {
    this.pageState.update((prev) => new Map(prev).set(promptId, { first: event.first ?? 0, rows: event.rows ?? VOTE_COMMENT_RESULTS_PAGE_SIZE }));
  }

  // === Private Initializers ===
  /** Slices each prompt's responses to its current page. The offset is clamped to the last valid
   *  page so a stale Map entry (e.g. from a previously opened vote with more comments, or after a
   *  rows-per-page change) can never render an empty page. */
  private initPaginatedCommentResults(): Signal<CommentResultPageView[]> {
    return computed(() => {
      const stateByPrompt = this.pageState();

      return this.commentResults().map((cr) => {
        const totalResponses = cr.responses.length;
        const state = stateByPrompt.get(cr.prompt.prompt_id);
        const rows = state?.rows ?? VOTE_COMMENT_RESULTS_PAGE_SIZE;
        const lastPageFirst = Math.max(0, Math.ceil(totalResponses / rows) - 1) * rows;
        const first = Math.min(state?.first ?? 0, lastPageFirst);

        return {
          ...cr,
          responses: cr.responses.slice(first, first + rows).map((response, index) => ({
            ...response,
            paragraphs: splitIntoParagraphs(response.comment_text),
            position: first + index,
          })),
          totalResponses,
          first,
          rows,
        };
      });
    });
  }
}
