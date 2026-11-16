// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VoteParticipationStats } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteParticipationCardComponent } from './vote-participation-card.component';

/** Strips all whitespace: Angular drops inter-element whitespace, so adjacent elements' text runs together. */
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, '');

const STATS: VoteParticipationStats = { eligibleVoters: 12, totalResponses: 9, participationRate: 75, abstainedVoters: 2, abstainedRate: 22 };

describe('VoteParticipationCardComponent', () => {
  let fixture: ComponentFixture<VoteParticipationCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VoteParticipationCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(VoteParticipationCardComponent);
    fixture.componentRef.setInput('stats', STATS);
  });

  const card = (testId = 'vote-results-participation'): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('renders participants, responses, rate and the progress width', () => {
    fixture.detectChanges();

    const text = squash(card()?.textContent);
    expect(text).toContain(squash('Total Participants 12'));
    expect(text).toContain(squash('Total Responses 9'));
    expect(text).toContain(squash('Response Rate 75%'));
    expect(card()?.querySelector<HTMLElement>('.bg-blue-500')?.style.width).toBe('75%');
  });

  it('hides the Abstained stat by default and shows it when requested', () => {
    fixture.detectChanges();
    expect(card('vote-results-abstained-stat')).toBeNull();

    fixture.componentRef.setInput('showAbstained', true);
    fixture.detectChanges();
    expect(squash(card('vote-results-abstained-stat')?.textContent)).toBe(squash('Abstained 2'));
  });

  it('shows "—" for the abstention count while pseudo-anonymous results are held (#3916)', () => {
    fixture.componentRef.setInput('stats', { ...STATS, abstainedVoters: 0, abstainedRate: 0 });
    fixture.componentRef.setInput('showAbstained', true);
    fixture.componentRef.setInput('abstainedHeld', true);
    fixture.detectChanges();

    expect(card('vote-results-abstained-value')?.textContent?.trim()).toBe('—');
    expect(squash(card()?.textContent)).toContain(squash('Total Responses 9'));
  });

  it('applies the given test id', () => {
    fixture.componentRef.setInput('testId', 'vote-results-ranked-participation');
    fixture.detectChanges();

    expect(card('vote-results-ranked-participation')).toBeTruthy();
    expect(card()).toBeNull();
  });

  it('adds no layout box of its own', () => {
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).classList).toContain('contents');
  });
});
