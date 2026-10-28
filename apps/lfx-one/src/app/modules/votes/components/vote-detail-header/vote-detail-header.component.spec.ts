// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
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
    pseudo_anonymity: false,
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

  function render(inputs: { vote?: Vote; audience?: 'voter' | 'creator'; canCastVote?: boolean; limited?: boolean } = {}): void {
    fixture.componentRef.setInput('vote', inputs.vote ?? makeVote());
    fixture.componentRef.setInput('audience', inputs.audience ?? 'voter');
    fixture.componentRef.setInput('canCastVote', inputs.canCastVote ?? false);
    fixture.componentRef.setInput('limited', inputs.limited ?? false);
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

  it.each([undefined, null])('shows unavailable privacy for missing metadata (%s)', (privacy) => {
    const vote = makeVote();
    // A malformed/partial payload can carry null even though the typed contract does not.
    Object.assign(vote, { pseudo_anonymity: privacy });
    render({ vote });

    expect(text('vote-detail-header-privacy')).toBe('Ballot privacy unavailable');
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
    // Managers reach results from the Results tab, so only voters get View results (#4447).
    it.each([
      ['creator', PollStatus.ACTIVE, true, true, true, false],
      ['creator', PollStatus.ACTIVE, false, true, false, false],
      ['creator', PollStatus.ENDED, false, false, false, false],
      ['voter', PollStatus.ACTIVE, true, false, true, true],
      ['voter', PollStatus.ACTIVE, false, false, false, true],
      ['voter', PollStatus.ENDED, false, false, false, true],
    ] as const)('%s on a %s vote (awaiting: %s) → reminder %s, cast %s, view results %s', (audience, status, canCastVote, reminder, cast, viewResults) => {
      render({ vote: makeVote({ status }), audience, canCastVote });

      expect(exists('vote-detail-header-send-reminder')).toBe(reminder);
      expect(exists('vote-detail-header-cast-vote')).toBe(cast);
      expect(exists('vote-detail-header-view-results')).toBe(viewResults);
    });

    it('makes Send reminder the primary action for a manager on an open vote (#4447)', () => {
      render({ audience: 'creator' });
      const reminder = fixture.debugElement.query(By.css('[data-testid="vote-detail-header-send-reminder"]')).componentInstance as ButtonComponent;

      expect(reminder.outlined()).toBe(false);
      expect(reminder.severity()).toBeUndefined();
    });

    it('emits each manager action', () => {
      render({ audience: 'creator', canCastVote: true });
      const emitted: string[] = [];
      fixture.componentInstance.sendReminder.subscribe(() => emitted.push('reminder'));
      fixture.componentInstance.castVote.subscribe(() => emitted.push('cast'));
      fixture.componentInstance.back.subscribe(() => emitted.push('back'));

      for (const id of ['send-reminder', 'cast-vote']) {
        fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-${id}"] button`).click();
      }
      fixture.nativeElement.querySelector('[data-testid="vote-detail-header-back"]').click();

      expect(emitted).toEqual(['reminder', 'cast', 'back']);
    });

    it('emits each voter action', () => {
      render({ audience: 'voter', canCastVote: true });
      const emitted: string[] = [];
      fixture.componentInstance.castVote.subscribe(() => emitted.push('cast'));
      fixture.componentInstance.viewResults.subscribe(() => emitted.push('results'));

      for (const id of ['cast-vote', 'view-results']) {
        fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-${id}"] button`).click();
      }

      expect(emitted).toEqual(['cast', 'results']);
    });
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows only title, status and back navigation when limited on a %s vote (#4330)', (status) => {
    render({ limited: true, vote: makeVote({ status, early_end_time: '2026-10-20T12:00:00Z' }) });

    for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'view-results', 'tabs']) {
      expect(exists(`vote-detail-header-${suffix}`)).toBe(false);
    }
    expect(fixture.nativeElement.querySelector('[data-testid^="vote-detail-header-tab-"]')).toBeNull();
    expect(text('vote-detail-header-title')).toBe('Synthetic roadmap approval');
    expect(exists('vote-detail-header-status')).toBe(true);
    expect(exists('vote-detail-header-back')).toBe(true);
  });

  it('renders the tab strip and emits the clicked tab', () => {
    render();
    const tabs: string[] = [];
    fixture.componentInstance.tabChange.subscribe((tab) => tabs.push(tab));

    expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-header-tab-overview"]').getAttribute('aria-selected')).toBe('true');
    fixture.nativeElement.querySelector('[data-testid="vote-detail-header-tab-comments"]').click();

    expect(tabs).toEqual(['comments']);
  });

  it('keeps only the selected tab in the Tab order and points it at the page panel', () => {
    render();
    const tab = (key: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-tab-${key}"]`);

    expect(tab('overview').getAttribute('tabindex')).toBe('0');
    expect(tab('overview').id).toBe('vote-detail-tab-overview');
    expect(tab('overview').getAttribute('aria-controls')).toBe('vote-detail-tab-panel');
    expect(tab('results').getAttribute('tabindex')).toBe('-1');
    expect(tab('results').getAttribute('aria-controls')).toBeNull();
  });

  it('moves between tabs with the arrow, Home and End keys, wrapping at the ends', () => {
    render();
    const tabs: string[] = [];
    fixture.componentInstance.tabChange.subscribe((tab) => tabs.push(tab));
    const tablist: HTMLElement = fixture.nativeElement.querySelector('[data-testid="vote-detail-header-tabs"]');
    const press = (key: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      tablist.dispatchEvent(event);
      return event;
    };

    expect(press('ArrowRight').defaultPrevented).toBe(true);
    press('ArrowLeft');
    press('End');
    press('Home');
    expect(press('Tab').defaultPrevented).toBe(false);

    const keys = VOTE_DETAIL_TABS.map((option) => option.key);
    expect(tabs).toEqual([keys[1], keys[keys.length - 1], keys[keys.length - 1], keys[0]]);
  });

  it('moves from the focused tab when a second arrow lands before the selection catches up', () => {
    render();
    const tabs: string[] = [];
    fixture.componentInstance.tabChange.subscribe((tab) => tabs.push(tab));
    const keys = VOTE_DETAIL_TABS.map((option) => option.key);
    const tab = (key: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-tab-${key}"]`);

    // `activeTab` is still the first tab: the parent hasn't written `?tab=` yet.
    tab(keys[0]).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    tab(keys[1]).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

    expect(tabs).toEqual([keys[1], keys[2]]);
  });
});
