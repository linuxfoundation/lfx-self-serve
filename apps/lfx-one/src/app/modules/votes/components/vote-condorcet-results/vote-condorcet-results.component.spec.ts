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
      { key: 'a\u0000b', count: 3, ranking: ['Candidate A', 'Candidate B'] },
      { key: 'b', count: 2, ranking: ['Candidate B'] },
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
      heading: 'Candidate A won',
      message: 'Preferred over every other option in head-to-head comparisons.',
    },
    {
      name: 'an IRV winner',
      overrides: { outcome: CondorcetOutcome.IRV_WINNER, winnerNames: ['Candidate B'], usedIrv: true },
      heading: 'Candidate B won',
      message: 'No option beat every other option head-to-head, so instant-runoff elimination decided the result.',
    },
    {
      name: 'a tie',
      overrides: { outcome: CondorcetOutcome.TIE, winnerNames: ['Candidate A', 'Candidate B'], usedIrv: true },
      heading: 'Tie — no single winner',
      message: 'There is a tie between Candidate A and Candidate B. No single winner can be determined.',
    },
    {
      name: 'no winner',
      overrides: { outcome: CondorcetOutcome.NO_WINNER, winnerNames: [], usedIrv: true },
      heading: 'No winner determined',
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
    expect(winner).toContain(compact('Won 1 out of 1 possible head-to-head matchup'));
    expect(winner).not.toContain(compact('matchups'));
    expect(compact(text(byTestId(el, 'vote-condorcet-standing-b')))).toContain(compact('2nd Candidate B'));
  });

  it('agrees count nouns with singular and plural counts', () => {
    const one = render(
      question({
        rankSummary: [
          { candidate: A, counts: [1, 0] },
          { candidate: B, counts: [0, 0] },
        ],
        ballotPatterns: [{ key: 'a', count: 1, ranking: ['Candidate A'] }],
      })
    );
    expect(text(byTestId(one, 'vote-condorcet-preference-a'))).toContain('Ranked on 1 ballot');
    expect(text(byTestId(one, 'vote-condorcet-preference-a'))).not.toContain('Ranked on 1 ballots');
    expect(text(byTestId(one, 'vote-condorcet-ballots-toggle'))).toBe('View ballot rankings (1 distinct order)');

    const many = render(
      question({
        standings: [
          { rank: 1, choiceId: 'a', choiceText: 'Candidate A', winCount: 2, totalMatchups: 2, isWinner: true, isTied: false, eliminatedInRound: null },
        ],
      })
    );
    expect(text(byTestId(many, 'vote-condorcet-standing-a'))).toContain('Won 2 out of 2 possible head-to-head matchups');
    expect(text(byTestId(many, 'vote-condorcet-preference-a'))).toContain('Ranked on 5 ballots');
    expect(text(byTestId(many, 'vote-condorcet-ballots-toggle'))).toBe('View ballot rankings (2 distinct orders)');
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

  it('renders pairwise cells with icons and visible win, loss and tie labels', () => {
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
      ['2', 'Candidate B', 'Not ranked'],
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

  it('positions each scrolling table wrapper so its screen-reader caption cannot widen the page', () => {
    const el = render(question());
    const wrappers = Array.from(el.querySelectorAll('.overflow-x-auto'));
    expect(wrappers).toHaveLength(3);
    wrappers.forEach((wrapper) => expect(wrapper.classList).toContain('relative'));
  });

  it('bounds and wraps sticky candidate names instead of letting them cover the data columns', () => {
    const el = render(question());
    for (const id of ['vote-condorcet-pairwise', 'vote-condorcet-rank-summary']) {
      const names = byTestId(el, id)?.querySelectorAll('tbody th[scope="row"] span') ?? [];
      expect(names).toHaveLength(2);
      names.forEach((name) => {
        expect(name.classList).toContain('w-32');
        expect(name.classList).toContain('break-words');
        expect(name.classList).toContain('whitespace-normal');
        expect(name.parentElement?.classList).not.toContain('whitespace-nowrap');
      });
    }
  });

  it('bounds and wraps candidate names in pairwise column headers and ballot cells', () => {
    const el = render(question());
    const columnNames = Array.from(byTestId(el, 'vote-condorcet-pairwise')?.querySelectorAll('thead th[scope="col"] span') ?? []);
    const ballotNames = Array.from(byTestId(el, 'vote-condorcet-ballots')?.querySelectorAll('tbody td span') ?? []);
    expect(columnNames.map((name) => text(name))).toEqual(['Candidate A', 'Candidate B']);
    expect(ballotNames.map((name) => text(name))).toEqual(['Candidate A', 'Candidate B', 'Candidate B', 'Not ranked']);
    [...columnNames, ...ballotNames].forEach((name) => {
      expect(name.classList).toContain('w-32');
      expect(name.classList).toContain('break-words');
      expect(name.classList).toContain('whitespace-normal');
      expect(name.parentElement?.classList).not.toContain('whitespace-nowrap');
    });
  });

  it('moves the same ballot row nodes when counts change their order', () => {
    const initial = question();
    const el = render(initial);
    const before = Array.from(byTestId(el, 'vote-condorcet-ballots')?.querySelectorAll('tbody tr') ?? []);
    render({ ...initial, ballotPatterns: [{ ...initial.ballotPatterns![1], count: 4 }, initial.ballotPatterns![0]] });
    const after = Array.from(byTestId(el, 'vote-condorcet-ballots')?.querySelectorAll('tbody tr') ?? []);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(text(after[0].querySelector('th'))).toBe('4');
  });

  it('shows an empty note when no ranked ballots exist yet', () => {
    const el = render(question({ ballotPatterns: [] }), false);
    expect(text(byTestId(el, 'vote-condorcet-ballots-empty'))).toBe('No ranked ballots recorded yet.');
  });

  it('drops "yet" from the empty ballot note once the vote is closed', () => {
    const el = render(question({ ballotPatterns: [] }));
    expect(text(byTestId(el, 'vote-condorcet-ballots-empty'))).toBe('No ranked ballots were submitted.');
  });

  it('renders the candidate rank summary with ordinal headers', () => {
    const el = render(question({ ranks: [1, 2, 3, 11, 12, 22] }));
    const summary = byTestId(el, 'vote-condorcet-rank-summary');
    expect(Array.from(summary?.querySelectorAll('thead th') ?? []).map((th) => text(th))).toEqual(['Options', '1st', '2nd', '3rd', '11th', '12th', '22nd']);
    const rows = Array.from(summary?.querySelectorAll('tbody tr') ?? []);
    expect(rows.map((row) => Array.from(row.children).map((cell) => text(cell)))).toEqual([
      ['Candidate A', '3', '2'],
      ['Candidate B', '2', '3'],
    ]);
  });

  it('places preference distributions before the collapsed ballot breakdown', () => {
    const el = render(question());
    const ids = Array.from(el.querySelectorAll('section')).map((section) => section.getAttribute('data-testid'));
    expect(ids).toEqual([
      'vote-condorcet-outcome',
      'vote-condorcet-standings',
      'vote-condorcet-pairwise',
      'vote-condorcet-rank-summary',
      'vote-condorcet-ballots',
    ]);
    const details = byTestId(el, 'vote-condorcet-ballots-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    byTestId(el, 'vote-condorcet-ballots-toggle')!.click();
    expect(details.open).toBe(true);
    byTestId(el, 'vote-condorcet-ballots-toggle')!.click();
    expect(details.open).toBe(false);
  });

  it('previews five ballot orders, expands all, and returns to the preview', () => {
    const patterns = Array.from({ length: 7 }, (_, index) => ({
      key: `synthetic-pattern-${index}`,
      count: 7 - index,
      ranking: ['Candidate A'],
    }));
    const el = render(question({ ballotPatterns: patterns }));
    const rows = () => byTestId(el, 'vote-condorcet-ballots')!.querySelectorAll('tbody tr');
    const toggle = byTestId(el, 'vote-condorcet-ballots-show-all') as HTMLButtonElement;
    expect(rows()).toHaveLength(5);
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector(`[id="${toggle.getAttribute('aria-controls')}"]`)).not.toBeNull();
    toggle.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(7);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    fixture.detectChanges();
    expect(rows()).toHaveLength(5);
  });

  it('does not offer show all when there are at most five orders', () => {
    const el = render(question());
    expect(byTestId(el, 'vote-condorcet-ballots-show-all')).toBeNull();
  });

  it('normalizes each preference bar within ballots ranking that option, with exact counts as text', () => {
    const el = render(
      question({
        rankSummary: [
          { candidate: A, counts: [1, 3] },
          { candidate: B, counts: [0, 2] },
        ],
      })
    );
    const a = byTestId(el, 'vote-condorcet-preference-a')!;
    const b = byTestId(el, 'vote-condorcet-preference-b')!;
    expect(text(a)).toContain('Ranked on 4 ballots');
    expect(text(b)).toContain('Ranked on 2 ballots');
    expect(text(a).replace(/\s/g, '')).toContain('1st:12nd:3');
    const widths = (row: HTMLElement) => Array.from(row.querySelectorAll('[aria-hidden="true"] > span')).map((segment) => (segment as HTMLElement).style.width);
    expect(widths(a)).toEqual(['25%', '75%']);
    expect(widths(b)).toEqual(['0%', '100%']);
    expect(text(byTestId(el, 'vote-condorcet-rank-summary'))).toContain('Ballots omitting the option and abstentions are not included.');
    expect(a.querySelector('.h-5')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('handles zero rankings without NaN or a false filled bar', () => {
    const el = render(question({ rankSummary: [{ candidate: A, counts: [0, 0] }] }));
    const row = byTestId(el, 'vote-condorcet-preference-a')!;
    expect(text(row)).toContain('No rankings recorded for this option.');
    expect(Array.from(row.querySelectorAll('[aria-hidden="true"] > span')).map((segment) => (segment as HTMLElement).style.width)).toEqual(['0%', '0%']);
    expect(row.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('keeps the service winner when another option has more first choices', () => {
    const el = render(
      question({
        rankSummary: [
          { candidate: A, counts: [1, 4] },
          { candidate: B, counts: [4, 1] },
        ],
      })
    );
    expect(text(byTestId(el, 'vote-condorcet-outcome-heading'))).toBe('Candidate A won');
    expect(text(byTestId(el, 'vote-condorcet-method-explanation'))).toContain('First-choice votes alone do not decide a Condorcet result.');
    expect(text(byTestId(el, 'vote-condorcet-winner-matchups'))).toContain('Candidate A vs Candidate B');
  });

  it('never highlights winner matchups or a trophy before closure or for an IRV fallback', () => {
    const el = render(question(), false);
    expect(text(byTestId(el, 'vote-condorcet-outcome-heading'))).toBe('Voting in progress');
    expect(byTestId(el, 'vote-condorcet-winner-matchups')).toBeNull();
    expect(el.querySelector('.fa-trophy')).toBeNull();
    render(question({ usedIrv: true, outcome: CondorcetOutcome.IRV_WINNER }));
    expect(byTestId(el, 'vote-condorcet-winner-matchups')).toBeNull();
    expect(text(byTestId(el, 'vote-condorcet-outcome'))).toContain('Instant-runoff fallback');
  });

  it('omits the focused matchup summary when the matrix is unavailable', () => {
    const el = render(
      question({
        pairwise: [
          {
            candidate: A,
            cells: [
              { value: '—', result: 'self' },
              { value: '0–0', result: 'neutral' },
            ],
          },
        ],
      })
    );
    expect(byTestId(el, 'vote-condorcet-winner-matchups')).toBeNull();
    expect(text(byTestId(el, 'vote-condorcet-outcome-heading'))).toBe('Candidate A won');
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
