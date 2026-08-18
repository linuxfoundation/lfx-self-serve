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
  MENTION_FILTER_MAX_VALUES,
  MENTION_MAX_CACHED_WINDOWS,
  MENTION_PAGE_SIZE_OPTIONS,
  MENTION_SEARCH_DEBOUNCE_MS,
  MENTION_SEARCH_MIN_CHARS,
  MENTION_SERVER_WINDOW_SIZE,
  MENTION_TIME_TICK_INTERVAL_MS,
} from '@lfx-one/shared/constants';
import {
  applyPredicateToSignals,
  buildActiveFilterPills,
  buildMentionFilters,
  countActiveFilters,
  decodePredicateFromQueryParams,
  encodePredicateToQueryParams,
  getDefaultMarketingImpactPeriod,
  mapAuthorsToOptions,
  mapLanguagesToOptions,
  mapPlatformsToOptions,
  mapRawToMention,
  mapSubProjectsToOptions,
  mergeSelectedAuthors,
  predicatesEqual,
  predicateFromSignals,
  queryParamsEqual,
  scopesEqual,
} from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { SocialListeningService } from '@services/social-listening.service';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
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
  ScopeState,
  SocialListeningCountRequest,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningPlatform,
  SocialListeningScopedOptionsRequest,
  SocialListeningSignals,
  SocialListeningSubProject,
  SocialListeningTab,
  SocialListeningWindowCacheEntry,
} from '@lfx-one/shared/interfaces';

import { SocialListeningAnalyticsComponent } from './components/analytics/social-listening-analytics.component';
import { FeedHeaderComponent } from './components/feed-header/feed-header.component';
import { FiltersPanelComponent } from './components/filters-panel/filters-panel.component';
import { MentionsListComponent } from './components/mentions-list/mentions-list.component';

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
  ],
  templateUrl: './social-listening.component.html',
  styleUrl: './social-listening.component.scss',
})
export class SocialListeningComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly socialListeningService = inject(SocialListeningService);

  private readonly defaultPeriod = getDefaultMarketingImpactPeriod();
  private readonly serverWindowSize = MENTION_SERVER_WINDOW_SIZE;

  // === Model signals (two-way bound by the feed header) ===
  public readonly activeTab = signal<SocialListeningTab>('feed');
  public readonly selectedPeriod = signal(this.defaultPeriod);
  public readonly selectedProject = signal('all');
  public readonly selectedPlatform = signal('all');
  public readonly searchInput = signal('');

  // === Filter signals (wired into the predicate now; the filters panel UI lands in LFXV2-3017) ===
  public readonly selectedSentiment = signal('all');
  public readonly selectedRelevance = signal('all');
  public readonly selectedLanguage = signal('all');
  public readonly selectedHasTitle = signal('all');
  public readonly selectedKeywords = signal<string[]>([]);
  public readonly selectedTags = signal<string[]>([]);
  public readonly selectedAuthors = signal<string[]>([]);

  // === Pagination state ===
  public readonly currentPage = signal(0);
  public readonly pageSize = signal(DEFAULT_MENTION_PAGE_SIZE);
  public readonly rowsPerPageOptions = MENTION_PAGE_SIZE_OPTIONS;
  private readonly windowCache = signal<Map<number, SocialListeningWindowCacheEntry>>(new Map());
  private readonly backgroundLoading = signal(false);
  /** Bumped to force a one-time refetch of a window whose phase-2 fill failed. */
  private readonly feedRetryTick = signal(0);
  /** Windows that already consumed their one automatic refetch (reset on scope change). */
  private readonly retriedWindows = new Set<number>();

  // === Filters panel state (LFXV2-3017) ===
  public readonly filtersOpen = signal(false);
  private readonly filtersOpenedOnce = signal(false);

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

  private readonly windowIndex = computed(() => Math.floor((this.currentPage() * this.pageSize()) / this.serverWindowSize));
  // The server clamps offset at MAX_FEED_OFFSET (100,000) — past ~1000 windows the response is clamped, not window-accurate.
  private readonly serverOffset = computed(() => this.windowIndex() * this.serverWindowSize);
  private readonly localOffset = computed(() => this.currentPage() * this.pageSize() - this.serverOffset());

  // === Request pipelines ===
  private readonly searchQuery: Signal<string> = this.initSearchQuery();
  /** The live feed predicate as a request fragment — drives the feed, the count, and (as an input) the analytics tab. */
  public readonly currentFilters: Signal<MentionFilters> = this.initCurrentFilters();
  private readonly feedRequest: Signal<SocialListeningFeedRequest | null> = this.initFeedRequest();
  private readonly countRequest: Signal<SocialListeningCountRequest | null> = this.initCountRequest();
  private readonly feedCacheKey: Signal<string | null> = this.initFeedCacheKey();
  private readonly feedState: Signal<LoadableState<SocialListeningFeedResponse>> = this.initFeedState();
  private readonly countState: Signal<LoadableState<number>> = this.initTotalRecords();
  public readonly totalRecords = computed(() => this.countState().data ?? 0);
  public readonly countError = computed(() => this.countState().error);
  private readonly subProjectsState: Signal<LoadableState<SocialListeningSubProject[]>> = this.initSubProjectsState();
  private readonly platformsState: Signal<LoadableState<SocialListeningPlatform[]>> = this.initPlatformsState();

  public readonly subProjectOptions = computed(() => mapSubProjectsToOptions(this.subProjectsState().data));
  public readonly platformOptions = computed(() => mapPlatformsToOptions(this.platformsState().data));
  public readonly optionsLoading = computed(() => this.subProjectsState().loading || this.platformsState().loading);

  // === Filter-option pipelines (3017): lazy — gated on filtersOpenedOnce, never fire on page load ===
  private readonly languagesState: Signal<LoadableState<string[]>> = this.initLanguagesState();
  private readonly keywordsState: Signal<LoadableState<string[]>> = this.initScopedOptionsState((req) => this.socialListeningService.getMentionsKeywords(req));
  // The filter panel needs the full tag vocabulary for the scope, not the analytics top-10 default.
  private readonly tagsState: Signal<LoadableState<string[]>> = this.initScopedOptionsState((req) =>
    this.socialListeningService.getMentionsTags({ ...req, limit: MENTION_FILTER_MAX_VALUES }).pipe(map((tags) => tags.map((tag) => tag.TAG)))
  );
  private readonly authorsState: Signal<LoadableState<AuthorOption[]>> = this.initAuthorsState();

  public readonly languageOptions = computed(() => mapLanguagesToOptions(this.languagesState().data));
  public readonly languagesLoading = computed(() => this.languagesState().loading);
  public readonly availableKeywords = computed(() => this.keywordsState().data);
  public readonly keywordsLoading = computed(() => this.keywordsState().loading);
  public readonly availableTags = computed(() => this.tagsState().data);
  public readonly tagsLoading = computed(() => this.tagsState().loading);
  // A kept author selection can drop out of the rescoped options — mergeSelectedAuthors re-adds
  // it as a placeholder so the multiselect chip label still resolves.
  public readonly availableAuthors = computed(() => mergeSelectedAuthors(this.authorsState().data, this.selectedAuthors()));
  public readonly authorsLoading = computed(() => this.authorsState().loading);

  public readonly activeFilterCount = computed(() => countActiveFilters(this.currentPredicate()));
  public readonly activeFilterPills = computed(() => buildActiveFilterPills(this.currentPredicate()));

  private readonly currentWindowData = computed(() => this.windowCache().get(this.windowIndex()) ?? this.feedState().data);

  public readonly loading = computed(() => {
    const windowData = this.windowCache().get(this.windowIndex());
    if (!windowData) return this.feedState().loading;
    if (windowData.complete) return false;
    // Partial window: the visible page extends past what phase 2 has filled so far.
    const neededEnd = this.localOffset() + this.pageSize();
    if (neededEnd <= windowData.mentions.length) return false;
    return this.backgroundLoading() || this.feedState().loading;
  });
  public readonly error = computed(() => this.feedState().error);
  public readonly first = computed(() => this.currentPage() * this.pageSize());
  public readonly mentions: Signal<Mention[]> = this.initMentions();
  public readonly dataComputedAt: Signal<Date | null> = this.initDataComputedAt();

  // === Predicate/scope codec state ===
  private readonly signals: SocialListeningSignals = {
    selectedSentiment: this.selectedSentiment,
    selectedRelevance: this.selectedRelevance,
    selectedLanguage: this.selectedLanguage,
    selectedHasTitle: this.selectedHasTitle,
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
      const { predicate, scope } = decodePredicateFromQueryParams(params, this.defaultPeriod);
      if (predicatesEqual(predicate, this.currentPredicate()) && scopesEqual(scope, this.currentScope())) return;
      applyPredicateToSignals(predicate, this.signals);
      this.activeTab.set(scope.activeTab);
      this.selectedPeriod.set(scope.period);
      this.selectedProject.set(scope.sourceProjectId);
      this.selectedPlatform.set(scope.platform);
      this.commitScopeKey();
    });

    // State → URL. `merge` preserves 3rd-party params (utm_*); the encoder emits explicit nulls
    // for owned keys at default so merge removes them. queryParamsEqual prevents write loops.
    effect(() => {
      const target = encodePredicateToQueryParams(this.currentPredicate(), this.currentScope(), this.defaultPeriod);
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

    // A language the loaded scope carries no rows for (stale URL, rescoped period) is dropped rather
    // than left advertising a pill nothing can match — only once the option list has actually landed.
    effect(() => {
      const state = this.languagesState();
      if (state.loading || state.data.length === 0) return;
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

    // Close the panel on tab leave — remounting it on return would steal focus into a dialog the user never reopened.
    effect(() => {
      if (this.activeTab() === 'analytics') untracked(() => this.filtersOpen.set(false));
    });

    // Any scope/filter change restarts pagination from the first page with a cold window cache.
    // (foundationSlug + selectedPeriod are explicit deps; the selects feed in via currentFilters.)
    effect(() => {
      this.foundationSlug();
      this.selectedPeriod();
      this.currentFilters();
      untracked(() => {
        this.currentPage.set(0);
        this.windowCache.set(new Map());
        this.retriedWindows.clear();
      });
    });

    // Foundation switch resets the sub-project + platform scope (their option lists rescope).
    effect(() => {
      const current = this.foundationSlug();
      const previous = this.previousFoundationSlug;
      if (previous !== null && previous !== '' && previous !== current) {
        this.selectedProject.set('all');
        this.selectedPlatform.set('all');
      }
      this.previousFoundationSlug = current;
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

  /** Arms the deferred filter-option fetches on hover/focus so the round-trip hides behind the intent→click gap (PCC port). */
  public prefetchFilterOptions(): void {
    if (!this.filtersOpenedOnce()) {
      this.filtersOpenedOnce.set(true);
    }
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
      keywords: () => this.selectedKeywords.set([]),
      tags: () => this.selectedTags.set([]),
      authors: () => this.selectedAuthors.set([]),
      search: () => this.searchInput.set(''),
    };
    resetters[id as keyof FilterPredicate]?.();
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

  private initSearchQuery(): Signal<string> {
    return toSignal(
      toObservable(this.searchInput).pipe(
        debounceTime(MENTION_SEARCH_DEBOUNCE_MS),
        map((value) => {
          const trimmed = value.trim();
          return trimmed.length >= MENTION_SEARCH_MIN_CHARS ? trimmed : '';
        }),
        distinctUntilChanged()
      ),
      { initialValue: '' }
    );
  }

  private initCurrentFilters(): Signal<MentionFilters> {
    return computed(() =>
      buildMentionFilters({
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
      })
    );
  }

  private initFeedRequest(): Signal<SocialListeningFeedRequest | null> {
    return computed(() => {
      const foundationSlug = this.foundationSlug();
      if (!foundationSlug) return null;
      return {
        foundationSlug,
        period: this.selectedPeriod(),
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
      return { foundationSlug, period: this.selectedPeriod(), ...this.currentFilters() };
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

          const initialLimit = this.localOffset() === 0 ? this.pageSize() : this.serverWindowSize;
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
                // Drop the half-filled window, then force one refetch — in-window paging never re-emits
                // feedRequest, so without the tick the window's later pages stay empty until a revisit.
                // A stale window's failure must not consume the live filter set's one retry.
                catchError(() => {
                  if (cacheKey === untracked(this.feedCacheKey)) {
                    this.evictWindowCache(windowIdx);
                    if (!this.retriedWindows.has(windowIdx)) {
                      this.retriedWindows.add(windowIdx);
                      this.feedRetryTick.update((tick) => tick + 1);
                    }
                  }
                  return EMPTY;
                }),
                finalize(() => this.backgroundLoading.set(false))
              );

              return merge(of(phase1State), phase2$);
            }),
            catchError((err) =>
              of<LoadableState<SocialListeningFeedResponse>>({ loading: false, error: err?.message || 'Failed to load mentions', data: EMPTY_FEED_RESPONSE })
            ),
            startWith<LoadableState<SocialListeningFeedResponse>>({ loading: true, error: null, data: EMPTY_FEED_RESPONSE })
          );
        })
      ),
      { initialValue: { loading: true, error: null, data: EMPTY_FEED_RESPONSE } }
    );
  }

  private initTotalRecords(): Signal<LoadableState<number>> {
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

  /** Languages option fetch (3017): deferred until the Filters button is first hovered/focused/opened. */
  private initLanguagesState(): Signal<LoadableState<string[]>> {
    return toSignal(
      toObservable(computed(() => ({ foundationSlug: this.foundationSlug(), period: this.selectedPeriod(), opened: this.filtersOpenedOnce() }))).pipe(
        debounceTime(0), // Coalesce synchronous signal changes (foundation switch + scope reset) into one fetch
        filter((t) => !!t.foundationSlug && !!t.period && t.opened),
        switchMap((t) =>
          this.socialListeningService.getMentionsLanguages({ foundationSlug: t.foundationSlug, period: t.period }).pipe(
            map((data): LoadableState<string[]> => ({ loading: false, error: null, data })),
            catchError(() => of<LoadableState<string[]>>({ loading: false, error: 'Failed to load options', data: [] })),
            startWith<LoadableState<string[]>>({ loading: true, error: null, data: [] })
          )
        )
      ),
      { initialValue: { loading: false, error: null, data: [] } }
    );
  }

  /** Keywords/tags option fetches (3017): like languages, but also refetch when the platform/sub-project scope changes. */
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
              catchError(() => of<LoadableState<AuthorOption[]>>({ loading: false, error: null, data: [] })),
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

  private initDataComputedAt(): Signal<Date | null> {
    return computed(() => {
      const timestamp = this.currentWindowData().computedAt;
      if (!timestamp) return null;
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    });
  }

  /** Caches a fetched window and prunes entries farther than ±MENTION_MAX_CACHED_WINDOWS from it. */
  private updateWindowCache(windowIdx: number, cacheKey: string, data: SocialListeningWindowCacheEntry): void {
    // An in-flight response from before a scope/filter reset can land after the cache was cleared
    // (pipeline cancellation lags one macrotask) — drop it instead of serving stale rows.
    if (cacheKey !== untracked(this.feedCacheKey)) return;
    this.windowCache.update((cache) => {
      const updated = new Map(cache).set(windowIdx, data);
      for (const key of Array.from(updated.keys())) {
        if (Math.abs(key - windowIdx) > MENTION_MAX_CACHED_WINDOWS) updated.delete(key);
      }
      return updated;
    });
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
