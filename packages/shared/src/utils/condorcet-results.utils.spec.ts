// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { CondorcetOutcome, PollType, VoteVoterStatus } from '../enums/poll.enum';
import type {
  CondorcetMatrixEntry,
  CondorcetQuestionView,
  CondorcetStandingRow,
  IrvRoundSummary,
  PollQuestionResult,
  RankedChoiceVoteResult,
  VoteResultsResponse,
  VoteVoter,
} from '../interfaces/poll.interface';
import { buildCondorcetOverviewOutcome, buildCondorcetQuestionViews, condorcetBallotsMatchResults } from './condorcet-results.utils';
import { buildRankedQuestionViews } from './vote-results.utils';

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
    expect(v.irvRounds).toBeNull();
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

  it.each([
    { usedIrv: false, choiceText: 'Service candidate', label: 'Service candidate', outcome: CondorcetOutcome.CONDORCET_WINNER },
    { usedIrv: true, choiceText: 'Service candidate', label: 'Service candidate', outcome: CondorcetOutcome.IRV_WINNER },
    { usedIrv: false, choiceText: '', label: 'x', outcome: CondorcetOutcome.CONDORCET_WINNER },
    { usedIrv: true, choiceText: '', label: 'x', outcome: CondorcetOutcome.IRV_WINNER },
  ])('labels an unmatched service winner: $outcome, "$choiceText"', ({ usedIrv, choiceText, label, outcome }) => {
    const v = view(
      question({
        ranked_choice_winner_info: {
          poll_choices: [
            { choice_id: 'x', choice_text: choiceText },
            { choice_id: 'x', choice_text: choiceText },
          ],
          condorcet_irv_used_for_eliminations: usedIrv,
        },
      })
    );
    expect(v.outcome).toBe(outcome);
    expect(v.winnerNames).toEqual([label]);
    expect(buildCondorcetOverviewOutcome(v)).toMatchObject({ result: 'winner', label: 'Winner', winnerTexts: [label] });
    expect(v.candidates.map((candidate) => candidate.choiceId)).toEqual(['a', 'b', 'c']);
    expect(v.rankSummary).toHaveLength(3);
    expect(v.pairwise).toHaveLength(3);
  });

  it('orders IRV survivors by final counts when the service winner has no table row', () => {
    const q = question({
      ranked_choice_winner_info: { poll_choices: [{ choice_id: 'x', choice_text: 'Service candidate' }], condorcet_irv_used_for_eliminations: true },
      irv_round_summary: [
        {
          round_number: 1,
          votes: [
            { choice_id: 'a', vote_count: 1 },
            { choice_id: 'b', vote_count: 3 },
            { choice_id: 'c', vote_count: 2 },
          ],
          total_votes: 6,
          exhausted_votes: 0,
          threshold: 4,
          message: '',
        },
      ],
    });
    const detail = view(q);
    expect(detail.outcome).toBe(CondorcetOutcome.IRV_WINNER);
    expect(detail.winnerNames).toEqual(['Service candidate']);
    expect(detail.standings.map(({ choiceId, rank, isWinner }) => [choiceId, rank, isWinner])).toEqual([
      ['b', 1, false],
      ['c', 2, false],
      ['a', 3, false],
    ]);
  });

  it.each([false, true])('keeps a partial tie when a service winner is absent from configured and ranked choices (IRV: %s)', (usedIrv) => {
    const q = question({
      question: { question_id: 'q1', prompt: 'Who should chair the board?', type: 'single_choice', choices: CHOICES.slice(0, 2) },
      ranked_choice_votes: rankedVotes([]).slice(0, 2),
      ranked_choice_winner_info: winners(['a', 'c'], usedIrv),
    });
    const detail = view(q);
    const [present] = buildRankedQuestionViews(results(q), PollType.CONDORCET_IRV);
    expect(detail.outcome).toBe(CondorcetOutcome.TIE);
    expect(detail.winnerNames).toEqual(['Candidate A', 'Candidate C']);
    expect(detail.candidates.map(({ choiceId }) => choiceId)).toEqual(['a', 'b']);
    expect(buildCondorcetOverviewOutcome(detail)).toMatchObject({ result: 'tie', label: 'Tied', winnerTexts: ['Candidate A', 'Candidate C'] });
    expect(present.outcome?.result).toBe('tie');
    expect(present.outcome?.winnerTexts).toEqual(detail.winnerNames);
    expect(present.standings.filter(({ label }) => label === 'tied').map(({ choiceId }) => choiceId)).toEqual(['a', 'c']);
  });

  it('preserves configured names across Results, Overview, Present and ballot patterns', () => {
    const q = question({ ranked_choice_winner_info: { poll_choices: [{ choice_id: 'a', choice_text: 'Stale service name' }] } });
    const detail = view(q, [ballot('1', ['a', 'b'])]);
    const [present] = buildRankedQuestionViews(results(q), PollType.CONDORCET_IRV);
    expect(detail.winnerNames).toEqual(['Candidate A']);
    expect(detail.standings[0].choiceText).toBe('Candidate A');
    expect(detail.candidates[0].choiceText).toBe('Candidate A');
    expect(detail.ballotPatterns?.[0].ranking).toEqual(['Candidate A', 'Candidate B']);
    expect(buildCondorcetOverviewOutcome(detail).winnerTexts).toEqual(['Candidate A']);
    expect(present.outcome?.winnerTexts).toEqual(detail.winnerNames);
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

  it('uses reverse-only matchups consistently for pairwise cells and standings', () => {
    const q = question({
      ranked_choice_votes: [
        {
          choice_id: 'a',
          rank_counts: [],
          condorcet_matrix: [
            { choice_id: 'a', other_choice_id: 'b', choice_id_wins: 2, other_choice_id_wins: 3, result: '' },
            { choice_id: 'a', other_choice_id: 'c', choice_id_wins: 3, other_choice_id_wins: 2, result: '' },
          ],
        },
        {
          choice_id: 'c',
          rank_counts: [],
          condorcet_matrix: [{ choice_id: 'c', other_choice_id: 'b', choice_id_wins: 2, other_choice_id_wins: 3, result: '' }],
        },
      ],
      ranked_choice_winner_info: winners(['b']),
    });
    const v = view(q);
    expect(v.pairwise.find((row) => row.candidate.choiceId === 'b')?.cells).toEqual([
      { value: '3–2', result: 'win' },
      { value: '—', result: 'self' },
      { value: '3–2', result: 'win' },
    ]);
    expect(v.standings.map(({ choiceId, rank, winCount, isWinner }) => ({ choiceId, rank, winCount, isWinner }))).toEqual([
      { choiceId: 'b', rank: 1, winCount: 2, isWinner: true },
      { choiceId: 'a', rank: 2, winCount: 1, isWinner: false },
      { choiceId: 'c', rank: 3, winCount: 0, isWinner: false },
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
    const detail = view(q);
    expect(detail.standings.map((s) => [s.choiceId, s.rank, s.isWinner, s.eliminatedInRound])).toEqual([
      ['b', 1, true, null],
      ['c', 2, false, null],
      ['a', 3, false, 2],
      ['d', 4, false, 1],
    ]);
    // #6152: the fallback's round-by-round count, rows in standings order
    expect(detail.irvRounds?.rows.map((row) => [row.choiceId, row.cells.map((cell) => cell.status)])).toEqual([
      ['b', ['continuing', 'continuing', 'winner']],
      ['c', ['continuing', 'continuing', 'continuing']],
      ['a', ['continuing', 'eliminated', 'out']],
      ['d', ['eliminated', 'out', 'out']],
    ]);
    expect(detail.irvRounds?.steps.map((step) => step.kind)).toEqual(['eliminated', 'eliminated', 'winner']);
  });

  it.each(['complete', 'mirrored', 'missing'])('shares the IRV survivor head-to-head tiebreaker with Present (%s pair)', (pair) => {
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
    for (const rcv of q.ranked_choice_votes ?? []) {
      rcv.condorcet_matrix = rcv.condorcet_matrix?.filter((entry) => {
        if (pair === 'complete') return true;
        if (entry.choice_id === 'b' && entry.other_choice_id === 'c') return false;
        return pair !== 'missing' || entry.choice_id !== 'c' || entry.other_choice_id !== 'b';
      });
    }
    const [present] = buildRankedQuestionViews(results(q), PollType.CONDORCET_IRV);
    const [irv] = buildRankedQuestionViews(results(q), PollType.INSTANT_RUNOFF_VOTE);
    const detail = view(q);
    expect(present.standings.map(({ choiceId, rank }) => [choiceId, rank])).toEqual(detail.standings.map(({ choiceId, rank }) => [choiceId, rank]));
    expect(irv.standings.map(({ choiceId }) => choiceId)).toEqual(['a', 'b', 'c']);
    if (pair === 'missing') {
      expect(detail.standings.map(({ choiceId }) => choiceId)).toEqual(['a', 'b', 'c']);
      return;
    }
    expect(view(q).standings.map((s) => [s.choiceId, s.rank])).toEqual([
      ['a', 1],
      ['c', 2],
      ['b', 3],
    ]);
  });

  it('ranks every option first, in question order, when the service returns every option after IRV rounds', () => {
    const q = question({
      ranked_choice_winner_info: winners(['a', 'b', 'c'], true),
      // A Condorcet cycle (A > B > C > A) with tied first choices: upstream appends the tie round and returns everyone.
      ranked_choice_votes: rankedVotes([
        ['a', 'b', 2, 1],
        ['b', 'c', 2, 1],
        ['c', 'a', 2, 1],
      ]),
      irv_round_summary: [
        {
          round_number: 1,
          votes: [
            { choice_id: 'a', vote_count: 1 },
            { choice_id: 'b', vote_count: 1 },
            { choice_id: 'c', vote_count: 1 },
          ],
          total_votes: 3,
          exhausted_votes: 0,
          threshold: 2,
          message: '',
          eliminated_choice_id: '',
        },
      ],
    });
    const v = view(q);
    expect(v.outcome).toBe(CondorcetOutcome.NO_WINNER);
    expect(v.standings.map((s) => [s.choiceId, s.rank, s.isWinner, s.eliminatedInRound])).toEqual([
      ['a', 1, false, null],
      ['b', 1, false, null],
      ['c', 1, false, null],
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

  it.each(['empty', 'omitted'])('groups user_choice ballots when ranked_user_choice is %s', (rankedState) => {
    const fallback = ballot('fallback', ['b', 'a', 'c']);
    const answer = fallback.poll_answers![0];
    answer.user_choice = answer.ranked_user_choice;
    answer.ranked_user_choice = [];
    if (rankedState === 'omitted') Reflect.deleteProperty(answer, 'ranked_user_choice');
    expect(view(question(), [fallback, ballot('ranked', ['b', 'a', 'c'])]).ballotPatterns).toEqual([
      { key: 'b\u0000a\u0000c', count: 2, ranking: ['Candidate B', 'Candidate A', 'Candidate C'] },
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

  it.each([false, true])('keeps Results and Present outcome/standing labels aligned for every candidate returned (IRV: %s)', (usedIrv) => {
    const q = question({
      ranked_choice_winner_info: winners(['a', 'b', 'c'], usedIrv),
      irv_round_summary: [
        {
          round_number: 1,
          votes: CHOICES.map(({ choice_id }) => ({ choice_id, vote_count: 1 })),
          total_votes: 3,
          exhausted_votes: 0,
          threshold: 2,
          message: '',
        },
      ],
    });
    const detail = view(q);
    const [present] = buildRankedQuestionViews(results(q), PollType.CONDORCET_IRV);
    expect(detail.outcome).toBe(CondorcetOutcome.NO_WINNER);
    expect(present.outcome?.result).toBe('none');
    expect(present.outcome?.winnerTexts).toEqual([]);
    expect(present.standings.map(({ choiceId, rank, label }) => ({ choiceId, rank, label }))).toEqual(
      detail.standings.map(({ choiceId, rank }) => ({ choiceId, rank, label: null }))
    );
    // The Overview reads the same outcome as the presenter, never "tied" (#6124).
    expect(buildCondorcetOverviewOutcome(detail)).toMatchObject({ result: present.outcome?.result, label: 'No winner', winnerTexts: [] });
  });

  it.each([
    { pollType: PollType.INSTANT_RUNOFF_VOTE, result: 'tie', label: 'tied' },
    { pollType: PollType.MEEK_STV, result: 'winner', label: 'elected' },
  ])('preserves $pollType outcomes when every candidate is returned', ({ pollType, result, label }) => {
    const q = question({ ranked_choice_winner_info: winners(['a', 'b', 'c'], true) });
    const [present] = buildRankedQuestionViews(results(q), pollType);
    expect(present.outcome?.result).toBe(result);
    expect(present.outcome?.winnerTexts).toEqual(['Candidate A', 'Candidate B', 'Candidate C']);
    expect(present.standings.map((row) => row.label)).toEqual([label, label, label]);
  });

  it('marks ballot patterns unavailable when no ballots are provided', () => {
    expect(view(question(), null).ballotPatterns).toBeNull();
    expect(view(question(), []).ballotPatterns).toEqual([]);
  });
});

describe('buildCondorcetOverviewOutcome (#6124)', () => {
  const row = (choiceId: string, rank: number, overrides: Partial<CondorcetStandingRow> = {}): CondorcetStandingRow => ({
    rank,
    choiceId,
    choiceText: `Candidate ${choiceId.toUpperCase()}`,
    winCount: 0,
    totalMatchups: 3,
    isWinner: false,
    isTied: false,
    eliminatedInRound: null,
    ...overrides,
  });

  function overview(outcome: CondorcetOutcome, winnerNames: string[], standings: CondorcetStandingRow[], usedIrv = false) {
    const questionView: CondorcetQuestionView = {
      questionId: 'q1',
      prompt: 'Who should chair the board?',
      candidates: [],
      outcome,
      winnerNames,
      usedIrv,
      standings,
      pairwise: [],
      ranks: [],
      rankSummary: [],
      ballotPatterns: null,
    };
    return buildCondorcetOverviewOutcome(questionView);
  }

  it('names a Condorcet winner with its head-to-head explanation and the runner-up records', () => {
    const outcome = overview(
      CondorcetOutcome.CONDORCET_WINNER,
      ['Candidate A'],
      [row('a', 1, { isWinner: true, winCount: 3 }), row('b', 2, { winCount: 2 }), row('c', 3, { winCount: 1 })]
    );
    expect(outcome).toEqual({
      questionId: 'q1',
      prompt: 'Who should chair the board?',
      result: 'winner',
      label: 'Winner',
      winnerTexts: ['Candidate A'],
      explanation: 'Preferred over every other option in head-to-head comparisons.',
      standings: [
        { choiceId: 'b', choiceText: 'Candidate B', rank: 2, detail: 'Won 2 out of 3 possible head-to-head matchups' },
        { choiceId: 'c', choiceText: 'Candidate C', rank: 3, detail: 'Won 1 out of 3 possible head-to-head matchups' },
      ],
      hiddenCount: 0,
    });
  });

  it('explains the instant-runoff fallback and prefers the elimination round over the head-to-head record', () => {
    const outcome = overview(
      CondorcetOutcome.IRV_WINNER,
      ['Candidate C'],
      [row('c', 1, { isWinner: true }), row('a', 2, { winCount: 1 }), row('b', 3, { winCount: 1, eliminatedInRound: 1 })],
      true
    );
    expect(outcome).toMatchObject({
      result: 'winner',
      label: 'Winner',
      explanation: 'No option beat every other option head-to-head, so instant-runoff elimination decided the result.',
    });
    expect(outcome.standings.map((standing) => standing.detail)).toEqual(['Won 1 out of 3 possible head-to-head matchups', 'Eliminated in round 1']);
  });

  it('keeps a tie neutral and excludes the tied options from the standings', () => {
    const outcome = overview(
      CondorcetOutcome.TIE,
      ['Candidate A', 'Candidate B'],
      [row('a', 1, { isWinner: true, isTied: true }), row('b', 1, { isWinner: true, isTied: true }), row('c', 3)]
    );
    expect(outcome).toMatchObject({
      result: 'tie',
      label: 'Tied',
      winnerTexts: ['Candidate A', 'Candidate B'],
      explanation: 'No single winner could be determined.',
    });
    expect(outcome.standings.map((standing) => standing.choiceId)).toEqual(['c']);
  });

  it('reports no winner without names or an explanation', () => {
    const outcome = overview(CondorcetOutcome.NO_WINNER, [], [row('a', 1), row('b', 1)], true);
    expect(outcome).toMatchObject({ result: 'none', label: 'No winner', winnerTexts: [], explanation: null });
    expect(outcome.standings).toHaveLength(2);
  });

  it('leaves the detail empty without a head-to-head matrix', () => {
    const outcome = overview(
      CondorcetOutcome.IRV_WINNER,
      ['Candidate A'],
      [row('a', 1, { isWinner: true, totalMatchups: 0 }), row('b', 2, { totalMatchups: 0 })],
      true
    );
    expect(outcome.standings[0].detail).toBeNull();
  });

  it('caps the standings at VOTE_OVERVIEW_STANDINGS_LIMIT and counts the rest', () => {
    const outcome = overview(
      CondorcetOutcome.CONDORCET_WINNER,
      ['Candidate A'],
      [row('a', 1, { isWinner: true }), ...['b', 'c', 'd', 'e'].map((id, index) => row(id, index + 2))]
    );
    expect(outcome.standings.map((standing) => standing.choiceId)).toEqual(['b', 'c', 'd']);
    expect(outcome.hiddenCount).toBe(1);
  });
});

describe('condorcetBallotsMatchResults', () => {
  const final = () => ({ ...results(question({ ranked_choice_votes: rankedVotes([], { a: [1, 1, 0], b: [1, 1, 0], c: [0, 0, 0] }) })), num_votes_cast: 2 });
  const indexed = () => [ballot('1', ['a', 'b']), ballot('2', ['b', 'a'])];
  it('matches submitted partial rankings in stored rank order and ignores unsubmitted rows', () => {
    expect(condorcetBallotsMatchResults(final(), [...indexed(), ballot('3', [], VoteVoterStatus.NOT_VOTED)])).toBe(true);
  });
  it('detects an indexed ballot count that lags the final tally', () => {
    expect(condorcetBallotsMatchResults(final(), indexed().slice(0, 1))).toBe(false);
  });
  it('detects old rankings even when indexed participation matches', () => {
    expect(condorcetBallotsMatchResults(final(), [ballot('1', ['a', 'b']), ballot('2', ['a', 'b'])])).toBe(false);
  });
  it('counts abstentions separately without including them in ranked counts', () => {
    const results = { ...final(), num_votes_cast: 3, num_abstained: 1 };
    expect(condorcetBallotsMatchResults(results, [...indexed(), ballot('3', [], VoteVoterStatus.ABSTAINED)])).toBe(true);
    expect(condorcetBallotsMatchResults(results, indexed())).toBe(false);
  });
  it('uses user_choice when indexed ranked_user_choice is empty', () => {
    const ballots = indexed();
    const answer = ballots[0].poll_answers![0];
    answer.user_choice = answer.ranked_user_choice;
    answer.ranked_user_choice = [];
    expect(condorcetBallotsMatchResults(final(), ballots)).toBe(true);
  });
  it('detects missing question answers and missing final rank counts', () => {
    expect(condorcetBallotsMatchResults(final(), [ballot('1', ['a', 'b'], VoteVoterStatus.VOTED, 'other'), indexed()[1]])).toBe(false);
    const noRanks = final();
    delete noRanks.poll_results[0].ranked_choice_votes;
    expect(condorcetBallotsMatchResults(noRanks, indexed())).toBe(false);
  });
  it('does not claim a revision token when cancelling rankings preserve every aggregate', () => {
    const final = { ...results(question({ ranked_choice_votes: rankedVotes([], { a: [1, 1, 1], b: [1, 1, 1], c: [1, 1, 1] }) })), num_votes_cast: 3 };
    expect(condorcetBallotsMatchResults(final, [ballot('1', ['a', 'b', 'c']), ballot('2', ['b', 'c', 'a']), ballot('3', ['c', 'a', 'b'])])).toBe(true);
    expect(condorcetBallotsMatchResults(final, [ballot('1', ['a', 'c', 'b']), ballot('2', ['b', 'a', 'c']), ballot('3', ['c', 'b', 'a'])])).toBe(true);
  });
});
