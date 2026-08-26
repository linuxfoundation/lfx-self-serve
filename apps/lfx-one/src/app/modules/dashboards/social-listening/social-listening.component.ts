// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, PLATFORM_ID, Signal, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { MessageComponent } from '@components/message/message.component';
import {
  DEFAULT_MENTION_PAGE_SIZE,
  DEFAULT_MENTION_PREDICATE,
  DEFAULT_MENTION_VIEW_SCOPE,
  MAX_SAVED_FILTERS_PER_PROJECT,
  MENTION_FILTER_MAX_VALUES,
  MENTION_MAX_CACHED_WINDOWS,
  MENTION_MAX_FEED_OFFSET,
  MENTION_PAGE_SIZE_OPTIONS,
  MENTION_SEARCH_DEBOUNCE_MS,
  MENTION_SEARCH_MIN_CHARS,
  MENTION_SERVER_WINDOW_SIZE,
  MENTION_TIME_TICK_INTERVAL_MS,
} from '@lfx-one/shared/constants';
import {
  applyPredicateToSignals,
  applyViewScopeToSignals,
  buildActiveFilterPills,
  buildMentionFilters,
  countActiveFilters,
  decodePredicateFromQueryParams,
  encodePredicateToQueryParams,
  getDefaultMarketingImpactPeriod,
  isDefaultViewScope,
  isEmptyPredicate,
  mapAuthorsToOptions,
  mapLanguagesToOptions,
  mapPlatformsToOptions,
  mapRawToMention,
  mapSubProjectsToOptions,
  mergeSelectedAuthors,
  normalizeMentionSearch,
  predicatesEqual,
  predicateFromSignals,
  queryParamsEqual,
  sameSavedViewLabelPredicate,
  scopesEqual,
  viewScopeFromSignals,
  viewScopesEqual,
} from '@lfx-one/shared/utils';
import { MentionBookmarkService } from '@services/mention-bookmark.service';
import { MentionReadStateService } from '@services/mention-read-state.service';
import { ProjectContextService } from '@services/project-context.service';
import { SavedFilterService } from '@services/saved-filter.service';
import { SocialListeningService } from '@services/social-listening.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService } from 'primeng/dynamicdialog';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  firstValueFrom,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';

import type {
  AuthorOption,
  FilterPredicate,
  LoadableState,
  Mention,
  MentionFilters,
  ReadStateData,
  SavedFilter,
  SavedViewScope,
  ScopeState,
  SocialListeningCountRequest,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningMention,
  SocialListeningPlatform,
  SocialListeningScopedOptionsRequest,
  SocialListeningScopeSignals,
  SocialListeningSignals,
  SocialListeningSubProject,
  SocialListeningTab,
  SocialListeningWindowCacheEntry,
} from '@lfx-one/shared/interfaces';

import { SocialListeningAnalyticsComponent } from './components/analytics/social-listening-analytics.component';
import { FeedHeaderComponent } from './components/feed-header/feed-header.component';
import { FiltersPanelComponent } from './components/filters-panel/filters-panel.component';
import { MentionsListComponent } from './components/mentions-list/mentions-list.component';
import { SaveViewDialogComponent } from './components/save-view-dialog/save-view-dialog.component';
import { ViewsDropdownComponent } from './components/views-dropdown/views-dropdown.component';

/** Shared immutable empty-feed value for initial/error/no-scope states. */
const EMPTY_FEED_RESPONSE: SocialListeningFeedResponse = { mentions: [], computedAt: null };

/**
 * Social Listening — Foundation Lens page (ED + LF Staff), LFXV2-3016: PCC's mentions feed on the
 * 3015 endpoints — windowed pagination (100-row windows, ±2 cached), query-param sync, and reset
 * effects on scope/filter/foundation change. Saved views are deferred.
 */
@Component({
  selector: 'lfx-social-listening',
  imports: [
    CardComponent,
    EmptyStateComponent,
    FilterPillsComponent,
    MessageComponent,
    FeedHeaderComponent,
    FiltersPanelComponent,
    MentionsListComponent,
    SocialListeningAnalyticsComponent,
    ViewsDropdownComponent,
    ConfirmDialogModule,
  ],
  templateUrl: './social-listening.component.html',
  styleUrl: './social-listening.component.scss',
  // Component-scoped (PCC parity): each store's destroyRef/injector scopes to the page, so the
  // preference state reloads on foundation switch and is dropped on page leave.
  providers: [MentionBookmarkService, MentionReadStateService, SavedFilterService, DialogService, ConfirmationService],
})
export class SocialListeningComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly socialListeningService = inject(SocialListeningService);
  private readonly mentionBookmarkService = inject(MentionBookmarkService);
  private readonly mentionReadStateService = inject(MentionReadStateService);
  private readonly savedFilterService = inject(SavedFilterService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  private readonly defaultPeriod = getDefaultMarketingImpactPeriod();
  private readonly serverWindowSize = MENTION_SERVER_WINDOW_SIZE;
  /** Deep-linked search, decoded once — seeds the input and the debounced query so the first fetch is already filtered. */
  private readonly initialSearch = decodePredicateFromQueryParams(this.route.snapshot.queryParams, this.defaultPeriod).predicate.search;

  // === Model signals (two-way bound by the feed header) ===
  public readonly activeTab = signal<SocialListeningTab>('feed');
  public readonly selectedPeriod = signal(this.defaultPeriod);
  public readonly selectedProject = signal('all');
  public readonly selectedPlatform = signal('all');
  public readonly searchInput = signal(this.initialSearch);

  // === Filter signals (wired into the predicate now; the filters panel UI lands in LFXV2-3017) ===
  public readonly selectedSentiment = signal('all');
  public readonly selectedRelevance = signal('all');
  public readonly selectedLanguage = signal('all');
  public readonly selectedHasTitle = signal('all');
  public readonly selectedBookmarkFilter = signal('all');
  public readonly selectedReadFilter = signal('all');
  public readonly selectedKeywords = signal<string[]>([]);
  public readonly selectedTags = signal<string[]>([]);
  public readonly selectedAuthors = signal<string[]>([]);

  // === Pagination state ===
  public readonly currentPage = signal(0);
  public readonly pageSize = signal(DEFAULT_MENTION_PAGE_SIZE);
  public readonly rowsPerPageOptions = MENTION_PAGE_SIZE_OPTIONS;
  private readonly windowCache = signal<Map<number, SocialListeningWindowCacheEntry>>(new Map());
  // Global-newest MENTION_TS, captured whenever window 0 loads — survives cache pruning so a mark-all from a deep page still stamps the true cutoff.
  private newestMentionTs: string | null = null;
  /** Guards the mark-all cutoff fetch against double-clicks during a slow round-trip. */
  private markAllPending = false;
  private readonly backgroundLoading = signal(false);
  /** Bumped to force a one-time refetch of a window whose phase-2 fill failed. */
  private readonly feedRetryTick = signal(0);
  /** Windows that already consumed their one automatic refetch (reset on scope change). */
  private readonly retriedWindows = new Set<number>();

  // === Filters panel state (LFXV2-3017) ===
  public readonly filtersOpen = signal(false);
  private readonly filtersOpenedOnce = signal(false);

  // === Saved views (LFXV2-3002 Block 3) ===
  public readonly activeViewId = signal<string | null>(null);
  public readonly viewsOpen = signal(false);
  public readonly foreignViewBannerVisible = signal(false);

  // === Analytics export state (LFXV2-3018) — the header emits, the analytics component captures ===
  public readonly exporting = signal(false);
  public readonly exportNonce = signal(0);
  /** Reported by the analytics child — export stays disabled until no panel renders skeletons. */
  public readonly analyticsPanelsLoading = signal(false);

  /** Shared heartbeat that re-evaluates relative timestamps on rendered cards (one interval per page, not per card). */
  public readonly timeTick = signal(0);

  private previousFoundationSlug: string | null = null;
  private previousScopeKey: string | null = null;

  // === Scope derivations ===
  public readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  public readonly hasFoundation = computed(() => !!this.foundationSlug());
  /** Live bookmark set for the active user+foundation (empty while loading — decoration only until then). */
  public readonly bookmarkedIds = computed(() => this.mentionBookmarkService.state().data);
  private readonly readState = this.mentionReadStateService.state;
  // Primitive read-state status projections — the snapshot effect must fire on load transitions only, not on every doc change (a single toggle would otherwise re-snapshot and reshuffle the page mid-triage).
  private readonly readStateLoading = computed(() => this.readState().loading);
  private readonly readStateErrored = computed(() => this.readState().error !== null);
  /** Read-state snapshot behind the unread feed filter — refreshed only on mode entry, load completion, and the two mark-all actions, so single toggles restyle in place and pagination stays stable. */
  private readonly unreadSnapshot = signal<ReadStateData | null>(null);

  private readonly windowIndex = computed(() => Math.floor((this.currentPage() * this.pageSize()) / this.serverWindowSize));
  // The paginator is capped at the last servable window, so serverOffset stays within MENTION_MAX_FEED_OFFSET (100,000).
  private readonly serverOffset = computed(() => this.windowIndex() * this.serverWindowSize);
  private readonly localOffset = computed(() => this.currentPage() * this.pageSize() - this.serverOffset());

  // === Request pipelines ===
  private readonly searchQuery: Signal<string> = this.initSearchQuery();
  /** The live feed predicate as a request fragment — drives the feed, the count, and (via `analyticsFilters`) the analytics tab. */
  public readonly currentFilters: Signal<MentionFilters> = this.initCurrentFilters();
  /** Analytics never filter by bookmark or read state — `mentionIds` and the unread params are feed+count only, so the analytics input strips them. */
  public readonly analyticsFilters: Signal<MentionFilters> = this.initAnalyticsFilters();
  private readonly feedRequest: Signal<SocialListeningFeedRequest | null> = this.initFeedRequest();
  private readonly countRequest: Signal<SocialListeningCountRequest | null> = this.initCountRequest();
  private readonly feedCacheKey: Signal<string | null> = this.initFeedCacheKey();
  private readonly feedState: Signal<LoadableState<SocialListeningFeedResponse>> = this.initFeedState();
  private readonly countState: Signal<LoadableState<number>> = this.initCountState();
  public readonly totalRecords: Signal<number> = this.initTotalRecords();
  // The server clamps offset at MENTION_MAX_FEED_OFFSET — never advertise pages past the last servable window.
  public readonly paginatorTotalRecords = computed(() => Math.min(this.totalRecords(), MENTION_MAX_FEED_OFFSET + this.serverWindowSize));
  public readonly countError = computed(() => this.countState().error);
  private readonly subProjectsState: Signal<LoadableState<SocialListeningSubProject[]>> = this.initSubProjectsState();
  private readonly platformsState: Signal<LoadableState<SocialListeningPlatform[]>> = this.initPlatformsState();

  public readonly subProjectOptions = computed(() => mapSubProjectsToOptions(this.subProjectsState().data));
  public readonly platformOptions = computed(() => mapPlatformsToOptions(this.platformsState().data));
  public readonly optionsLoading = computed(() => this.subProjectsState().loading || this.platformsState().loading);

  // === Filter-option pipelines (3017): lazy — gated on filtersOpenedOnce, never fire on page load ===
  /** Latches once a languages fetch succeeds — distinguishes "options landed empty" from "never fetched". */
  private readonly languagesResolved = signal(false);
  private readonly languagesState: Signal<LoadableState<string[]>> = this.initLanguagesState();
  private readonly keywordsState: Signal<LoadableState<string[]>> = this.initScopedOptionsState((req) => this.socialListeningService.getMentionsKeywords(req));
  // The filter panel needs the full tag vocabulary for the scope, not the analytics top-10 default.
  private readonly tagsState: Signal<LoadableState<string[]>> = this.initScopedOptionsState((req) =>
    this.socialListeningService.getMentionsTags({ ...req, limit: MENTION_FILTER_MAX_VALUES }).pipe(map((tags) => tags.map((tag) => tag.TAG)))
  );
  private readonly authorsState: Signal<LoadableState<AuthorOption[]>> = this.initAuthorsState();

  public readonly languageOptions = computed(() => mapLanguagesToOptions(this.languagesState().data));
  public readonly languagesLoading = computed(() => this.languagesState().loading);
  public readonly languagesError = computed(() => this.languagesState().error !== null);
  public readonly availableKeywords = computed(() => this.keywordsState().data);
  public readonly keywordsLoading = computed(() => this.keywordsState().loading);
  public readonly keywordsError = computed(() => this.keywordsState().error !== null);
  public readonly availableTags = computed(() => this.tagsState().data);
  public readonly tagsLoading = computed(() => this.tagsState().loading);
  public readonly tagsError = computed(() => this.tagsState().error !== null);
  // A kept author selection can drop out of the rescoped options — mergeSelectedAuthors re-adds
  // it as a placeholder so the multiselect chip label still resolves.
  public readonly availableAuthors = computed(() => mergeSelectedAuthors(this.authorsState().data, this.selectedAuthors()));
  public readonly authorsLoading = computed(() => this.authorsState().loading);
  public readonly authorsError = computed(() => this.authorsState().error !== null);

  public readonly activeFilterCount = computed(() => countActiveFilters(this.currentPredicate()));
  // Analytics can't apply bookmark/read filters (`mentionIds` is feed-only, read state is never sent) —
  // on that tab those pills would claim a filter the charts ignore, so build pills without them.
  public readonly activeFilterPills = computed(() => {
    const predicate = this.currentPredicate();
    if (this.activeTab() === 'analytics') {
      return buildActiveFilterPills({
        ...predicate,
        bookmarkFilter: DEFAULT_MENTION_PREDICATE.bookmarkFilter,
        readFilter: DEFAULT_MENTION_PREDICATE.readFilter,
      });
    }
    return buildActiveFilterPills(predicate);
  });

  // No feedState fallback: on a cache miss the feed's data belongs to a prior window/filter set, so serving it flashes stale rows.
  private readonly currentWindowData = computed(() => this.windowCache().get(this.windowIndex()) ?? EMPTY_FEED_RESPONSE);

  public readonly loading = computed(() => {
    // Unread mode filters against the persisted read state — hold loading until it arrives so the
    // "all caught up" empty state can't paint before unread mentions are actually known.
    if (this.selectedReadFilter() === 'unread' && this.readState().loading) return true;
    // Bookmark mode filters by the persisted bookmark set — same hold, so the "no bookmarks" empty state can't flash mid-load.
    if (this.selectedBookmarkFilter() === 'bookmarked' && this.mentionBookmarkService.state().loading) return true;
    const windowData = this.windowCache().get(this.windowIndex());
    // A miss means the fetch is in flight or queued behind the coalescing debounce — hold loading so stale rows never paint.
    if (!windowData) return this.feedRequest() !== null && !this.feedState().error;
    if (windowData.complete) return false;
    // Partial window: the visible page extends past what phase 2 has filled so far.
    const neededEnd = this.localOffset() + this.pageSize();
    if (neededEnd <= windowData.mentions.length) return false;
    return this.backgroundLoading() || this.feedState().loading;
  });
  public readonly error = computed(() => this.feedState().error);
  /** Unread mode with a failed read-state load: the list swaps for an error banner so an empty fallback doc can't pose as "all caught up". */
  public readonly readStateError = computed(() => this.selectedReadFilter() === 'unread' && this.readState().error !== null);
  /** Bookmark mode with a failed bookmark load: same swap, so an empty fallback set can't pose as "no bookmarked mentions". */
  public readonly bookmarkStateError = computed(() => this.selectedBookmarkFilter() === 'bookmarked' && this.mentionBookmarkService.state().error !== null);
  /** Current window's background fill failed past its automatic retry — the list swaps the empty state for a retry row. */
  public readonly phase2Failed = computed(() => this.windowCache().get(this.windowIndex())?.phase2Failed === true);
  public readonly first = computed(() => this.currentPage() * this.pageSize());
  public readonly mentions: Signal<Mention[]> = this.initMentions();
  public readonly readMentionIds: Signal<Set<string>> = this.initReadMentionIds();
  public readonly dataComputedAt: Signal<Date | null> = this.initDataComputedAt();

  // === Predicate/scope codec state ===
  private readonly signals: SocialListeningSignals = {
    selectedSentiment: this.selectedSentiment,
    selectedRelevance: this.selectedRelevance,
    selectedLanguage: this.selectedLanguage,
    selectedHasTitle: this.selectedHasTitle,
    selectedBookmarkFilter: this.selectedBookmarkFilter,
    selectedReadFilter: this.selectedReadFilter,
    selectedKeywords: this.selectedKeywords,
    selectedTags: this.selectedTags,
    selectedAuthors: this.selectedAuthors,
    searchInput: this.searchInput,
  };

  // `search` comes off the debounced, min-length-gated query so the pills, the URL and the fetched
  // rows all describe the same filter — the raw input would advertise a search that isn't applied yet.
  public readonly currentPredicate = computed<FilterPredicate>(() => ({ ...predicateFromSignals(this.signals), search: this.searchQuery() }), {
    equal: predicatesEqual,
  });

  public readonly currentScope = computed<ScopeState>(
    () => ({
      activeTab: this.activeTab(),
      period: this.selectedPeriod(),
      sourceProjectId: this.selectedProject(),
      platform: this.selectedPlatform(),
    }),
    { equal: scopesEqual }
  );

  // Scope bundle captured by saved views (period/project/platform only — the tab is not part of a view).
  private readonly scopeSignals: SocialListeningScopeSignals = {
    selectedPeriod: this.selectedPeriod,
    selectedProject: this.selectedProject,
    selectedPlatform: this.selectedPlatform,
  };

  public readonly currentViewScope = computed<SavedViewScope>(() => viewScopeFromSignals(this.scopeSignals), { equal: viewScopesEqual });

  // === Saved-view state (derived from the SavedFilterService store) ===
  public readonly savedFilters = computed(() => this.savedFilterService.state().data);
  public readonly deletingViewIds = computed(() => this.savedFilterService.deletingViewIds());
  public readonly savedFiltersLoading = computed(() => this.savedFilterService.state().loading);
  public readonly savedViewsReadOnly = computed(() => this.savedFilterService.state().readOnly);
  public readonly atSavedViewLimit = computed(() => this.savedFilters().length >= MAX_SAVED_FILTERS_PER_PROJECT);
  public readonly savedViewNames = computed(() => this.savedFilters().map((v) => v.name));
  public readonly savedViewLimit = MAX_SAVED_FILTERS_PER_PROJECT;
  public readonly canSaveCurrentView = computed(
    () => (!isEmptyPredicate(this.currentPredicate()) || !isDefaultViewScope(this.currentViewScope(), this.defaultPeriod)) && !this.savedViewsReadOnly()
  );
  public readonly activeViewName: Signal<string | null> = this.initActiveViewName();

  public constructor() {
    // Relative timestamps refresh on a shared tick — browser-only (setInterval), one interval
    // for the whole page instead of PCC's per-card intervals.
    if (isPlatformBrowser(this.platformId)) {
      const intervalId = setInterval(() => this.timeTick.update((value) => value + 1), MENTION_TIME_TICK_INTERVAL_MS);
      this.destroyRef.onDestroy(() => clearInterval(intervalId));
    }

    // URL → state. Deep-equality guards make this idempotent for emissions we caused ourselves
    // (the URL-write effect below) and for router churn unrelated to our params.
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const { predicate, scope, viewId } = decodePredicateFromQueryParams(params, this.defaultPeriod);
      if (predicatesEqual(predicate, this.currentPredicate()) && scopesEqual(scope, this.currentScope()) && viewId === this.activeViewId()) return;
      applyPredicateToSignals(predicate, this.signals);
      this.activeViewId.set(viewId);
      this.activeTab.set(scope.activeTab);
      this.selectedPeriod.set(scope.period);
      this.selectedProject.set(scope.sourceProjectId);
      this.selectedPlatform.set(scope.platform);
      this.commitScopeKey();
    });

    // State → URL. `merge` preserves 3rd-party params (utm_*); the encoder emits explicit nulls
    // for owned keys at default so merge removes them. queryParamsEqual prevents write loops.
    effect(() => {
      const target = encodePredicateToQueryParams(this.currentPredicate(), this.currentScope(), this.activeViewId(), this.defaultPeriod);
      // Don't strip a deep-linked ?search= while the debounced query is still catching up to the input.
      const pendingSearch = this.searchInput().trim();
      if (pendingSearch.length >= MENTION_SEARCH_MIN_CHARS && pendingSearch !== this.searchQuery()) return;
      if (queryParamsEqual(target, this.route.snapshot.queryParams)) return;
      untracked(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: target,
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    });

    // A language the scope carries no rows for (stale URL, rescoped period) is dropped — the resolved latch
    // separates "landed empty" (invalidate) from "never fetched" (don't wipe a deep-linked ?language=).
    effect(() => {
      const state = this.languagesState();
      if (!this.languagesResolved() || state.loading || state.error) return;
      const selected = untracked(this.selectedLanguage);
      if (selected === DEFAULT_MENTION_PREDICATE.language) return;
      if (state.data.some((language) => language.toLowerCase() === selected.toLowerCase())) return;
      untracked(() => this.selectedLanguage.set(DEFAULT_MENTION_PREDICATE.language));
    });

    // Leaving the analytics tab destroys the child mid-export — the parent owns clearing the header's
    // loading state and resetting the nonce, or remounting the child replays the last export.
    effect(() => {
      if (this.activeTab() === 'analytics') return;
      untracked(() => {
        this.exporting.set(false);
        this.exportNonce.set(0);
      });
    });

    // Close the panels on tab leave — remounting them on return would steal focus into a dialog the user never reopened.
    effect(() => {
      if (this.activeTab() === 'analytics')
        untracked(() => {
          this.filtersOpen.set(false);
          this.viewsOpen.set(false);
        });
    });

    // Any scope/filter change restarts pagination from the first page with a cold window cache.
    // (foundationSlug + selectedPeriod are explicit deps; the selects feed in via currentFilters.)
    // The unread snapshot rides currentFilters too — entering/leaving unread mode and mark-all
    // refreshes reset here, so there is no separate unread page reset or clamp effect anymore.
    effect(() => {
      this.foundationSlug();
      // Bookmark mode freezes the request's period — depending on it here clears the cache with no refetch (skeleton hang).
      if (this.selectedBookmarkFilter() !== 'bookmarked') this.selectedPeriod();
      this.currentFilters();
      untracked(() => {
        this.currentPage.set(0);
        this.windowCache.set(new Map());
        this.retriedWindows.clear();
        this.newestMentionTs = null;
      });
    });

    // Preference state is per user + foundation: reload it as either resolves or changes (PCC port).
    effect(() => {
      const userId = this.userService.user()?.sub;
      const projectId = this.projectContextService.selectedFoundationSfid();
      const ctx = userId && projectId ? { userId, projectId } : null;
      untracked(() => {
        this.mentionBookmarkService.setContext(ctx);
        this.mentionReadStateService.setContext(ctx);
        this.savedFilterService.setContext(ctx);
      });
    });

    // Foundation switch resets the sub-project + platform scope (their option lists rescope).
    // selectedBookmarkFilter/selectedReadFilter are intentionally NOT reset — both are date-independent
    // user state (PCC parity); the persisted read state itself reloads via the context effect above.
    effect(() => {
      const current = this.foundationSlug();
      const previous = this.previousFoundationSlug;
      if (previous !== null && previous !== '' && previous !== current) {
        this.selectedProject.set('all');
        this.selectedPlatform.set('all');
        this.activeViewId.set(null);
        // The banner names a view from the previous foundation — leaving it up would save into the new foundation's store.
        this.foreignViewBannerVisible.set(false);
      }
      this.previousFoundationSlug = current;
    });

    // Unread mode runs off a read-state snapshot: capture on mode entry and when the persisted state
    // finishes loading — never on single toggles (primitive status deps only), so a read row restyles
    // in place instead of vanishing mid-triage. The bulk-rollback tick is the one data-adjacent dep: a
    // failed mark-all restores the prior doc without a loading/error transition, and the snapshot must
    // re-capture it or the unread feed keeps paging a cutoff that never persisted.
    effect(() => {
      this.selectedReadFilter();
      this.readStateLoading();
      this.readStateErrored();
      this.mentionReadStateService.bulkRollbackTick();
      untracked(() => this.refreshUnreadSnapshot());
    });

    // A foundation with a single sub-project locks the scope to it (ported from PCC). It lives here,
    // not in the header, so the latch can commit the new scope key — establishing the default scope
    // is not a user scope change and must not drop keywords/tags supplied by the URL.
    effect(() => {
      const options = this.subProjectOptions();
      if (options.length !== 2 || untracked(this.selectedProject) !== 'all') return;
      untracked(() => {
        this.selectedProject.set(options[1].value);
        this.commitScopeKey();
      });
    });

    // Scope change (foundation / platform / sub-project) rescopes the keyword + tag option lists,
    // so stale selections are dropped (their options may no longer exist).
    effect(() => {
      const scopeKey = this.computeScopeKey();
      if (!scopeKey) return;
      const previous = this.previousScopeKey;
      if (previous !== null && previous !== scopeKey) {
        this.selectedKeywords.set([]);
        this.selectedTags.set([]);
      }
      this.previousScopeKey = scopeKey;
    });

    // Foreign-view detector (PCC port): gated on !savedFiltersLoading() so a cold ?view= id isn't wiped
    // before the list arrives. Not-found + non-default state → clear id + banner; found-but-drifted → silent clear.
    effect(() => {
      const projectId = this.projectContextService.selectedFoundationSfid();
      const userId = this.userService.user()?.sub;
      if (!projectId || !userId) return;
      if (this.savedFiltersLoading()) return;
      const id = this.activeViewId();
      if (!id) return;
      const predicate = this.currentPredicate();
      const scope = this.currentViewScope();
      untracked(() => {
        const view = this.savedFilters().find((v) => v.id === id);
        if (!view) {
          this.activeViewId.set(null);
          if (!isEmptyPredicate(predicate) || !isDefaultViewScope(scope, this.defaultPeriod)) {
            this.foreignViewBannerVisible.set(true);
          }
        } else if (!sameSavedViewLabelPredicate(predicate, view.predicate) || !viewScopesEqual(scope, view.scope)) {
          this.activeViewId.set(null);
        }
      });
    });

    // One-way latch (3017): defer filter-option requests until the panel is first opened;
    // prefetchFilterOptions() on hover typically arms it even earlier.
    toObservable(this.filtersOpen)
      .pipe(filter(Boolean), take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.filtersOpenedOnce.set(true));
  }

  public onPageChange(event: { page: number; rows: number }): void {
    this.currentPage.set(event.page);
    this.pageSize.set(event.rows);
  }

  /** Card toggle → the bookmark service owns the cap/loading gates, the optimistic write, and the toasts. */
  public onBookmarkToggled(mention: Mention): void {
    this.mentionBookmarkService.toggleBookmark(mention.id);
  }

  /** Card toggle → the read-state service owns the loading gate, the optimistic write, and the toasts. */
  public onReadToggled(mention: Mention): void {
    this.mentionReadStateService.toggleRead(mention.id, mention.timestamp);
  }

  /** The cutoff is the newest loaded MENTION_TS — never wall-clock, so backfilled mentions aren't silently hidden. */
  public onMarkAllAsRead(): void {
    // The read-state doc is foundation-global, so a narrowed feed's newest can't stand in for it. Same when
    // window 0 never landed (paged away mid-fetch) — the retained global-newest is unknown, so resolve it live.
    if (this.feedNarrowed() || !this.newestMentionTs) {
      void this.markAllFromUnfilteredNewest();
      return;
    }
    this.mentionReadStateService.markAllAsRead(this.newestMentionTs);
    // A new cutoff invalidates the unread snapshot — refresh so the unread view re-queries instead of paging stale state.
    this.refreshUnreadSnapshot();
  }

  public onMarkAllAsUnread(): void {
    this.mentionReadStateService.markAllAsUnread();
    this.refreshUnreadSnapshot();
  }

  /** Manual retry of a phase-2-failed window: the tick re-runs the fetch pipeline; a successful refetch overwrites the flagged cache entry (clearing it here would flash the bare empty state for a frame). */
  public retryWindow(): void {
    this.feedRetryTick.update((tick) => tick + 1);
  }

  /** Arms the deferred filter-option fetches on hover/focus so the round-trip hides behind the intent→click gap (PCC port). */
  public prefetchFilterOptions(): void {
    if (!this.filtersOpenedOnce()) {
      this.filtersOpenedOnce.set(true);
    }
  }

  // === Saved views (LFXV2-3002 Block 3, PCC port) ===

  /** Applies a view's predicate + scope; the commit keeps the scope-key reset effect from wiping its keywords/tags. */
  public applyView(view: SavedFilter): void {
    this.activeViewId.set(view.id);
    applyPredicateToSignals(view.predicate, this.signals);
    applyViewScopeToSignals(view.scope, this.scopeSignals);
    this.commitScopeKey();
  }

  public saveCurrentView(name: string): void {
    // On a failed write the rollback drops the view — clearing the pending id keeps the foreign-view
    // detector from misreading the user's own failed save as a shared preset.
    const created = this.savedFilterService.addSavedFilter(name, this.currentPredicate(), this.currentViewScope(), () => {
      if (created && this.activeViewId() === created.id) this.activeViewId.set(null);
    });
    if (created) this.activeViewId.set(created.id);
  }

  public onSavedViewDeleted(id: string): void {
    this.savedFilterService.removeSavedFilter(id, () => {
      if (this.activeViewId() === id) this.resetToDefaultViewState();
    });
  }

  public onViewSelected(view: SavedFilter): void {
    this.applyView(view);
    this.viewsOpen.set(false);
    this.foreignViewBannerVisible.set(false);
  }

  public onDefaultViewSelected(): void {
    this.resetToDefaultViewState();
    this.viewsOpen.set(false);
    this.foreignViewBannerVisible.set(false);
  }

  public openSaveDialog(): void {
    // Guard at the entry point so a user at the limit (or read-only) doesn't fill in a name only to be rejected on close.
    if (this.atSavedViewLimit() || this.savedViewsReadOnly()) return;

    const ref = this.dialogService.open(SaveViewDialogComponent, {
      header: 'Save current view',
      modal: true,
      closable: true,
      dismissableMask: true,
      style: { width: '24rem' },
      draggable: false,
      resizable: false,
      data: { existingNames: this.savedViewNames() },
    });
    ref?.onClose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((name: string | undefined) => {
      if (name) {
        this.saveCurrentView(name);
        this.foreignViewBannerVisible.set(false);
      }
    });
  }

  public onSaveFromForeignBanner(): void {
    // Dismissal happens in openSaveDialog's onClose when a save completes — dismissing here would fire even on cancel.
    this.openSaveDialog();
  }

  public dismissForeignViewBanner(): void {
    this.foreignViewBannerVisible.set(false);
  }

  /** Triggers the analytics PNG export (LFXV2-3018) by bumping the nonce the analytics component reacts to. */
  public onExportAnalytics(): void {
    this.exportNonce.update((nonce) => nonce + 1);
  }

  /** Resets the predicate to DEFAULT_MENTION_PREDICATE; cloned arrays make the URL-write effect re-encode cleanly. */
  public clearAllFilters(): void {
    applyPredicateToSignals({ ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [] }, this.signals);
  }

  /** Removes one active filter dimension from the summary pills row (id = FilterPredicate key). */
  public removeFilterPill(id: string): void {
    const resetters: Record<keyof FilterPredicate, () => void> = {
      sentiment: () => this.selectedSentiment.set(DEFAULT_MENTION_PREDICATE.sentiment),
      relevance: () => this.selectedRelevance.set(DEFAULT_MENTION_PREDICATE.relevance),
      language: () => this.selectedLanguage.set(DEFAULT_MENTION_PREDICATE.language),
      hasTitle: () => this.selectedHasTitle.set(DEFAULT_MENTION_PREDICATE.hasTitle),
      bookmarkFilter: () => this.selectedBookmarkFilter.set(DEFAULT_MENTION_PREDICATE.bookmarkFilter),
      readFilter: () => this.selectedReadFilter.set(DEFAULT_MENTION_PREDICATE.readFilter),
      keywords: () => this.selectedKeywords.set([]),
      tags: () => this.selectedTags.set([]),
      authors: () => this.selectedAuthors.set([]),
      search: () => this.searchInput.set(''),
    };
    resetters[id as keyof FilterPredicate]?.();
  }

  /** Any active feed predicate or a non-default period means the loaded windows (and their newest) are a subset of the foundation feed. */
  private feedNarrowed(): boolean {
    return Object.keys(this.currentFilters()).length > 0 || this.selectedPeriod() !== this.defaultPeriod;
  }

  /** Resolves the foundation-global newest (limit-1 unfiltered fetch; the feed sorts newest-first) and stamps it as the read cutoff. */
  private async markAllFromUnfilteredNewest(): Promise<void> {
    const foundationSlug = this.foundationSlug();
    if (!foundationSlug || this.markAllPending) return;
    this.markAllPending = true;

    try {
      const response = await firstValueFrom(this.socialListeningService.getMentionsFeed({ foundationSlug, period: this.defaultPeriod, limit: 1, offset: 0 }));
      // A foundation switch mid-flight rebound the preference store — never stamp the old foundation's cutoff into the new one's doc.
      if (this.foundationSlug() !== foundationSlug) return;
      // Empty window (no mentions in the default period): fall back to the newest already loaded so a
      // past-period feed still marks instead of silently no-oping.
      const latestTs = this.newestTsOf(response.mentions) ?? this.newestMentionTs ?? this.newestTsOf(this.currentWindowData().mentions);
      this.mentionReadStateService.markAllAsRead(latestTs);
      // A new cutoff invalidates the unread snapshot — refresh so the unread view re-queries instead of paging stale state.
      this.refreshUnreadSnapshot();
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Mark all as read failed',
        detail: 'Could not resolve the latest mentions — nothing was marked as read. Please try again.',
      });
    } finally {
      this.markAllPending = false;
    }
  }

  /**
   * Captures the persisted read state as the unread request snapshot. Only meaningful in unread mode —
   * any other read filter clears it, so the feed/count requests drop the unread params immediately.
   * A loading or errored state also clears it: the request null-guards then hold the feed rather than
   * let an empty fallback doc classify every mention as unread.
   */
  private refreshUnreadSnapshot(): void {
    const state = this.readState();
    this.unreadSnapshot.set(this.selectedReadFilter() === 'unread' && !state.loading && !state.error ? state.data : null);
  }

  private computeScopeKey(): string | null {
    const slug = this.foundationSlug();
    if (!slug) return null;
    return `${slug}|${this.selectedPlatform()}|${this.selectedProject()}`;
  }

  /** Commits the current scope key without resetting — used after applying decoded URL state. */
  private commitScopeKey(): void {
    const scopeKey = this.computeScopeKey();
    if (!scopeKey) return;
    this.previousScopeKey = scopeKey;
  }

  /** Resets predicate + scope to the defaults and drops the active view — the "No Preset View" / active-view-deleted path. */
  private resetToDefaultViewState(): void {
    applyPredicateToSignals({ ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [] }, this.signals);
    applyViewScopeToSignals({ ...DEFAULT_MENTION_VIEW_SCOPE, period: this.defaultPeriod }, this.scopeSignals);
    this.activeViewId.set(null);
    this.commitScopeKey();
  }

  private initSearchQuery(): Signal<string> {
    // Seeded from the deep link so the first feed+count already carry `search` — waiting out the
    // debounce would fire an unfiltered fetch and flash unfiltered rows.
    const seeded = normalizeMentionSearch(this.initialSearch);
    return toSignal(toObservable(this.searchInput).pipe(debounceTime(MENTION_SEARCH_DEBOUNCE_MS), map(normalizeMentionSearch), distinctUntilChanged()), {
      initialValue: seeded,
    });
  }

  private initCurrentFilters(): Signal<MentionFilters> {
    return computed(() => {
      // Bookmark mode: the feed/count requests carry the bookmarked ID set (empty sets are dropped
      // by buildMentionFilters — the request computeds turn an empty set into a null request).
      const mentionIds = this.selectedBookmarkFilter() === 'bookmarked' ? Array.from(this.bookmarkedIds()) : undefined;

      return buildMentionFilters({
        sentiment: this.selectedSentiment(),
        relevance: this.selectedRelevance(),
        platform: this.selectedPlatform(),
        keywords: this.selectedKeywords(),
        tags: this.selectedTags(),
        authors: this.selectedAuthors(),
        sourceProjectId: this.selectedProject(),
        language: this.selectedLanguage(),
        hasTitle: this.selectedHasTitle(),
        search: this.searchQuery(),
        mentionIds,
        // Unread mode: the read-state snapshot rides the same request path — the server filters period-wide.
        unread: this.unreadSnapshot() ?? undefined,
      });
    });
  }

  private initAnalyticsFilters(): Signal<MentionFilters> {
    return computed(() => {
      // Analytics stays bookmark- and read-state-blind: strip both per-user filter sets.
      const filters = { ...this.currentFilters() };
      delete filters.mentionIds;
      delete filters.unreadOnly;
      delete filters.readIds;
      delete filters.unreadIds;
      delete filters.readBeforeTs;
      return filters;
    });
  }

  private initFeedRequest(): Signal<SocialListeningFeedRequest | null> {
    return computed(() => {
      const foundationSlug = this.foundationSlug();
      if (!foundationSlug) return null;
      // Bookmark mode: a constant valid period token keeps period changes from refetching (the server
      // skips the date window for mentionIds anyway); an empty bookmark set skips the request entirely.
      const bookmarked = this.selectedBookmarkFilter() === 'bookmarked';
      const period = bookmarked ? this.defaultPeriod : this.selectedPeriod();
      if (bookmarked && this.bookmarkedIds().size === 0) return null;
      // Unread mode: no request until the read-state snapshot exists — an empty fallback doc would classify everything as unread.
      if (this.selectedReadFilter() === 'unread' && this.unreadSnapshot() === null) return null;
      return {
        foundationSlug,
        period,
        limit: this.serverWindowSize,
        offset: this.serverOffset(),
        ...this.currentFilters(),
      };
    });
  }

  private initCountRequest(): Signal<SocialListeningCountRequest | null> {
    return computed(() => {
      const foundationSlug = this.foundationSlug();
      if (!foundationSlug) return null;
      const bookmarked = this.selectedBookmarkFilter() === 'bookmarked';
      const period = bookmarked ? this.defaultPeriod : this.selectedPeriod();
      if (bookmarked && this.bookmarkedIds().size === 0) return null;
      // Unread mode: no request until the read-state snapshot exists — an empty fallback doc would classify everything as unread.
      if (this.selectedReadFilter() === 'unread' && this.unreadSnapshot() === null) return null;
      return { foundationSlug, period, ...this.currentFilters() };
    });
  }

  /** Fingerprint of the live request minus window bounds — identifies the filter set a feed response belongs to. */
  private initFeedCacheKey(): Signal<string | null> {
    return computed(() => {
      const req = this.feedRequest();
      return req ? JSON.stringify({ ...req, limit: 0, offset: 0 }) : null;
    });
  }

  /**
   * Two-phase windowed feed fetch (PCC port): phase 1 paints the visible page fast; phase 2 fills
   * the rest of the window in the background as one stream — `switchMap` cancels it on re-entry.
   */
  private initFeedState(): Signal<LoadableState<SocialListeningFeedResponse>> {
    return toSignal(
      toObservable(computed(() => ({ req: this.feedRequest(), tick: this.feedRetryTick() }))).pipe(
        debounceTime(0), // Coalesce synchronous signal changes into one emission
        switchMap(({ req }) => {
          if (req === null) {
            return of<LoadableState<SocialListeningFeedResponse>>({ loading: false, error: null, data: EMPTY_FEED_RESPONSE });
          }

          const windowIdx = Math.floor((req.offset ?? 0) / this.serverWindowSize);
          const cacheKey = JSON.stringify({ ...req, limit: 0, offset: 0 });
          // Only a fully filled window can be served from cache — a partial one would strand the rows phase 2 never wrote.
          const cached = this.windowCache().get(windowIdx);
          if (cached?.complete) {
            return of<LoadableState<SocialListeningFeedResponse>>({ loading: false, error: null, data: cached });
          }

          // Phase 2 re-requests from offset + initialLimit — past MENTION_MAX_FEED_OFFSET that offset clamps, duplicating rows.
          const canSplitWindow = (req.offset ?? 0) + this.pageSize() <= MENTION_MAX_FEED_OFFSET;
          const initialLimit = this.localOffset() === 0 && canSplitWindow ? this.pageSize() : this.serverWindowSize;
          const initialReq = { ...req, limit: initialLimit };

          return this.socialListeningService.getMentionsFeed(initialReq).pipe(
            switchMap((phase1Data) => {
              const remaining = this.serverWindowSize - initialLimit;
              const phase1Complete = remaining <= 0 || phase1Data.mentions.length < initialLimit;
              this.updateWindowCache(windowIdx, cacheKey, { ...phase1Data, complete: phase1Complete });
              const phase1State: LoadableState<SocialListeningFeedResponse> = { loading: false, error: null, data: phase1Data };

              if (phase1Complete) return of(phase1State);

              this.backgroundLoading.set(true);
              const backgroundRequest = { ...req, limit: remaining, offset: (req.offset ?? 0) + initialLimit };
              const phase2$ = this.socialListeningService.getMentionsFeed(backgroundRequest).pipe(
                tap((backgroundData) => {
                  const previous = this.windowCache().get(windowIdx);
                  this.updateWindowCache(windowIdx, cacheKey, {
                    mentions: [...(previous?.mentions ?? []), ...backgroundData.mentions],
                    computedAt: backgroundData.computedAt ?? previous?.computedAt ?? null,
                    complete: true,
                  });
                }),
                ignoreElements(),
                // First failure: evict and force one refetch (in-window paging never re-emits feedRequest); a
                // second keeps the partial window flagged for manual retry. Stale failures skip both.
                catchError(() => {
                  if (cacheKey === untracked(this.feedCacheKey)) {
                    if (!this.retriedWindows.has(windowIdx)) {
                      this.retriedWindows.add(windowIdx);
                      this.evictWindowCache(windowIdx);
                      this.feedRetryTick.update((tick) => tick + 1);
                    } else {
                      this.flagWindowFailed(windowIdx, cacheKey);
                    }
                  }
                  return EMPTY;
                }),
                finalize(() => this.backgroundLoading.set(false))
              );

              return merge(of(phase1State), phase2$);
            }),
            // Friendly copy at the write site — the raw HttpErrorResponse text ("500 OK") means nothing to users.
            catchError(() =>
              of<LoadableState<SocialListeningFeedResponse>>({
                loading: false,
                error: "Mentions couldn't be loaded. Try again or widen the filters.",
                data: EMPTY_FEED_RESPONSE,
              })
            ),
            startWith<LoadableState<SocialListeningFeedResponse>>({ loading: true, error: null, data: EMPTY_FEED_RESPONSE })
          );
        })
      ),
      { initialValue: { loading: true, error: null, data: EMPTY_FEED_RESPONSE } }
    );
  }

  private initCountState(): Signal<LoadableState<number>> {
    return toSignal(
      toObservable(this.countRequest).pipe(
        debounceTime(0), // Coalesce synchronous signal changes into one emission
        switchMap((req) => {
          if (req === null) return of<LoadableState<number>>({ loading: false, error: null, data: 0 });
          return this.socialListeningService.getMentionsCount(req).pipe(
            map((response): LoadableState<number> => ({ loading: false, error: null, data: response.total })),
            // A failed count must not masquerade as a legitimate zero — the template surfaces the error.
            catchError(() => of<LoadableState<number>>({ loading: false, error: 'Failed to load the mention count', data: 0 })),
            startWith<LoadableState<number>>({ loading: true, error: null, data: 0 })
          );
        })
      ),
      { initialValue: { loading: false, error: null, data: 0 } }
    );
  }

  private initSubProjectsState(): Signal<LoadableState<SocialListeningSubProject[]>> {
    return this.initFoundationOptions((foundationSlug) => this.socialListeningService.getMentionsProjects({ foundationSlug }));
  }

  /** Languages option fetch (3017): lazy like the other filter options, and scoped like keywords/tags so the dropdown and the invalid-language reset track the actual feed scope. */
  private initLanguagesState(): Signal<LoadableState<string[]>> {
    return this.initScopedOptionsState((req) => this.socialListeningService.getMentionsLanguages(req).pipe(tap(() => this.languagesResolved.set(true))));
  }

  /** Scoped option fetches (3017): lazy on the Filters button, refetch when the platform/sub-project scope changes. */
  private initScopedOptionsState<T>(fetchFn: (req: SocialListeningScopedOptionsRequest) => Observable<T[]>): Signal<LoadableState<T[]>> {
    return toSignal(
      toObservable(
        computed(() => ({
          foundationSlug: this.foundationSlug(),
          period: this.selectedPeriod(),
          platform: this.selectedPlatform(),
          sourceProjectId: this.selectedProject(),
          opened: this.filtersOpenedOnce(),
        }))
      ).pipe(
        debounceTime(0), // Coalesce synchronous signal changes (foundation switch + scope reset) into one fetch
        filter((t) => !!t.foundationSlug && !!t.period && t.opened),
        switchMap((t) =>
          fetchFn({
            foundationSlug: t.foundationSlug,
            period: t.period,
            platform: t.platform !== 'all' ? t.platform : undefined,
            sourceProjectId: t.sourceProjectId !== 'all' ? t.sourceProjectId : undefined,
          }).pipe(
            map((data): LoadableState<T[]> => ({ loading: false, error: null, data })),
            catchError(() => of<LoadableState<T[]>>({ loading: false, error: 'Failed to load options', data: [] })),
            startWith<LoadableState<T[]>>({ loading: true, error: null, data: [] })
          )
        )
      ),
      { initialValue: { loading: false, error: null, data: [] } }
    );
  }

  /**
   * Author options (3017): cascade off every OTHER filter (the request omits `authors` itself).
   * Waits for the feed load + 300 ms debounce so it doesn't contend for the Snowflake pool.
   */
  private initAuthorsState(): Signal<LoadableState<AuthorOption[]>> {
    return toSignal(
      toObservable(
        computed(() => {
          const req = {
            foundationSlug: this.foundationSlug(),
            period: this.selectedPeriod(),
            platform: this.selectedPlatform(),
            sourceProjectId: this.selectedProject(),
            sentiment: this.selectedSentiment(),
            relevance: this.selectedRelevance(),
            language: this.selectedLanguage(),
            hasTitle: this.selectedHasTitle(),
            keywords: this.selectedKeywords(),
            tags: this.selectedTags(),
            search: this.searchQuery(),
          };
          const ready = !!req.foundationSlug && !!req.period && this.filtersOpenedOnce() && !this.feedState().loading;
          return { req, key: JSON.stringify(req), ready };
        })
      ).pipe(
        filter((t) => t.ready),
        debounceTime(300),
        distinctUntilChanged((a, b) => a.key === b.key),
        switchMap(({ req }) =>
          this.socialListeningService
            .getMentionsAuthors({
              foundationSlug: req.foundationSlug,
              period: req.period,
              ...buildMentionFilters({
                sentiment: req.sentiment,
                relevance: req.relevance,
                platform: req.platform,
                keywords: req.keywords,
                tags: req.tags,
                sourceProjectId: req.sourceProjectId,
                language: req.language,
                hasTitle: req.hasTitle,
                search: req.search,
              }),
            })
            .pipe(
              map((data): LoadableState<AuthorOption[]> => ({ loading: false, error: null, data: mapAuthorsToOptions(data) })),
              // Surface the failure like the other option lists — an empty success and a transport failure must not look alike.
              catchError(() => of<LoadableState<AuthorOption[]>>({ loading: false, error: 'Failed to load options', data: [] })),
              startWith<LoadableState<AuthorOption[]>>({ loading: true, error: null, data: [] })
            )
        )
      ),
      { initialValue: { loading: false, error: null, data: [] } }
    );
  }

  private initPlatformsState(): Signal<LoadableState<SocialListeningPlatform[]>> {
    return this.initFoundationOptions((foundationSlug) => this.socialListeningService.getMentionsPlatforms({ foundationSlug }));
  }

  /** Shared pipeline for the foundation-scoped (period-independent) option fetches. */
  private initFoundationOptions<T>(fetchFn: (foundationSlug: string) => Observable<T[]>): Signal<LoadableState<T[]>> {
    return toSignal(
      toObservable(this.foundationSlug).pipe(
        filter((slug) => !!slug),
        distinctUntilChanged(),
        switchMap((foundationSlug) =>
          fetchFn(foundationSlug).pipe(
            map((data): LoadableState<T[]> => ({ loading: false, error: null, data })),
            catchError(() => of<LoadableState<T[]>>({ loading: false, error: 'Failed to load options', data: [] })),
            startWith<LoadableState<T[]>>({ loading: true, error: null, data: [] })
          )
        )
      ),
      { initialValue: { loading: false, error: null, data: [] } }
    );
  }

  private initMentions(): Signal<Mention[]> {
    return computed(() => {
      const start = this.localOffset();
      return this.currentWindowData()
        .mentions.slice(start, start + this.pageSize())
        .map(mapRawToMention);
    });
  }

  private initReadMentionIds(): Signal<Set<string>> {
    return computed(() => {
      // Empty while the read state loads — cards must not flash read before the persisted state arrives.
      if (this.readState().loading) return new Set<string>();
      const ids = new Set<string>();
      for (const m of this.mentions()) {
        if (this.mentionReadStateService.isRead(m.id, m.timestamp)) ids.add(m.id);
      }
      return ids;
    });
  }

  private initTotalRecords(): Signal<number> {
    return computed(() => this.countState().data ?? 0);
  }

  private initDataComputedAt(): Signal<Date | null> {
    return computed(() => {
      const timestamp = this.currentWindowData().computedAt;
      if (!timestamp) return null;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    });
  }

  private initActiveViewName(): Signal<string | null> {
    return computed(() => {
      const id = this.activeViewId();
      if (!id) return null;
      return this.savedFilters().find((v) => v.id === id)?.name ?? null;
    });
  }

  /** Keeps the partial window but flags it, so the list offers a retry row instead of a bare empty state. */
  private flagWindowFailed(windowIdx: number, cacheKey: string): void {
    const previous = this.windowCache().get(windowIdx);
    this.updateWindowCache(windowIdx, cacheKey, {
      mentions: previous?.mentions ?? [],
      computedAt: previous?.computedAt ?? null,
      complete: false,
      phase2Failed: true,
    });
  }

  /** Caches a fetched window and prunes entries farther than ±MENTION_MAX_CACHED_WINDOWS from it. */
  private updateWindowCache(windowIdx: number, cacheKey: string, data: SocialListeningWindowCacheEntry): void {
    // An in-flight response from before a scope/filter reset can land after the cache was cleared
    // (pipeline cancellation lags one macrotask) — drop it instead of serving stale rows.
    if (cacheKey !== untracked(this.feedCacheKey)) return;
    // Window 0 holds the global newest (feed sorts newest-first) — retain its cutoff outside the prunable cache.
    if (windowIdx === 0) {
      this.newestMentionTs = this.newestTsOf(data.mentions);
    }
    this.windowCache.update((cache) => {
      const updated = new Map(cache).set(windowIdx, data);
      for (const key of Array.from(updated.keys())) {
        if (Math.abs(key - windowIdx) > MENTION_MAX_CACHED_WINDOWS) updated.delete(key);
      }
      return updated;
    });
  }

  /** Newest parseable MENTION_TS in a window — epoch-ms compare since Snowflake's space-separated timestamps don't lexicographically sort against ISO "T"; NaN never wins a `>` compare, so unparseable values are skipped. */
  private newestTsOf(mentions: SocialListeningMention[]): string | null {
    return mentions.reduce<string | null>((max, m) => {
      if (!m.MENTION_TS) return max;
      const time = new Date(m.MENTION_TS).getTime();
      if (Number.isNaN(time)) return max;
      return max === null || time > new Date(max).getTime() ? m.MENTION_TS : max;
    }, null);
  }

  private evictWindowCache(windowIdx: number): void {
    this.windowCache.update((cache) => {
      if (!cache.has(windowIdx)) return cache;
      const updated = new Map(cache);
      updated.delete(windowIdx);
      return updated;
    });
  }
}
