// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RankedQuestionView } from '@lfx-one/shared/interfaces';
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
    hasRoundSummary: true,
    ...overrides,
  };
}

describe('VoteRankedQuestionResultsComponent', () => {
  let fixture: ComponentFixture<VoteRankedQuestionResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteRankedQuestionResultsComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteRankedQuestionResultsComponent);
  });

  function render(value: RankedQuestionView, variant?: 'creator' | 'voter'): HTMLElement {
    fixture.componentRef.setInput('question', value);
    if (variant) fixture.componentRef.setInput('variant', variant);
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

    it('shows the empty states and the round-summary banner', () => {
      const el = render(question());

      expect(text(el.querySelector('[data-testid="vote-results-ranked-choice-c2"]'))).toContain(squash('No rankings recorded yet.'));
      expect(el.querySelector('[data-testid="vote-results-ranked-rounds-q1"]')).toBeTruthy();

      render(question({ choiceDistributions: [], hasRoundSummary: false }));
      expect(text(el.querySelector('[data-testid="vote-results-ranked-question-empty-q1"]'))).toBe(squash('No ranked results recorded yet for this question.'));
      expect(el.querySelector('[data-testid="vote-results-ranked-rounds-q1"]')).toBeNull();
    });
  });

  describe('voter', () => {
    it('renders the rank rows without test ids, empty states or the banner', () => {
      const el = render(question(), 'voter');

      expect(text(el)).toContain(squash('Rank the candidates'));
      expect(text(el)).toContain(squash('Candidate One 4 voters'));
      expect(text(el)).toContain(squash('Rank 1 3 75%'));
      expect(el.querySelector('[data-testid]')).toBeNull();
      expect(text(el)).not.toContain(squash('No rankings recorded yet.'));
      expect(text(el)).not.toContain(squash('Round-by-round'));
    });

    it('renders no empty-question message', () => {
      const el = render(question({ choiceDistributions: [] }), 'voter');

      expect(text(el)).toBe(squash('Rank the candidates'));
    });
  });

  describe('voter links (#3914)', () => {
    const viewLink = (choiceId: string): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="vote-results-ranked-choice-${choiceId}-view-voters"] button`);

    it('renders no links by default', () => {
      render(question());

      expect(viewLink('c1')).toBeNull();
    });

    it('updates prepared first-choice counts when the question changes', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(question());
      expect(viewLink('c1')?.textContent).toContain('View 3 first-choice voters');

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
      expect(viewLink('c3')?.textContent).toContain('View 1 first-choice voter');
    });

    it('links each choice ranked first by its rank-1 count and emits the question and choice key', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(question());
      const emitted: string[] = [];
      fixture.componentInstance.viewVoters.subscribe((key) => emitted.push(key));

      expect(viewLink('c1')?.textContent).toContain('View 3 first-choice voters');
      expect(viewLink('c2')).toBeNull();
      viewLink('c1')!.click();
      expect(emitted).toEqual(['q1:c1']);
    });
  });
});
