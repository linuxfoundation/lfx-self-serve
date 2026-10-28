// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { getVoteVisibilityRules } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }, provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteDetailFactsComponent);
  });

  function render(vote: Vote, audience: 'voter' | 'creator' = 'voter'): void {
    fixture.componentRef.setInput('vote', vote);
    fixture.componentRef.setInput('audience', audience);
    fixture.detectChanges();
  }

  const value = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"] dd`)?.textContent ?? '').trim();
  const exists = (id: string): boolean => fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"]`) !== null;
  const headline = (): string => (fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-visibility-summary"]')?.textContent ?? '').trim();
  /** `p-popover` renders its content only while open, appended to the body — open it before reading the rules. */
  const openPopover = (): string[] => {
    fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-visibility-more"] button').click();
    fixture.detectChanges();
    return Array.from(document.body.querySelectorAll('[data-testid="vote-detail-facts-visibility-rule"]') as NodeListOf<HTMLElement>).map((li) =>
      (li.textContent ?? '').trim()
    );
  };

  it('lists only the facts the header does not show', () => {
    render(makeVote());

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-created"] dt').textContent.trim()).toBe('Created');
    expect(value('created')).not.toBe('—');
    expect(value('comments')).toBe('Optional · 1 question');
    for (const removed of ['group', 'close', 'ended-early', 'method', 'electorate', 'privacy']) {
      expect(exists(removed)).toBe(false);
    }
  });

  it('lists a closed pseudo-anonymous ballot without comments', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true, poll_comment_prompts: [], total_voting_request_invitations: undefined }));

    expect(value('comments')).toBe('Not enabled');
    expect(exists('ended-early')).toBe(false);
  });

  it.each([1, 2])('uses the page-resolved count for %s result-only comment prompts', (count) => {
    fixture.componentRef.setInput('commentPromptCount', count);
    render(makeVote({ poll_comment_prompts: [] }));

    expect(value('comments')).toBe(`Optional · ${count} ${count === 1 ? 'question' : 'questions'}`);

    fixture.componentRef.setInput('commentPromptCount', 0);
    fixture.detectChanges();
    expect(value('comments')).toBe('Not enabled');
  });

  it('shows the first voter rule as the headline', () => {
    render(makeVote());

    expect(headline()).toBe(getVoteVisibilityRules('voter', false, false)[0]);
  });

  it('shows the manager headline for a closed pseudo-anonymous vote', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), 'creator');

    expect(headline()).toBe(getVoteVisibilityRules('creator', true, true)[0]);
  });

  it('lists every rule, headline included, in the popover', () => {
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), 'creator');

    expect(document.body.querySelector('[data-testid="vote-detail-facts-visibility-rule"]')).toBeNull();
    expect(openPopover()).toEqual(getVoteVisibilityRules('creator', true, true));
  });

  it('exposes the visibility popover state on the native button', async () => {
    render(makeVote());
    const trigger = fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-visibility-more"] button') as HTMLButtonElement;

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('labels the visibility dialog, focuses its rules and returns focus on Escape', async () => {
    render(makeVote());
    const trigger = fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-visibility-more"] button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe('vote-detail-facts-visibility-rules');

    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = document.body.querySelector('[role="dialog"][aria-label="Visibility rules"]');
    expect(dialog).not.toBeNull();
    const rules = dialog!.querySelector('#vote-detail-facts-visibility-rules') as HTMLElement;
    await vi.waitFor(() => expect(document.activeElement).toBe(rules));

    rules.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"][aria-label="Visibility rules"]')).toBeNull());
  });

  it.each(['creator', 'voter'] as const)('shows pending visibility copy for %s until held results are released', (audience) => {
    fixture.componentRef.setInput('resultsHeld', true);
    render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }), audience);

    expect(headline()).toBe('Voting has closed. Totals and comments will appear once they are finalized.');
    expect(headline()).not.toContain('see the final totals');

    fixture.componentRef.setInput('resultsHeld', false);
    fixture.detectChanges();
    expect(headline()).toContain('see the final totals and comments.');
  });

  it('tells a manager of an open pseudo-anonymous vote that totals and comments wait for close (#3916)', () => {
    render(makeVote({ status: PollStatus.ACTIVE, pseudo_anonymity: true }), 'creator');

    expect(headline()).toBe('As a manager, you can follow who has responded. Totals and comments appear when the vote closes.');
    expect(headline()).not.toContain('live totals');
  });

  it.each<['voter' | 'creator', PollStatus, boolean | undefined | null]>([
    ['creator', PollStatus.ACTIVE, undefined],
    ['creator', PollStatus.ENDED, null],
    ['creator', PollStatus.DISABLED, undefined],
    ['voter', PollStatus.ACTIVE, null],
    ['voter', PollStatus.ENDED, undefined],
  ])('does not promise ballots or repeat privacy to %s when privacy metadata is missing (%s)', (audience, status, privacy) => {
    fixture.componentRef.setInput('vote', { ...makeVote({ status }), pseudo_anonymity: privacy });
    fixture.componentRef.setInput('audience', audience);
    fixture.detectChanges();

    const popoverRules = openPopover();
    expect(popoverRules).toContain('No one sees how another voter voted on this page.');
    expect(popoverRules.join(' ')).not.toContain('unavailable');
    expect(popoverRules.join(' ')).not.toContain('Voters tab');
    expect(popoverRules.join(' ')).not.toContain('can see each voter');
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('keeps the Voters tab available in the manager copy for a named %s vote', (status) => {
    render(makeVote({ status, pseudo_anonymity: false }), 'creator');

    const popoverRules = openPopover();
    expect(popoverRules).toContain("You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(popoverRules.join(' ')).not.toContain('Once voting opens');
  });

  it('never describes a draft as closed', () => {
    render(makeVote({ status: PollStatus.DISABLED }), 'creator');

    const popoverRules = openPopover();
    expect(popoverRules).toEqual(getVoteVisibilityRules('creator', false, false, false));
    expect(popoverRules).toContain("Once voting opens, you can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(popoverRules).not.toContain("You can see each voter's ballot on the Voters tab. Voters can't see each other's ballots.");
    expect(popoverRules).not.toContain('Invited voters now see the final totals and comments, without commenter names.');
    expect(popoverRules.join(' ')).not.toContain('while the vote is open');
  });
});
