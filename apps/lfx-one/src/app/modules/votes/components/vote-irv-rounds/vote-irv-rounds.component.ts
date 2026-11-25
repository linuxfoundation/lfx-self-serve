// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { IrvRoundCell, IrvRoundDisplayRow, IrvRoundsView, IrvRoundStep, IrvRoundStepLine } from '@lfx-one/shared/interfaces';
import { joinNames } from '@lfx-one/shared/utils';

/**
 * Round-by-round instant-runoff count for one ranked question (#6152): a matrix of each candidate's votes per round,
 * then one plain-language line per round on who was eliminated, where their ballots went, and who won.
 * Callers render it only for final results.
 */
@Component({
  selector: 'lfx-vote-irv-rounds',
  templateUrl: './vote-irv-rounds.component.html',
  host: { class: 'contents' },
})
export class VoteIrvRoundsComponent {
  // === Inputs ===
  public readonly rounds = input.required<IrvRoundsView>();
  /** Emit `data-testid` hooks; the ranked results parent turns them off for its `voter` variant. */
  public readonly testIds = input<boolean>(true);

  // === Computed Signals ===
  /** Candidate rows with each cell's vote, percentage and status text. */
  protected readonly rows: Signal<IrvRoundDisplayRow[]> = computed(() =>
    this.rounds().rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        votesText: cell.votes === null ? '—' : `${cell.votes}`,
        percentageText: cell.percentage === null ? '' : `${cell.percentage}%`,
        statusLabel: this.cellLabel(cell),
      })),
    }))
  );
  /** One sentence per round describing what happened. */
  protected readonly stepLines: Signal<IrvRoundStepLine[]> = this.initStepLines();

  // === Private Initializers ===
  private initStepLines(): Signal<IrvRoundStepLine[]> {
    return computed(() => {
      const view = this.rounds();
      const finalRound = view.rounds.find((column) => column.isFinal)?.roundNumber ?? null;
      return view.steps.map((step) => ({ roundNumber: step.roundNumber, text: this.stepText(step, step.roundNumber === finalRound) }));
    });
  }

  // === Private Helpers ===
  private cellLabel(cell: IrvRoundCell): string | null {
    switch (cell.status) {
      case 'eliminated':
        return 'Eliminated';
      case 'winner':
        return 'Winner';
      case 'tied':
        return 'Tied';
      default:
        return null;
    }
  }

  private stepText(step: IrvRoundStep, isFinal: boolean): string {
    const names = joinNames(step.choiceTexts);
    switch (step.kind) {
      case 'eliminated':
        return [`${names} was eliminated with ${this.count(step.votes ?? 0, 'vote')}.`, this.transferText(step), this.tieBreakText(step)]
          .filter((part) => part !== '')
          .join(' ');
      case 'winner':
        if (step.votes === null) return `${names} won.`;
        return `${names} won with ${step.votes} of ${this.count(step.continuingBallots, 'continuing ballot')} (majority needed: ${step.threshold}).`;
      case 'tie':
        if (step.votes === null) return `${names} tied, so no single winner could be determined.`;
        return `${names} tied with ${this.count(step.votes, 'vote')} each, so no single winner could be determined.`;
      case 'exhausted':
        return 'Every ballot was exhausted, so no single winner could be determined.';
      default:
        return isFinal ? 'No winner could be determined.' : 'No option was eliminated in this round.';
    }
  }

  /** Where an eliminated option's ballots went: "Their ballots moved: 5 to A, 3 to B, 2 exhausted." */
  private transferText(step: IrvRoundStep): string {
    if (!step.votes) return 'No ballots to transfer.';
    if (step.transfers.length === 0) {
      return step.exhaustedFromElimination === 1 ? 'Their ballot was exhausted.' : `All ${step.exhaustedFromElimination} of their ballots were exhausted.`;
    }
    const moves = step.transfers.map((transfer) => `${transfer.votes} to ${transfer.choiceText}`);
    if (step.exhaustedFromElimination > 0) moves.push(`${step.exhaustedFromElimination} exhausted`);
    return `${step.votes === 1 ? 'Their ballot moved' : 'Their ballots moved'}: ${moves.join(', ')}.`;
  }

  private tieBreakText(step: IrvRoundStep): string {
    if (step.tieBreak === 'lower_preference') {
      return `Tied for the fewest votes; decided by comparing lower-ranked preferences (rank ${step.tieBreakLevel}).`;
    }
    if (step.tieBreak === 'random') return 'Tied for the fewest votes; the voting service picked one at random.';
    return '';
  }

  /** "1 vote", "2 votes". */
  private count(n: number, noun: string): string {
    return `${n} ${n === 1 ? noun : `${noun}s`}`;
  }
}
