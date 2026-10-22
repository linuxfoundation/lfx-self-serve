// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VOTE_DETAIL_TABS } from '@lfx-one/shared/constants';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteDetailHeaderComponent } from './vote-detail-header.component';

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Synthetic roadmap approval',
    status: PollStatus.ACTIVE,
    end_time: '2026-10-30T16:00:00Z',
    project_uid: 'proj-1',
    committee_name: 'Synthetic Steering Committee',
    poll_type: PollType.GENERIC,
    total_voting_request_invitations: 12,
    ...overrides,
  } as Vote;
}

describe('VoteDetailHeaderComponent', () => {
  let fixture: ComponentFixture<VoteDetailHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VoteDetailHeaderComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteDetailHeaderComponent);
  });

  function render(inputs: { vote?: Vote; audience?: 'voter' | 'creator'; canCastVote?: boolean } = {}): void {
    fixture.componentRef.setInput('vote', inputs.vote ?? makeVote());
    fixture.componentRef.setInput('audience', inputs.audience ?? 'voter');
    fixture.componentRef.setInput('canCastVote', inputs.canCastVote ?? false);
    fixture.componentRef.setInput('activeTab', 'overview');
    fixture.componentRef.setInput('tabs', VOTE_DETAIL_TABS);
    fixture.detectChanges();
  }

  const text = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').trim();
  const exists = (id: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  it('renders the title, status, group, method, privacy, close date and invited voters', () => {
    render();

    expect(text('vote-detail-header-title')).toBe('Synthetic roadmap approval');
    expect(text('vote-detail-header-status')).toContain('Active');
    expect(text('vote-detail-header-group')).toContain('Synthetic Steering Committee');
    expect(text('vote-detail-header-method')).toContain('Plurality Vote');
    expect(text('vote-detail-header-privacy')).toContain('Named ballot');
    expect(text('vote-detail-header-close-date')).toMatch(/^Closes /);
    expect(text('vote-detail-header-invited')).toBe('12 invited voters');
  });

  it('labels a majority vote as majority, not as a ranked method', () => {
    render({ vote: makeVote({ poll_type: PollType.MAJORITY }) });

    expect(text('vote-detail-header-method')).toBe('Majority Vote');
  });

  it('labels a pseudo-anonymous ended vote', () => {
    render({ vote: makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true, total_voting_request_invitations: 1 }) });

    expect(text('vote-detail-header-privacy')).toContain('Pseudo-anonymous ballot');
    expect(text('vote-detail-header-close-date')).toMatch(/^Closed /);
    expect(text('vote-detail-header-invited')).toBe('1 invited voter');
    expect(exists('vote-detail-header-ended-early')).toBe(false);
  });

  it('notes an early close, since end_time stays the scheduled deadline', () => {
    render({ vote: makeVote({ status: PollStatus.ENDED, early_end_time: '2026-10-20T12:00:00Z' }) });

    expect(text('vote-detail-header-close-date')).toMatch(/^Closed /);
    expect(text('vote-detail-header-ended-early')).toBe('Vote closed early on Oct 20, 2026. All voters have responded.');
  });

  describe('actions', () => {
    it.each([
      ['creator', PollStatus.ACTIVE, true, true, true],
      ['creator', PollStatus.ACTIVE, false, true, false],
      ['creator', PollStatus.ENDED, false, false, false],
      ['voter', PollStatus.ACTIVE, true, false, true],
      ['voter', PollStatus.ACTIVE, false, false, false],
      ['voter', PollStatus.ENDED, false, false, false],
    ] as const)('%s on a %s vote (awaiting: %s) → reminder %s, cast %s', (audience, status, canCastVote, reminder, cast) => {
      render({ vote: makeVote({ status }), audience, canCastVote });

      expect(exists('vote-detail-header-send-reminder')).toBe(reminder);
      expect(exists('vote-detail-header-cast-vote')).toBe(cast);
      expect(exists('vote-detail-header-view-results')).toBe(true);
    });

    it('emits each action', () => {
      render({ audience: 'creator', canCastVote: true });
      const emitted: string[] = [];
      fixture.componentInstance.sendReminder.subscribe(() => emitted.push('reminder'));
      fixture.componentInstance.castVote.subscribe(() => emitted.push('cast'));
      fixture.componentInstance.viewResults.subscribe(() => emitted.push('results'));
      fixture.componentInstance.back.subscribe(() => emitted.push('back'));

      for (const id of ['send-reminder', 'cast-vote', 'view-results']) {
        fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-${id}"] button`).click();
      }
      fixture.nativeElement.querySelector('[data-testid="vote-detail-header-back"]').click();

      expect(emitted).toEqual(['reminder', 'cast', 'results', 'back']);
    });
  });

  it('renders the tab strip and emits the clicked tab', () => {
    render();
    const tabs: string[] = [];
    fixture.componentInstance.tabChange.subscribe((tab) => tabs.push(tab));

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-header-tab-overview"]').getAttribute('aria-selected')).toBe('true');
    fixture.nativeElement.querySelector('[data-testid="vote-detail-header-tab-comments"]').click();

    expect(tabs).toEqual(['comments']);
  });
});
