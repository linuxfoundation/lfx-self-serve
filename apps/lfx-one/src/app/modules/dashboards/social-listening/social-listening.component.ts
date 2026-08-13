// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, effect, inject, PLATFORM_ID, Signal, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { MessageComponent } from '@components/message/message.component';
import {
  DEFAULT_MENTION_PAGE_SIZE,
  MENTION_MAX_CACHED_WINDOWS,
  MENTION_PAGE_SIZE_OPTIONS,
  MENTION_SEARCH_DEBOUNCE_MS,
  MENTION_SEARCH_MIN_CHARS,
  MENTION_SERVER_WINDOW_SIZE,
  MENTION_TIME_TICK_INTERVAL_MS,
} from '@lfx-one/shared/constants';
import {
  applyPredicateToSignals,
  buildMentionFilters,
  decodePredicateFromQueryParams,
  encodePredicateToQueryParams,
  getDefaultMarketingImpactPeriod,
  mapPlatformsToOptions,
  mapRawToMention,
  mapSubProjectsToOptions,
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
  tap,
} from 'rxjs';

import type {
  FilterPredicate,
  LoadableState,
  Mention,
  MentionFilters,
  ScopeState,
  SocialListeningCountRequest,
  SocialListeningFeedRequest,
  SocialListeningFeedResponse,
  SocialListeningPlatform,
  SocialListeningSignals,
  SocialListeningSubProject,
  SocialListeningTab,
} from '@lfx-one/shared/interfaces';

import { FeedHeaderComponent } from './components/feed-header/feed-header.component';
import { MentionsListComponent } from './components/mentions-list/mentions-list.component';

/** Shared immutable empty-feed value for initial/error/no-scope states. */
const EMPTY_FEED_RESPONSE: SocialListeningFeedResponse = { mentions: [], computedAt: null };

/**
 * Social Listening — Foundation Lens page (ED-only), LFXV2-3016. Ports PCC's mentions feed
 * (`reports/social-listening`) onto the LFXV2-3015 REST endpoints: two-phase windowed pagination
 * (100-row server windows, ±2 cached), bidirectional query-param sync via the shared codec, and
 * reset effects on scope/filter/foundation change. Bookmarks, read state, saved views, the
 * filters panel (3017), and the analytics tab content (3018) are out of scope for this slice.
 */
@Component({
  selector: 'lfx-social-listening',
  imports: [CardComponent, EmptyStateComponent, MessageComponent, FeedHeaderComponent, MentionsListComponent],
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
  private readonly windowCache = signal<Map<number, SocialListeningFeedResponse>>(new Map());
  private readonly backgroundLoading = signal(false);

  /** Shared heartbeat that re-evaluates relative timestamps on rendered cards (one interval per page, not per card). */
  public readonly timeTick = signal(0);

  private previousFoundationSlug: string | null = null;
  private previousScopeKey: string | null = null;

  // === Scope derivations ===
  public readonly foundationSlug = computed(() => this.projectContextService.selectedFoundation()?.slug ?? '');
  public readonly hasFoundation = computed(() => !!this.foundationSlug());

  private readonly windowIndex = computed(() => Math.floor((this.currentPage() * this.pageSize()) / this.serverWindowSize));
  private readonly serverOffset = computed(() => this.windowIndex() * this.serverWindowSize);
  private readonly localOffset = computed(() => this.currentPage() * this.pageSize() - this.serverOffset());

  // === Request pipelines ===
  private readonly searchQuery: Signal<string> = this.initSearchQuery();
  private readonly currentFilters: Signal<MentionFilters> = this.initCurrentFilters();
  private readonly feedRequest: Signal<SocialListeningFeedRequest | null> = this.initFeedRequest();
  private readonly countRequest: Signal<SocialListeningCountRequest | null> = this.initCountRequest();
  private readonly feedState: Signal<LoadableState<SocialListeningFeedResponse>> = this.initFeedState();
  public readonly totalRecords: Signal<number> = this.initTotalRecords();
  private readonly subProjectsState: Signal<LoadableState<SocialListeningSubProject[]>> = this.initSubProjectsState();
  private readonly platformsState: Signal<LoadableState<SocialListeningPlatform[]>> = this.initPlatformsState();

  public readonly subProjectOptions = computed(() => mapSubProjectsToOptions(this.subProjectsState().data));
  public readonly platformOptions = computed(() => mapPlatformsToOptions(this.platformsState().data));
  public readonly optionsLoading = computed(() => this.subProjectsState().loading || this.platformsState().loading);

  private readonly currentWindowData = computed(() => this.windowCache().get(this.windowIndex()) ?? this.feedState().data);

  public readonly loading = computed(() => {
    const windowData = this.windowCache().get(this.windowIndex());
    if (!windowData) return this.feedState().loading;
    // Cached window but the visible page extends past what phase 2 has filled so far.
    const neededEnd = this.localOffset() + this.pageSize();
    return neededEnd > windowData.mentions.length && this.backgroundLoading();
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

  public readonly currentPredicate = computed<FilterPredicate>(() => predicateFromSignals(this.signals), { equal: predicatesEqual });

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

    // Any scope/filter change restarts pagination from the first page with a cold window cache.
    // (foundationSlug + selectedPeriod are explicit deps; the selects feed in via currentFilters.)
    effect(() => {
      this.foundationSlug();
      this.selectedPeriod();
      this.currentFilters();
      untracked(() => {
        this.currentPage.set(0);
        this.windowCache.set(new Map());
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
  }

  public onPageChange(event: { page: number; rows: number }): void {
    this.currentPage.set(event.page);
    this.pageSize.set(event.rows);
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

  /**
   * Two-phase windowed feed fetch (ported from PCC): phase 1 fetches just the visible page for a
   * fast first paint when the page sits at the window start; phase 2 fills the rest of the window
   * in the background as one stream (no nested subscribes) — `switchMap` cancels it on re-entry.
   */
  private initFeedState(): Signal<LoadableState<SocialListeningFeedResponse>> {
    return toSignal(
      toObservable(this.feedRequest).pipe(
        debounceTime(0), // Coalesce synchronous signal changes into one emission
        switchMap((req) => {
          if (req === null) {
            return of<LoadableState<SocialListeningFeedResponse>>({ loading: false, error: null, data: EMPTY_FEED_RESPONSE });
          }

          const windowIdx = Math.floor((req.offset ?? 0) / this.serverWindowSize);
          const cached = this.windowCache().get(windowIdx);
          if (cached) {
            return of<LoadableState<SocialListeningFeedResponse>>({ loading: false, error: null, data: cached });
          }

          const initialLimit = this.localOffset() === 0 ? this.pageSize() : this.serverWindowSize;
          const initialReq = { ...req, limit: initialLimit };

          return this.socialListeningService.getMentionsFeed(initialReq).pipe(
            switchMap((phase1Data) => {
              this.updateWindowCache(windowIdx, phase1Data);
              const phase1State: LoadableState<SocialListeningFeedResponse> = { loading: false, error: null, data: phase1Data };

              const remaining = this.serverWindowSize - initialLimit;
              if (remaining <= 0 || phase1Data.mentions.length < initialLimit) return of(phase1State);

              this.backgroundLoading.set(true);
              const backgroundRequest = { ...req, limit: remaining, offset: (req.offset ?? 0) + initialLimit };
              const phase2$ = this.socialListeningService.getMentionsFeed(backgroundRequest).pipe(
                tap((backgroundData) => {
                  const previous = this.windowCache().get(windowIdx);
                  this.updateWindowCache(windowIdx, {
                    mentions: [...(previous?.mentions ?? []), ...backgroundData.mentions],
                    computedAt: backgroundData.computedAt ?? previous?.computedAt ?? null,
                  });
                }),
                ignoreElements(),
                catchError(() => EMPTY),
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

  private initTotalRecords(): Signal<number> {
    return toSignal(
      toObservable(this.countRequest).pipe(
        debounceTime(0), // Coalesce synchronous signal changes into one emission
        switchMap((req) => {
          if (req === null) return of(0);
          return this.socialListeningService.getMentionsCount(req).pipe(
            map((response) => response.total),
            catchError(() => of(0))
          );
        })
      ),
      { initialValue: 0 }
    );
  }

  private initSubProjectsState(): Signal<LoadableState<SocialListeningSubProject[]>> {
    return this.initFoundationOptions((foundationSlug) => this.socialListeningService.getMentionsProjects({ foundationSlug }));
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
  private updateWindowCache(windowIdx: number, data: SocialListeningFeedResponse): void {
    this.windowCache.update((cache) => {
      const updated = new Map(cache).set(windowIdx, data);
      for (const key of Array.from(updated.keys())) {
        if (Math.abs(key - windowIdx) > MENTION_MAX_CACHED_WINDOWS) updated.delete(key);
      }
      return updated;
    });
  }
}
