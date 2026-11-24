// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TagComponent } from '@components/tag/tag.component';
import { VoteOverviewOutcome } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteOverviewOutcomeComponent } from './vote-overview-outcome.component';

function outcome(overrides: Partial<VoteOverviewOutcome> = {}): VoteOverviewOutcome {
  return {
    questionId: 'q1',
    prompt: 'Who should chair the board?',
    result: 'winner',
    label: 'Winner',
    winnerTexts: ['Option D'],
    explanation: 'Preferred over every other option in head-to-head comparisons.',
    standings: [
      { choiceId: 'a', choiceText: 'Option A', rank: 2, detail: 'Won 2 out of 3 possible head-to-head matchups' },
      { choiceId: 'b', choiceText: 'Option B', rank: 3, detail: null },
    ],
    hiddenCount: 0,
    ...overrides,
  };
}

describe('VoteOverviewOutcomeComponent (#6124)', () => {
  let fixture: ComponentFixture<VoteOverviewOutcomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteOverviewOutcomeComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteOverviewOutcomeComponent);
  });

  function render(value: VoteOverviewOutcome, variant?: 'full' | 'compact', ariaLabel?: string): HTMLElement {
    fixture.componentRef.setInput('outcome', value);
    if (variant) fixture.componentRef.setInput('variant', variant);
    if (ariaLabel) fixture.componentRef.setInput('ariaLabel', ariaLabel);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="vote-overview-outcome"]');
  }

  const byTestId = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const text = (el: Element | null | undefined): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** Rank, option and detail of a standings row, read per cell because adjacent spans carry no whitespace. */
  const cells = (choiceId: string): string[] =>
    [...(byTestId(`vote-overview-outcome-standing-${choiceId}`)?.querySelectorAll('span') ?? [])].map((el) => text(el));

  it('renders a winner banner with a trophy, the word "Winner", the name in large text and the explanation', () => {
    const section = render(outcome());

    expect(section.tagName).toBe('SECTION');
    expect(section.getAttribute('aria-label')).toBe('Outcome');
    expect(section.getAttribute('role')).toBeNull();
    expect(section.classList).toContain('bg-emerald-50');
    expect(text(byTestId('vote-overview-outcome-label'))).toBe('Winner');
    expect(text(byTestId('vote-overview-outcome-names'))).toBe('Option D');
    expect(byTestId('vote-overview-outcome-names')?.classList).toContain('text-lg');
    expect(text(byTestId('vote-overview-outcome-explanation'))).toBe('Preferred over every other option in head-to-head comparisons.');
    const icon = section.querySelector('i');
    expect(icon?.classList).toContain('fa-trophy');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('lists the runner-up standings with ordinals and details', () => {
    render(outcome());

    expect(fixture.nativeElement.querySelector('ol')).toBeTruthy();
    expect(cells('a')).toEqual(['2nd', 'Option A', 'Won 2 out of 3 possible head-to-head matchups']);
    expect(cells('b')).toEqual(['3rd', 'Option B']);
    expect(byTestId('vote-overview-outcome-more')).toBeNull();
  });

  it.each([
    [1, '+1 more option on the Results tab'],
    [4, '+4 more options on the Results tab'],
  ])('points to the Results tab for %i hidden option(s)', (hiddenCount, copy) => {
    render(outcome({ hiddenCount }));

    expect(text(byTestId('vote-overview-outcome-more'))).toBe(copy);
  });

  it('keeps a tie neutral with a balance icon and joined names', () => {
    const section = render(
      outcome({ result: 'tie', label: 'Tied', winnerTexts: ['Option A', 'Option B'], explanation: 'No single winner could be determined.', standings: [] })
    );

    expect(section.classList).toContain('bg-slate-50');
    expect(section.classList).not.toContain('bg-emerald-50');
    expect(section.querySelector('i')?.classList).toContain('fa-scale-balanced');
    expect(text(byTestId('vote-overview-outcome-label'))).toBe('Tied');
    expect(text(byTestId('vote-overview-outcome-names'))).toBe('Option A and Option B');
    expect(fixture.nativeElement.querySelector('ol')).toBeNull();
  });

  it('says no winner could be determined without an explanation', () => {
    const section = render(outcome({ result: 'none', label: 'No winner', winnerTexts: [], explanation: null, standings: [] }));

    expect(section.classList).toContain('bg-slate-50');
    expect(section.querySelector('i')?.classList).toContain('fa-circle-question');
    expect(text(byTestId('vote-overview-outcome-label'))).toBe('No winner');
    expect(text(byTestId('vote-overview-outcome-names'))).toBe('No winner could be determined');
    expect(byTestId('vote-overview-outcome-explanation')).toBeNull();
  });

  it('renders Meek STV seats as elected', () => {
    render(
      outcome({
        label: 'Elected',
        winnerTexts: ['Option A', 'Option B', 'Option C'],
        explanation: 'Elected using Meek STV proportional counting.',
        standings: [{ choiceId: 'd', choiceText: 'Option D', rank: 4, detail: 'Not elected' }],
      })
    );

    expect(text(byTestId('vote-overview-outcome-label'))).toBe('Elected');
    expect(text(byTestId('vote-overview-outcome-names'))).toBe('Option A, Option B and Option C');
    expect(cells('d')).toEqual(['4th', 'Option D', 'Not elected']);
  });

  it('renders the compact variant as one line with a label tag and no explanation or standings', () => {
    const section = render(outcome({ hiddenCount: 2 }), 'compact', 'Q2 outcome');

    expect(section.getAttribute('aria-label')).toBe('Q2 outcome');
    expect(text(byTestId('vote-overview-outcome-names'))).toBe('Option D');
    expect(text(section.querySelector('lfx-tag'))).toBe('Winner');
    expect(section.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
    expect(byTestId('vote-overview-outcome-explanation')).toBeNull();
    expect(fixture.nativeElement.querySelector('ol')).toBeNull();
    expect(byTestId('vote-overview-outcome-more')).toBeNull();
  });

  it.each([
    { result: 'winner', label: 'Winner', winnerTexts: ['Option D'], severity: 'success', icon: 'fa-trophy' },
    { result: 'tie', label: 'Tied', winnerTexts: ['Option A', 'Option B'], severity: 'secondary', icon: 'fa-scale-balanced' },
    { result: 'none', label: 'No winner', winnerTexts: [], severity: 'secondary', icon: 'fa-circle-question' },
  ] as const)('gives a compact $result line a $severity tag and its own icon', ({ result, label, winnerTexts, severity, icon }) => {
    const section = render(outcome({ result, label, winnerTexts: [...winnerTexts] }), 'compact');
    const tag = fixture.debugElement.query(By.directive(TagComponent)).componentInstance as TagComponent;

    expect(tag.value()).toBe(label);
    expect(tag.severity()).toBe(severity);
    expect(section.querySelector('i')?.classList).toContain(icon);
  });
});
