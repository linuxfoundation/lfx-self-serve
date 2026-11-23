// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CondorcetOutcome } from '@lfx-one/shared/enums';
import { CondorcetQuestionView } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteCondorcetResultsComponent } from './vote-condorcet-results.component';

const A = { choiceId: 'a', choiceText: 'Candidate A' };
const B = { choiceId: 'b', choiceText: 'Candidate B' };

function question(overrides: Partial<CondorcetQuestionView> = {}): CondorcetQuestionView {
  return {
    questionId: 'q1',
    prompt: 'Who should chair the board?',
    candidates: [A, B],
    outcome: CondorcetOutcome.CONDORCET_WINNER,
    winnerNames: ['Candidate A'],
    usedIrv: false,
    standings: [
      { rank: 1, choiceId: 'a', choiceText: 'Candidate A', winCount: 1, totalMatchups: 1, isWinner: true, isTied: false, eliminatedInRound: null },
      { rank: 2, choiceId: 'b', choiceText: 'Candidate B', winCount: 0, totalMatchups: 1, isWinner: false, isTied: false, eliminatedInRound: null },
    ],
    pairwise: [
      {
        candidate: A,
        cells: [
          { value: '—', result: 'self' },
          { value: '3–2', result: 'win' },
        ],
      },
      {
        candidate: B,
        cells: [
          { value: '2–3', result: 'loss' },
          { value: '—', result: 'self' },
        ],
      },
    ],
    ranks: [1, 2],
    rankSummary: [
      { candidate: A, counts: [3, 2] },
      { candidate: B, counts: [2, 3] },
    ],
    ballotPatterns: [
      { count: 3, ranking: ['Candidate A', 'Candidate B'] },
      { count: 2, ranking: ['Candidate B'] },
    ],
    ...overrides,
  };
}

describe('VoteCondorcetResultsComponent', () => {
  let fixture: ComponentFixture<VoteCondorcetResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteCondorcetResultsComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteCondorcetResultsComponent);
  });

  function render(value: CondorcetQuestionView, isClosed = true): HTMLElement {
    fixture.componentRef.setInput('question', value);
    fixture.componentRef.setInput('isClosed', isClosed);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
  const text = (el: Element | null | undefined): string => squash(el?.textContent ?? '');
  const byTestId = (el: HTMLElement, id: string): HTMLElement | null => el.querySelector(`[data-testid="${id}"]`);

  it.each([
    {
      name: 'a Condorcet winner',
      overrides: {},
      heading: 'Condorcet IRV – Final Voting Outcome',
      message: 'Candidate A is the winner, having defeated all other candidates in head-to-head matchups.',
    },
    {
      name: 'an IRV winner',
      overrides: { outcome: CondorcetOutcome.IRV_WINNER, winnerNames: ['Candidate B'], usedIrv: true },
      heading: 'Instant Runoff Voting (IRV) – Final Voting Outcome',
      message:
        'No candidate beat every other candidate head-to-head, so instant-runoff elimination decided the result. Candidate B is declared the winner after the IRV elimination process.',
    },
    {
      name: 'a tie',
      overrides: { outcome: CondorcetOutcome.TIE, winnerNames: ['Candidate A', 'Candidate B'], usedIrv: true },
      heading: 'Instant Runoff Voting (IRV) – Final Voting Outcome',
      message: 'There is a tie between Candidate A and Candidate B. No single winner can be determined.',
    },
    {
      name: 'no winner',
      overrides: { outcome: CondorcetOutcome.NO_WINNER, winnerNames: [], usedIrv: true },
      heading: 'Instant Runoff Voting (IRV) – Final Voting Outcome',
      message: 'No winner could be determined.',
    },
  ])('explains $name', ({ overrides, heading, message }) => {
    const el = render(question(overrides));
    expect(text(byTestId(el, 'vote-condorcet-outcome')?.querySelector('h5'))).toBe(heading);
    expect(text(byTestId(el, 'vote-condorcet-outcome-message'))).toBe(message);
  });

  it('renders standings with the winner tag and head-to-head record', () => {
    // Angular drops inter-element whitespace, so compare with all whitespace removed.
    const compact = (value: string): string => value.replace(/\s+/g, '');
    const el = render(question());
    const winner = compact(text(byTestId(el, 'vote-condorcet-standing-a')));
    expect(winner).toContain(compact('1st Candidate A Winner'));
    expect(winner).toContain(compact('Won 1 out of 1 possible head-to-head matchups'));
    expect(compact(text(byTestId(el, 'vote-condorcet-standing-b')))).toContain(compact('2nd Candidate B'));
  });

  it('tags tied winners and shows the elimination round', () => {
    const el = render(
      question({
        outcome: CondorcetOutcome.TIE,
        standings: [
          { rank: 1, choiceId: 'a', choiceText: 'Candidate A', winCount: 0, totalMatchups: 1, isWinner: true, isTied: true, eliminatedInRound: null },
          { rank: 2, choiceId: 'b', choiceText: 'Candidate B', winCount: 0, totalMatchups: 1, isWinner: false, isTied: false, eliminatedInRound: 1 },
        ],
      })
    );
    expect(text(byTestId(el, 'vote-condorcet-standing-a'))).toContain('Tied');
    expect(text(byTestId(el, 'vote-condorcet-standing-b'))).toContain('Eliminated in round 1');
  });

  it('replaces the outcome and standings with an in-progress note while the vote is open', () => {
    const el = render(question(), false);
    expect(text(byTestId(el, 'vote-condorcet-in-progress'))).toBe('The vote is currently in progress. Final results will be available once voting has ended.');
    expect(byTestId(el, 'vote-condorcet-outcome-message')).toBeNull();
    expect(byTestId(el, 'vote-condorcet-standings')).toBeNull();
    expect(byTestId(el, 'vote-condorcet-pairwise')).toBeTruthy();
    expect(byTestId(el, 'vote-condorcet-rank-summary')).toBeTruthy();
  });

  it('says the result is being finalized, never in progress, once voting has ended but final totals are pending', () => {
    fixture.componentRef.setInput('isEnded', true);
    const el = render(question(), false);
    expect(text(byTestId(el, 'vote-condorcet-finalizing'))).toBe('Voting has ended. The final outcome will appear once the final totals are confirmed.');
    expect(byTestId(el, 'vote-condorcet-in-progress')).toBeNull();
    expect(byTestId(el, 'vote-condorcet-outcome-message')).toBeNull();
    expect(byTestId(el, 'vote-condorcet-standings')).toBeNull();

    fixture.componentRef.setInput('isClosed', true);
    fixture.detectChanges();
    expect(byTestId(el, 'vote-condorcet-finalizing')).toBeNull();
    expect(byTestId(el, 'vote-condorcet-outcome-message')).not.toBeNull();
  });

  it('renders pairwise cells with icons and screen-reader results', () => {
    const el = render(question());
    const rows = byTestId(el, 'vote-condorcet-pairwise')?.querySelectorAll('tbody tr') ?? [];
    expect(rows.length).toBe(2);
    const [selfCell, winCell] = Array.from(rows[0].querySelectorAll('td'));
    expect(text(selfCell)).toBe('—');
    expect(winCell.getAttribute('data-result')).toBe('win');
    expect(text(winCell)).toBe('3–2 Win');
    expect(winCell.querySelector('i.fa-circle-check')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(rows[1].querySelectorAll('td')[0])).toBe('2–3 Loss');
    expect(byTestId(el, 'vote-condorcet-pairwise')?.querySelector('caption.sr-only')).toBeTruthy();
  });

  it('renders ballot patterns, padding partial ballots', () => {
    const el = render(question());
    const rows = Array.from(byTestId(el, 'vote-condorcet-ballots')?.querySelectorAll('tbody tr') ?? []);
    expect(rows.map((row) => Array.from(row.children).map((cell) => text(cell)))).toEqual([
      ['3', 'Candidate A', 'Candidate B'],
      ['2', 'Candidate B', ''],
    ]);
    expect(byTestId(el, 'vote-condorcet-ballots-unavailable')).toBeNull();
  });

  it('shows the unavailable note instead of the ballot table without named ballots', () => {
    const el = render(question({ ballotPatterns: null }));
    expect(text(byTestId(el, 'vote-condorcet-ballots-unavailable'))).toBe("Ballot-by-ballot rankings aren't available for this vote.");
    expect(byTestId(el, 'vote-condorcet-ballots')?.querySelector('table')).toBeNull();
  });

  it('waits for named ballots instead of calling them unavailable while they load', () => {
    fixture.componentRef.setInput('ballotsLoading', true);
    const el = render(question({ ballotPatterns: null }));
    expect(text(byTestId(el, 'vote-condorcet-ballots-loading'))).toBe('Loading ballot rankings…');
    expect(byTestId(el, 'vote-condorcet-ballots-unavailable')).toBeNull();
  });

  it('keeps screen-reader cell text inside each scrolling table so it cannot widen the page', () => {
    const el = render(question());
    const wrappers = Array.from(el.querySelectorAll('.overflow-x-auto'));
    expect(wrappers).toHaveLength(3);
    wrappers.forEach((wrapper) => expect(wrapper.classList).toContain('relative'));
  });

  it('shows an empty note when no ranked ballots exist yet', () => {
    const el = render(question({ ballotPatterns: [] }));
    expect(text(byTestId(el, 'vote-condorcet-ballots-empty'))).toBe('No ranked ballots recorded yet.');
  });

  it('renders the candidate rank summary with ordinal headers', () => {
    const el = render(question({ ranks: [1, 2, 3, 11, 12, 22] }));
    const summary = byTestId(el, 'vote-condorcet-rank-summary');
    expect(Array.from(summary?.querySelectorAll('thead th') ?? []).map((th) => text(th))).toEqual(['Candidates', '1st', '2nd', '3rd', '11th', '12th', '22nd']);
    const rows = Array.from(summary?.querySelectorAll('tbody tr') ?? []);
    expect(rows.map((row) => Array.from(row.children).map((cell) => text(cell)))).toEqual([
      ['Candidate A', '3', '2'],
      ['Candidate B', '2', '3'],
    ]);
  });

  it('numbers the question heading only when asked', () => {
    let el = render(question());
    expect(text(el.querySelector('h4'))).toBe('Who should chair the board?');
    fixture.componentRef.setInput('questionNumber', 2);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(text(el.querySelector('h4'))).toBe('Q2. Who should chair the board?');
  });
});
