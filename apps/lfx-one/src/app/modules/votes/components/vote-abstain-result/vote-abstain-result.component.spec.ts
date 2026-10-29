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

  describe('voter links (#3914, #4450)', () => {
    const viewLink = (): HTMLButtonElement | null => fixture.nativeElement.querySelector('button[data-testid="vote-results-option-abstain-view-voters"]');

    it('renders no link by default', () => {
      render(stats(2, 40), 'final');

      expect(viewLink()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('2 abstentions');
    });

    it.each([
      ['live', 1, '1 abstention'],
      ['live', 2, '2 abstentions'],
      ['final', 1, '1 abstention'],
      ['final', 2, '2 abstentions'],
    ] as const)('makes the %s count of %i the link and includes its visible label in the accessible name', (variant, count, label) => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(stats(count, count * 20), variant);
      let emitted = 0;
      fixture.componentInstance.viewVoters.subscribe(() => (emitted += 1));

      expect(viewLink()?.textContent?.trim()).toBe(label);
      expect(viewLink()?.getAttribute('aria-label')).toBe(`${label}, view ${count === 1 ? 'voter' : 'voters'} who abstained`);
      viewLink()!.click();
      expect(emitted).toBe(1);
    });

    it.each(['live', 'final'] as const)('renders no link when nobody abstained in the %s variant', (variant) => {
      fixture.componentRef.setInput('showVoterLinks', true);
      render(stats(0, 0), variant);

      expect(viewLink()).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('0 abstentions');
    });
  });

  it.each(['live', 'final'] as const)('does not italicize the %s abstain label', (variant) => {
    render(stats(1, 20), variant);

    expect(fixture.nativeElement.querySelector('.italic')).toBeNull();
  });
});
