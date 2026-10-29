// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import { VOTE_DETAIL_TABS } from '@lfx-one/shared/constants';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
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
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        // The real Send ballots button renders for managers; it only touches these once clicked.
        { provide: VoteService, useValue: {} },
        { provide: MessageService, useValue: { add: () => undefined } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteDetailHeaderComponent);
  });

  function render(
    inputs: {
      vote?: Vote;
      audience?: 'voter' | 'creator';
      canCastVote?: boolean;
      canPresent?: boolean;
      canSendBallots?: boolean;
      slideBusy?: boolean;
      limited?: boolean;
    } = {}
  ): void {
    fixture.componentRef.setInput('vote', inputs.vote ?? makeVote());
    fixture.componentRef.setInput('audience', inputs.audience ?? 'voter');
    fixture.componentRef.setInput('canCastVote', inputs.canCastVote ?? false);
    fixture.componentRef.setInput('canPresent', inputs.canPresent ?? false);
    fixture.componentRef.setInput('canSendBallots', inputs.canSendBallots ?? false);
    fixture.componentRef.setInput('slideBusy', inputs.slideBusy ?? false);
    fixture.componentRef.setInput('limited', inputs.limited ?? false);
    fixture.componentRef.setInput('activeTab', 'overview');
    fixture.componentRef.setInput('tabs', VOTE_DETAIL_TABS);
    fixture.detectChanges();
  }

  const text = (id: string): string => (fixture.nativeElement.querySelector(`[data-testid="${id}"]`)?.textContent ?? '').trim();
  const exists = (id: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  it('lets a long unbroken title shrink and wrap inside its flex row', () => {
    const name = 'a'.repeat(200);
    render({ vote: makeVote({ name }) });

    const title: HTMLElement = fixture.nativeElement.querySelector('[data-testid="vote-detail-header-title"]');
    expect(title.textContent?.trim()).toBe(name);
    expect(title.classList).toContain('min-w-0');
    expect(title.classList).toContain('max-w-full');
    expect(title.classList).toContain('break-words');
  });

  it('renders the title, status, group, method, privacy, close date and invited voters', () => {
    render();

    expect(text('vote-detail-header-title')).toBe('Synthetic roadmap approval');
    expect(text('vote-detail-header-status')).toContain('Active');
    expect(text('vote-detail-header-group')).toContain('Synthetic Steering Committee');
    expect(text('vote-detail-header-method')).toContain('Plurality vote');
    expect(text('vote-detail-header-privacy')).toContain('Named ballot');
    expect(text('vote-detail-header-close-date')).toMatch(/^Closes /);
    expect(text('vote-detail-header-invited')).toBe('12 invited voters');
  });

  it('renders group and method as plain meta-row text, not chips', () => {
    render();

    const meta = fixture.nativeElement.querySelector('[data-testid="vote-detail-header-meta"]') as HTMLElement;
    expect(meta.querySelector('[data-testid="vote-detail-header-group"]')?.textContent).toContain('Synthetic Steering Committee');
    expect(meta.querySelector('[data-testid="vote-detail-header-method"]')?.textContent).toContain('Plurality vote');
    expect(exists('vote-detail-header-tags')).toBe(false);
    expect(fixture.nativeElement.querySelector('lfx-tag[data-testid="vote-detail-header-group"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-tag[data-testid="vote-detail-header-method"]')).toBeNull();
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

    expect(text('vote-detail-header-method')).toBe('Majority vote');
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

    it('demotes Cast vote to secondary when a manager is also an invited voter, keeping one primary action (#4447)', () => {
      render({ audience: 'creator', canCastVote: true });
      const button = (id: string): ButtonComponent =>
        fixture.debugElement.query(By.css(`[data-testid="vote-detail-header-${id}"]`)).componentInstance as ButtonComponent;

      expect(button('send-reminder').outlined()).toBe(false);
      expect(button('send-reminder').severity()).toBeUndefined();
      expect(button('cast-vote').outlined()).toBe(true);
      expect(button('cast-vote').severity()).toBe('secondary');
    });

    it('keeps Cast vote primary for a voter', () => {
      render({ audience: 'voter', canCastVote: true });
      const cast = fixture.debugElement.query(By.css('[data-testid="vote-detail-header-cast-vote"]')).componentInstance as ButtonComponent;

      expect(cast.outlined()).toBe(false);
      expect(cast.severity()).toBeUndefined();
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

    it.each([
      [true, true],
      [true, false],
      [false, false],
    ])('canPresent=%s, canSendBallots=%s → Present/Copy slide follow canPresent, Send ballots follows canSendBallots', (canPresent, canSendBallots) => {
      render({ audience: 'creator', canPresent, canSendBallots });

      expect(exists('vote-detail-header-present')).toBe(canPresent);
      expect(exists('vote-detail-header-copy-slide')).toBe(canPresent);
      expect(exists('vote-detail-header-send-ballots')).toBe(canSendBallots);
    });

    it('hides Present, Copy slide and Send ballots while limited', () => {
      render({ audience: 'creator', canPresent: true, canSendBallots: true, limited: true });

      for (const id of ['present', 'copy-slide', 'send-ballots']) {
        expect(exists(`vote-detail-header-${id}`)).toBe(false);
      }
    });

    it('emits Present and Copy slide', () => {
      render({ audience: 'creator', canPresent: true });
      const emitted: string[] = [];
      fixture.componentInstance.present.subscribe(() => emitted.push('present'));
      fixture.componentInstance.copySlide.subscribe(() => emitted.push('copy-slide'));

      for (const id of ['present', 'copy-slide']) {
        fixture.nativeElement.querySelector(`[data-testid="vote-detail-header-${id}"] button`).click();
      }

      expect(emitted).toEqual(['present', 'copy-slide']);
    });

    it.each([true, false])('shows Copy slide as loading=%s while the export runs', (slideBusy) => {
      render({ audience: 'creator', canPresent: true, slideBusy });
      const copy = fixture.debugElement.query(By.css('[data-testid="vote-detail-header-copy-slide"]')).componentInstance as ButtonComponent;

      expect(copy.loading()).toBe(slideBusy);
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
