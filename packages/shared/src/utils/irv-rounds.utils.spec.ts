// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { IrvRoundSummary } from '../interfaces/poll.interface';
import { buildIrvRoundsView } from './irv-rounds.utils';

const TEXT: Record<string, string> = { a: 'Candidate A', b: 'Candidate B', c: 'Candidate C', d: 'Candidate D' };
const textOf = (id: string): string => TEXT[id] ?? id;

/** One round as the voting service sends it: `eliminated_choice_id` is `""` when nobody was eliminated. */
function round(
  roundNumber: number,
  votes: Record<string, number>,
  opts: { exhausted?: number; eliminated?: string; transfers?: Record<string, number>; message?: string } = {}
): IrvRoundSummary {
  const total = Object.values(votes).reduce((sum, count) => sum + count, 0);
  return {
    round_number: roundNumber,
    votes: Object.entries(votes).map(([choice_id, vote_count]) => ({ choice_id, vote_count, percentage: total ? (vote_count / total) * 100 : 0 })),
    total_votes: total,
    exhausted_votes: opts.exhausted ?? 0,
    threshold: Math.floor(total / 2) + 1,
    eliminated_choice_id: opts.eliminated ?? '',
    ...(opts.transfers ? { transferred_votes: Object.entries(opts.transfers).map(([choice_id, vote_count]) => ({ choice_id, vote_count })) } : {}),
    message: opts.message ?? '',
  };
}

/** Delta out (2 exhausted), then Gamma out (1 exhausted), then Alpha wins by majority. */
const MAJORITY_ROUNDS: IrvRoundSummary[] = [
  round(1, { a: 40, b: 30, c: 20, d: 10 }, { eliminated: 'd', transfers: { b: 3, a: 5 }, message: 'd eliminated with 10 votes.' }),
  round(2, { a: 45, b: 33, c: 20 }, { exhausted: 2, eliminated: 'c', transfers: { a: 4, b: 15 }, message: 'c eliminated with 20 votes.' }),
  round(3, { a: 49, b: 48 }, { exhausted: 3, message: 'a wins by majority.' }),
];

describe('buildIrvRoundsView', () => {
  it('returns null when there are no rounds', () => {
    expect(buildIrvRoundsView([], ['a'], ['a'], textOf)).toBeNull();
  });

  it('builds round columns with footer values, marking only the last round final', () => {
    const view = buildIrvRoundsView(MAJORITY_ROUNDS, ['a', 'b', 'c', 'd'], ['a'], textOf);

    expect(view?.rounds).toEqual([
      { roundNumber: 1, continuingBallots: 100, exhaustedBallots: 0, threshold: 51, isFinal: false },
      { roundNumber: 2, continuingBallots: 98, exhaustedBallots: 2, threshold: 50, isFinal: false },
      { roundNumber: 3, continuingBallots: 97, exhaustedBallots: 3, threshold: 49, isFinal: true },
    ]);
  });

  it('builds a row per candidate with continuing, eliminated, out and winner cells', () => {
    const view = buildIrvRoundsView(MAJORITY_ROUNDS, ['a', 'b', 'c', 'd'], ['a'], textOf);

    expect(view?.rows.map((row) => row.choiceText)).toEqual(['Candidate A', 'Candidate B', 'Candidate C', 'Candidate D']);
    expect(view?.rows[0].cells).toEqual([
      { roundNumber: 1, votes: 40, percentage: 40, status: 'continuing' },
      { roundNumber: 2, votes: 45, percentage: 46, status: 'continuing' },
      { roundNumber: 3, votes: 49, percentage: 51, status: 'winner' },
    ]);
    expect(view?.rows[1].cells[2]).toEqual({ roundNumber: 3, votes: 48, percentage: 49, status: 'continuing' });
    expect(view?.rows[3].cells).toEqual([
      { roundNumber: 1, votes: 10, percentage: 10, status: 'eliminated' },
      { roundNumber: 2, votes: null, percentage: null, status: 'out' },
      { roundNumber: 3, votes: null, percentage: null, status: 'out' },
    ]);
  });

  it('builds elimination steps with sorted transfers and the ballots exhausted by the elimination', () => {
    const view = buildIrvRoundsView(MAJORITY_ROUNDS, ['a', 'b', 'c', 'd'], ['a'], textOf);

    expect(view?.steps[0]).toEqual({
      roundNumber: 1,
      kind: 'eliminated',
      choiceTexts: ['Candidate D'],
      votes: 10,
      continuingBallots: 100,
      threshold: 51,
      transfers: [
        { choiceId: 'a', choiceText: 'Candidate A', votes: 5 },
        { choiceId: 'b', choiceText: 'Candidate B', votes: 3 },
      ],
      exhaustedFromElimination: 2,
      tieBreak: null,
      tieBreakLevel: null,
    });
    expect(view?.steps[1].transfers.map((t) => t.choiceId)).toEqual(['b', 'a']);
    expect(view?.steps[1].exhaustedFromElimination).toBe(1);
    expect(view?.steps[2]).toMatchObject({ kind: 'winner', choiceTexts: ['Candidate A'], votes: 49, continuingBallots: 97, threshold: 49 });
  });

  it('treats an eliminated candidate with no votes and no transfers as nothing to transfer', () => {
    const view = buildIrvRoundsView([round(1, { a: 3, b: 2, c: 0 }, { eliminated: 'c' }), round(2, { a: 3, b: 2 })], ['a', 'b', 'c'], ['a'], textOf);

    expect(view?.steps[0]).toMatchObject({ kind: 'eliminated', votes: 0, transfers: [], exhaustedFromElimination: 0 });
  });

  it('reads the extra winner-only round after a lower-preference tie-break as the winner', () => {
    const rounds = [
      round(
        1,
        { a: 2, b: 2 },
        { eliminated: 'b', transfers: { a: 2 }, message: 'b eliminated with 2 votes. Tie for elimination broken at preference level 2.' }
      ),
      round(2, { a: 4 }, { message: 'a is the winner.' }),
    ];
    const view = buildIrvRoundsView(rounds, ['a', 'b'], ['a'], textOf);

    expect(view?.rows[0].cells[1].status).toBe('winner');
    expect(view?.rows[1].cells[1].status).toBe('out');
    expect(view?.steps[1]).toMatchObject({ kind: 'winner', choiceTexts: ['Candidate A'], votes: 4 });
  });

  it('marks every winner of an unbreakable final tie as tied', () => {
    const view = buildIrvRoundsView(
      [round(1, { a: 5, b: 5 }, { message: 'Unbreakable tie between all remaining candidates: [a b].' })],
      ['b', 'a'],
      ['a', 'b'],
      textOf
    );

    expect(view?.rows.map((row) => row.cells[0].status)).toEqual(['tied', 'tied']);
    expect(view?.steps[0]).toMatchObject({ kind: 'tie', choiceTexts: ['Candidate B', 'Candidate A'], votes: 5 });
  });

  it('reads a final round with no continuing ballots as exhausted', () => {
    const view = buildIrvRoundsView([round(1, { a: 0, b: 0 }, { exhausted: 4 })], ['a', 'b'], ['a', 'b'], textOf);

    expect(view?.rows[0].cells[0]).toEqual({ roundNumber: 1, votes: 0, percentage: 0, status: 'tied' });
    expect(view?.steps[0]).toMatchObject({ kind: 'exhausted', choiceTexts: [], votes: null });
  });

  it('reads a final round without an elimination or a displayed winner as no winner', () => {
    const view = buildIrvRoundsView([round(1, { a: 3, b: 2 })], ['a', 'b'], [], textOf);

    expect(view?.rows.map((row) => row.cells[0].status)).toEqual(['continuing', 'continuing']);
    expect(view?.steps[0]).toMatchObject({ kind: 'none', choiceTexts: [], votes: null });
  });

  it.each([
    { message: 'c eliminated with 1 votes. Tie for elimination broken at preference level 2.', tieBreak: 'lower_preference', tieBreakLevel: 2 },
    { message: 'c eliminated with 1 votes. Tie among [c d] broken randomly.', tieBreak: 'random', tieBreakLevel: null },
    { message: 'c eliminated with 1 votes.', tieBreak: null, tieBreakLevel: null },
  ])('reads the tie-break note from "$message"', ({ message, tieBreak, tieBreakLevel }) => {
    const view = buildIrvRoundsView([round(1, { a: 3, b: 2, c: 1, d: 1 }, { eliminated: 'c', message }), round(2, { a: 4, b: 2, d: 1 })], ['a'], ['a'], textOf);

    expect(view?.steps[0]).toMatchObject({ tieBreak, tieBreakLevel });
  });

  it('breaks equal transfers by row order', () => {
    const view = buildIrvRoundsView(
      [round(1, { a: 3, b: 3, c: 4 }, { eliminated: 'c', transfers: { b: 2, a: 2 } }), round(2, { a: 5, b: 5 })],
      ['a', 'b', 'c'],
      [],
      textOf
    );

    expect(view?.steps[0].transfers.map((t) => t.choiceId)).toEqual(['a', 'b']);
  });

  it('sorts rounds by round number', () => {
    const view = buildIrvRoundsView([...MAJORITY_ROUNDS].reverse(), ['a', 'b', 'c', 'd'], ['a'], textOf);

    expect(view?.rounds.map((column) => column.roundNumber)).toEqual([1, 2, 3]);
    expect(view?.steps.map((step) => step.kind)).toEqual(['eliminated', 'eliminated', 'winner']);
  });

  it('appends a counted choice missing from the given order, in first-seen order', () => {
    const view = buildIrvRoundsView(MAJORITY_ROUNDS, ['b', 'a'], ['a'], textOf);

    expect(view?.rows.map((row) => row.choiceId)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('treats missing round votes as no candidates counted', () => {
    const view = buildIrvRoundsView([{ ...round(1, {}), votes: undefined as unknown as IrvRoundSummary['votes'] }], ['a'], [], textOf);

    expect(view?.rows[0].cells[0].status).toBe('out');
    expect(view?.steps[0].kind).toBe('exhausted');
  });
});
