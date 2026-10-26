// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VoteParticipationStats } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteAbstainResultComponent } from './vote-abstain-result.component';

function stats(abstainedVoters: number, abstainedRate: number): VoteParticipationStats {
  return { eligibleVoters: 10, totalResponses: 5, participationRate: 50, abstainedVoters, abstainedRate };
}

describe('VoteAbstainResultComponent', () => {
  let fixture: ComponentFixture<VoteAbstainResultComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteAbstainResultComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteAbstainResultComponent);
  });

  function render(value: VoteParticipationStats, variant?: 'live' | 'final', testId?: string): HTMLElement | null {
    fixture.componentRef.setInput('stats', value);
    if (variant) fixture.componentRef.setInput('variant', variant);
    if (testId) fixture.componentRef.setInput('testId', testId);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector(`[data-testid="${testId ?? 'vote-results-option-abstain'}"]`);
  }

  const text = (el: HTMLElement | null): string => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('renders the live row with the count, rate and a slate-300 bar', () => {
    const row = render(stats(1, 20), 'live');

    expect(text(row)).toBe('Abstain 1 abstention · 20%');
    expect(row?.querySelector<HTMLElement>('.bg-slate-300')?.style.width).toBe('20%');
    expect(row?.classList).not.toContain('rounded-lg');
  });

  it('renders the final card with the rate in parentheses and a white track', () => {
    const row = render(stats(2, 40), 'final');

    expect(text(row)).toBe('Abstain 2 abstentions (40%)');
    expect(row?.classList).toContain('rounded-lg');
    const bar = row?.querySelector<HTMLElement>('.bg-slate-400');
    expect(bar?.style.width).toBe('40%');
    expect(bar?.parentElement?.classList).toContain('bg-white');
  });

  it('pluralizes abstentions', () => {
    expect(text(render(stats(1, 10)))).toContain('1 abstention ');
    expect(text(render(stats(0, 0)))).toContain('0 abstentions');
  });

  it('defaults to the final variant and the creator test id', () => {
    const row = render(stats(1, 20));

    expect(row).toBeTruthy();
    expect(row?.classList).toContain('rounded-lg');
  });

  it('applies the given test id', () => {
    expect(render(stats(1, 20), 'final', 'vote-results-voter-option-abstain')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="vote-results-option-abstain"]')).toBeNull();
  });

  describe('voter links (#3914)', () => {
    const viewLink = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('[data-testid="vote-results-option-abstain-view-voters"] button');

    it('renders no link by default', () => {
      render(stats(2, 40), 'final');

      expect(viewLink()).toBeNull();
    });

    it('links the abstentions when shown, and emits on click', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(stats(2, 40), 'live');
      let emitted = 0;
      fixture.componentInstance.viewVoters.subscribe(() => (emitted += 1));

      expect(viewLink()?.textContent).toContain('View 2 voters');
      viewLink()!.click();
      expect(emitted).toBe(1);
    });

    it('renders no link when nobody abstained', () => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(stats(0, 0), 'final');

      expect(viewLink()).toBeNull();
    });
  });
});
