// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal, signal } from '@angular/core';
import { TagComponent } from '@components/tag/tag.component';
import { VOTE_CONDORCET_BALLOT_PREVIEW_LIMIT, VOTE_CONDORCET_RANK_COLORS } from '@lfx-one/shared/constants';
import { CondorcetOutcome } from '@lfx-one/shared/enums';
import { CondorcetBallotPatternRow, CondorcetPairwiseRow, CondorcetQuestionView, RankedChoiceDistribution } from '@lfx-one/shared/interfaces';
import { joinNames } from '@lfx-one/shared/utils';
import { OrdinalPipe } from '@pipes/ordinal.pipe';

/**
 * Outcome-first Condorcet IRV results for one question (#5969, #6112).
 * The service decides the outcome; preference bars and ballot previews only explain existing counts.
 * Open and finalizing votes never display a winner or final standings.
 */
@Component({
  selector: 'lfx-vote-condorcet-results',
  imports: [TagComponent, OrdinalPipe],
  templateUrl: './vote-condorcet-results.component.html',
  host: { class: 'contents' },
})
export class VoteCondorcetResultsComponent {
  // === Inputs ===
  public readonly question = input.required<CondorcetQuestionView>();
  /** One-based position in a multi-question Results view; omit for an unnumbered heading. */
  public readonly questionNumber = input<number>();
  public readonly isClosed = input.required<boolean>();
  /** Voting has ended; until `isClosed`, the final results are still being confirmed. */
  public readonly isEnded = input<boolean>(false);
  /** Drafts have not opened, so they must not be described as voting in progress. */
  public readonly isDraft = input<boolean>(false);
  /** Named ballots are still loading, so the ballot section waits instead of saying they aren't available. */
  public readonly ballotsLoading = input<boolean>(false);
  protected readonly rankColors = VOTE_CONDORCET_RANK_COLORS;
  protected readonly ballotPreviewLimit = VOTE_CONDORCET_BALLOT_PREVIEW_LIMIT;

  // === Writable Signals ===
  protected readonly showAllBallots = signal(false);

  // === Computed Signals ===
  protected readonly hasWinner: Signal<boolean> = computed(
    () => this.question().outcome === CondorcetOutcome.CONDORCET_WINNER || this.question().outcome === CondorcetOutcome.IRV_WINNER
  );
  protected readonly isTie: Signal<boolean> = computed(() => this.question().outcome === CondorcetOutcome.TIE);
  protected readonly outcomeHeading: Signal<string> = this.initOutcomeHeading();
  protected readonly outcomeMessage: Signal<string> = this.initOutcomeMessage();
  protected readonly winnerMatchups: Signal<CondorcetPairwiseRow | undefined> = this.initWinnerMatchups();
  protected readonly preferenceDistributions: Signal<RankedChoiceDistribution[]> = this.initPreferenceDistributions();
  protected readonly visibleBallotPatterns: Signal<CondorcetBallotPatternRow[]> = this.initVisibleBallotPatterns();

  // === Private Initializers ===
  private initOutcomeHeading(): Signal<string> {
    return computed(() => {
      if (this.isDraft()) return 'Not open yet';
      if (!this.isClosed()) return this.isEnded() ? 'Finalizing results' : 'Voting in progress';
      if (this.hasWinner()) return `${this.question().winnerNames[0]} won`;
      return this.isTie() ? 'Tie — no single winner' : 'No winner determined';
    });
  }

  private initOutcomeMessage(): Signal<string> {
    return computed(() => {
      const { outcome, winnerNames } = this.question();
      switch (outcome) {
        case CondorcetOutcome.CONDORCET_WINNER:
          return 'Preferred over every other option in head-to-head comparisons.';
        case CondorcetOutcome.IRV_WINNER:
          return 'No option beat every other option head-to-head, so instant-runoff elimination decided the result.';
        case CondorcetOutcome.TIE:
          return `There is a tie between ${joinNames(winnerNames)}. No single winner can be determined.`;
        default:
          return 'No winner could be determined.';
      }
    });
  }

  private initWinnerMatchups(): Signal<CondorcetPairwiseRow | undefined> {
    return computed(() => {
      const q = this.question();
      if (!this.isClosed() || q.outcome !== CondorcetOutcome.CONDORCET_WINNER) return undefined;
      const winner = q.standings.find((standing) => standing.isWinner);
      return q.pairwise.find(
        (row) => row.candidate.choiceId === winner?.choiceId && row.cells.some((cell) => cell.result !== 'self' && cell.result !== 'neutral')
      );
    });
  }

  private initPreferenceDistributions(): Signal<RankedChoiceDistribution[]> {
    return computed(() => {
      const q = this.question();
      return q.rankSummary.map((row) => {
        // Normalize within ballots ranking this option, not all responses (which may include abstentions or omissions).
        const totalRanked = row.counts.reduce((sum, count) => sum + count, 0);
        return {
          choiceId: row.candidate.choiceId,
          choiceText: row.candidate.choiceText,
          totalRanked,
          rankCounts: q.ranks.map((rank, index) => {
            const count = row.counts[index] ?? 0;
            return { rank, count, percentage: totalRanked > 0 ? (count / totalRanked) * 100 : 0 };
          }),
        };
      });
    });
  }

  private initVisibleBallotPatterns(): Signal<CondorcetBallotPatternRow[]> {
    return computed(() => {
      const patterns = this.question().ballotPatterns ?? [];
      return this.showAllBallots() ? patterns : patterns.slice(0, VOTE_CONDORCET_BALLOT_PREVIEW_LIMIT);
    });
  }
}
