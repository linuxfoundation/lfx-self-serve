// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { formatDate } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    poll_type: PollType.GENERIC,
    total_voting_request_invitations: 12,
    poll_questions: [{ question_id: 'question-1', prompt: 'Approve the roadmap?', type: 'single_choice', choices: [] }],
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
  });

  function render(vote: Vote = makeVote(), commentPromptCount: number | null = null): void {
    fixture = TestBed.createComponent(VoteDetailFactsComponent);
    fixture.componentRef.setInput('vote', vote);
    fixture.componentRef.setInput('commentPromptCount', commentPromptCount);
    fixture.detectChanges();
  }

  const value = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"] dd`)?.textContent ?? '').trim();
  const label = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"] dt`)?.textContent ?? '').trim();
  const exists = (id: string): boolean => fixture.nativeElement.querySelector(`[data-testid="vote-detail-facts-${id}"]`) !== null;
  const rowIds = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-facts-details"] dl > [data-testid]') as NodeListOf<HTMLElement>).map((row) =>
      (row.getAttribute('data-testid') ?? '').replace('vote-detail-facts-', '')
    );

  it('lists every vote fact in one Vote details card, in order', () => {
    render();

    expect(rowIds()).toEqual(['created', 'group', 'method', 'close-date', 'invited', 'vote-questions', 'comments', 'comment-prompts']);
    expect(label('created')).toBe('Created');
    expect(value('created')).toBe('Oct 8, 2026 9:00 AM UTC');
    expect(value('group')).toBe('Synthetic Steering Committee');
    expect(value('method')).toBe('Plurality vote');
    expect(value('close-date')).toBe('Closes Oct 30, 2026 4:00 PM UTC');
    expect(value('invited')).toBe('12 invited voters');
    expect(value('vote-questions')).toBe('1');
    expect(label('comments')).toBe('Comments');
    expect(value('comments')).toBe('Active');
    expect(label('comment-prompts')).toBe('Comment prompts');
    expect(value('comment-prompts')).toBe('1');
  });

  it('renders no Visibility at a glance card, rules or popover trigger', () => {
    render();

    expect(fixture.nativeElement.querySelectorAll('lfx-card').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-testid^="vote-detail-facts-visibility"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Visibility at a glance');
    expect(fixture.nativeElement.textContent).not.toContain('More about visibility');
  });

  it('falls back to a dash for a missing created date and to labels for an unknown group or method', () => {
    render(makeVote({ creation_time: undefined, committee_name: undefined, poll_type: undefined }));

    expect(value('created')).toBe('—');
    expect(value('group')).toBe('Unknown group');
    expect(value('method')).toBe('Plurality vote');
  });

  describe('created date timezone', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each([
      ['server', 'Pacific/Auckland', '2026-10-01T12:00:00Z', 'Oct 1, 2026'],
      ['server', 'America/Los_Angeles', '2026-10-01T00:30:00Z', 'Oct 1, 2026'],
      ['browser', 'Pacific/Auckland', '2026-10-01T12:00:00Z', 'Oct 2, 2026'],
      ['browser', 'America/Los_Angeles', '2026-10-01T00:30:00Z', 'Sep 30, 2026'],
      ['browser', 'America/Los_Angeles', '2026-07-01T07:30:00Z', 'Jul 1, 2026'],
      ['browser', 'America/Los_Angeles', '2026-01-01T07:30:00Z', 'Dec 31, 2025'],
    ])('formats Created on %s with host zone %s at %s', (platform, timezone, creationTime, expected) => {
      vi.stubEnv('TZ', timezone);
      TestBed.overrideProvider(PLATFORM_ID, { useValue: platform });
      render(makeVote({ status: PollStatus.ENDED, creation_time: creationTime }));

      expect(value('created')).toContain(expected);
    });
  });

  it('labels a majority vote as majority, not as a ranked method', () => {
    render(makeVote({ poll_type: PollType.MAJORITY }));

    expect(value('method')).toBe('Majority vote');
  });

  describe('counts (#5022)', () => {
    const question = (n: number) => ({ question_id: `question-${n}`, prompt: `Synthetic question ${n}?`, type: 'single_choice', choices: [] });
    const prompt = (n: number) => ({ prompt_id: `prompt-${n}`, prompt: `Synthetic prompt ${n}?` });

    it.each([
      [0, 1],
      [1, 3],
      [3, 2],
    ])('counts %s voting questions and %s comment prompts independently', (questions, prompts) => {
      render(
        makeVote({
          poll_questions: Array.from({ length: questions }, (_, i) => question(i + 1)),
          poll_comment_prompts: Array.from({ length: prompts }, (_, i) => prompt(i + 1)),
        })
      );

      expect(value('vote-questions')).toBe(String(questions));
      expect(value('comment-prompts')).toBe(String(prompts));
    });

    it('shows a dash, not zero, when voting-question metadata is missing', () => {
      render(makeVote({ poll_questions: undefined }));

      expect(value('vote-questions')).toBe('—');
    });

    it('hides both comment rows when comments are not enabled, keeping the question count', () => {
      render(makeVote({ poll_comment_prompts: [] }));

      expect(exists('comments')).toBe(false);
      expect(exists('comment-prompts')).toBe(false);
      expect(value('vote-questions')).toBe('1');
    });

    it('counts configured prompts even when no one has written a response', () => {
      render(makeVote({ poll_comment_prompts: [prompt(1), prompt(2)], num_response_received: 0 }));

      expect(value('comments')).toBe('Active');
      expect(value('comment-prompts')).toBe('2');
    });

    it.each([PollStatus.ACTIVE, PollStatus.ENDED])('reads Comments: Active from the comment configuration on a %s vote', (status) => {
      render(makeVote({ status }));

      expect(value('comments')).toBe('Active');
    });

    it.each([1, 2])('uses the page-resolved count for %s result-only comment prompts', (count) => {
      render(makeVote({ poll_comment_prompts: [] }), count);

      expect(value('comments')).toBe('Active');
      expect(value('comment-prompts')).toBe(String(count));

      fixture.componentRef.setInput('commentPromptCount', 0);
      fixture.detectChanges();
      expect(exists('comments')).toBe(false);
      expect(exists('comment-prompts')).toBe(false);
    });

    it('prefers the page-resolved prompt count over the vote metadata', () => {
      render(makeVote({ poll_comment_prompts: [prompt(1)] }), 3);

      expect(value('comment-prompts')).toBe('3');
    });
  });

  describe('invited voters', () => {
    it.each([
      [0, '0 invited voters'],
      [1, '1 invited voter'],
      [12, '12 invited voters'],
    ])('shows a known total of %s', (invited, expected) => {
      render(makeVote({ total_voting_request_invitations: invited }));

      expect(value('invited')).toBe(expected);
    });

    it.each([undefined, null])('hides an unknown total (%s)', (invited) => {
      render({ ...makeVote(), total_voting_request_invitations: invited as unknown as number });

      expect(exists('invited')).toBe(false);
    });
  });

  describe('close date', () => {
    it('labels a closed pseudo-anonymous vote without an early close', () => {
      render(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true }));

      expect(value('close-date')).toMatch(/^Closed /);
      expect(exists('ended-early')).toBe(false);
    });

    it('notes an early close without claiming full participation', () => {
      render(
        makeVote({
          status: PollStatus.ENDED,
          early_end_time: '2026-10-20T12:00:00Z',
          total_voting_request_invitations: 10,
          num_response_received: 3,
        })
      );

      expect(value('close-date')).toMatch(/^Closed /);
      expect(value('ended-early')).toBe(`Vote closed early on ${formatDate('2026-10-20T12:00:00Z', 'MMM d, y', 'en-US')}.`);
    });

    it.each([
      [PollStatus.ENDED, '2026-10-20T12:00:00Z', '2026-10-30T16:00:00Z', 'Closed Oct 20, 2026 12:00 PM UTC'],
      ['Ended' as PollStatus, '2026-10-20T12:00:00Z', '2026-10-30T16:00:00Z', 'Closed Oct 20, 2026 12:00 PM UTC'],
      [PollStatus.ENDED, undefined, '2026-10-30T16:00:00Z', 'Closed Oct 30, 2026 4:00 PM UTC'],
      [PollStatus.ENDED, '', '2026-10-30T16:00:00Z', 'Closed Oct 30, 2026 4:00 PM UTC'],
      [PollStatus.ENDED, '2026-10-20T12:00:00Z', '', 'Closed Oct 20, 2026 12:00 PM UTC'],
      [PollStatus.ACTIVE, '2026-10-20T12:00:00Z', '2026-10-30T16:00:00Z', 'Closes Oct 30, 2026 4:00 PM UTC'],
    ] as const)('formats the %s close date with early time %s and deadline %s', (status, earlyEndTime, endTime, expected) => {
      render(makeVote({ status, early_end_time: earlyEndTime, end_time: endTime }));

      expect(value('close-date')).toBe(expected);
    });

    it.each([
      [PollStatus.ENDED, undefined],
      [PollStatus.ACTIVE, '2026-10-20T12:00:00Z'],
    ] as const)('hides the close date row when a %s vote has no usable time (early %s)', (status, earlyEndTime) => {
      render(makeVote({ status, early_end_time: earlyEndTime, end_time: '' }));

      expect(exists('close-date')).toBe(false);
      expect(exists('time-remaining')).toBe(false);
    });

    it('updates the close date when the vote ends early', () => {
      render();
      expect(value('close-date')).toBe('Closes Oct 30, 2026 4:00 PM UTC');

      fixture.componentRef.setInput('vote', makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-20T12:00:00Z' }));
      fixture.detectChanges();

      expect(value('close-date')).toBe('Closed Oct 20, 2026 12:00 PM UTC');
      expect(value('ended-early')).toBe(`Vote closed early on ${formatDate('2026-10-20T12:00:00Z', 'MMM d, y', 'en-US')}.`);
    });

    it('exposes the full closing time zone to screen readers', () => {
      render();
      const closeDate: HTMLElement = fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-close-date"] [role="note"]');

      expect(closeDate.getAttribute('tabindex')).toBe('0');
      expect(closeDate.getAttribute('aria-label')).toBe('Closes Oct 30, 2026 4:00 PM UTC (Coordinated Universal Time)');

      fixture.componentRef.setInput('vote', makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-20T12:00:00Z' }));
      fixture.detectChanges();

      expect(closeDate.getAttribute('aria-label')).toBe('Closed Oct 20, 2026 12:00 PM UTC (Coordinated Universal Time)');
    });

    it('lets long values wrap inside the card', () => {
      render(makeVote({ committee_name: 'Synthetic '.repeat(40) }));
      const groupValue: HTMLElement = fixture.nativeElement.querySelector('[data-testid="vote-detail-facts-group"] dd');

      expect(groupValue.classList).toContain('min-w-0');
      expect(groupValue.classList).toContain('break-words');
    });
  });

  describe('time remaining (#4767)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-26T16:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows how long an active vote has left, beside the unchanged close date', () => {
      render();

      expect(label('time-remaining')).toBe('Time remaining');
      expect(value('time-remaining')).toBe('Closes in 4 days');
      expect(value('close-date')).toBe('Closes Oct 30, 2026 4:00 PM UTC');
    });

    it('shows no time remaining for an ended vote', () => {
      render(makeVote({ status: PollStatus.ENDED }));

      expect(exists('time-remaining')).toBe(false);
    });

    it.each(['2026-10-20T16:00:00Z', '2026-10-26T15:00:00Z', '2026-10-26T16:00:00Z'])('shows no time remaining at or after the deadline (%s)', (endTime) => {
      render(makeVote({ end_time: endTime }));

      expect(exists('time-remaining')).toBe(false);
    });

    it('still shows time remaining for a deadline later today', () => {
      render(makeVote({ end_time: '2026-10-26T17:00:00Z' }));

      expect(value('time-remaining')).toBe('Closes today');
    });
  });

  describe('mounted countdown clock (#4767)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.stubEnv('TZ', 'UTC');
      vi.setSystemTime(new Date('2026-10-26T16:00:00Z'));
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'browser' });
    });

    afterEach(() => {
      fixture.destroy();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    // Flush scheduled zoneless rendering, not fixture.detectChanges: elapsed time must update the DOM itself.
    async function tick(ms: number): Promise<void> {
      await vi.advanceTimersByTimeAsync(ms);
      await fixture.whenStable();
    }

    it('removes the countdown when the mounted vote reaches its deadline', async () => {
      render(makeVote({ end_time: '2026-10-26T16:00:01Z' }));
      await fixture.whenStable();
      expect(value('time-remaining')).toBe('Closes today');

      await tick(999);
      expect(exists('time-remaining')).toBe(true);
      await tick(2);

      expect(exists('time-remaining')).toBe(false);
      expect(value('close-date')).toBe('Closes Oct 26, 2026 4:00 PM UTC');
    });

    it('refreshes the relative label at midnight without changing vote inputs', async () => {
      vi.setSystemTime(new Date('2026-10-26T23:59:59Z'));
      render(makeVote({ end_time: '2026-10-28T16:00:00Z' }));
      await fixture.whenStable();
      expect(value('time-remaining')).toBe('Closes in 2 days');

      await tick(1_001);

      expect(value('time-remaining')).toBe('Closes tomorrow');
    });

    it('uses the viewer-local midnight across a daylight-saving transition', async () => {
      vi.stubEnv('TZ', 'America/New_York');
      vi.setSystemTime(new Date('2026-03-08T05:00:00Z')); // Midnight EST; the next midnight is only 23 hours away.
      render(makeVote({ end_time: '2026-03-09T16:00:00Z' }));
      await fixture.whenStable();
      expect(value('time-remaining')).toBe('Closes tomorrow');

      await tick(23 * 60 * 60 * 1_000 + 1);

      expect(value('time-remaining')).toBe('Closes today');
    });

    it('reschedules expiry when the deadline changes on the mounted card', async () => {
      render(makeVote({ end_time: '2026-10-26T16:00:01Z' }));
      await fixture.whenStable();
      fixture.componentRef.setInput('vote', makeVote({ end_time: '2026-10-26T16:00:02Z' }));
      await tick(1);

      await tick(1_000);
      expect(value('time-remaining')).toBe('Closes today');
      await tick(1_000);

      expect(exists('time-remaining')).toBe(false);
    });

    it('cancels the clock when the vote ends early', async () => {
      render();
      await fixture.whenStable();
      fixture.componentRef.setInput('vote', makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-26T16:00:00Z' }));
      await tick(1);

      expect(exists('time-remaining')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('cleans up the pending countdown timeout when destroyed', async () => {
      render();
      await fixture.whenStable();
      expect(vi.getTimerCount()).toBe(1);

      fixture.destroy();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not schedule a countdown timeout during SSR', async () => {
      TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
      render();
      await fixture.whenStable();

      expect(value('time-remaining')).toBe('Closes in 4 days');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
