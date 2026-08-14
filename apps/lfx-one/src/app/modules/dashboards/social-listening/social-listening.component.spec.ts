// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { SocialListeningService } from '@services/social-listening.service';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Mention,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningMention,
  SocialListeningQueryParams,
} from '@lfx-one/shared/interfaces';

import { SocialListeningComponent } from './social-listening.component';

/**
 * Container-level coverage for the two things the child specs cannot see: the windowed pagination
 * arithmetic (windowIndex/serverOffset/localOffset, ±2-window cache eviction) and the bidirectional
 * query-param sync. The template is blanked out — nothing here needs the rendered tree.
 */
describe('SocialListeningComponent', () => {
  const FOUNDATION = { uid: 'f1', name: 'CNCF', slug: 'cncf' };

  let fixture: ComponentFixture<SocialListeningComponent>;
  let getMentionsFeed: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let queryParams$: BehaviorSubject<SocialListeningQueryParams>;
  /** What the URL currently holds — the navigate stub writes it, the snapshot getter reads it. */
  let currentParams: SocialListeningQueryParams;

  function rawMention(id: string): SocialListeningMention {
    return { MENTION_ID: id, MENTION_TS: '2026-08-01T00:00:00Z' } as SocialListeningMention;
  }

  /** A full page/window of fake rows, id'd by absolute offset so slices are identifiable. */
  function feedResponse(req: SocialListeningFeedRequest): SocialListeningFeedResponse {
    const limit = req.limit ?? 0;
    const offset = req.offset ?? 0;
    return { mentions: Array.from({ length: limit }, (_, i) => rawMention(`m${offset + i}`)), computedAt: null };
  }

  /** Mimics router.navigate with queryParamsHandling: 'merge' (explicit nulls delete keys). */
  function navigateImpl(_commands: unknown[], extras?: { queryParams?: SocialListeningQueryParams; queryParamsHandling?: string }): Promise<boolean> {
    const qp = extras?.queryParams ?? {};
    const merged: SocialListeningQueryParams = { ...currentParams };
    for (const [key, value] of Object.entries(qp)) {
      if (value === null || value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    currentParams = merged;
    // The real router re-emits queryParams after navigation — the loopback must be idempotent.
    queryParams$.next(currentParams);
    return Promise.resolve(true);
  }

  async function settle(): Promise<void> {
    // debounceTime(0) on the request pipelines + the navigate promise need a macrotask turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function feedCalls(): SocialListeningFeedRequest[] {
    return getMentionsFeed.mock.calls.map(([req]) => req as SocialListeningFeedRequest);
  }

  function cachedWindows(): number[] {
    const cache = (fixture.componentInstance as unknown as { windowCache: () => Map<number, SocialListeningFeedResponse> }).windowCache();
    return [...cache.keys()].sort((a, b) => a - b);
  }

  function mentionIds(): string[] {
    return fixture.componentInstance.mentions().map((mention: Mention) => mention.id);
  }

  beforeEach(async () => {
    TestBed.resetTestingModule();

    currentParams = {};
    queryParams$ = new BehaviorSubject<SocialListeningQueryParams>({});
    navigate = vi.fn(navigateImpl);
    getMentionsFeed = vi.fn((req: SocialListeningFeedRequest) => of(feedResponse(req)));

    await TestBed.configureTestingModule({
      imports: [SocialListeningComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: queryParams$.asObservable(),
            get snapshot() {
              return { queryParams: currentParams };
            },
          },
        },
        { provide: Router, useValue: { navigate } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal(FOUNDATION) } },
        {
          provide: SocialListeningService,
          useValue: {
            getMentionsFeed,
            getMentionsCount: vi.fn(() => of({ total: 1000 })),
            getMentionsProjects: vi.fn(() => of([])),
            getMentionsPlatforms: vi.fn(() => of([])),
            getMentionsLanguages: vi.fn(() => of([])),
            getMentionsKeywords: vi.fn(() => of([])),
            getMentionsTags: vi.fn(() => of([])),
            getMentionsAuthors: vi.fn(() => of([])),
          },
        },
      ],
    })
      .overrideComponent(SocialListeningComponent, { set: { template: '' } })
      .compileComponents();

    fixture = TestBed.createComponent(SocialListeningComponent);
    fixture.detectChanges();
    await settle();
  });

  describe('windowed pagination', () => {
    it('fetches window 0 in two phases, then pages within it without a refetch', async () => {
      // Phase 1 paints the visible page; phase 2 fills the rest of the 100-row window.
      expect(feedCalls()).toEqual([expect.objectContaining({ limit: 20, offset: 0 }), expect.objectContaining({ limit: 80, offset: 20 })]);
      expect(cachedWindows()).toEqual([0]);
      expect(mentionIds()).toHaveLength(20);

      // Page 4 (rows 80–99) still lives in window 0 — no new fetch.
      fixture.componentInstance.onPageChange({ page: 4, rows: 20 });
      await settle();

      expect(getMentionsFeed).toHaveBeenCalledTimes(2);
      expect(mentionIds()[0]).toBe('m80');
    });

    it('fetches the next window when the page crosses the window edge', async () => {
      fixture.componentInstance.onPageChange({ page: 5, rows: 20 });
      await settle();

      expect(feedCalls().at(-2)).toEqual(expect.objectContaining({ limit: 20, offset: 100 }));
      expect(cachedWindows()).toEqual([0, 1]);
      expect(mentionIds()[0]).toBe('m100');
    });

    it('a page-size change mid-window slices the cached window instead of refetching', async () => {
      fixture.componentInstance.onPageChange({ page: 1, rows: 50 });
      await settle();

      // Offset 50 sits inside window 0 (rows 0–99) — the cache serves it.
      expect(getMentionsFeed).toHaveBeenCalledTimes(2);
      expect(mentionIds()).toHaveLength(50);
      expect(mentionIds()[0]).toBe('m50');

      // Offset 150 lands past the window edge — a new window fetch is required.
      fixture.componentInstance.onPageChange({ page: 3, rows: 50 });
      await settle();

      expect(feedCalls().at(-1)).toEqual(expect.objectContaining({ offset: 100 }));
      expect(mentionIds()[0]).toBe('m150');
    });

    it('evicts windows farther than ±2 from the current window', async () => {
      for (const page of [5, 10, 15, 20]) {
        fixture.componentInstance.onPageChange({ page, rows: 20 });
        await settle();
      }

      // Window 4 is current (page 20 at rows 20); windows 0 and 1 fell out of the ±2 band.
      expect(cachedWindows()).toEqual([2, 3, 4]);
    });
  });

  describe('query-param sync', () => {
    it('writes filter state to the URL, eliding defaults', async () => {
      expect(navigate).not.toHaveBeenCalled();

      fixture.componentInstance.selectedSentiment.set('negative');
      fixture.componentInstance.selectedTags.set(['ai', 'ml']);
      await settle();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(currentParams['sentiment']).toBe('negative');
      // Multi-value keys stay arrays so the router emits repeated params (commas survive).
      expect(currentParams['tags']).toEqual(['ai', 'ml']);
      expect(currentParams['relevance']).toBeUndefined();

      // Returning to the default removes the key entirely.
      fixture.componentInstance.selectedSentiment.set('all');
      await settle();
      expect(currentParams['sentiment']).toBeUndefined();
    });

    it('applies inbound query params to the signals, preserving commas inside repeated values', async () => {
      currentParams = { sentiment: 'positive', tags: ['a,b', 'c'] };
      queryParams$.next(currentParams);
      await settle();

      expect(fixture.componentInstance.selectedSentiment()).toBe('positive');
      expect(fixture.componentInstance.selectedTags()).toEqual(['a,b', 'c']);
      // The applied state re-encodes to the same URL — no redundant navigation.
      expect(navigate).not.toHaveBeenCalled();
    });

    it('does not fight itself: an encode→navigate→decode loopback lands exactly once', async () => {
      fixture.componentInstance.selectedAuthors.set(['Last, First']);
      await settle();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(currentParams['authors']).toEqual(['Last, First']);
      expect(fixture.componentInstance.selectedAuthors()).toEqual(['Last, First']);
    });
  });
});
