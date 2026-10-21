// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { getVoteVisibilityRules } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteDetailFactsComponent } from './vote-detail-facts.component';

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Synthetic roadmap approval',
    status: PollStatus.ACTIVE,
    creation_time: '2026-10-08T09:00:00Z',
    end_time: '2026-10-30T16:00:00Z',
    project_uid: 'proj-1',
    committee_name: 'Synthetic Steering Committee',
    poll_type: PollType.CONDORCET_IRV,
    total_voting_request_invitations: 12,
    poll_comment_prompts: [{ prompt_id: 'prompt-1', prompt: 'Any concerns?' }],
    ...overrides,
  } as Vote;
}

describe('VoteDetailFactsComponent', () => {
  let fixture: ComponentFixture<VoteDetailFactsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VoteDetailFactsComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteDetailFactsComponent);
  });

  function render(vote: Vote, audience: 'voter' | 'creator' = 'voter'): void {
    fixture.componentRef.setInput('vote', vote);
    fixture.componentRef.setInput('audience', audience);
    fixture.detectChanges();
  }

  const value = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"] dd`)?.textContent ?? '').trim();
  const rules = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-facts-visibility-rule"]') as NodeListOf<HTMLElement>).map((li) =>
      (li.textContent ?? '').trim()
    );

  it('lists the facts of a named ballot', () => {
    render(makeVote());

    expect(value('group')).toBe('Synthetic Steering Committee');
    expect(value('opened')).not.toBe('—');
    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-close"] dt').textContent.trim()).toBe('Closes');
    expect(value('method')).toBe('Ranked Choice (Condorcet IRV)');
    expect(value('electorate')).toBe('12 invited voters');
    expect(value('privacy')).toBe('Named');
    expect(value('comments')).toBe('Optional · 1 prompt');
  });

  it('lists the facts of a closed pseudo-anonymous ballot without comments', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true, poll_comment_prompts: [], total_voting_request_invitations: undefined }));

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-close"] dt').textContent.trim()).toBe('Closed');
    expect(value('privacy')).toBe('Pseudo-anonymous');
    expect(value('comments')).toBe('Not enabled');
    expect(value('electorate')).toBe('—');
    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-ended-early"]')).toBeNull();
  });

  it('notes an early close under the scheduled close date', () => {
    render(makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-20T12:00:00Z' }));

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-ended-early"]').textContent.trim()).toBe(
      'Vote closed early on Oct 20, 2026. All voters have responded.'
    );
  });

  it('shows the voter visibility copy', () => {
    render(makeVote());

    expect(rules()).toEqual(getVoteVisibilityRules('voter', false, true));
  });

  it('shows the manager visibility copy for a closed pseudo-anonymous vote', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), 'creator');

    expect(rules()).toEqual(getVoteVisibilityRules('creator', true, false));
  });
});
