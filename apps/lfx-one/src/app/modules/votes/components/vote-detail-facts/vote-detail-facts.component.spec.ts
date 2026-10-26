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
    pseudo_anonymity: false,
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
    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-created"] dt').textContent.trim()).toBe('Created');
    expect(value('created')).not.toBe('—');
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

  it.each([1, 2])('uses the page-resolved count for %s result-only comment prompts', (count) => {
    fixture.componentRef.setInput('commentPromptCount', count);
    render(makeVote({ poll_comment_prompts: [] }));

    expect(value('comments')).toBe(`Optional · ${count} ${count === 1 ? 'prompt' : 'prompts'}`);

    fixture.componentRef.setInput('commentPromptCount', 0);
    fixture.detectChanges();
    expect(value('comments')).toBe('Not enabled');
  });

  it('notes an early close under the scheduled close date', () => {
    render(makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-20T12:00:00Z' }));

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-ended-early"]').textContent.trim()).toBe(
      'Vote closed early on Oct 20, 2026. All voters have responded.'
    );
  });

  it('shows the voter visibility copy', () => {
    render(makeVote());

    expect(rules()).toEqual(getVoteVisibilityRules('voter', false, false));
  });

  it('shows the manager visibility copy for a closed pseudo-anonymous vote', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), 'creator');

    expect(rules()).toEqual(getVoteVisibilityRules('creator', true, true));
  });

  it.each(['creator', 'voter'] as const)('shows pending visibility copy for %s until held results are released', (audience) => {
    fixture.componentRef.setInput('resultsHeld', true);
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), audience);

    expect(rules()[0]).toBe('Voting has closed. Totals and comments will appear once they are finalized.');
    expect(rules().join(' ')).not.toContain('see the final totals');
    expect(rules()).toContain('No one sees how another voter voted on this page.');

    fixture.componentRef.setInput('resultsHeld', false);
    fixture.detectChanges();
    expect(rules()[0]).toContain('see the final totals and comments.');
  });

  it('tells a manager of an open pseudo-anonymous vote that totals and comments wait for close (#3916)', () => {
    render(makeVote({ status: PollStatus.ACTIVE, pseudo_anonymity: true }), 'creator');

    expect(rules()[0]).toBe('As a manager, you can follow who has responded. Totals and comments appear when the vote closes.');
    expect(rules().join(' ')).not.toContain('live totals');
  });

  it.each<['voter' | 'creator', PollStatus]>([
    ['creator', PollStatus.ACTIVE],
    ['creator', PollStatus.ENDED],
    ['creator', PollStatus.DISABLED],
    ['voter', PollStatus.ACTIVE],
    ['voter', PollStatus.ENDED],
  ])('does not promise ballots to %s when privacy metadata is missing (%s)', (audience, status) => {
    render(makeVote({ status, pseudo_anonymity: undefined }), audience);

    expect(value('privacy')).toBe('Unavailable');
    expect(rules()).toContain('No one sees how another voter voted on this page.');
    expect(rules()).toContain('Ballot privacy information is unavailable.');
    expect(rules().join(' ')).not.toContain('Voters tab');
    expect(rules().join(' ')).not.toContain('can see each voter');
  });

  it.each<['voter' | 'creator', PollStatus]>([
    ['creator', PollStatus.ACTIVE],
    ['creator', PollStatus.ENDED],
    ['creator', PollStatus.DISABLED],
    ['voter', PollStatus.ACTIVE],
    ['voter', PollStatus.ENDED],
  ])('treats runtime null privacy as unavailable for %s (%s)', (audience, status) => {
    fixture.componentRef.setInput('vote', { ...makeVote({ status }), pseudo_anonymity: null });
    fixture.componentRef.setInput('audience', audience);
    fixture.detectChanges();

    expect(value('privacy')).toBe('Unavailable');
    expect(rules()).toContain('Ballot privacy information is unavailable.');
    expect(rules().join(' ')).not.toContain('Named ballot');
    expect(rules().join(' ')).not.toContain('Voters tab');
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('keeps the Voters tab available in the manager copy for a named %s vote', (status) => {
    render(makeVote({ status, pseudo_anonymity: false }), 'creator');

    expect(rules()).toContain("You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(rules().join(' ')).not.toContain('Once voting opens');
  });

  it('never describes a draft as closed', () => {
    render(makeVote({ status: PollStatus.DISABLED }), 'creator');

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-close"] dt').textContent.trim()).toBe('Closes');
    expect(rules()).toEqual(getVoteVisibilityRules('creator', false, false, false));
    expect(rules()).toContain("Once voting opens, you can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(rules()).not.toContain("You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(rules()).not.toContain('Invited voters now see the final totals and comments.');
    expect(rules().join(' ')).not.toContain('while the vote is open');
  });
});
