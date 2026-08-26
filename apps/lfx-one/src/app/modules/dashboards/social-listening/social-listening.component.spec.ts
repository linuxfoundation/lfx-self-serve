// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { DEFAULT_MENTION_PREDICATE, MAX_SAVED_FILTERS_PER_PROJECT } from '@lfx-one/shared/constants';
import { getDefaultMarketingImpactPeriod, isReadInState } from '@lfx-one/shared/utils';
import { MentionBookmarkService } from '@services/mention-bookmark.service';
import { MentionReadStateService } from '@services/mention-read-state.service';
import { ProjectContextService } from '@services/project-context.service';
import { SavedFilterService } from '@services/saved-filter.service';
import { SocialListeningService } from '@services/social-listening.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FilterPredicate,
  Mention,
  ReadStateData,
  SavedFilter,
  SavedViewScope,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningMention,
  SocialListeningQueryParams,
  User,
  UserPreferenceState,
} from '@lfx-one/shared/interfaces';

import { FeedHeaderComponent } from './components/feed-header/feed-header.component';
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
  /** Mirrors the service's bulk-rollback tick — bumped when a failed mark-all restores the prior doc. */
  let bulkRollbackTick: WritableSignal<number>;
  let isRead: ReturnType<typeof vi.fn>;
  let toggleRead: ReturnType<typeof vi.fn>;
  let markAllAsRead: ReturnType<typeof vi.fn>;
  let markAllAsUnread: ReturnType<typeof vi.fn>;
  let setReadContext: ReturnType<typeof vi.fn>;
  let foundationSignal: ReturnType<typeof signal>;
  let foundationSfid: WritableSignal<string | null>;
  let userSignal: WritableSignal<User | null>;
  /** SavedFilterService harness — state is the live saved-view list; add/remove mutate it like the real store. */
  let savedFilterState: WritableSignal<UserPreferenceState<SavedFilter[]>>;
  let savedFilterDeletingIds: WritableSignal<ReadonlySet<string>>;
  let setSavedFilterContext: ReturnType<typeof vi.fn>;
  let addSavedFilter: ReturnType<typeof vi.fn>;
  let removeSavedFilter: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let dialogClose$: Subject<string | undefined>;

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
    bulkRollbackTick = signal(0);
    isRead = vi.fn((id: string, ts: string) => isReadInState(readState().data, id, ts));
    toggleRead = vi.fn();
    markAllAsRead = vi.fn();
    markAllAsUnread = vi.fn();
    setReadContext = vi.fn();
    foundationSignal = signal(FOUNDATION);
    foundationSfid = signal<string | null>(null);
    userSignal = signal<User | null>(null);
    savedFilterState = signal<UserPreferenceState<SavedFilter[]>>({ data: [], loading: false, readOnly: false, error: null });
    savedFilterDeletingIds = signal<ReadonlySet<string>>(new Set());
    setSavedFilterContext = vi.fn();
    addSavedFilter = vi.fn((name: string, predicate: FilterPredicate, scope: SavedViewScope): SavedFilter => {
      const created: SavedFilter = { id: 'view-new', name, predicate, scope, createdAt: '2026-08-01T00:00:00.000Z' };
      savedFilterState.update((s) => ({ ...s, data: [...s.data, created] }));
      return created;
    });
    removeSavedFilter = vi.fn((id: string, onRemoved?: () => void) => {
      savedFilterState.update((s) => ({ ...s, data: s.data.filter((f) => f.id !== id) }));
      onRemoved?.();
    });
    dialogClose$ = new Subject<string | undefined>();
    dialogOpen = vi.fn(() => ({ onClose: dialogClose$.asObservable() }));

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
        // Injected by the component but provided app-wide in production — the blanked template override drops it here.
        { provide: MessageService, useValue: { add: vi.fn() } },
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
          // The page scopes the preference services + dialog/confirm plumbing to itself — swap them here or the real stores would hit the transport.
          providers: [
            { provide: MentionBookmarkService, useValue: { state: bookmarkState, setContext: setBookmarkContext, toggleBookmark } },
            {
              provide: MentionReadStateService,
              useValue: { state: readState, bulkRollbackTick, setContext: setReadContext, isRead, toggleRead, markAllAsRead, markAllAsUnread },
            },
            {
              provide: SavedFilterService,
              useValue: {
                state: savedFilterState,
                deletingViewIds: savedFilterDeletingIds,
                setContext: setSavedFilterContext,
                addSavedFilter,
                removeSavedFilter,
              },
            },
            { provide: DialogService, useValue: { open: dialogOpen } },
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

  describe('language invalidation', () => {
    it('keeps a deep-linked language while the option list has not been fetched', async () => {
      queryParams$.next({ language: 'fr' });
      await settle();

      // The lazy options fetch has never fired — an untouched list must not wipe the deep link.
      expect(fixture.componentInstance.selectedLanguage()).toBe('fr');
    });

    it('clears a stale deep-linked language once the option list lands empty', async () => {
      queryParams$.next({ language: 'fr' });
      await settle();
      expect(fixture.componentInstance.selectedLanguage()).toBe('fr');

      // The fetch is armed by the first panel intent; a successful-but-empty list still invalidates.
      fixture.componentInstance.prefetchFilterOptions();
      await settle();

      expect(fixture.componentInstance.selectedLanguage()).toBe('all');
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

    it('holds the feed loading state while the bookmark set loads in bookmarked mode', async () => {
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      bookmarkState.set({ data: new Set(), loading: true, readOnly: false, error: null });
      await settle();

      // The empty set is the not-yet-loaded fallback — the "no bookmarks" empty state must not paint yet.
      expect(fixture.componentInstance.loading()).toBe(true);
      expect(fixture.componentInstance.bookmarkStateError()).toBe(false);
    });

    it('flags an error state when the bookmark set fails to load in bookmarked mode', async () => {
      fixture.componentInstance.selectedBookmarkFilter.set('bookmarked');
      bookmarkState.set({ data: new Set(), loading: false, readOnly: false, error: new Error('boom') });
      await settle();

      // The template swaps the list for an error banner so the fallback empty set can't pose as "no bookmarks".
      expect(fixture.componentInstance.bookmarkStateError()).toBe(true);
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

    it('sends the read-state snapshot as server filter params when entering unread mode', async () => {
      readState.set(readStateWith({ readIds: ['m0', 'm1'], readBeforeTs: '2026-08-01 12:00:00' }));
      const feedCallCount = getMentionsFeed.mock.calls.length;
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      // Entering unread mode re-queries both pipelines — the server now applies the read-state exclusion period-wide.
      expect(getMentionsFeed.mock.calls.length).toBeGreaterThan(feedCallCount);
      expect(getMentionsCount.mock.calls.length).toBeGreaterThan(countCallCount);
      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readIds: ['m0', 'm1'], readBeforeTs: '2026-08-01 12:00:00' });
      // Empty override arrays are dropped from the request, and the paginator total is the server's count.
      expect(feedCalls().at(-1)?.unreadIds).toBeUndefined();
      expect(fixture.componentInstance.totalRecords()).toBe(1000);
      expect(currentParams['read']).toBe('unread');
    });

    it('holds the unread feed while the read state loads — skeleton shows, no empty-doc fetch', async () => {
      readState.set(readStateWith({}, true));
      const feedCallCount = getMentionsFeed.mock.calls.length;
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      // The loading gate covers the stale cached window; the null-guard blocks any unread fetch.
      expect(fixture.componentInstance.loading()).toBe(true);
      expect(fixture.componentInstance.totalRecords()).toBe(0);
      expect(getMentionsFeed).toHaveBeenCalledTimes(feedCallCount);
      expect(getMentionsCount).toHaveBeenCalledTimes(countCallCount);
      expect(feedCalls().every((req) => req.unreadOnly === undefined)).toBe(true);
    });

    it('re-queries unread from page 1 when mark-all-as-read refreshes the snapshot', async () => {
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();
      fixture.componentInstance.onPageChange({ page: 4, rows: 20 });
      await settle();
      expect(fixture.componentInstance.currentPage()).toBe(4);

      // Unread mode narrows the feed, so mark-all first resolves the foundation-global newest via a limit-1 fetch.
      // Mirror the production ordering inside the mock: the store's optimistic commit lands
      // synchronously within markAllAsRead, so the component's snapshot refresh must observe the
      // new cutoff. (A plain fn + manual readState.set beforehand would pass even if the component
      // refreshed before committing.)
      markAllAsRead.mockImplementation((ts: string) => readState.set(readStateWith({ readBeforeTs: ts })));
      fixture.componentInstance.onMarkAllAsRead();
      await settle();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-01T00:00:00Z');
      // Then the refreshed snapshot re-queries with the new cutoff, restarting at page 1.
      expect(fixture.componentInstance.currentPage()).toBe(0);
      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readBeforeTs: '2026-08-01T00:00:00Z' });
    });

    it('re-captures the unread snapshot when a failed mark-all rolls back', async () => {
      readState.set(readStateWith({ readBeforeTs: '2026-08-01 12:00:00' }));
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();
      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readBeforeTs: '2026-08-01 12:00:00' });

      // Optimistic mark-all commits synchronously; the snapshot refreshes onto the new cutoff.
      markAllAsRead.mockImplementation((ts: string) => readState.set(readStateWith({ readBeforeTs: ts })));
      fixture.componentInstance.onMarkAllAsRead();
      await settle();
      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readBeforeTs: '2026-08-01T00:00:00Z' });

      // The persist then fails: mergeRollback restores the prior doc and bumps the tick — no loading/error
      // transition fires, so only the tick dep lets the effect re-capture the restored cutoff.
      readState.set(readStateWith({ readBeforeTs: '2026-08-01 12:00:00' }));
      bulkRollbackTick.update((tick) => tick + 1);
      await settle();

      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readBeforeTs: '2026-08-01 12:00:00' });
    });

    it('restyles a toggled row in place — no refetch, no reshuffle, no total change', async () => {
      readState.set(readStateWith({ readBeforeTs: '2026-08-01 12:00:00' }));
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();
      const feedCallCount = getMentionsFeed.mock.calls.length;
      const countCallCount = getMentionsCount.mock.calls.length;
      const pageBefore = mentionIds();

      // The service owns the write; the harness mirrors the persisted doc change.
      readState.set(readStateWith({ readBeforeTs: '2026-08-01 12:00:00', readIds: ['m3'] }));
      await settle();

      expect(getMentionsFeed).toHaveBeenCalledTimes(feedCallCount);
      expect(getMentionsCount).toHaveBeenCalledTimes(countCallCount);
      expect(mentionIds()).toEqual(pageBefore);
      expect(fixture.componentInstance.readMentionIds().has('m3')).toBe(true);
    });

    it('strips the unread params from the analytics filters', async () => {
      readState.set(readStateWith({ readIds: ['m7'], readBeforeTs: '2026-08-01 12:00:00' }));
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(fixture.componentInstance.currentFilters()).toMatchObject({ unreadOnly: true, readIds: ['m7'], readBeforeTs: '2026-08-01 12:00:00' });
      const analytics = fixture.componentInstance.analyticsFilters();
      expect(analytics.unreadOnly).toBeUndefined();
      expect(analytics.readIds).toBeUndefined();
      expect(analytics.unreadIds).toBeUndefined();
      expect(analytics.readBeforeTs).toBeUndefined();
    });

    it('shows the read-state error and holds the unread feed when the read state fails to load', async () => {
      readState.set({ ...readStateWith(), error: 'boom' });
      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      // The template swaps the list for the error banner, and no request carries the unread params.
      expect(fixture.componentInstance.readStateError()).toBe(true);
      expect(feedCalls().every((req) => req.unreadOnly === undefined)).toBe(true);
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

    it('retains the global-newest mark-all cutoff after window 0 is pruned from the cache', async () => {
      // Window 0 rows stamp newer than every deeper window — the retained cutoff must survive window 0's eviction.
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) => {
        const response = feedResponse(req);
        const ts = (req.offset ?? 0) === 0 ? '2026-08-01T00:00:00Z' : '2026-07-01T00:00:00Z';
        return of({ ...response, mentions: response.mentions.map((m) => ({ ...m, MENTION_TS: ts })) });
      });
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      // Page into window 4 — windows 0 and 1 fall out of the ±2 band.
      for (const page of [5, 10, 15, 20]) {
        fixture.componentInstance.onPageChange({ page, rows: 20 });
        await settle();
      }
      expect(cachedWindows()).toEqual([2, 3, 4]);

      fixture.componentInstance.onMarkAllAsRead();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-01T00:00:00Z');
    });

    it('resets the page and re-queries with the snapshot params on read-filter change', async () => {
      readState.set(readStateWith({ readIds: ['m7'] }));
      fixture.componentInstance.onPageChange({ page: 4, rows: 20 });
      await settle();
      expect(fixture.componentInstance.currentPage()).toBe(4);
      expect(cachedWindows()).toEqual([0]);
      const feedCallCount = getMentionsFeed.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(fixture.componentInstance.currentPage()).toBe(0);
      // The window cache went cold and refilled — the server now filters, so cached unfiltered windows no longer apply.
      expect(cachedWindows()).toEqual([0]);
      expect(getMentionsFeed.mock.calls.length).toBeGreaterThan(feedCallCount);
      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readIds: ['m7'] });
    });

    it('adds the unread params on entry and drops them on exit', async () => {
      readState.set(readStateWith({ readIds: ['m7'] }));
      const unfilteredFingerprint = JSON.stringify(feedCalls().at(-1));
      const countCallCount = getMentionsCount.mock.calls.length;

      fixture.componentInstance.selectedReadFilter.set('unread');
      await settle();

      expect(feedCalls().at(-1)).toMatchObject({ unreadOnly: true, readIds: ['m7'] });
      expect(getMentionsCount.mock.calls.length).toBeGreaterThan(countCallCount);

      fixture.componentInstance.selectedReadFilter.set('all');
      await settle();

      expect(JSON.stringify(feedCalls().at(-1))).toEqual(unfilteredFingerprint);
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

    it('resolves the mark-all cutoff from a live fetch when window 0 never landed', async () => {
      // A window-0 fetch that never emits leaves newestMentionTs null — mark-all must resolve the global newest itself.
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) =>
        req.limit === 1 ? of({ mentions: [{ MENTION_ID: 'g', MENTION_TS: '2026-08-05 10:00:00' } as SocialListeningMention], computedAt: null }) : of()
      );
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      fixture.componentInstance.onMarkAllAsRead();
      await settle();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-05 10:00:00');
    });

    it('does not stamp the mark-all cutoff when the foundation switches mid-fetch', async () => {
      // The limit-1 cutoff fetch stays open so the foundation switch (and the store rebind) lands first.
      const cutoff$ = new Subject<SocialListeningFeedResponse>();
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) => (req.limit === 1 ? cutoff$.asObservable() : of(feedResponse(req))));
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      fixture.componentInstance.selectedSentiment.set('negative');
      await settle();
      fixture.componentInstance.onMarkAllAsRead();

      foundationSignal.set({ uid: 'f2', name: 'LF', slug: 'linuxfoundation' });
      foundationSfid.set('001XYZ0000ABCDEFAAA');
      await settle();

      cutoff$.next({ mentions: [{ MENTION_ID: 'g', MENTION_TS: '2026-08-05 10:00:00' } as SocialListeningMention], computedAt: null });
      await settle();

      expect(markAllAsRead).not.toHaveBeenCalled();
    });

    it('falls back to the loaded newest when the unfiltered cutoff window comes back empty', async () => {
      // No mentions in the default period (a foundation whose mentions are all in a prior year) — mark-all
      // must still stamp the newest loaded timestamp instead of silently no-oping on a visible feed.
      getMentionsFeed.mockImplementation((req: SocialListeningFeedRequest) =>
        req.limit === 1 ? of({ mentions: [], computedAt: null }) : of(feedResponse(req))
      );
      fixture.destroy();
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      fixture.componentInstance.selectedSentiment.set('negative');
      await settle();
      fixture.componentInstance.onMarkAllAsRead();
      await settle();

      expect(markAllAsRead).toHaveBeenCalledWith('2026-08-01T00:00:00Z');
    });
  });

  describe('saved views', () => {
    function savedView(overrides: Partial<SavedFilter> = {}): SavedFilter {
      return {
        id: 'v1',
        name: 'Crisis',
        predicate: { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [] },
        scope: { period: getDefaultMarketingImpactPeriod(), sourceProjectId: 'all', platform: 'all' },
        createdAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
      };
    }

    function withPredicate(predicate: Partial<FilterPredicate>): Partial<SavedFilter> {
      return { predicate: { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [], ...predicate } };
    }

    /** The foreign-view detector is inert until the user + foundation resolve (context effect). */
    async function resolveContext(): Promise<void> {
      userSignal.set({ sub: 'u1' } as User);
      foundationSfid.set('001ABC0000XYZDEFAAA');
      await settle();
    }

    it('sets the saved-filter context together with the other preference services', async () => {
      expect(setSavedFilterContext).toHaveBeenCalledWith(null);

      await resolveContext();

      expect(setSavedFilterContext).toHaveBeenLastCalledWith({ userId: 'u1', projectId: '001ABC0000XYZDEFAAA' });
    });

    it('applies a view — predicate + scope + activeViewId together — preserving its keywords/tags across the scope change', async () => {
      const view = savedView({
        ...withPredicate({ sentiment: 'negative', keywords: ['kubernetes'], tags: ['ai'] }),
        scope: { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' },
      });

      fixture.componentInstance.applyView(view);
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.selectedSentiment()).toBe('negative');
      expect(fixture.componentInstance.selectedPeriod()).toBe('2026-03');
      expect(fixture.componentInstance.selectedProject()).toBe('proj-1');
      expect(fixture.componentInstance.selectedPlatform()).toBe('reddit');
      // The scope-key reset effect must not wipe the view's array filters (applyView commits the scope key first).
      expect(fixture.componentInstance.selectedKeywords()).toEqual(['kubernetes']);
      expect(fixture.componentInstance.selectedTags()).toEqual(['ai']);
      expect(currentParams['view']).toBe('v1');
      expect(currentParams['sentiment']).toBe('negative');
    });

    it('saves the current view and marks the created view active', async () => {
      fixture.componentInstance.selectedSentiment.set('negative');
      await settle();

      fixture.componentInstance.saveCurrentView('Crisis');
      await settle();

      expect(addSavedFilter).toHaveBeenCalledWith(
        'Crisis',
        expect.objectContaining({ sentiment: 'negative' }),
        expect.objectContaining({ period: getDefaultMarketingImpactPeriod(), sourceProjectId: 'all', platform: 'all' }),
        expect.any(Function)
      );
      expect(fixture.componentInstance.activeViewId()).toBe('view-new');
      expect(currentParams['view']).toBe('view-new');
    });

    it('clears the pending active view when the save write fails and rolls back', async () => {
      // Mirror the store's failure path: rollback drops the view, then the error callback fires.
      addSavedFilter.mockImplementation((name: string, predicate: FilterPredicate, scope: SavedViewScope, onPersistError?: () => void): SavedFilter => {
        const created: SavedFilter = { id: 'view-new', name, predicate, scope, createdAt: '2026-08-01T00:00:00.000Z' };
        savedFilterState.update((s) => ({ ...s, data: [...s.data, created] }));
        queueMicrotask(() => {
          savedFilterState.update((s) => ({ ...s, data: s.data.filter((f) => f.id !== created.id) }));
          onPersistError?.();
        });
        return created;
      });

      fixture.componentInstance.selectedSentiment.set('negative');
      await settle();
      fixture.componentInstance.saveCurrentView('Crisis');
      expect(fixture.componentInstance.activeViewId()).toBe('view-new');

      await settle();
      // The ghost id must be gone — otherwise the foreign-view detector would misread the failed save as a shared preset.
      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
    });

    it('resets predicate + scope to defaults when the active view is deleted, and keeps state when another view is deleted', async () => {
      const view = savedView({ ...withPredicate({ sentiment: 'negative' }), scope: { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' } });
      const other = savedView({ id: 'v2', name: 'Other' });
      savedFilterState.set({ data: [view, other], loading: false, readOnly: false, error: null });
      fixture.componentInstance.applyView(view);
      await settle();

      // A non-active delete leaves the applied view untouched.
      fixture.componentInstance.onSavedViewDeleted('v2');
      await settle();
      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.selectedSentiment()).toBe('negative');

      fixture.componentInstance.onSavedViewDeleted('v1');
      await settle();

      expect(removeSavedFilter).toHaveBeenCalledWith('v1', expect.any(Function));
      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.selectedSentiment()).toBe('all');
      expect(fixture.componentInstance.selectedPeriod()).toBe(getDefaultMarketingImpactPeriod());
      expect(fixture.componentInstance.selectedProject()).toBe('all');
      expect(fixture.componentInstance.selectedPlatform()).toBe('all');
      expect(currentParams['view']).toBeUndefined();
    });

    it('clears the active-view label on manual filter drift — but never for a search-only edit', async () => {
      await resolveContext();
      const view = savedView(withPredicate({ sentiment: 'negative' }));
      savedFilterState.set({ data: [view], loading: false, readOnly: false, error: null });
      fixture.componentInstance.applyView(view);
      await settle();
      expect(fixture.componentInstance.activeViewName()).toBe('Crisis');

      // Search refinement keeps the label (sameSavedViewLabelPredicate ignores search).
      fixture.componentInstance.searchInput.set('mesh');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await settle();
      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.activeViewName()).toBe('Crisis');
      expect(currentParams['view']).toBe('v1');

      // A non-search drift silently clears the label and strips ?view= from the URL.
      fixture.componentInstance.selectedSentiment.set('positive');
      await settle();
      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.activeViewName()).toBeNull();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
      expect(currentParams['view']).toBeUndefined();
    });

    it('keeps a cold ?view= id while the saved list loads, then resolves it without a banner', async () => {
      const view = savedView();
      savedFilterState.set({ data: [], loading: true, readOnly: false, error: null });

      // Rebuild with the deep link already in the URL (the subscribe reads it at construction).
      fixture.destroy();
      currentParams = { view: 'v1' };
      queryParams$.next(currentParams);
      fixture = TestBed.createComponent(SocialListeningComponent);
      fixture.detectChanges();
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);

      await resolveContext();
      // Still loading — the detector must not wipe the id.
      expect(fixture.componentInstance.activeViewId()).toBe('v1');

      savedFilterState.set({ data: [view], loading: false, readOnly: false, error: null });
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.activeViewName()).toBe('Crisis');
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
    });

    it('shows the foreign-view banner for an unknown ?view= with non-default state and clears the id', async () => {
      await resolveContext();
      savedFilterState.set({ data: [savedView()], loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedSentiment.set('negative');
      await settle();

      fixture.componentInstance.activeViewId.set('someone-elses-view');
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(true);
      expect(currentParams['view']).toBeUndefined();
    });

    it('clears a found-but-drifted view id silently — no banner', async () => {
      await resolveContext();
      // The view exists but its predicate (negative) doesn't match the current default state.
      savedFilterState.set({ data: [savedView(withPredicate({ sentiment: 'negative' }))], loading: false, readOnly: false, error: null });
      await settle();

      fixture.componentInstance.activeViewId.set('v1');
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
    });

    it('saves a copy of the foreign view from the banner and hides the banner', async () => {
      await resolveContext();
      savedFilterState.set({ data: [], loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedSentiment.set('negative');
      fixture.componentInstance.activeViewId.set('foreign-id');
      await settle();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(true);

      fixture.componentInstance.onSaveFromForeignBanner();

      expect(dialogOpen).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ header: 'Save current view', data: { existingNames: [] } }));

      dialogClose$.next('My Crisis');
      await settle();

      expect(addSavedFilter).toHaveBeenCalledWith('My Crisis', expect.objectContaining({ sentiment: 'negative' }), expect.anything(), expect.any(Function));
      expect(fixture.componentInstance.activeViewId()).toBe('view-new');
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
    });

    it('dismisses the foreign-view banner without saving', async () => {
      await resolveContext();
      savedFilterState.set({ data: [], loading: false, readOnly: false, error: null });
      fixture.componentInstance.selectedSentiment.set('negative');
      fixture.componentInstance.activeViewId.set('foreign-id');
      await settle();
      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(true);

      fixture.componentInstance.dismissForeignViewBanner();

      expect(fixture.componentInstance.foreignViewBannerVisible()).toBe(false);
      expect(dialogOpen).not.toHaveBeenCalled();
    });

    it('does not open the save dialog at the limit or when the store is read-only', async () => {
      savedFilterState.set({
        data: Array.from({ length: MAX_SAVED_FILTERS_PER_PROJECT }, (_, i) => savedView({ id: `v${i}`, name: `View ${i}` })),
        loading: false,
        readOnly: false,
        error: null,
      });

      fixture.componentInstance.openSaveDialog();
      expect(dialogOpen).not.toHaveBeenCalled();

      savedFilterState.set({ data: [], loading: false, readOnly: true, error: null });
      fixture.componentInstance.openSaveDialog();
      expect(dialogOpen).not.toHaveBeenCalled();
    });

    it('strips ?view= when No Preset View is selected and resets to the defaults', async () => {
      const view = savedView({ ...withPredicate({ sentiment: 'negative' }), scope: { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' } });
      savedFilterState.set({ data: [view], loading: false, readOnly: false, error: null });
      fixture.componentInstance.applyView(view);
      await settle();
      expect(currentParams['view']).toBe('v1');

      fixture.componentInstance.onDefaultViewSelected();
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBeNull();
      expect(fixture.componentInstance.selectedSentiment()).toBe('all');
      expect(fixture.componentInstance.selectedPeriod()).toBe(getDefaultMarketingImpactPeriod());
      expect(fixture.componentInstance.selectedProject()).toBe('all');
      expect(fixture.componentInstance.selectedPlatform()).toBe('all');
      expect(currentParams['view']).toBeUndefined();
      expect(currentParams['sentiment']).toBeUndefined();
    });

    it('applies an inbound ?view= deep link to the active view state', async () => {
      currentParams = { view: 'v1', sentiment: 'negative' };
      queryParams$.next(currentParams);
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBe('v1');
      expect(fixture.componentInstance.selectedSentiment()).toBe('negative');
    });

    it('clears the active view on foundation switch', async () => {
      const view = savedView(withPredicate({ sentiment: 'negative' }));
      savedFilterState.set({ data: [view], loading: false, readOnly: false, error: null });
      fixture.componentInstance.applyView(view);
      await settle();
      expect(fixture.componentInstance.activeViewId()).toBe('v1');

      foundationSignal.set({ uid: 'f2', name: 'LF', slug: 'linuxfoundation' });
      await settle();

      expect(fixture.componentInstance.activeViewId()).toBeNull();
    });
  });
});

/** Panel exclusivity lives in the feed-header toggle handlers (PCC's activePanel union semantics); the header has no spec file of its own. */
describe('FeedHeaderComponent — panel exclusivity', () => {
  let headerFixture: ComponentFixture<FeedHeaderComponent>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [FeedHeaderComponent] })
      .overrideComponent(FeedHeaderComponent, { set: { template: '' } })
      .compileComponents();

    headerFixture = TestBed.createComponent(FeedHeaderComponent);
    headerFixture.componentRef.setInput('activeTab', 'feed');
    headerFixture.componentRef.setInput('selectedPeriod', '2026-08');
    headerFixture.componentRef.setInput('selectedProject', 'all');
    headerFixture.componentRef.setInput('selectedPlatform', 'all');
    headerFixture.componentRef.setInput('searchInput', '');
    headerFixture.detectChanges();
    await headerFixture.whenStable();
  });

  function toggles(): { toggleViews: () => void; toggleFilters: () => void } {
    return headerFixture.componentInstance as unknown as { toggleViews: () => void; toggleFilters: () => void };
  }

  it('opening one panel closes the other; toggling off leaves both closed', () => {
    const header = headerFixture.componentInstance;

    toggles().toggleFilters();
    expect(header.filtersVisible()).toBe(true);
    expect(header.viewsVisible()).toBe(false);

    toggles().toggleViews();
    expect(header.viewsVisible()).toBe(true);
    expect(header.filtersVisible()).toBe(false);

    toggles().toggleFilters();
    expect(header.filtersVisible()).toBe(true);
    expect(header.viewsVisible()).toBe(false);

    toggles().toggleFilters();
    expect(header.filtersVisible()).toBe(false);
    expect(header.viewsVisible()).toBe(false);
  });
});
