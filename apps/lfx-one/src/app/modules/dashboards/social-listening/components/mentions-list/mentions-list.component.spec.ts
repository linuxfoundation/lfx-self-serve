// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
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
    await TestBed.configureTestingModule({ imports: [MentionsListComponent] }).compileComponents();
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
});
