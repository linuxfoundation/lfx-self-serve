// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { getDefaultMarketingImpactPeriod, isReadInState } from '@lfx-one/shared/utils';
import { MentionBookmarkService } from '@services/mention-bookmark.service';
import { MentionReadStateService } from '@services/mention-read-state.service';
import { ProjectContextService } from '@services/project-context.service';
import { SocialListeningService } from '@services/social-listening.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Mention,
  ReadStateData,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningMention,
  SocialListeningQueryParams,
  User,
  UserPreferenceState,
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
  let getMentionsCount: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let queryParams$: BehaviorSubject<SocialListeningQueryParams>;
  /** What the URL currently holds — the navigate stub writes it, the snapshot getter reads it. */
  let currentParams: SocialListeningQueryParams;
  /** Component-scoped MentionBookmarkService is overridden with this harness — state is the live bookmark set. */
  let bookmarkState: WritableSignal<UserPreferenceState<Set<string>>>;
  let toggleBookmark: ReturnType<typeof vi.fn>;
  let setBookmarkContext: ReturnType<typeof vi.fn>;
  /** MentionReadStateService harness — `isRead` delegates to the real pure function over the harness state. */
  let readState: WritableSignal<UserPreferenceState<ReadStateData>>;
  let isRead: ReturnType<typeof vi.fn>;
  let toggleRead: ReturnType<typeof vi.fn>;
  let markAllAsRead: ReturnType<typeof vi.fn>;
  let markAllAsUnread: ReturnType<typeof vi.fn>;
  let setReadContext: ReturnType<typeof vi.fn>;
  let foundationSignal: ReturnType<typeof signal>;
  let foundationSfid: WritableSignal<string | null>;
  let userSignal: WritableSignal<User | null>;

  function rawMention(id: string): SocialListeningMention {
    return { MENTION_ID: id, MENTION_TS: '2026-08-01T00:00:00Z' } as SocialListeningMention;
  }

  function readStateWith(data: Partial<ReadStateData> = {}, loading = false): UserPreferenceState<ReadStateData> {
    return { data: { readBeforeTs: null, readIds: [], unreadIds: [], ...data }, loading, readOnly: false, error: null };
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
    getMentionsCount = vi.fn(() => of({ total: 1000 }));
    bookmarkState = signal<UserPreferenceState<Set<string>>>({ data: new Set<string>(), loading: false, readOnly: false, error: null });
    toggleBookmark = vi.fn();
    setBookmarkContext = vi.fn();
    readState = signal<UserPreferenceState<ReadStateData>>(readStateWith());
    isRead = vi.fn((id: string, ts: string) => isReadInState(readState().data, id, ts));
    toggleRead = vi.fn();
    markAllAsRead = vi.fn();
    markAllAsUnread = vi.fn();
    setReadContext = vi.fn();
    foundationSignal = signal(FOUNDATION);
    foundationSfid = signal<string | null>(null);
    userSignal = signal<User | null>(null);

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
        { provide: ProjectContextService, useValue: { selectedFoundation: foundationSignal, selectedFoundationSfid: foundationSfid } },
        { provide: UserService, useValue: { user: userSignal } },
        {
          provide: SocialListeningService,
          useValue: {
            getMentionsFeed,
            getMentionsCount,
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
      .overrideComponent(SocialListeningComponent, {
        set: {
          template: '',
          // The page scopes both preference services to itself — swap them here or the real stores would hit the transport.
          providers: [
            { provide: MentionBookmarkService, useValue: { state: bookmarkState, setContext: setBookmarkContext, toggleBookmark } },
            {
              provide: MentionReadStateService,
              useValue: { state: readState, setContext: setReadContext, isRead, toggleRead, markAllAsRead, markAllAsUnread },
            },
          ],
        },
      })
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

    it('auto-refetches a window once when its phase-2 fill fails, then serves it complete', async () => {
      // Window 1's background fill (offset 120) fails on the first attempt only.
      let failed = false;
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) => {
        if (req.offset === 120 && !failed) {
          failed = true;
          return throwError(() => new Error('phase 2 failed'));
        }
        return of(feedResponse(req));
      });

      fixture.componentInstance.onPageChange({ page: 5, rows: 20 });
      await settle();

      // Failed fill (120) + forced refetch of the window (100 + 120 again).
      expect(feedCalls().filter((req) => req.offset === 120)).toHaveLength(2);
      expect(cachedWindows()).toEqual([0, 1]);
      expect(mentionIds()[0]).toBe('m100');

      // The recovered window is complete — in-window paging serves it without another fetch.
      const calls = getMentionsFeed.mock.calls.length;
      fixture.componentInstance.onPageChange({ page: 6, rows: 20 });
      await settle();
      expect(getMentionsFeed).toHaveBeenCalledTimes(calls);
      expect(mentionIds()[0]).toBe('m120');
    });

    it('flags the window for manual retry when the phase-2 fill keeps failing, and retry recovers it', async () => {
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) =>
        req.offset === 120 ? throwError(() => new Error('phase 2 failed')) : of(feedResponse(req))
      );

      fixture.componentInstance.onPageChange({ page: 5, rows: 20 });
      await settle();

      // One failed fill + one failed refetch — then the partial window stays cached, flagged for manual retry.
      expect(feedCalls().filter((req) => req.offset === 120)).toHaveLength(2);
      expect(cachedWindows()).toEqual([0, 1]);
      expect(fixture.componentInstance.phase2Failed()).toBe(true);

      // Manual retry clears the flag and re-runs the window fetch, recovering the window.
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) => of(feedResponse(req)));
      fixture.componentInstance.retryWindow();
      await settle();

      expect(feedCalls().filter((req) => req.offset === 120)).toHaveLength(3);
      expect(fixture.componentInstance.phase2Failed()).toBe(false);
      expect(mentionIds()[0]).toBe('m100');
    });
  });

  describe('mention count', () => {
    it('surfaces a count failure as an error instead of masquerading as a zero total', async () => {
      getMentionsCount.mockReturnValue(throwError(() => new Error('count failed')));

      // Any filter change re-issues the count request against the failing mock.
      fixture.componentInstance.selectedPlatform.set('reddit');
      await settle();

      expect(fixture.componentInstance.countError()).toBe('Failed to load the mention count');
      expect(fixture.componentInstance.totalRecords()).toBe(0);
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

    it('seeds the first fetch from a deep-linked ?q= — no unfiltered flash or refire', async () => {
      // Rebuild the component with the deep link already in the URL (the seed reads the snapshot at construction).
      fixture.destroy();
      currentParams = { q: 'mesh' };
      queryParams$.next(currentParams);
      getMentionsFeed.mockClear();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      // Phase 1 already carries the search — no unfiltered first fetch.
      expect(feedCalls()).toEqual([
        expect.objectContaining({ limit: 20, offset: 0, search: 'mesh' }),
        expect.objectContaining({ limit: 80, offset: 20, search: 'mesh' }),
      ]);
      expect(fixture.componentInstance.searchInput()).toBe('mesh');

      // Past the debounce window the seeded value is unchanged — no second fire.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await settle();
      expect(getMentionsFeed).toHaveBeenCalledTimes(2);
      expect(currentParams['q']).toBe('mesh');
    });

    it('keeps a deep-linked ?search= in the URL while the debounced query catches up', async () => {
      currentParams = { search: 'mesh' };
      queryParams$.next(currentParams);
      await settle();

      // Inside the 500ms debounce window the URL-write effect must not strip the param.
      expect(navigate).not.toHaveBeenCalled();
      expect(currentParams['search']).toBe('mesh');

      // Once the debounce lands, the applied state re-encodes to the same URL — still no write.
      await new Promise((resolve) => setTimeout(resolve, 600));
      await settle();
      expect(currentParams['search']).toBe('mesh');
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  describe('bookmark mode', () => {
    it('sets the bookmark context once the signed-in user and foundation SFID resolve, and clears it when either drops', async () => {
      // Neither has resolved yet — the store stays idle.
      expect(setBookmarkContext).toHaveBeenCalledWith(null);

      userSignal.set({ sub: 'u1' } as User);
      foundationSfid.set('001ABC0000XYZDEFAAA');
      await settle();

      expect(setBookmarkContext).toHaveBeenLastCalledWith({ userId: 'u1', projectId: '001ABC0000XYZDEFAAA' });
    });

    it('carries the bookmarked ID set as mentionIds on a constant period token, regardless of the selected period', async () => {
      fixture.componentInstance.selectedPeriod.set('2026-03');
      bookmarkState.set({ data: new Set(['m1', 'm3']), loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      await settle();

      const bookmarkCalls = feedCalls().filter((req) => 'mentionIds' in req);
      expect(bookmarkCalls.length).toBeGreaterThan(0);
      for (const req of bookmarkCalls) {
        expect(req.mentionIds).toEqual(['m1', 'm3']);
        // The constant default period, never the live selectedPeriod — period changes must not refetch in bookmark mode.
        expect(req.period).toBe(getDefaultMarketingImpactPeriod());
      }
      expect(getMentionsCount).toHaveBeenLastCalledWith(expect.objectContaining({ mentionIds: ['m1', 'm3'], period: getDefaultMarketingImpactPeriod() }));
      // The filter round-trips through the URL.
      expect(currentParams['bookmarks']).toBe('bookmarked');
    });

    it('skips the feed and count requests entirely when the bookmarked set is empty', async () => {
      const feedCallCount = getMentionsFeed.mock.calls.length;
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      await settle();

      expect(getMentionsFeed).toHaveBeenCalledTimes(feedCallCount);
      expect(getMentionsCount).toHaveBeenCalledTimes(countCallCount);
      expect(fixture.componentInstance.totalRecords()).toBe(0);
      expect(fixture.componentInstance.mentions()).toEqual([]);
      expect(fixture.componentInstance.loading()).toBe(false);
    });

    it('delegates a card toggle to the bookmark service by mention id', () => {
      fixture.componentInstance.onBookmarkToggled({ id: 'm1' } as Mention);

      expect(toggleBookmark).toHaveBeenCalledWith('m1');
    });

    it('strips mentionIds from the analytics filter input', async () => {
      bookmarkState.set({ data: new Set(['m1']), loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      await settle();

      expect(fixture.componentInstance.currentFilters().mentionIds).toEqual(['m1']);
      expect(fixture.componentInstance.analyticsFilters()).not.toHaveProperty('mentionIds');
    });

    it('resets to All on clear-all and on pill removal, stripping the URL key', async () => {
      bookmarkState.set({ data: new Set(['m1']), loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      await settle();
      expect(currentParams['bookmarks']).toBe('bookmarked');

      fixture.componentInstance.removeFilterPill('bookmarkFilter');
      await settle();
      expect(fixture.componentInstance.selectedBookmarkFilter()).toBe('all');
      expect(currentParams['bookmarks']).toBeUndefined();

      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      await settle();
      fixture.componentInstance.clearAllFilters();
      await settle();
      expect(fixture.componentInstance.selectedBookmarkFilter()).toBe('all');
      expect(currentParams['bookmarks']).toBeUndefined();
    });

    it('keeps the bookmark filter across a foundation switch while the ID set reloads', async () => {
      bookmarkState.set({ data: new Set(['m1']), loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      fixture.componentInstance.selectedProject.set('proj-1');
      fixture.componentInstance.selectedPlatform.set('Reddit');
      await settle();

      foundationSignal.set({ uid: 'f2', name: 'LF', slug: 'linuxfoundation' });
      await settle();

      expect(fixture.componentInstance.selectedBookmarkFilter()).toBe('bookmarked');
      expect(currentParams['bookmarks']).toBe('bookmarked');
      // Sub-project + platform still reset on the switch — only the bookmark filter survives.
      expect(fixture.componentInstance.selectedProject()).toBe('all');
      expect(fixture.componentInstance.selectedPlatform()).toBe('all');
    });
  });

  describe('read state', () => {
    it('sets the read-state context together with the bookmark context as the user and foundation resolve', async () => {
      expect(setReadContext).toHaveBeenCalledWith(null);

      userSignal.set({ sub: 'u1' } as User);
      foundationSfid.set('001ABC0000XYZDEFAAA');
      await settle();

      expect(setReadContext).toHaveBeenLastCalledWith({ userId: 'u1', projectId: '001ABC0000XYZDEFAAA' });
    });

    it('filters the loaded window client-side in unread mode and recomputes totalRecords', async () => {
      // Window 0 holds m0–m99; the first five read leaves 95 unread.
      readState.set(readStateWith({ readIds: ['m0', 'm1', 'm2', 'm3', 'm4'] }));
      const feedCallCount = getMentionsFeed.mock.calls.length;
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(fixture.componentInstance.totalRecords()).toBe(95);
      expect(mentionIds()).toHaveLength(20);
      expect(mentionIds()[0]).toBe('m5');
      // No refetch — the unread view is a client-side filter over the cached window.
      expect(getMentionsFeed).toHaveBeenCalledTimes(feedCallCount);
      expect(getMentionsCount).toHaveBeenCalledTimes(countCallCount);
      expect(currentParams['read']).toBe('unread');
    });

    it('returns empty unread views while the read state loads (no unread flash)', async () => {
      readState.set(readStateWith({}, true));
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(fixture.componentInstance.totalRecords()).toBe(0);
      expect(fixture.componentInstance.mentions()).toEqual([]);
      expect(fixture.componentInstance.readMentionIds().size).toBe(0);
    });

    it('clamps the page when marking all as read shrinks the unread total', async () => {
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();
      // 100 unread rows in window 0 → 5 pages of 20.
      fixture.componentInstance.onPageChange({ page: 4, rows: 20 });
      await settle();
      expect(fixture.componentInstance.currentPage()).toBe(4);

      // Mark-all covers every loaded row (all stamped 2026-08-01T00:00:00Z).
      readState.set(readStateWith({ readBeforeTs: '2026-08-01 23:59:59' }));
      await settle();

      expect(fixture.componentInstance.totalRecords()).toBe(0);
      expect(fixture.componentInstance.currentPage()).toBe(0);
    });

    it('derives the mark-all cutoff from the newest loaded MENTION_TS, skipping null timestamps', async () => {
      getMentionsFeed.mockImplementation(() =>
        of({
          mentions: [
            { MENTION_ID: 'old', MENTION_TS: '2026-07-30 10:00:00' },
            // Space-separated Snowflake format — the reduce must normalize to epoch ms, not compare lexicographically.
            { MENTION_ID: 'newest', MENTION_TS: '2026-08-01 15:30:00' },
            { MENTION_ID: 'no-ts', MENTION_TS: null },
          ] as SocialListeningMention[],
          computedAt: null,
        })
      );
      // Rebuild so the feed pipeline fetches the custom rows (the seed reads at construction).
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      fixture.componentInstance.onMarkAllAsRead();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-01 15:30:00');
    });

    it('derives the mark-all cutoff from window 0 even when paged into a later window', async () => {
      // Window 0 rows stamp newer than window 1's — the cutoff must come from window 0 regardless of the current page.
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) => {
        const response = feedResponse(req);
        const ts = (req.offset ?? 0) === 0 ? '2026-08-01T00:00:00Z' : '2026-07-01T00:00:00Z';
        return of({ ...response, mentions: response.mentions.map((m) => ({ ...m, MENTION_TS: ts })) });
      });
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      // pageSize 20 × page 5 = offset 100 → window 1 (serverWindowSize is 100).
      fixture.componentInstance.onPageChange({ page: 5, rows: 20 });
      await settle();
      expect(cachedWindows()).toEqual([0, 1]);

      fixture.componentInstance.onMarkAllAsRead();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-01T00:00:00Z');
    });

    it('resets the page on read-filter change without clearing the window cache or refetching', async () => {
      fixture.componentInstance.onPageChange({ page: 4, rows: 20 });
      await settle();
      expect(fixture.componentInstance.currentPage()).toBe(4);
      expect(cachedWindows()).toEqual([0]);
      const feedCallCount = getMentionsFeed.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(fixture.componentInstance.currentPage()).toBe(0);
      expect(cachedWindows()).toEqual([0]);
      expect(getMentionsFeed).toHaveBeenCalledTimes(feedCallCount);
    });

    it('leaves the feed and count request fingerprints unchanged across read-filter flips', async () => {
      const feedFingerprint = feedCalls().map((req) => JSON.stringify(req));
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();
      fixture.componentInstance.selectedReadFilter.set('all');
      await settle();

      expect(feedCalls().map((req) => JSON.stringify(req))).toEqual(feedFingerprint);
      expect(getMentionsCount).toHaveBeenCalledTimes(countCallCount);
    });

    it('keeps the read filter across a foundation switch while the read state reloads per foundation', async () => {
      fixture.componentInstance.selectedReadFilter.set('unread');
      fixture.componentInstance.selectedProject.set('proj-1');
      await settle();

      userSignal.set({ sub: 'u1' } as User);
      foundationSfid.set('001ABC0000XYZDEFAAA');
      await settle();

      foundationSignal.set({ uid: 'f2', name: 'LF', slug: 'linuxfoundation' });
      foundationSfid.set('001XYZ0000ABCDEFAAA');
      await settle();

      expect(fixture.componentInstance.selectedReadFilter()).toBe('unread');
      expect(currentParams['read']).toBe('unread');
      // Sub-project still resets on the switch — only the read filter survives.
      expect(fixture.componentInstance.selectedProject()).toBe('all');
      expect(setReadContext).toHaveBeenLastCalledWith({ userId: 'u1', projectId: '001XYZ0000ABCDEFAAA' });
    });

    it('delegates card toggles and mark-all actions to the read-state service', () => {
      fixture.componentInstance.onReadToggled({ id: 'm1', timestamp: '2026-08-01T00:00:00Z' } as Mention);
      expect(toggleRead).toHaveBeenCalledWith('m1', '2026-08-01T00:00:00Z');

      fixture.componentInstance.onMarkAllAsUnread();
      expect(markAllAsUnread).toHaveBeenCalledTimes(1);
    });
  });
});
