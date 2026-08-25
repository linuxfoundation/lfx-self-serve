// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TableComponent } from '@components/table/table.component';
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

  it('keeps the range count and the paginator report visible in unread view — the server total is exact', async () => {
    setMentions([baseMention('m1')]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-count"]')).not.toBeNull();

    fixture.componentRef.setInput('unreadView', true);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="mentions-list-count"]')).not.toBeNull();
    const table = fixture.debugElement.query(By.directive(TableComponent)).componentInstance as TableComponent;
    expect(table.showCurrentPageReport()).toBe(true);
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
    expect(allRead.textContent).toContain('No unread mentions in this period.');
  });
});
