// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CondorcetOutcome, VoteVoterStatus } from '../enums/poll.enum';
import type {
  CondorcetMatrixEntry,
  IrvRoundSummary,
  PollQuestionResult,
  RankedChoiceVoteResult,
  VoteResultsResponse,
  VoteVoter,
} from '../interfaces/poll.interface';
import { buildCondorcetQuestionViews, buildCondorcetRankingsSignature, buildCondorcetSummaryLines } from './condorcet-results.utils';

const CHOICES = [
  { choice_id: 'a', choice_text: 'Candidate A' },
  { choice_id: 'b', choice_text: 'Candidate B' },
  { choice_id: 'c', choice_text: 'Candidate C' },
];

/** Pairwise wins as [row, col, rowWins, colWins]; each pair is emitted from both sides, as upstream does. */
function rankedVotes(pairs: [string, string, number, number][], rankCounts: Record<string, number[]> = {}): RankedChoiceVoteResult[] {
  const entries = (id: string): CondorcetMatrixEntry[] =>
    pairs.flatMap(([row, col, rowWins, colWins]) => {
      if (row === id) return [{ choice_id: row, other_choice_id: col, choice_id_wins: rowWins, other_choice_id_wins: colWins, result: '' }];
      if (col === id) return [{ choice_id: col, other_choice_id: row, choice_id_wins: colWins, other_choice_id_wins: rowWins, result: '' }];
      return [];
    });
  return CHOICES.map(({ choice_id }) => ({
    choice_id,
    rank_counts: (rankCounts[choice_id] ?? []).map((count, index) => ({ rank: index + 1, count })),
    condorcet_matrix: entries(choice_id),
  }));
}

function question(overrides: Partial<PollQuestionResult> = {}): PollQuestionResult {
  return {
    question: { question_id: 'q1', prompt: 'Who should chair the board?', type: 'single_choice', choices: CHOICES },
    // A beats B and C head-to-head; B beats C.
    ranked_choice_votes: rankedVotes(
      [
        ['a', 'b', 3, 2],
        ['a', 'c', 4, 1],
        ['b', 'c', 3, 2],
      ],
      { a: [1, 4, 0], b: [3, 1, 1], c: [1, 0, 4] }
    ),
    ranked_choice_winner_info: { poll_choices: [{ choice_id: 'a', choice_text: 'Candidate A' }], condorcet_irv_used_for_eliminations: false },
    ...overrides,
  };
}

function results(...questions: PollQuestionResult[]): VoteResultsResponse {
  return { poll_results: questions, comment_results: [], num_recipients: 5, num_votes_cast: 5, poll_end_time: '2026-06-01T00:00:00Z' };
}

function winners(ids: string[], usedIrv = false): PollQuestionResult['ranked_choice_winner_info'] {
  return { poll_choices: CHOICES.filter((c) => ids.includes(c.choice_id)), condorcet_irv_used_for_eliminations: usedIrv };
}

function view(q: PollQuestionResult, ballots: VoteVoter[] | null = null) {
  return buildCondorcetQuestionViews(results(q), ballots)[0];
}

function ballot(uid: string, ranking: string[], status = VoteVoterStatus.VOTED, questionId = 'q1'): VoteVoter {
  return {
    uid,
    user_name: `Voter ${uid}`,
    user_email: `${uid}@example.com`,
    status,
    poll_answers: [
      {
        prompt: 'Who should chair the board?',
        question_id: questionId,
        type: 'single_choice',
        user_choice: [],
        // Stored out of order to prove the builder sorts by choice_rank.
        ranked_user_choice: ranking.map((id, index) => ({ choice_id: id, choice_text: `stored ${id}`, choice_rank: index + 1 })).reverse(),
      },
    ],
  };
}

describe('buildCondorcetQuestionViews', () => {
  it('returns no views without results', () => {
    expect(buildCondorcetQuestionViews(null, null)).toEqual([]);
    expect(buildCondorcetQuestionViews(results(), null)).toEqual([]);
  });

  it('shows the service winner even when another candidate has the most first choices (AC-1)', () => {
    // B has 3 first choices to A's 1, but the service decided A.
    const v = view(question());
    expect(v.outcome).toBe(CondorcetOutcome.CONDORCET_WINNER);
    expect(v.winnerNames).toEqual(['Candidate A']);
    expect(v.rankSummary.find((row) => row.candidate.choiceId === 'b')?.counts[0]).toBe(3);
  });

  it.each([
    { name: 'a Condorcet winner', info: winners(['a']), outcome: CondorcetOutcome.CONDORCET_WINNER, names: ['Candidate A'], usedIrv: false },
    { name: 'an IRV-fallback winner', info: winners(['b'], true), outcome: CondorcetOutcome.IRV_WINNER, names: ['Candidate B'], usedIrv: true },
    { name: 'a tie', info: winners(['a', 'c'], true), outcome: CondorcetOutcome.TIE, names: ['Candidate A', 'Candidate C'], usedIrv: true },
    { name: 'no winners', info: winners([], true), outcome: CondorcetOutcome.NO_WINNER, names: [], usedIrv: true },
    { name: 'every candidate returned', info: winners(['a', 'b', 'c'], true), outcome: CondorcetOutcome.NO_WINNER, names: [], usedIrv: true },
    { name: 'missing winner info', info: undefined, outcome: CondorcetOutcome.NO_WINNER, names: [], usedIrv: false },
  ])('resolves $name', ({ info, outcome, names, usedIrv }) => {
    const v = view(question({ ranked_choice_winner_info: info }));
    expect(v.outcome).toBe(outcome);
    expect(v.winnerNames).toEqual(names);
    expect(v.usedIrv).toBe(usedIrv);
  });

  it('orders every table by question.choices, whatever order ranked_choice_votes arrive in', () => {
    const q = question();
    q.ranked_choice_votes = [...(q.ranked_choice_votes ?? [])].reverse();
    const v = view(q);
    expect(v.candidates.map((c) => c.choiceId)).toEqual(['a', 'b', 'c']);
    expect(v.pairwise.map((row) => row.candidate.choiceId)).toEqual(['a', 'b', 'c']);
    expect(v.rankSummary.map((row) => row.candidate.choiceId)).toEqual(['a', 'b', 'c']);
  });

  it('labels non-winners from question.choices and an unknown ranked choice by its id', () => {
    const q = question();
    q.ranked_choice_votes = [...(q.ranked_choice_votes ?? []), { choice_id: 'x', rank_counts: [] }];
    expect(view(q).candidates.map((c) => c.choiceText)).toEqual(['Candidate A', 'Candidate B', 'Candidate C', 'x']);
  });

  it('builds pairwise cells for wins, losses, ties, 0–0 and the diagonal', () => {
    const q = question({
      ranked_choice_votes: rankedVotes([
        ['a', 'b', 3, 2],
        ['a', 'c', 2, 2],
        ['b', 'c', 0, 0],
      ]),
    });
    expect(view(q).pairwise.map((row) => row.cells)).toEqual([
      [
        { value: '—', result: 'self' },
        { value: '3–2', result: 'win' },
        { value: '2–2', result: 'tie' },
      ],
      [
        { value: '2–3', result: 'loss' },
        { value: '—', result: 'self' },
        { value: '0–0', result: 'neutral' },
      ],
      [
        { value: '2–2', result: 'tie' },
        { value: '0–0', result: 'neutral' },
        { value: '—', result: 'self' },
      ],
    ]);
  });

  it('ranks Condorcet standings by head-to-head wins with competition ranking', () => {
    // A and B tie each other and each beat C → 1, 1, 3.
    const q = question({
      ranked_choice_votes: rankedVotes([
        ['a', 'b', 2, 2],
        ['a', 'c', 4, 1],
        ['b', 'c', 4, 1],
      ]),
      ranked_choice_winner_info: winners(['a', 'b']),
    });
    expect(view(q).standings.map((s) => [s.choiceText, s.rank, s.winCount, s.totalMatchups, s.isWinner, s.isTied])).toEqual([
      ['Candidate A', 1, 1, 2, true, true],
      ['Candidate B', 1, 1, 2, true, true],
      ['Candidate C', 3, 0, 2, false, false],
    ]);
  });

  it('counts a head-to-head win stored only under the opponent, as the pairwise table does', () => {
    // Upstream normally emits each pair from both sides; here every pair arrives on its column's row only.
    const q = question();
    q.ranked_choice_votes = (q.ranked_choice_votes ?? []).map((rcv) => ({
      ...rcv,
      condorcet_matrix: rcv.condorcet_matrix?.filter((entry) => entry.choice_id > entry.other_choice_id),
    }));
    const v = view(q);
    expect(v.pairwise[0].cells[1]).toEqual({ value: '3–2', result: 'win' });
    expect(v.standings.map((s) => [s.choiceId, s.rank, s.winCount])).toEqual([
      ['a', 1, 2],
      ['b', 2, 1],
      ['c', 3, 0],
    ]);
  });

  it('gives a clear Condorcet winner sequential standings', () => {
    expect(view(question()).standings.map((s) => [s.choiceId, s.rank, s.winCount, s.isWinner])).toEqual([
      ['a', 1, 2, true],
      ['b', 2, 1, false],
      ['c', 3, 0, false],
    ]);
  });

  it('builds IRV standings: winner, survivors by final-round votes, then eliminations latest first', () => {
    const fourChoices = [...CHOICES, { choice_id: 'd', choice_text: 'Candidate D' }];
    const round = (n: number, votes: [string, number][], eliminated?: string): IrvRoundSummary => ({
      round_number: n,
      votes: votes.map(([choice_id, vote_count]) => ({ choice_id, vote_count })),
      total_votes: 6,
      exhausted_votes: 0,
      threshold: 4,
      message: '',
      eliminated_choice_id: eliminated,
    });
    const q = question({
      question: { question_id: 'q1', prompt: 'Rank', type: 'single_choice', choices: fourChoices },
      ranked_choice_winner_info: winners(['b'], true),
      irv_round_summary: [
        round(
          1,
          [
            ['a', 1],
            ['b', 2],
            ['c', 2],
            ['d', 1],
          ],
          'd'
        ),
        round(
          2,
          [
            ['a', 1],
            ['b', 3],
            ['c', 2],
          ],
          'a'
        ),
        round(3, [
          ['b', 4],
          ['c', 2],
        ]),
      ],
    });
    expect(view(q).standings.map((s) => [s.choiceId, s.rank, s.isWinner, s.eliminatedInRound])).toEqual([
      ['b', 1, true, null],
      ['c', 2, false, null],
      ['a', 3, false, 2],
      ['d', 4, false, 1],
    ]);
  });

  it('breaks an IRV survivor tie on final-round votes head-to-head', () => {
    const q = question({
      ranked_choice_winner_info: winners(['a'], true),
      // B and C both hold 2 votes in the final round; C beats B head-to-head.
      ranked_choice_votes: rankedVotes([
        ['a', 'b', 3, 2],
        ['a', 'c', 3, 2],
        ['b', 'c', 1, 4],
      ]),
      irv_round_summary: [
        {
          round_number: 1,
          votes: [
            { choice_id: 'a', vote_count: 3 },
            { choice_id: 'b', vote_count: 2 },
            { choice_id: 'c', vote_count: 2 },
          ],
          total_votes: 7,
          exhausted_votes: 0,
          threshold: 4,
          message: '',
        },
      ],
    });
    expect(view(q).standings.map((s) => [s.choiceId, s.rank])).toEqual([
      ['a', 1],
      ['c', 2],
      ['b', 3],
    ]);
  });

  it.each([
    {
      name: 'one winner',
      ids: ['b'],
      expected: [
        ['b', 1, true, false],
        ['a', 2, false, false],
        ['c', 2, false, false],
      ],
    },
    {
      name: 'a tie',
      ids: ['a', 'c'],
      expected: [
        ['a', 1, true, true],
        ['c', 1, true, true],
        ['b', 3, false, false],
      ],
    },
    {
      name: 'no winner',
      ids: [],
      expected: [
        ['a', 1, false, false],
        ['b', 1, false, false],
        ['c', 1, false, false],
      ],
    },
  ])('falls back without IRV rounds: $name', ({ ids, expected }) => {
    const v = view(question({ ranked_choice_winner_info: winners(ids, true) }));
    expect(v.standings.map((s) => [s.choiceId, s.rank, s.isWinner, s.isTied])).toEqual(expected);
  });

  it('summarizes voters per rank position, one column per candidate', () => {
    const v = view(question());
    expect(v.ranks).toEqual([1, 2, 3]);
    expect(v.rankSummary.map((row) => row.counts)).toEqual([
      [1, 4, 0],
      [3, 1, 1],
      [1, 0, 4],
    ]);
  });

  it('leaves standings empty and matchups at 0 without a Condorcet matrix', () => {
    const q = question({ ranked_choice_votes: CHOICES.map(({ choice_id }) => ({ choice_id, rank_counts: [] })) });
    const v = view(q);
    expect(v.standings).toEqual([]);
    expect(v.pairwise[0].cells[1]).toEqual({ value: '0–0', result: 'neutral' });
  });

  it('counts identical ballot rankings, most common first, ignoring abstained, pending and other-question ballots', () => {
    const ballots = [
      ballot('1', ['b', 'a', 'c']),
      ballot('2', ['a', 'b']),
      ballot('3', ['b', 'a', 'c']),
      ballot('4', ['c', 'a', 'b'], VoteVoterStatus.ABSTAINED),
      ballot('5', ['c', 'a', 'b'], VoteVoterStatus.NOT_VOTED),
      ballot('6', ['c', 'a', 'b'], VoteVoterStatus.VOTED, 'q2'),
      { uid: '7', status: VoteVoterStatus.VOTED },
    ];
    expect(view(question(), ballots).ballotPatterns).toEqual([
      { key: 'b\u0000a\u0000c', count: 2, ranking: ['Candidate B', 'Candidate A', 'Candidate C'] },
      { key: 'a\u0000b', count: 1, ranking: ['Candidate A', 'Candidate B'] },
    ]);
  });

  it('keeps ballot pattern keys stable when counts reorder them or candidate names change', () => {
    const ballots = [ballot('1', ['b', 'a', 'c']), ballot('2', ['a', 'b'])];
    const before = view(question(), ballots).ballotPatterns!;
    const q = question();
    q.question.choices = q.question.choices.map((choice) => ({ ...choice, choice_text: `Updated ${choice.choice_id}` }));
    const after = view(q, [...ballots, ballot('3', ['a', 'b'])]).ballotPatterns!;
    expect(after.map(({ key, count }) => ({ key, count }))).toEqual([
      { key: before[1].key, count: 2 },
      { key: before[0].key, count: 1 },
    ]);
  });

  it('reads a ranking stored in user_choice when ranked_user_choice is empty', () => {
    const fromUserChoice = ballot('1', []);
    const answer = fromUserChoice.poll_answers![0];
    answer.user_choice = [
      { choice_id: 'c', choice_text: 'stored c', choice_rank: 2 },
      { choice_id: 'b', choice_text: 'stored b', choice_rank: 1 },
    ];
    expect(view(question(), [fromUserChoice, ballot('2', ['b', 'c'])]).ballotPatterns).toEqual([
      { key: 'b\u0000c', count: 2, ranking: ['Candidate B', 'Candidate C'] },
    ]);
  });

  it('marks ballot patterns unavailable when no ballots are provided', () => {
    expect(view(question(), null).ballotPatterns).toBeNull();
    expect(view(question(), []).ballotPatterns).toEqual([]);
  });
});

describe('buildCondorcetRankingsSignature', () => {
  it('ignores the order ranked_choice_votes arrive in', () => {
    const q = question();
    const reordered = question({ ranked_choice_votes: [...(q.ranked_choice_votes ?? [])].reverse() });
    expect(buildCondorcetRankingsSignature(results(reordered))).toBe(buildCondorcetRankingsSignature(results(q)));
  });

  it('changes when a revised ranking moves rank counts without changing the ballot count', () => {
    // One voter moves A from 2nd to 1st and B from 1st to 2nd; num_votes_cast stays 5.
    const revised = question({
      ranked_choice_votes: rankedVotes(
        [
          ['a', 'b', 4, 1],
          ['a', 'c', 4, 1],
          ['b', 'c', 3, 2],
        ],
        { a: [2, 3, 0], b: [2, 2, 1], c: [1, 0, 4] }
      ),
    });
    expect(buildCondorcetRankingsSignature(results(revised))).not.toBe(buildCondorcetRankingsSignature(results(question())));
  });
});

describe('buildCondorcetSummaryLines', () => {
  it('returns nothing while the vote is open', () => {
    expect(buildCondorcetSummaryLines(buildCondorcetQuestionViews(results(question()), null), false)).toEqual([]);
  });

  it.each([
    { name: 'a winner', info: winners(['a']), text: 'Winner: Candidate A' },
    { name: 'an IRV winner', info: winners(['c'], true), text: 'Winner: Candidate C' },
    { name: 'a tie', info: winners(['a', 'b'], true), text: 'Tied: Candidate A and Candidate B' },
    { name: 'no winner', info: winners([], true), text: 'No winner' },
  ])('reads $name once closed', ({ info, text }) => {
    const views = buildCondorcetQuestionViews(results(question({ ranked_choice_winner_info: info })), null);
    expect(buildCondorcetSummaryLines(views, true)).toEqual([{ questionId: 'q1', question: 'Who should chair the board?', text }]);
  });
});
