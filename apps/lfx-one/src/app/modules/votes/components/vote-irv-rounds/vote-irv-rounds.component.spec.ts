// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IrvRoundCell, IrvRoundColumn, IrvRoundsView, IrvRoundStep } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteIrvRoundsComponent } from './vote-irv-rounds.component';

function column(roundNumber: number, overrides: Partial<IrvRoundColumn> = {}): IrvRoundColumn {
  return { roundNumber, continuingBallots: 100, exhaustedBallots: 0, threshold: 51, isFinal: false, ...overrides };
}

/** A cell whose percentage is its share of the round's continuing ballots (100 unless given). */
function cell(roundNumber: number, votes: number | null, status: IrvRoundCell['status'] = 'continuing', continuing = 100): IrvRoundCell {
  return { roundNumber, votes, percentage: votes === null ? null : Math.round((votes / continuing) * 100), status };
}

function step(roundNumber: number, overrides: Partial<IrvRoundStep> = {}): IrvRoundStep {
  return {
    roundNumber,
    kind: 'none',
    choiceTexts: [],
    votes: null,
    continuingBallots: 100,
    threshold: 51,
    transfers: [],
    exhaustedFromElimination: 0,
    tieBreak: null,
    tieBreakLevel: null,
    ...overrides,
  };
}

/** Candidate D out in round 1 (5 to A, 3 to B, 2 exhausted), Candidate C out in round 2 (10 to A, 2 to B, 8 exhausted), Candidate A wins round 3. */
const MAJORITY: IrvRoundsView = {
  rounds: [
    column(1),
    column(2, { continuingBallots: 98, exhaustedBallots: 2, threshold: 50 }),
    column(3, { continuingBallots: 90, exhaustedBallots: 10, threshold: 46, isFinal: true }),
  ],
  rows: [
    { choiceId: 'a', choiceText: 'Candidate A', cells: [cell(1, 40), cell(2, 45, 'continuing', 98), cell(3, 55, 'winner', 90)] },
    { choiceId: 'b', choiceText: 'Candidate B', cells: [cell(1, 30), cell(2, 33, 'continuing', 98), cell(3, 35, 'continuing', 90)] },
    { choiceId: 'c', choiceText: 'Candidate C', cells: [cell(1, 20), cell(2, 20, 'eliminated', 98), cell(3, null, 'out')] },
    { choiceId: 'd', choiceText: 'Candidate D', cells: [cell(1, 10, 'eliminated'), cell(2, null, 'out'), cell(3, null, 'out')] },
  ],
  steps: [
    step(1, {
      kind: 'eliminated',
      choiceTexts: ['Candidate D'],
      votes: 10,
      transfers: [
        { choiceId: 'a', choiceText: 'Candidate A', votes: 5 },
        { choiceId: 'b', choiceText: 'Candidate B', votes: 3 },
      ],
      exhaustedFromElimination: 2,
    }),
    step(2, {
      kind: 'eliminated',
      choiceTexts: ['Candidate C'],
      votes: 20,
      transfers: [
        { choiceId: 'a', choiceText: 'Candidate A', votes: 10 },
        { choiceId: 'b', choiceText: 'Candidate B', votes: 2 },
      ],
      exhaustedFromElimination: 8,
      tieBreak: 'lower_preference',
      tieBreakLevel: 2,
    }),
    step(3, { kind: 'winner', choiceTexts: ['Candidate A'], votes: 55, continuingBallots: 90, threshold: 46 }),
  ],
};

describe('VoteIrvRoundsComponent', () => {
  let fixture: ComponentFixture<VoteIrvRoundsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteIrvRoundsComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteIrvRoundsComponent);
  });

  function render(value: IrvRoundsView): HTMLElement {
    fixture.componentRef.setInput('rounds', value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Collapses whitespace runs, so template line breaks do not matter. */
  const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** Strips all whitespace: Angular drops inter-element whitespace, so adjacent elements' text runs together. */
  const squash = (value: string): string => value.replace(/\s+/g, '');
  const cellEl = (el: HTMLElement, choiceId: string, round: number): HTMLElement | null =>
    el.querySelector(`[data-testid="vote-irv-rounds-cell-${choiceId}-${round}"]`);
  const stepText = (el: HTMLElement, round: number): string => text(el.querySelector(`[data-testid="vote-irv-rounds-step-${round}"]`));

  it('renders the section with a round column per round and labels the final round', () => {
    const el = render(MAJORITY);

    expect(text(el.querySelector('[data-testid="vote-irv-rounds"] h5'))).toBe('Round-by-round count');
    const region = el.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Round-by-round count');
    expect(region?.getAttribute('tabindex')).toBe('0');
    const headers = [...el.querySelectorAll('[data-testid="vote-irv-rounds-table"] thead th')].map(text);
    expect(headers).toEqual(['Option', 'Round 1', 'Round 2', 'Round 3 Final round']);
  });

  it('renders votes, percentages and the Eliminated, Winner and out cells', () => {
    const el = render(MAJORITY);

    expect(squash(text(cellEl(el, 'a', 1)))).toBe(squash('40 (40%)'));
    expect(squash(text(cellEl(el, 'a', 3)))).toBe(squash('55 (61%) Winner'));
    expect(cellEl(el, 'a', 3)?.classList).toContain('text-emerald-700');
    expect(squash(text(cellEl(el, 'd', 1)))).toBe(squash('10 (10%) Eliminated'));
    expect(cellEl(el, 'd', 1)?.classList).toContain('text-slate-500');
    expect(squash(text(cellEl(el, 'd', 2)))).toBe(squash('— Not in this round'));
    expect(cellEl(el, 'd', 2)?.querySelector('[aria-hidden="true"]')?.textContent).toBe('—');
    expect(cellEl(el, 'd', 2)?.querySelector('.sr-only')?.textContent).toBe('Not in this round');
  });

  it('marks every tied cell as Tied', () => {
    const el = render({
      rounds: [column(1, { isFinal: true })],
      rows: [
        { choiceId: 'a', choiceText: 'Candidate A', cells: [cell(1, 50, 'tied')] },
        { choiceId: 'b', choiceText: 'Candidate B', cells: [cell(1, 50, 'tied')] },
      ],
      steps: [step(1, { kind: 'tie', choiceTexts: ['Candidate A', 'Candidate B'], votes: 50 })],
    });

    expect(squash(text(cellEl(el, 'a', 1)))).toBe(squash('50 (50%) Tied'));
    expect(squash(text(cellEl(el, 'b', 1)))).toBe(squash('50 (50%) Tied'));
    expect(stepText(el, 1)).toBe('Round 1: Candidate A and Candidate B tied with 50 votes each, so no single winner could be determined.');
  });

  it('renders continuing ballots, exhausted ballots and majority needed per round', () => {
    const el = render(MAJORITY);

    const footer = [...el.querySelectorAll('[data-testid="vote-irv-rounds-table"] tfoot tr')].map((row) => [...row.children].map(text));
    expect(footer).toEqual([
      ['Continuing ballots', '100', '98', '90'],
      ['Exhausted ballots', '0', '2', '10'],
      ['Majority needed', '51', '50', '46'],
    ]);
  });

  it('describes each round: transfers with exhausted ballots, a lower-preference tie-break and the winner', () => {
    const el = render(MAJORITY);

    expect(stepText(el, 1)).toBe('Round 1: Candidate D was eliminated with 10 votes. Their ballots moved: 5 to Candidate A, 3 to Candidate B, 2 exhausted.');
    expect(stepText(el, 2)).toBe(
      'Round 2: Candidate C was eliminated with 20 votes. Their ballots moved: 10 to Candidate A, 2 to Candidate B, 8 exhausted. Tied for the fewest votes; decided by comparing lower-ranked preferences (rank 2).'
    );
    expect(stepText(el, 3)).toBe('Round 3: Candidate A won with 55 of 90 continuing ballots (majority needed: 46).');
  });

  it.each([
    {
      name: 'nothing to transfer',
      step: step(1, { kind: 'eliminated', choiceTexts: ['Candidate C'], votes: 0 }),
      expected: 'Candidate C was eliminated with 0 votes. No ballots to transfer.',
    },
    {
      name: 'a single vote, all exhausted, picked at random',
      step: step(1, { kind: 'eliminated', choiceTexts: ['Candidate C'], votes: 1, exhaustedFromElimination: 1, tieBreak: 'random' }),
      expected: 'Candidate C was eliminated with 1 vote. Their ballot was exhausted. Tied for the fewest votes; the voting service picked one at random.',
    },
    {
      name: 'several ballots, all exhausted',
      step: step(1, { kind: 'eliminated', choiceTexts: ['Candidate C'], votes: 3, exhaustedFromElimination: 3 }),
      expected: 'Candidate C was eliminated with 3 votes. All 3 of their ballots were exhausted.',
    },
    {
      name: 'a winner with one continuing ballot',
      step: step(1, { kind: 'winner', choiceTexts: ['Candidate A'], votes: 1, continuingBallots: 1, threshold: 1 }),
      expected: 'Candidate A won with 1 of 1 continuing ballot (majority needed: 1).',
    },
    {
      name: 'every ballot exhausted',
      step: step(1, { kind: 'exhausted' }),
      expected: 'Every ballot was exhausted, so no single winner could be determined.',
    },
    { name: 'no winner', step: step(1), expected: 'No winner could be determined.' },
  ])('describes $name', ({ step: value, expected }) => {
    const el = render({ rounds: [column(1, { isFinal: true })], rows: [], steps: [value] });

    expect(stepText(el, 1)).toBe(`Round 1: ${expected}`);
  });

  it('describes a non-final round without an elimination neutrally', () => {
    const el = render({ rounds: [column(1), column(2, { isFinal: true })], rows: [], steps: [step(1), step(2)] });

    expect(stepText(el, 1)).toBe('Round 1: No option was eliminated in this round.');
    expect(stepText(el, 2)).toBe('Round 2: No winner could be determined.');
  });
});
