// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VoteResultsOption } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteOptionResultsComponent } from './vote-option-results.component';

function option(overrides: Partial<VoteResultsOption>): VoteResultsOption {
  return { choiceId: 'c1', text: 'Option one', voteCount: 0, percentage: 0, isWinner: false, isTied: false, isLeading: false, ...overrides };
}

describe('VoteOptionResultsComponent', () => {
  let fixture: ComponentFixture<VoteOptionResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteOptionResultsComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteOptionResultsComponent);
  });

  function render(options: VoteResultsOption[], variant?: 'live' | 'final' | 'voter-final', testIdPrefix?: string): void {
    fixture.componentRef.setInput('options', options);
    if (variant) fixture.componentRef.setInput('variant', variant);
    if (testIdPrefix) fixture.componentRef.setInput('testIdPrefix', testIdPrefix);
    fixture.detectChanges();
  }

  const row = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => row(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  describe('live', () => {
    it('highlights the leading option and mutes the rest', () => {
      render([option({ choiceId: 'c1', voteCount: 3, percentage: 75, isLeading: true }), option({ choiceId: 'c2', voteCount: 1, percentage: 25 })], 'live');

      expect(row('vote-results-option-c1')?.querySelector('.bg-blue-500')?.getAttribute('style')).toContain('width: 75%');
      expect(row('vote-results-option-c1')?.querySelector('span')?.className).toBe('font-semibold text-slate-900');
      expect(row('vote-results-option-c2')?.querySelector('.bg-slate-300')).toBeTruthy();
      expect(row('vote-results-option-c2')?.querySelector('span')?.className).toBe('font-normal text-slate-600');
    });

    it('pluralizes the vote count and joins the percentage', () => {
      render([option({ choiceId: 'c1', voteCount: 1, percentage: 50 }), option({ choiceId: 'c2', voteCount: 2, percentage: 100 })], 'live');

      expect(text('vote-results-option-c1')).toContain('1 vote · 50%');
      expect(text('vote-results-option-c2')).toContain('2 votes · 100%');
    });

    it('never shows winner or tie badges', () => {
      render([option({ isWinner: true, isTied: true, voteCount: 2 })], 'live');
      expect(text('vote-results-option-c1')).not.toContain('Winner');
      expect(text('vote-results-option-c1')).not.toContain('Tied');
    });
  });

  describe.each([
    ['final', 'bg-white', 'bg-slate-100'],
    ['voter-final', 'bg-slate-100', 'bg-white'],
  ] as const)('%s', (variant, track, otherTrack) => {
    it('marks the winner', () => {
      render([option({ choiceId: 'c1', voteCount: 3, percentage: 75, isWinner: true }), option({ choiceId: 'c2', voteCount: 1, percentage: 25 })], variant);

      expect(text('vote-results-option-c1')).toContain('Winner');
      expect(row('vote-results-option-c1')?.classList).toContain('border-green-300');
      expect(row('vote-results-option-c1')?.querySelector('.bg-green-500')).toBeTruthy();
      expect(text('vote-results-option-c2')).not.toContain('Winner');
      expect(row('vote-results-option-c2')?.classList).toContain('border-slate-200');
    });

    it('marks ties', () => {
      render([option({ choiceId: 'c1', voteCount: 2, isTied: true }), option({ choiceId: 'c2', voteCount: 2, isTied: true })], variant);

      expect(text('vote-results-option-c1')).toContain('Tied');
      expect(text('vote-results-option-c2')).toContain('Tied');
      expect(row('vote-results-option-c1')?.classList).toContain('border-amber-300');
    });

    it('pluralizes the vote count with the percentage in parentheses', () => {
      render([option({ choiceId: 'c1', voteCount: 1, percentage: 50 }), option({ choiceId: 'c2', voteCount: 0, percentage: 0 })], variant);

      expect(text('vote-results-option-c1')).toContain('1 vote (50%)');
      expect(text('vote-results-option-c2')).toContain('0 votes (0%)');
    });

    it(`uses the ${track} bar track`, () => {
      render([option({ percentage: 40 })], variant);

      const bar = row('vote-results-option-c1')?.querySelector<HTMLElement>('.bg-slate-400');
      expect(bar?.style.width).toBe('40%');
      expect(bar?.parentElement?.classList).toContain(track);
      expect(bar?.parentElement?.classList).not.toContain(otherTrack);
    });
  });

  it('defaults to the final variant', () => {
    render([option({ percentage: 10 })]);
    expect(row('vote-results-option-c1')?.querySelector('.bg-white')).toBeTruthy();
  });

  it('applies the test-id prefix to every row', () => {
    render([option({ choiceId: 'c1' }), option({ choiceId: 'c2' })], 'voter-final', 'vote-results-voter-option-');

    expect(row('vote-results-voter-option-c1')).toBeTruthy();
    expect(row('vote-results-voter-option-c2')).toBeTruthy();
    expect(row('vote-results-option-c1')).toBeNull();
  });

  describe('voter links (#3914)', () => {
    const viewLink = (choiceId: string): HTMLButtonElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="vote-results-option-${choiceId}-view-voters"] button`);

    it('renders no links by default', () => {
      render([option({ choiceId: 'c1', voteCount: 2, percentage: 100 })], 'final');

      expect(viewLink('c1')).toBeNull();
    });

    it.each(['live', 'final'] as const)('links each %s option with votes and emits its choice id', (variant) => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render([option({ choiceId: 'c1', voteCount: 1, percentage: 100 }), option({ choiceId: 'c2', voteCount: 0 })], variant);
      const emitted: string[] = [];
      fixture.componentInstance.viewVoters.subscribe((choiceId) => emitted.push(choiceId));

      expect(viewLink('c1')?.textContent).toContain('View 1 voter');
      expect(viewLink('c2')).toBeNull();
      viewLink('c1')!.click();
      expect(emitted).toEqual(['c1']);
    });
  });
});
