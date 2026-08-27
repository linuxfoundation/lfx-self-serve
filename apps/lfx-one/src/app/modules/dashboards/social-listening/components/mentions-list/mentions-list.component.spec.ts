// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Mention } from '@lfx-one/shared/interfaces';

import { MentionCardComponent } from '../mention-card/mention-card.component';

import { MentionsListComponent } from './mentions-list.component';

/** List bookmark wiring (LFXV2-3002 Block 1): per-row `isBookmarked` decoration and the card → page re-emission. */
describe('MentionsListComponent', () => {
  function baseMention(id: string): Mention {
    return {
      id,
      platform: 'reddit',
      keyword: 'kubernetes',
      sourceProjectName: 'Kubernetes',
      timestamp: '2026-08-01T00:00:00Z',
      authorName: 'Jane Doe',
      authorProfileLink: 'https://reddit.com/u/jane',
      title: 'A mention',
      content: 'body text',
      analysis: '',
      sentiment: 'neutral',
      relevance: 'low',
      tags: ['ai'],
      originalUrl: `https://reddit.com/r/kubernetes/comments/${id}`,
      imageUrl: '',
      subreddit: 'kubernetes',
      language: 'en',
      raw: {} as Mention['raw'],
    };
  }

  let fixture: ComponentFixture<MentionsListComponent>;

  beforeEach(async () => {
    // provideRouter: the header's lfx-button imports RouterModule, and its <a> branch instantiates RouterLink.
    await TestBed.configureTestingModule({ imports: [MentionsListComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(MentionsListComponent);
  });

  function setMentions(mentions: Mention[]): void {
    fixture.componentRef.setInput('mentions', mentions);
    fixture.componentRef.setInput('totalMentions', mentions.length);
    // Mirror the parent: everything handed down is loaded, and the reachable total tracks it until the offset cap bites.
    fixture.componentRef.setInput('loadedCount', mentions.length);
    fixture.componentRef.setInput('servableTotal', mentions.length);
  }

  function cards(): MentionCardComponent[] {
    return fixture.debugElement.queryAll(By.directive(MentionCardComponent)).map((el) => el.componentInstance as MentionCardComponent);
  }

  it('decorates each card from the bookmarked ID set and re-derives when the set changes', async () => {
    setMentions([baseMention('m1'), baseMention('m2')]);
    fixture.componentRef.setInput('bookmarkedIds', new Set(['m1']));
    await fixture.whenStable();

    expect(cards().map((card) => card.isBookmarked())).toEqual([true, false]);

    fixture.componentRef.setInput('bookmarkedIds', new Set(['m2']));
    await fixture.whenStable();

    expect(cards().map((card) => card.isBookmarked())).toEqual([false, true]);
  });

  it('re-emits a card bookmark toggle as its own output', async () => {
    const mention = baseMention('m1');
    setMentions([mention]);
    await fixture.whenStable();

    const emitted: Mention[] = [];
    fixture.componentInstance.bookmarkToggled.subscribe((m) => emitted.push(m));

    cards()[0].bookmarkToggled.emit(mention);

    expect(emitted).toEqual([mention]);
  });

  it('defaults to an empty bookmark set — no card is decorated', async () => {
    setMentions([baseMention('m1')]);
    await fixture.whenStable();

    expect(cards().map((card) => card.isBookmarked())).toEqual([false]);
  });

  it('decorates each card from the read ID set', async () => {
    setMentions([baseMention('m1'), baseMention('m2')]);
    fixture.componentRef.setInput('readMentionIds', new Set(['m2']));
    await fixture.whenStable();

    expect(cards().map((card) => card.isRead())).toEqual([false, true]);
  });

  it('re-emits a card read toggle as its own output', async () => {
    const mention = baseMention('m1');
    setMentions([mention]);
    await fixture.whenStable();

    const emitted: Mention[] = [];
    fixture.componentInstance.readToggled.subscribe((m) => emitted.push(m));

    cards()[0].readToggled.emit(mention);

    expect(emitted).toEqual([mention]);
  });

  it('emits markAllRead / markAllUnread from the header buttons', async () => {
    setMentions([baseMention('m1')]);
    await fixture.whenStable();

    const events: string[] = [];
    fixture.componentInstance.markAllRead.subscribe(() => events.push('read'));
    fixture.componentInstance.markAllUnread.subscribe(() => events.push('unread'));

    // data-testid lands on the lfx-button host; the native button PrimeNG renders sits inside it.
    (fixture.nativeElement.querySelector('[data-testid="mentions-list-mark-all-read"] button') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('[data-testid="mentions-list-mark-all-unread"] button') as HTMLButtonElement).click();

    expect(events).toEqual(['read', 'unread']);
  });

  it('hides the mark-all buttons while loading or empty', async () => {
    setMentions([baseMention('m1')]);
    fixture.componentRef.setInput('loading', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-mark-all-read"]')).toBeNull();

    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('totalMentions', 0);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-mark-all-read"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-mark-all-unread"]')).toBeNull();
  });

  it('keeps the range count visible in unread view — the server total is exact', async () => {
    setMentions([baseMention('m1')]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-count"]')).not.toBeNull();

    fixture.componentRef.setInput('unreadView', true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-count"]')).not.toBeNull();
  });

  it('hides the Load More control once the feed is exhausted', async () => {
    setMentions([baseMention('m1')]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-load-more"]')).toBeNull();

    fixture.componentRef.setInput('hasMore', true);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-load-more"]')).not.toBeNull();
  });

  it('emits loadMore when the advance control is clicked', async () => {
    setMentions([baseMention('m1')]);
    fixture.componentRef.setInput('hasMore', true);
    await fixture.whenStable();

    let emitted = 0;
    fixture.componentInstance.loadMore.subscribe(() => (emitted += 1));
    (fixture.nativeElement.querySelector('[data-testid="mentions-list-load-more"]') as HTMLButtonElement).click();

    expect(emitted).toBe(1);
  });

  it('spins and locks the advance control while a Load More fetch is in flight', async () => {
    setMentions([baseMention('m1')]);
    fixture.componentRef.setInput('hasMore', true);
    fixture.componentRef.setInput('loadingMore', true);
    await fixture.whenStable();

    const button = fixture.nativeElement.querySelector('[data-testid="mentions-list-load-more"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.querySelector('.fa-spinner-third')).not.toBeNull();
  });

  it('drops the reachable total from the running count when the count request failed', async () => {
    setMentions([baseMention('m1')]);
    fixture.componentRef.setInput('hasMore', true);
    fixture.componentRef.setInput('servableTotal', 500);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-showing"]').textContent).toContain('1 of 500');

    fixture.componentRef.setInput('countError', true);
    await fixture.whenStable();

    const showing = fixture.nativeElement.querySelector('[data-testid="mentions-list-showing"]').textContent;
    expect(showing).toContain('Showing 1 mentions');
    expect(showing).not.toContain('500');
  });

  it('swaps the empty state for all-caught-up copy in unread view', async () => {
    setMentions([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-empty-state"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-all-read-state"]')).toBeNull();

    fixture.componentRef.setInput('unreadView', true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-empty-state"]')).toBeNull();
    const allRead = fixture.nativeElement.querySelector('[data-testid="mentions-list-all-read-state"]');
    expect(allRead).not.toBeNull();
    expect(allRead.textContent).toContain('No unread mentions match the current filters.');
  });

  it('offers a one-click filter reset from the empty state', async () => {
    setMentions([]);
    await fixture.whenStable();

    let emitted = 0;
    fixture.componentInstance.clearFilters.subscribe(() => (emitted += 1));
    (fixture.nativeElement.querySelector('[data-testid="mentions-list-empty-state"] button') as HTMLButtonElement).click();

    expect(emitted).toBe(1);
  });
});
