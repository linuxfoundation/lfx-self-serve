// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, input, model, Signal } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { VOTE_COMMENT_RESULTS_PAGE_SIZE, VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS } from '@lfx-one/shared/constants';
import { CommentResultPageView, PollCommentResult } from '@lfx-one/shared/interfaces';
import { splitIntoParagraphs } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { PaginatorModule, PaginatorState } from 'primeng/paginator';

/** Paginated comment-results list, one block per prompt. Page state is a model so the host can keep it when this component is destroyed and recreated (e.g. a drawer swapping in its loading skeleton on reopen). */
@Component({
  selector: 'lfx-vote-comment-results',
  imports: [DatePipe, ExpandableTextComponent, LinkifyPipe, PaginatorModule],
  templateUrl: './vote-comment-results.component.html',
  styleUrl: './vote-comment-results.component.scss',
  host: { class: 'contents' },
})
export class VoteCommentResultsComponent {
  // === Inputs ===
  public readonly commentResults = input.required<PollCommentResult[]>();

  // === Constants ===
  protected readonly commentRowsPerPageOptions = VOTE_COMMENT_RESULTS_ROWS_PER_PAGE_OPTIONS;

  // === Model Signals (two-way binding) ===
  /** Per-prompt paginator state ({ first, rows }), keyed by prompt_id. */
  public readonly pageState = model<Map<string, PaginatorState>>(new Map());

  // === Computed Signals ===
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
          responses: cr.responses.slice(first, first + rows).map((response) => ({
            ...response,
            paragraphs: splitIntoParagraphs(response.comment_text),
          })),
          totalResponses,
          first,
          rows,
        };
      });
    });
  }
}
