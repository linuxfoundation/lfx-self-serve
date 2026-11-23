// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RankedOutcome, RankedQuestionView, RankedStanding } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteRankedQuestionResultsComponent } from './vote-ranked-question-results.component';

function question(overrides: Partial<RankedQuestionView> = {}): RankedQuestionView {
  return {
    questionId: 'q1',
    prompt: 'Rank the candidates',
    choiceDistributions: [
      {
        choiceId: 'c1',
        choiceText: 'Candidate One',
        totalRanked: 4,
        rankCounts: [
          { rank: 1, count: 3, percentage: 75 },
          { rank: 2, count: 1, percentage: 25 },
        ],
      },
      { choiceId: 'c2', choiceText: 'Candidate Two', totalRanked: 1, rankCounts: [] },
    ],
    outcome: null,
    standings: [],
    ...overrides,
  };
}

function outcome(overrides: Partial<RankedOutcome> = {}): RankedOutcome {
  return { kind: 'condorcet', result: 'winner', winnerTexts: ['Candidate One'], roundCount: 0, condorcetFallback: false, ...overrides };
}

function standing(choiceId: string, choiceText: string, overrides: Partial<RankedStanding> = {}): RankedStanding {
  return { choiceId, choiceText, rank: 1, label: null, round: null, headToHeadWins: null, headToHeadTotal: null, ...overrides };
}

const condorcetStandings: RankedStanding[] = [
  standing('c1', 'Candidate One', { label: 'winner', headToHeadWins: 1, headToHeadTotal: 1 }),
  standing('c2', 'Candidate Two', { rank: 2, headToHeadWins: 0, headToHeadTotal: 1 }),
];

describe('VoteRankedQuestionResultsComponent', () => {
  let fixture: ComponentFixture<VoteRankedQuestionResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteRankedQuestionResultsComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteRankedQuestionResultsComponent);
  });

  function render(value: RankedQuestionView, variant?: 'creator' | 'voter', showOutcome?: boolean): HTMLElement {
    fixture.componentRef.setInput('question', value);
    if (variant) fixture.componentRef.setInput('variant', variant);
    if (showOutcome !== undefined) fixture.componentRef.setInput('showOutcome', showOutcome);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /** Strips all whitespace: Angular drops inter-element whitespace, so adjacent elements' text runs together. */
  const squash = (text: string): string => text.replace(/\s+/g, '');
  const text = (el: Element | null | undefined): string => squash(el?.textContent ?? '');

  describe('creator', () => {
    it('renders rank rows with count and percent under test ids', () => {
      const el = render(question());

      expect(text(el.querySelector('[data-testid="vote-results-ranked-question-q1"] h4'))).toBe(squash('Rank the candidates'));
      const c1 = text(el.querySelector('[data-testid="vote-results-ranked-choice-c1"]'));
      expect(c1).toContain(squash('Candidate One 4 voters'));
      expect(c1).toContain(squash('Rank 1 3 75%'));
      expect(c1).toContain(squash('Rank 2 1 25%'));
      expect(el.querySelector<HTMLElement>('[data-testid="vote-results-ranked-choice-c1"] .bg-blue-500')?.style.width).toBe('75%');
      expect(text(el.querySelector('[data-testid="vote-results-ranked-choice-c2"]'))).toContain(squash('Candidate Two 1 voter'));
    });

    it('shows the empty states without a round-summary placeholder', () => {
      const el = render(question());

      expect(text(el.querySelector('[data-testid="vote-results-ranked-choice-c2"]'))).toContain(squash('No rankings recorded yet.'));
      expect(text(el)).not.toContain(squash('coming soon'));

      render(question({ choiceDistributions: [] }));
      expect(text(el.querySelector('[data-testid="vote-results-ranked-question-empty-q1"]'))).toBe(squash('No ranked results recorded yet for this question.'));
    });
  });

  describe('outcome and standings (#2005)', () => {
    const banner = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-testid="vote-results-ranked-outcome-q1"]');
    /** Banner text with single spaces, so word boundaries around the bolded names are checked too. */
    const bannerText = (el: HTMLElement): string => (banner(el)?.textContent ?? '').replace(/\s+/g, ' ').trim();

    it('hides the banner and standings unless showOutcome is set', () => {
      const el = render(question({ outcome: outcome(), standings: condorcetStandings }));

      expect(banner(el)).toBeNull();
      expect(el.querySelector('[data-testid^="vote-results-ranked-standing-"]')).toBeNull();
      expect(text(el)).not.toContain('Standings');
      expect(text(el)).not.toContain(squash('Rank distribution'));
    });

    it('renders the Condorcet winner banner and head-to-head standings above the distribution', () => {
      const el = render(question({ outcome: outcome(), standings: condorcetStandings }), 'creator', true);

      expect(banner(el)?.getAttribute('role')).toBe('status');
      expect(banner(el)?.querySelector('strong')?.textContent).toBe('Candidate One');
      expect(bannerText(el)).toBe('Candidate One is the winner, having defeated every other candidate in head-to-head matchups.');
      expect(banner(el)?.querySelector('.fa-trophy')).toBeTruthy();
      expect(text(el.querySelector('[data-testid="vote-results-ranked-standing-c1"]'))).toBe(
        squash('1st Candidate One Won 1 out of 1 possible head-to-head matchup Winner')
      );
      expect(text(el.querySelector('[data-testid="vote-results-ranked-standing-c2"]'))).toBe(
        squash('2nd Candidate Two Won 0 out of 1 possible head-to-head matchup')
      );
      expect(text(el)).toContain(squash('Rank distribution'));
      expect(text(el).indexOf('Standings')).toBeLessThan(text(el).indexOf(squash('Rank distribution')));
    });

    it.each([
      [
        outcome({ result: 'tie', winnerTexts: ['Candidate One', 'Candidate Two'] }),
        'Candidate One and Candidate Two are tied. No single winner could be determined.',
      ],
      [outcome({ kind: 'irv', result: 'none', winnerTexts: [] }), 'No winner could be determined.'],
      [outcome({ kind: 'irv', roundCount: 3 }), 'Candidate One is the winner, with a majority of continuing ballots in round 3.'],
      [outcome({ kind: 'irv' }), 'Candidate One is the winner, with a majority of continuing ballots.'],
      [
        outcome({ kind: 'irv', roundCount: 2, condorcetFallback: true }),
        'No candidate beat every other candidate head-to-head, so the vote went to instant-runoff elimination. Candidate One is the winner after 2 rounds.',
      ],
      [outcome({ kind: 'meek_stv', winnerTexts: ['Candidate One'] }), 'Candidate One was elected by meeting the quota through proportional vote transfers.'],
      [
        outcome({ kind: 'meek_stv', winnerTexts: ['Candidate One', 'Candidate Two'] }),
        'Candidate One and Candidate Two were elected by meeting the quota through proportional vote transfers.',
      ],
    ])('words the banner for each outcome (%#)', (value, expected) => {
      const el = render(question({ outcome: value }), 'creator', true);

      expect(bannerText(el)).toBe(expected);
    });

    it('uses the neutral icon for a tie or no winner', () => {
      const el = render(question({ outcome: outcome({ result: 'none', winnerTexts: [] }) }), 'creator', true);

      expect(banner(el)?.querySelector('.fa-scale-balanced')).toBeTruthy();
      expect(banner(el)?.querySelector('strong')).toBeNull();
    });

    it('labels tied, eliminated, elected and not-elected rows', () => {
      const el = render(
        question({
          outcome: outcome({ kind: 'irv', result: 'tie', winnerTexts: ['Candidate One', 'Candidate Two'] }),
          standings: [
            standing('c1', 'Candidate One', { label: 'tied' }),
            standing('c2', 'Candidate Two', { label: 'tied' }),
            standing('c3', 'Candidate Three', { rank: 3, label: 'eliminated', round: 2 }),
            standing('c4', 'Candidate Four', { rank: 4, label: 'survivor' }),
            standing('c5', 'Candidate Five', { rank: 11, label: 'elected', round: 4 }),
            standing('c6', 'Candidate Six', { rank: 22, label: 'not_elected' }),
          ],
        }),
        'creator',
        true
      );
      const row = (choiceId: string): string => text(el.querySelector(`[data-testid="vote-results-ranked-standing-${choiceId}"]`));

      expect(row('c1')).toBe(squash('1st Candidate One Tied'));
      expect(row('c2')).toBe(squash('1st Candidate Two Tied'));
      expect(row('c3')).toBe(squash('3rd Candidate Three Eliminated in round 2'));
      expect(row('c4')).toBe(squash('4th Candidate Four'));
      expect(row('c5')).toBe(squash('11th Candidate Five Elected in round 4'));
      expect(row('c6')).toBe(squash('22nd Candidate Six Not elected'));
    });

    it('renders the banner and standings for voters without test ids', () => {
      const el = render(question({ outcome: outcome(), standings: condorcetStandings }), 'voter', true);

      expect(text(el)).toContain(squash('Candidate One is the winner'));
      expect(text(el)).toContain(squash('1st Candidate One Won 1 out of 1 possible head-to-head matchup Winner'));
      expect(el.querySelector('[data-testid]')).toBeNull();
    });
  });

  describe('voter', () => {
    it('renders the rank rows without test ids or empty states', () => {
      const el = render(question(), 'voter');

      expect(text(el)).toContain(squash('Rank the candidates'));
      expect(text(el)).toContain(squash('Candidate One 4 voters'));
      expect(text(el)).toContain(squash('Rank 1 3 75%'));
      expect(el.querySelector('[data-testid]')).toBeNull();
      expect(text(el)).not.toContain(squash('No rankings recorded yet.'));
    });

    it('renders no empty-question message', () => {
      const el = render(question({ choiceDistributions: [] }), 'voter');

      expect(text(el)).toBe(squash('Rank the candidates'));
    });
  });

  describe('voter links (#3914, #4450)', () => {
    const viewLink = (choiceId: string): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector(`button[data-testid="vote-results-ranked-choice-${choiceId}-view-voters"]`);

    it('renders no links by default', () => {
      render(question());

      expect(viewLink('c1')).toBeNull();
    });

    it('updates the Rank 1 link when the question changes', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(question());
      expect(viewLink('c1')?.textContent?.trim()).toBe('3');

      render(
        question({
          choiceDistributions: [
            {
              choiceId: 'c3',
              choiceText: 'Candidate Three',
              totalRanked: 3,
              rankCounts: [
                { rank: 2, count: 2, percentage: 67 },
                { rank: 1, count: 1, percentage: 33 },
              ],
            },
          ],
        })
      );

      expect(viewLink('c1')).toBeNull();
      expect(viewLink('c3')?.textContent?.trim()).toBe('1');
      expect(viewLink('c3')?.getAttribute('aria-label')).toBe('View the 1 voter who ranked Candidate Three first');
    });

    it('makes the Rank 1 count the link and emits the question and choice key', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(question());
      const emitted: string[] = [];
      fixture.componentInstance.viewVoters.subscribe((key) => emitted.push(key));

      expect(viewLink('c1')?.getAttribute('aria-label')).toBe('View the 3 voters who ranked Candidate One first');
      expect(viewLink('c2')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('[data-testid$="-view-voters"]').length).toBe(1);
      viewLink('c1')!.click();
      expect(emitted).toEqual(['q1:c1']);
    });

    it('keeps the Rank 2 count as plain text', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(question());

      expect(fixture.nativeElement.querySelectorAll('button').length).toBe(1);
    });
  });
});
